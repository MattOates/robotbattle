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
 */
let session: TtsSession | null = null;

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

    session ??= await TtsSession.create({
      voiceId: request.voiceId,
      wasmPaths: request.wasmPaths,
    });
    const wav = await (await session.predict(request.text)).arrayBuffer();
    post({ id: request.id, kind: "wav", wav }, [wav]);
  } catch (error) {
    post({
      id: request.id,
      kind: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
