/**
 * Runs a tournament round off the UI thread.
 *
 * A round of four ties is forty-four whole matches — several seconds of solid
 * simulation. On the main thread the bracket would freeze mid-round, on the one
 * screen where everybody is watching it.
 */

import { runRound, type DuelJob, type DuelRecord, type RoundProgress } from "./round.js";

export type RoundWorkerIn = {
  type: "run";
  jobs: DuelJob[];
  matches: number;
  /** Echoed back, so a late reply from an abandoned round can be ignored. */
  round: number;
};

export type RoundWorkerOut =
  | { type: "progress"; round: number; progress: RoundProgress }
  | { type: "done"; round: number; records: DuelRecord[] }
  | { type: "failed"; round: number; message: string };

const post = (message: RoundWorkerOut) => self.postMessage(message);

self.onmessage = (event: MessageEvent<RoundWorkerIn>) => {
  if (event.data?.type !== "run") return;
  const { round, jobs, matches } = event.data;
  try {
    const records = runRound(jobs, matches, (progress) =>
      post({ type: "progress", round, progress }),
    );
    post({ type: "done", round, records });
  } catch (err) {
    // A crash here must not leave a room staring at a progress bar forever.
    post({
      type: "failed",
      round,
      message: err instanceof Error ? err.message : "the round stopped unexpectedly",
    });
  }
};
