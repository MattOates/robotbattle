/**
 * Runs the test bench off the UI thread.
 *
 * A 400-match sweep takes a few seconds of solid computation; on the main
 * thread that would freeze the editor mid-keystroke.
 */

import { runTrials, type TrialProgress, type TrialReport, type TrialRequest } from "./trials.js";

export type TrialWorkerIn = { type: "run"; request: TrialRequest };

export type TrialWorkerOut =
  | { type: "progress"; progress: TrialProgress }
  | { type: "done"; report: TrialReport }
  | { type: "failed"; message: string };

const post = (message: TrialWorkerOut) => self.postMessage(message);

self.onmessage = (event: MessageEvent<TrialWorkerIn>) => {
  if (event.data?.type !== "run") return;
  try {
    const report = runTrials(event.data.request, (progress) =>
      post({ type: "progress", progress }),
    );
    post({ type: "done", report });
  } catch (err) {
    // A crash here must not leave the Workshop showing a spinner forever.
    post({
      type: "failed",
      message: err instanceof Error ? err.message : "the test bench stopped unexpectedly",
    });
  }
};
