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
 * There is no runtime on this branch. `assistantRuntime()` returning null is a
 * real state with a real rendering — "the assistant is not available here" —
 * and not a placeholder to be tidied away: it is also exactly what a browser
 * with no WebGPU and no API key will see once there are implementations.
 */

import type { ChatProvider } from "./provider.js";

export interface AssistantModel {
  id: string;
  /** Shown in the settings dropdown. */
  label: string;
  /**
   * What the machine must find room for, in megabytes.
   *
   * Zero for a runtime that does its thinking somewhere else. The panel uses it
   * to decide whether starting up is worth warning about, so a hosted model
   * correctly gets no warning.
   */
  vramMB: number;
}

/** Progress while a model is being fetched and made ready. */
export interface LoadProgress {
  /** 0..1, or null while the runtime is only reporting text. */
  fraction: number | null;
  text: string;
}

export interface AssistantRuntime {
  readonly models: readonly AssistantModel[];
  readonly defaultModelId: string;
  /** Whether this browser could run one of these at all. */
  available(): boolean;
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
  return null;
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
