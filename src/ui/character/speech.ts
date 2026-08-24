/**
 * The helper's voice.
 *
 * Neural text-to-speech, run entirely in this browser by Piper. Note what this
 * is *not*: the assistant's multi-gigabyte language model, gated behind a
 * button that names the size because downloading it is a serious imposition. A
 * voice is one model of a few dozen megabytes, cached in the origin private
 * file system, fetched once and never again — a different bargain, and worth
 * making without asking, but only just. Everything below treats the download as
 * something that can be slow, can fail, and must never hold anybody up.
 *
 * The seam is deliberate. `VoiceProvider` mirrors `assistant/provider.ts`, and
 * for the same reason: what does the work should be swappable without anything
 * above knowing. Piper is the only implementation today.
 */

import type { Character } from "../branding.js";
import type { PiperWorkerIn, PiperWorkerOut } from "./piper.worker.js";

/**
 * `Omit` over a union collapses it to the properties they share, which would
 * throw away the very fields that distinguish a request. Mapping over the union
 * keeps each arm intact.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** How long to wait for a voice before giving up and reading in silence. */
const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Where the WebAssembly the synthesiser runs on comes from.
 *
 * The runtime is served from our own origin — see the plugin in
 * `vite.config.ts` for why — and resolved against `document.baseURI` because
 * the site is built with relative paths and may live under any prefix.
 *
 * The phonemiser stays on its CDN, pinned. Its data file is 18 MB of eSpeak
 * dictionaries under the GPL, which is a licence to think about before copying
 * it into an ISC-licensed repository, and unlike the runtime its version is not
 * tied to anything we install.
 */
const PIPER_WASM = "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize";

function wasmPaths() {
  const base = typeof document === "undefined" ? "/" : document.baseURI;
  return {
    onnxWasm: new URL("piper-ort/", base).href,
    piperData: `${PIPER_WASM}.data`,
    piperWasm: `${PIPER_WASM}.wasm`,
  };
}

export interface VoiceProgress {
  /** 0 to 1, or null while the total size is still unknown. */
  fraction: number | null;
}

export interface VoiceProvider {
  /** Fetch and prepare the voice. Resolves when it is ready to speak. */
  load(onProgress?: (progress: VoiceProgress) => void): Promise<void>;
  /** Synthesise, without playing. Safe to call ahead of time. */
  synthesise(text: string): Promise<ArrayBuffer>;
  dispose(): void;
}

/**
 * Strip a step's markdown down to something worth reading aloud.
 *
 * A voice that says "backtick on sense robot backtick" is worse than no voice.
 * Pure, so the rules are testable without a browser or a model.
 */
export function speakable(text: string): string {
  return (
    text
      // Links: keep what was written, drop where it pointed.
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // Code, bold and italic all read as their contents.
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      // An unfilled placeholder would be read out as a word. Better to say
      // nothing than to say "open brace robot close brace".
      .replace(/\{\w+\}/g, "")
      // Whatever markup the passes above did not recognise — an unpaired
      // backtick, a row of asterisks — is still punctuation nobody should hear.
      .replace(/[`*]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Is there any prospect of this browser speaking at all? */
export function voiceSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function" &&
    (typeof window.AudioContext !== "undefined" ||
      typeof (window as { webkitAudioContext?: unknown }).webkitAudioContext !== "undefined")
  );
}

/**
 * Piper, loaded on demand.
 *
 * The import is dynamic so that the package and its WebAssembly are not in the
 * bundle anybody downloads to play the game — only in the one downloaded by
 * somebody who accepted a tour with a voice.
 */
class PiperVoice implements VoiceProvider {
  private voiceId: string;
  private ready: Promise<void> | null = null;
  /**
   * The worker doing all of it. Built on first use and kept, because it holds
   * the loaded model — and because the main thread must never import Piper
   * itself; see the worker's own note for why.
   */
  private worker: Worker | null = null;
  private nextId = 0;

  constructor(voiceId: string) {
    this.voiceId = voiceId;
  }

  private channel(): Worker {
    return (this.worker ??= new Worker(
      // `.ts`, not `.js`: this is the specifier the bundler resolves, and the
      // same form the other workers in this project use.
      new URL("./piper.worker.ts", import.meta.url),
      { type: "module" },
    ));
  }

  /** One request, one reply, with progress reports along the way. */
  private ask<T>(
    request: DistributiveOmit<PiperWorkerIn, "id">,
    want: PiperWorkerOut["kind"],
    onProgress?: (fraction: number | null) => void,
  ): Promise<T> {
    const worker = this.channel();
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const onMessage = (event: MessageEvent<PiperWorkerOut>) => {
        const reply = event.data;
        if (reply.id !== id) return;
        if (reply.kind === "progress") {
          onProgress?.(reply.fraction);
          return;
        }
        worker.removeEventListener("message", onMessage);
        if (reply.kind === "error") reject(new Error(reply.error));
        else if (reply.kind === want) resolve(reply as T);
        else reject(new Error(`unexpected reply ${reply.kind}`));
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage({ ...request, id } as PiperWorkerIn);
    });
  }

  load(onProgress?: (progress: VoiceProgress) => void): Promise<void> {
    this.ready ??= this.ask<void>({ kind: "load", voiceId: this.voiceId }, "loaded", (fraction) =>
      onProgress?.({ fraction }),
    ).then(() => undefined);
    return this.ready;
  }

  async synthesise(text: string): Promise<ArrayBuffer> {
    const reply = await this.ask<{ wav: ArrayBuffer }>(
      { kind: "say", voiceId: this.voiceId, wasmPaths: wasmPaths(), text },
      "wav",
    );
    return reply.wav;
  }

  dispose(): void {
    this.ready = null;
    this.worker?.terminate();
    this.worker = null;
  }
}

export function createVoice(character: Character): VoiceProvider {
  return new PiperVoice(character.voiceId);
}

/**
 * Speaks lines one at a time, and says how loud it is while it does.
 *
 * Two things here are less obvious than they look. Speaking a new line *stops*
 * the last one rather than queueing behind it, because a tour step that has
 * been advanced past should stop talking about itself immediately. And the
 * amplitude is measured off the audio that is actually playing rather than
 * estimated from the length of the text, so the face moves with the words even
 * when the synthesiser takes an unexpected pause.
 */
export class Speaker {
  private provider: VoiceProvider;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private samples = new Uint8Array(0);
  /** Synthesised lines, so a step already prepared plays instantly. */
  private cache = new Map<string, ArrayBuffer>();
  private disposed = false;
  /**
   * Which utterance is the current one.
   *
   * `say` has to await synthesis and decoding, and in that gap a second call
   * can arrive — pressing Next quickly, or a re-render re-running the effect.
   * Both would sail past `stop()`, because neither has started playing yet, and
   * then both would start: two copies of the same line a fraction apart, which
   * sounds like an echo. Bumping this makes every earlier call stand down at
   * its next opportunity.
   */
  private utterance = 0;

  constructor(provider: VoiceProvider) {
    this.provider = provider;
  }

  /**
   * Get the voice ready.
   *
   * Resolves `false` rather than rejecting when the voice cannot be had —
   * offline, no origin private file system, a fetch that failed, or simply
   * taking too long. The caller's job is then to carry on in silence, which is
   * a perfectly good tour, so this is not an error to handle but an answer.
   */
  async load(onProgress?: (progress: VoiceProgress) => void): Promise<boolean> {
    if (!voiceSupported()) return false;
    try {
      await Promise.race([
        this.provider.load(onProgress),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timed out")), DOWNLOAD_TIMEOUT_MS),
        ),
      ]);
      return !this.disposed;
    } catch {
      return false;
    }
  }

  /** Synthesise a line and keep it, so that saying it later is immediate. */
  async prepare(text: string): Promise<void> {
    const line = speakable(text);
    if (line === "" || this.cache.has(line) || this.disposed) return;
    try {
      this.cache.set(line, await this.provider.synthesise(line));
    } catch {
      // A line that will not synthesise is a line said silently.
    }
  }

  async say(text: string): Promise<void> {
    const line = speakable(text);
    if (line === "" || this.disposed) return;
    this.stop();
    const mine = ++this.utterance;
    const superseded = () => this.disposed || this.utterance !== mine;

    let wav = this.cache.get(line);
    if (!wav) {
      try {
        wav = await this.provider.synthesise(line);
        this.cache.set(line, wav);
      } catch {
        return;
      }
    }
    if (superseded()) return;

    try {
      const context = this.audio();
      // A context built inside a promise continuation is not built during a
      // user gesture, so it starts suspended and plays nothing. The page has
      // sticky activation by now — nobody reaches a tour without clicking —
      // which is what lets this resume rather than being refused.
      if (context.state === "suspended") await context.resume();
      if (superseded()) return;
      // `decodeAudioData` consumes the buffer it is given, so the cache keeps
      // the original and each playback decodes a copy.
      const decoded = await context.decodeAudioData(wav.slice(0));
      if (superseded()) return;

      const source = context.createBufferSource();
      source.buffer = decoded;
      source.connect(this.analyser!);
      source.start();
      this.source = source;
      source.onended = () => {
        if (this.source === source) this.source = null;
      };
    } catch {
      // Autoplay policy, a decode failure, a closed context: stay quiet.
    }
  }

  /** How loud it is right now, 0 to 1. Zero when nothing is playing. */
  amplitude(): number {
    if (!this.analyser || !this.source) return 0;
    this.analyser.getByteTimeDomainData(this.samples);
    let peak = 0;
    for (const sample of this.samples) {
      const deviation = Math.abs(sample - 128);
      if (deviation > peak) peak = deviation;
    }
    return Math.min(1, peak / 90);
  }

  get speaking(): boolean {
    return this.source !== null;
  }

  stop(): void {
    // Also invalidates anything mid-flight, so a line that has been synthesised
    // but not yet started does not begin playing after being stopped.
    this.utterance++;
    if (!this.source) return;
    try {
      this.source.stop();
    } catch {
      // Already stopped.
    }
    this.source = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.provider.dispose();
    this.cache.clear();
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }

  private audio(): AudioContext {
    if (!this.context) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.context = new Ctor();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      this.samples = new Uint8Array(this.analyser.fftSize);
      this.analyser.connect(this.context.destination);
    }
    return this.context;
  }
}
