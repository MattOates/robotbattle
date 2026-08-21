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
import type { AssistantModel, AssistantRuntime, LoadProgress } from "./runtime.js";
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
 * The default is the one WebLLM uses in its own chat example, which makes it
 * the best-travelled path through this stack — worth more here than a couple of
 * points of raw ability, given how much of the difficulty has been in the
 * plumbing rather than the model.
 *
 * Nothing here is tuned for function calling, and after the last attempt that
 * is a feature: the schema does the constraining, so what is wanted is a model
 * that follows instructions and writes valid JSON, which is every one of these.
 */
export const ASSISTANT_MODELS: readonly AssistantModel[] = [
  { id: "Llama-3.2-1B-Instruct-q4f32_1-MLC", label: "Llama 3.2 (1B)", vramMB: 1128.82 },
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 (1.5B)", vramMB: 1629.75 },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 (3B)", vramMB: 2263.69 },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 (3B)", vramMB: 2504.76 },
];

export const DEFAULT_MODEL_ID = ASSISTANT_MODELS[0]!.id;

export function isSupportedModel(id: string): boolean {
  return ASSISTANT_MODELS.some((m) => m.id === id);
}

export function webGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export const webllmJsonRuntime: AssistantRuntime = {
  models: ASSISTANT_MODELS,
  defaultModelId: DEFAULT_MODEL_ID,
  // A 1B sharing a 4096 token window with the protocol and the player's script.
  promptBudget: "tight",
  available: webGpuAvailable,
  create: (modelId, onProgress) => WebLLMJsonProvider.create(modelId, onProgress),
};

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
    const messages = flattenToolTurns(withProtocol(req.messages, req.tools));
    const deadline = deadlineWhileVisible(REPLY_TIMEOUT_MS);

    let reply: Reply | null;
    try {
      reply = await Promise.race([
        this.engine.chat.completions.create({
          messages,
          // No `tools`. That is the whole point — see the file header.
          response_format: {
            type: "json_object",
            schema: JSON.stringify(protocolSchema(req.tools)),
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
): ChatRequest["messages"] {
  const protocol = protocolInstructions(tools);
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
