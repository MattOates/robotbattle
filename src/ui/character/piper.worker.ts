/**
 * Everything to do with speech, off the main thread.
 *
 * Not an optimisation — a requirement, and the reason is worth stating because
 * it is easy to undo by accident. Importing Piper at all pulls in the ONNX
 * runtime, which compiles thirteen megabytes of WebAssembly; doing that on the
 * main thread stalls the editor and the arena for seconds. So the main thread
 * never imports the package, not even to ask which voices are already
 * downloaded. Every call goes through here.
 *
 * It is also single-threaded WebAssembly, and will stay that way on a static
 * host: multi-threading needs the page to be cross-origin isolated, which needs
 * COOP and COEP response headers, which GitHub Pages does not send. So a
 * sentence is seconds of solid arithmetic, and that is all the more reason for
 * it to happen somewhere nobody is waiting on a frame.
 *
 * Same shape as `trials.worker.ts`: a tagged request in, a tagged reply out.
 */

import { TtsSession, download, stored } from "@mintplex-labs/piper-tts-web";
// The `/wasm` build specifically, because that is the one Piper imports.
// Importing the bare package instead pulls a *second*, WebGPU-capable copy of
// the runtime into this worker, and two Emscripten runtimes in one thread is
// its own kind of trouble.
import { env } from "onnxruntime-web/wasm";

/**
 * Pin the runtime to one thread, and do not let it be talked out of it.
 *
 * Multi-threaded WebAssembly needs the page to be cross-origin isolated, which
 * needs COOP and COEP response headers, which a static host like GitHub Pages
 * does not send. So one thread is not a tuning choice here — it is the only
 * thing that can work.
 *
 * Piper sets `numThreads` to `navigator.hardwareConcurrency` as it initialises,
 * and on the main thread the runtime notices it cannot honour that and warns
 * and falls back. Inside a worker it does not fall back; it fails, and reports
 * the failure as "No graph was found in the protobuf" — which sends you looking
 * at your model file for a very long time before you think to look at threads.
 * The model is fine. The property is therefore made unwritable, so Piper's
 * assignment is quietly ignored rather than breaking synthesis.
 */
try {
  Object.defineProperty(env.wasm, "numThreads", {
    get: () => 1,
    // A setter that quietly declines, rather than a read-only property. Module
    // code is strict mode, so an unwritable property makes Piper's assignment
    // *throw* during initialisation — which fails the voice just as dead, only
    // with a different confusing message.
    set: () => undefined,
    configurable: true,
  });
} catch {
  // Not configurable on this runtime: the runtime's own fallback will have to
  // do. It manages on the main thread; the risk is confined to the worker.
}

interface WasmPaths {
  onnxWasm: string;
  piperData: string;
  piperWasm: string;
}

export type PiperWorkerIn =
  | { id: number; kind: "load"; voiceId: string }
  | { id: number; kind: "say"; voiceId: string; wasmPaths: WasmPaths; text: string };

export type PiperWorkerOut =
  | { id: number; kind: "progress"; fraction: number | null }
  | { id: number; kind: "loaded" }
  | { id: number; kind: "wav"; wav: ArrayBuffer }
  | { id: number; kind: "error"; error: string };

/**
 * Built once and kept: creating a session reads a sixty-megabyte model into the
 * runtime, so doing it per sentence would make every line cost what the first
 * one did.
 *
 * The *promise* is what is stored, not the session. `session ??= await
 * create()` reads as though it builds one, but the assignment happens after the
 * await, so two overlapping calls both see null and both start building — and
 * the tour always makes two at once, saying the current step while preparing
 * the next. Two concurrent initialisations of the runtime leave it in a state
 * where the model no longer parses, which surfaces as the wonderfully
 * unhelpful "No graph was found in the protobuf".
 */
let session: Promise<TtsSession> | null = null;

/**
 * Inference, one at a time.
 *
 * A session is not re-entrant, and the queue costs nothing here: the work is
 * CPU-bound and single-threaded anyway, so overlapping it would not make it
 * finish sooner even if it were safe.
 */
let queue: Promise<unknown> = Promise.resolve();

const post = (message: PiperWorkerOut, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(message, transfer ?? []);

self.onmessage = async (event: MessageEvent<PiperWorkerIn>) => {
  const request = event.data;
  try {
    if (request.kind === "load") {
      // Already in the origin private file system from a previous visit: there
      // is nothing to fetch and nothing to report.
      const have = await stored().catch(() => [] as string[]);
      if (!have.includes(request.voiceId)) {
        await download(request.voiceId, (progress) =>
          post({
            id: request.id,
            kind: "progress",
            fraction: progress.total > 0 ? progress.loaded / progress.total : null,
          }),
        );
      }
      post({ id: request.id, kind: "loaded" });
      return;
    }

    session ??= TtsSession.create({
      voiceId: request.voiceId,
      wasmPaths: request.wasmPaths,
    });
    const ready = await session;

    const mine = queue.then(() => ready.predict(request.text));
    // Kept as the tail whatever happens, so one failure does not wedge the
    // queue behind a rejected promise.
    queue = mine.catch(() => undefined);

    const wav = await (await mine).arrayBuffer();
    post({ id: request.id, kind: "wav", wav }, [wav]);
  } catch (error) {
    post({
      id: request.id,
      kind: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
