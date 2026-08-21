/**
 * Where a model actually comes from.
 *
 * `ChatProvider` says what a model *is* — messages in, tool calls out. This
 * says how you get hold of one: which models are on offer, whether this machine
 * can run any of them, and what it costs to start. The two are separate because
 * they change for different reasons. Swapping in a hosted model changes the
 * runtime completely and the provider interface not at all.
 *
 * Everything above this file — the panel, the settings screen, the stored
 * preference — is written against these types and never against a particular
 * engine. A runtime that has to download five gigabytes before it can answer
 * and one that posts to a URL with an API key both fit here, and the panel
 * cannot tell which it has.
 *
 * This branch runs a small model in the browser over WebGPU, and asks it for
 * structured JSON rather than tool calls. `assistantRuntime()` can still return
 * null, and that is a real state with a real rendering rather than a
 * placeholder — it is what a build with no engine compiled in looks like, just
 * as `available()` returning false is what a machine without WebGPU looks like.
 */

import type { ChatProvider } from "./provider.js";
import { webllmJsonRuntime } from "./webllm-json-provider.js";

export interface AssistantModel {
  /** The engine's own name for it, which nobody outside this folder needs. */
  id: string;
  /**
   * What it is called on screen.
   *
   * A name for what it does, not for what it is. Which model and how many
   * billion parameters are our problem, and knowing them helps nobody choose:
   * the only two things a player can act on are what it will do for them and
   * what it will cost their machine.
   */
  label: string;
  /** One line under the picker saying what choosing it means. */
  blurb: string;
  /**
   * What the machine must find room for, in megabytes.
   *
   * Zero for a runtime that does its thinking somewhere else. The panel uses it
   * to decide whether starting up is worth warning about, so a hosted model
   * correctly gets no warning.
   */
  vramMB: number;
  /**
   * May this model write RoboScript of its own?
   *
   * False for the small ones, and not out of caution — measured. Asked to
   * compose, they invent commands, write one-line `if` blocks, and produce
   * confident nonsense that has to be caught by the compiler and flagged. They
   * are perfectly good at reading and explaining, so below this line the
   * assistant quotes a known-good example out of the lessons instead of
   * writing one, and says which lesson it came from.
   */
  composes: boolean;
  /**
   * How much of the language to put in front of it.
   *
   * Per model rather than per runtime, which is where it started and was
   * wrong: the two rungs differ by three and a half gigabytes, and handing the
   * larger one the same cut-down card as the smaller wastes most of what it
   * was downloaded for. The Guide gets names and shapes; the Tutor gets the
   * explanations too.
   */
  promptBudget: PromptBudget;
}

/** Progress while a model is being fetched and made ready. */
export interface LoadProgress {
  /** 0..1, or null while the runtime is only reporting text. */
  fraction: number | null;
  text: string;
}

/**
 * How much prompt a runtime can be given before it stops coping.
 *
 * Not a preference — a property of the engine behind it. A one-billion
 * parameter model in a browser, sharing a 4096 token window with the protocol
 * and the player's script, has very little room. A hosted model has plenty.
 */
export type PromptBudget = "tight" | "roomy";

/**
 * What this machine can do, and why not when it cannot.
 *
 * The reason is for us rather than for the player — everything about the
 * assistant is hidden when it cannot run, rather than offered and then
 * explained away. A door that opens onto a wall is worse than no door.
 */
export interface AssistantCapability {
  ok: boolean;
  reason?: string;
}

export interface AssistantRuntime {
  readonly models: readonly AssistantModel[];
  readonly defaultModelId: string;
  /**
   * Whether this machine can actually run the smallest of them.
   *
   * Asynchronous because the honest answer needs the GPU adapter, and getting
   * one is a promise. Worth the wait: the cheap synchronous test — does
   * `navigator.gpu` exist — says yes on plenty of machines that then fail at
   * the point somebody has committed to a two gigabyte download.
   */
  capability(): Promise<AssistantCapability>;
  /**
   * Whether this model is already here, so starting it costs seconds rather
   * than gigabytes.
   *
   * Allowed to be wrong in one direction only: a false negative shows a
   * download button for something already downloaded, which is a wasted click.
   * A false positive would start a multi-gigabyte fetch nobody agreed to.
   */
  isCached(modelId: string): Promise<boolean>;
  /** Which models are downloaded, for a settings screen that tells the truth. */
  cached(): Promise<AssistantModel[]>;
  /** Throw the downloaded weights away. */
  forget(): Promise<void>;
  create(modelId: string, onProgress: (progress: LoadProgress) => void): Promise<ChatProvider>;
}

/**
 * The runtime this build was compiled with, or null if it has none.
 *
 * A function rather than a constant so that a runtime is free to decide it is
 * unavailable at call time — WebGPU and a stored API key are both things you
 * can only find out by looking.
 */
export function assistantRuntime(): AssistantRuntime | null {
  return webllmJsonRuntime;
}

/** The chosen model, or the default when the stored one is no longer offered. */
export function resolveModelId(stored: string | null | undefined): string {
  const runtime = assistantRuntime();
  if (!runtime) return "";
  return stored && runtime.models.some((m) => m.id === stored) ? stored : runtime.defaultModelId;
}

/** Rounded down to one decimal, for a button that should not understate itself. */
export function downloadSizeGB(id: string): number {
  const model = assistantRuntime()?.models.find((m) => m.id === id);
  return model ? Math.round((model.vramMB / 1024) * 10) / 10 : 0;
}
