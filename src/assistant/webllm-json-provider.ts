/**
 * The in-browser provider, second attempt: structured JSON instead of tools.
 *
 * Same engine, same seam, a different bargain with it. `tools` is never sent,
 * so WebLLM does not take over the prompt, and instead the reply is pinned to a
 * JSON schema we wrote — see `json-protocol.ts` for why that is the useful kind
 * of constraint. Not sending `tools` also gives back two things it takes away:
 * a real system message, and a `response_format` of our own.
 *
 * The models are ordinary small instruct models rather than the five 7-8B ones
 * WebLLM gates function calling behind, so the download is about a gigabyte
 * rather than four or five.
 */

import type { ChatProvider, ChatRequest, ChatResponse } from "./provider.js";
import type {
  AssistantCapability,
  AssistantModel,
  AssistantRuntime,
  LoadProgress,
} from "./runtime.js";
import {
  callsFromReply,
  flattenToolTurns,
  parseReply,
  protocolInstructions,
  protocolSchema,
} from "./json-protocol.js";

/**
 * Small instruct models, none over 3 GB.
 *
 * Ordinary instruct models rather than anything tuned for function calling,
 * because the schema does the constraining now: what is wanted is a model that
 * follows an instruction and writes valid JSON, which is all of these.
 *
 * Ordered smallest first, and the default is deliberately not the smallest.
 * The job is explaining a language from a lesson quoted in the prompt, and on
 * that the 3B is plainly better than the 1B — the same question that got
 * "Sparky will run on tracks, which are slower but can spin in place" from the
 * 3B got a paragraph about real-world military vehicles from the 1B. An extra
 * gigabyte is worth that; it is most of the feature.
 */
/**
 * Two rungs, both Gemma 2, because the difference between them is stark enough
 * to be worth a real choice and a third option would only be a worse version of
 * one of them.
 *
 * The small one does not write code. It explains, it reads the player's script,
 * and where an example would help it quotes one out of the lessons — code that
 * is compiled on every test run and therefore cannot be wrong. The large one
 * composes, and is good enough at it to be worth six gigabytes.
 */
export const ASSISTANT_MODELS: readonly AssistantModel[] = [
  {
    id: "gemma-2-2b-it-q4f16_1-MLC",
    label: "Guide",
    blurb: "Answers questions about RoboScript and finds the right example in the lessons.",
    vramMB: 1895.13,
    composes: false,
    // Names and shapes only. A 2B spends its attention badly given more.
    promptBudget: "tight",
  },
  {
    id: "gemma-2-9b-it-q4f16_1-MLC",
    label: "Tutor",
    blurb: "Everything the Guide does, and writes examples for your own robot. Slower to answer.",
    vramMB: 6422.01,
    composes: true,
    // The full reference, with what every event carries and what every
    // property means. This is most of what the extra three and a half
    // gigabytes are for.
    promptBudget: "roomy",
  },
];

/**
 * The largest of them, and a real ask: six and a half gigabytes of video
 * memory, against the two the rest of the list needs.
 *
 * Worth it because the quality is the whole feature. Everything below this is
 * good at "what does chassis tank mean" and unreliable the moment a question
 * needs two facts joined together, and no amount of prompt or retrieval work
 * has moved that — the ceiling has been the model for a while. The smaller
 * rungs stay for machines that cannot spare the memory.
 */
export const DEFAULT_MODEL_ID = "gemma-2-9b-it-q4f16_1-MLC";

export function isSupportedModel(id: string): boolean {
  return ASSISTANT_MODELS.some((m) => m.id === id);
}

export function webGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/**
 * The smallest thing on offer, so the gate is "can it run anything at all".
 */
const SMALLEST_MB = 1895.13;

/**
 * Can this machine actually run a model?
 *
 * `"gpu" in navigator` is not the question, though it was what we were asking.
 * A browser can have the WebGPU API and no adapter behind it — a virtual
 * machine, a blocklisted driver, a laptop on its integrated chip with hardware
 * acceleration switched off — and the failure then arrives after somebody has
 * agreed to a two gigabyte download, which is the worst possible moment.
 *
 * WebLLM has this check inside it, in `detectGPUDevice`, and does not export
 * it; reaching it would mean importing the whole inference engine before we
 * know whether we can use it. The adapter answers the same question directly.
 *
 * Deliberately conservative about saying no. Every test here rules out
 * something definitely broken rather than guessing at whether a machine is
 * fast enough, because "too slow" is a judgement the player can make for
 * themselves and "no GPU" is not.
 */
export async function probeCapability(): Promise<AssistantCapability> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    return { ok: false, reason: "this browser has no WebGPU" };
  }
  try {
    const adapter = await (navigator as Navigator & { gpu: GPU }).gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: "no graphics adapter is available to the browser" };

    // A binding limit this small means a software or heavily restricted
    // adapter; the weights are uploaded in chunks and would never fit.
    const limit = adapter.limits.maxStorageBufferBindingSize;
    if (limit < 128 * 1024 * 1024) {
      return { ok: false, reason: "the graphics adapter is too limited" };
    }

    // Reported by Chrome only, rounded, and capped at 8 — so it is useful for
    // ruling out a genuinely small machine and useless for anything else.
    const ram = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (typeof ram === "number" && ram > 0 && ram * 1024 < SMALLEST_MB * 2) {
      return { ok: false, reason: "there is not enough memory for the smallest model" };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: "the graphics adapter could not be reached" };
  }
}

export const webllmJsonRuntime: AssistantRuntime = {
  models: ASSISTANT_MODELS,
  defaultModelId: DEFAULT_MODEL_ID,
  capability: probeCapability,
  isCached: modelIsCached,
  cached: cachedModels,
  forget: forgetDownloads,
  create: (modelId, onProgress) => WebLLMJsonProvider.create(modelId, onProgress),
};

/**
 * Is this model already sitting in the browser's cache?
 *
 * WebLLM has `hasModelInCache`, and it lives inside the engine — importing five
 * megabytes of inference runtime to answer a yes/no would undo the whole reason
 * the engine is loaded lazily. It stores weights in a Cache API bucket of its
 * own, keyed by URLs that carry the model id, so the question can be answered
 * by looking rather than by loading.
 *
 * Every failure here answers "no", which shows a download button for something
 * already downloaded. That costs a click. Guessing "yes" wrongly would start a
 * two gigabyte fetch nobody asked for, so the asymmetry is deliberate.
 */
export async function modelIsCached(modelId: string): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    if (!(await caches.has(WEBLLM_CACHE))) return false;
    const cache = await caches.open(WEBLLM_CACHE);
    const keys = await cache.keys();
    return keys.some((request) => request.url.includes(modelId));
  } catch {
    // A browser that will not talk about its caches is one we know nothing
    // about, which is the same as not knowing whether the model is there.
    return false;
  }
}

/**
 * WebLLM's own buckets.
 *
 * Cache API, not localStorage — which matters, because the settings screen
 * reports localStorage and would cheerfully say "77 kB used" while six
 * gigabytes of weights sat next to it, invisible and undeletable.
 */
const WEBLLM_CACHE = "webllm/model";
const WEBLLM_CACHES = ["webllm/model", "webllm/wasm", "webllm/config"];

/** Which of the offered models are downloaded, and roughly how much they take. */
export async function cachedModels(): Promise<AssistantModel[]> {
  const found: AssistantModel[] = [];
  for (const model of ASSISTANT_MODELS) {
    if (await modelIsCached(model.id)) found.push(model);
  }
  return found;
}

/**
 * Throw the downloaded weights away.
 *
 * Whole buckets rather than picked-over entries: they belong to WebLLM alone,
 * a half-deleted model is worse than either keeping or losing it, and anything
 * still wanted is re-fetched on the next start. The point is that somebody who
 * gave up six gigabytes of disk can take it back without hunting through
 * browser settings for it.
 */
export async function forgetDownloads(): Promise<void> {
  if (typeof caches === "undefined") return;
  await Promise.all(
    WEBLLM_CACHES.map((name) => caches.delete(name).catch(() => false)),
  );
}

/**
 * How long to let one reply take before giving up on it.
 *
 * A reply that never arrives has no error to catch and no timeout of WebLLM's
 * own, so without this the panel says "Thinking…" until the page is reloaded.
 */
const REPLY_TIMEOUT_MS = 60_000;

/**
 * A deadline that only counts time the player can actually see.
 *
 * Chrome throttles a hidden tab hard — timers are held back to roughly one a
 * minute and the decode loop crawls along with them. A plain `setTimeout` would
 * therefore mostly measure how long the tab spent in the background, and fail
 * requests for the offence of the player looking at something else. This one
 * stops the clock while the tab is hidden, so the deadline means sixty seconds
 * of somebody actually waiting.
 */
export function deadlineWhileVisible(ms: number): { promise: Promise<null>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remaining = ms;
  let startedAt = 0;
  let done = false;

  const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

  let settle: (value: null) => void = () => {};
  const promise = new Promise<null>((resolve) => {
    settle = resolve;
  });

  const stop = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    remaining -= Date.now() - startedAt;
  };

  const start = () => {
    if (done || timer !== undefined) return;
    startedAt = Date.now();
    timer = setTimeout(() => {
      done = true;
      settle(null);
    }, Math.max(0, remaining));
  };

  const onVisibility = () => (visible() ? start() : stop());

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }
  if (visible()) start();

  return {
    promise,
    cancel: () => {
      done = true;
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    },
  };
}

type Engine = {
  chat: { completions: { create(req: unknown): Promise<unknown> } };
  /** Typed loosely on purpose: it does not reliably return a promise. */
  interruptGenerate(): unknown;
  resetChat(keepStats?: boolean): unknown;
  unload(): Promise<void>;
};

export class WebLLMJsonProvider implements ChatProvider {
  readonly id: string;
  private engine: Engine;
  private worker: Worker;
  /** Set once a run has overrun; an interrupted engine does not come back. */
  private broken = false;

  private constructor(id: string, engine: Engine, worker: Worker) {
    this.id = id;
    this.engine = engine;
    this.worker = worker;
  }

  static async create(
    modelId: string,
    onProgress: (p: LoadProgress) => void,
  ): Promise<WebLLMJsonProvider> {
    if (!isSupportedModel(modelId)) {
      throw new Error(`${modelId} is not one of the models this build offers.`);
    }
    if (!webGpuAvailable()) {
      throw new Error("This browser has no WebGPU, so it cannot run a model locally.");
    }

    const { CreateWebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
    const worker = new Worker(new URL("./webllm.worker.ts", import.meta.url), { type: "module" });
    const engine = await CreateWebWorkerMLCEngine(worker, modelId, {
      initProgressCallback: (report) => {
        onProgress({
          fraction: typeof report.progress === "number" ? report.progress : null,
          text: report.text,
        });
      },
    });
    return new WebLLMJsonProvider(modelId, engine as unknown as Engine, worker);
  }

  /** Whether the loaded model is allowed to write RoboScript of its own. */
  get composes(): boolean {
    return ASSISTANT_MODELS.find((m) => m.id === this.id)?.composes ?? true;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (this.broken) {
      throw new Error("The assistant was stopped. Start it again to keep going.");
    }

    type Reply = { choices: { message: { content: string | null } }[] };

    // The protocol goes in the system message, after whatever the caller put
    // there. It is instructions about *how to answer*, and those read better
    // last, next to the question they apply to.
    // Flattened as well as annotated: the `tool` and `tool_calls` roles the
    // loop records mean nothing to a backend that was not told about tools,
    // and leaving them in fails the request as soon as there is any history.
    // A private structured question is asked as-is: no protocol preamble, and
    // no tool vocabulary, because the answer is not a turn of conversation.
    const messages = req.json
      ? flattenToolTurns(req.messages)
      : flattenToolTurns(withProtocol(req.messages, req.tools, this.composes));
    const deadline = deadlineWhileVisible(REPLY_TIMEOUT_MS);

    let reply: Reply | null;
    try {
      reply = await Promise.race([
        this.engine.chat.completions.create({
          messages,
          // No `tools`. That is the whole point — see the file header.
          response_format: {
            type: "json_object",
            schema: JSON.stringify(
              req.json ? req.json.schema : protocolSchema(req.tools, this.composes),
            ),
          },
          // Low, because there is exactly one right shape for this answer and
          // no reason to go looking for a different one.
          temperature: req.temperature ?? 0.2,
          stream: false,
        }) as Promise<Reply>,
        deadline.promise,
      ]);
    } finally {
      deadline.cancel();
    }

    if (reply === null) {
      // An overrun run does not recover: interrupting halts it and resetting
      // the chat does not revive it, after which every question returns
      // instantly with nothing in it. Say so rather than pretend.
      try {
        await this.engine.interruptGenerate();
        await this.engine.resetChat(true);
      } catch {
        /* nothing useful to do; the message below is what matters */
      }
      this.broken = true;
      throw new Error(
        "The assistant got stuck and had to be stopped. Start it again to keep going.",
      );
    }

    const text = reply.choices[0]?.message.content ?? "";
    // A private question is answered to the caller, not to the player.
    if (req.json) return { content: text, tool_calls: [], finishReason: "stop" };

    const parsed = parseReply(text);
    if (parsed === null) {
      // Grammar-constrained output should make this impossible. If it happens
      // anyway, the raw text is more use to the player than a shrug.
      return { content: text || null, tool_calls: [], finishReason: "stop" };
    }

    return {
      content: null,
      tool_calls: callsFromReply(parsed, req.tools),
      finishReason: "tool_calls",
    };
  }

  dispose(): void {
    void this.engine.unload().catch(() => {
      // Unloading is a courtesy to the GPU; failing must not stop the player
      // closing the panel.
    });
    this.worker.terminate();
  }
}

/** Append the protocol to the system message, making one if there is none. */
export function withProtocol(
  messages: ChatRequest["messages"],
  tools: readonly { function: { name: string } }[] & ChatRequest["tools"],
  composes = true,
): ChatRequest["messages"] {
  const protocol = protocolInstructions(tools, composes);
  const index = messages.findIndex((m) => m.role === "system");
  if (index === -1) {
    return [{ role: "system", content: protocol }, ...messages];
  }
  const updated = [...messages];
  updated[index] = {
    ...messages[index]!,
    content: `${messages[index]!.content ?? ""}\n\n${protocol}`,
  };
  return updated;
}
