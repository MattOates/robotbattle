/**
 * Playing a whole round of ties.
 *
 * Split from `duel.ts` so the worker has one thing to call and the screen has
 * one shape to render. Everything here is pure and synchronous: the round is
 * decided before anybody watches anything, which is what lets the bracket show
 * its next layer immediately and the matches be watched at leisure afterwards.
 */

import { runDuel, type Duellist, type DuelResult, DUEL_MATCHES } from "./duel.js";
import type { ArenaSpec, FuelConfig } from "../sim/types.js";

/** One tie waiting to be played: a bracket slot and the two robots in it. */
export interface DuelJob {
  matchId: string;
  /** Entrant ids, so a result can be applied to the bracket without guessing. */
  aId: string;
  bId: string;
  a: Duellist;
  b: Duellist;
  /** First seed of the eleven; each match uses `seedBase + i`. */
  seedBase: number;
  /** Fuel settings for this tie. Travels with the job so the worker agrees. */
  fuel?: FuelConfig;
  /** The map \u2014 ground and walls. Travels with the job so a worker cannot fight on a different one. */
  arena?: ArenaSpec;
}

export interface DuelRecord {
  matchId: string;
  aId: string;
  bId: string;
  /** The entrant id that goes through, or null if neither script compiles. */
  winnerId: string | null;
  result: DuelResult;
}

export interface RoundProgress {
  /** Matches simulated so far across the whole round. */
  done: number;
  total: number;
  /** Which tie is being played, for a status line worth reading. */
  matchId: string;
}

/**
 * Seeds are spread far apart per tie so that no two ties in a round can share a
 * match, and so a tie's seeds do not depend on how many ties came before it —
 * which keeps a result reproducible even if the bracket is rebuilt.
 */
export const SEED_STRIDE = 1_000_000;

export function seedForJob(base: number, matchId: string): number {
  // A stable hash of the match id, so the same slot of the same bracket always
  // draws the same seeds however the round is scheduled.
  let hash = 2166136261;
  for (let i = 0; i < matchId.length; i++) {
    hash ^= matchId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (base + (Math.abs(hash) % SEED_STRIDE)) & 0x7fffffff;
}

export function runRound(
  jobs: readonly DuelJob[],
  matches: number = DUEL_MATCHES,
  onProgress?: (progress: RoundProgress) => void,
): DuelRecord[] {
  const total = jobs.length * matches;
  let done = 0;

  return jobs.map((job) => {
    const result = runDuel(
      job.a,
      job.b,
      job.seedBase,
      matches,
      () => {
        done++;
        // Every match would be a message per ~50ms of work; every fourth keeps
        // the bar moving without flooding the channel.
        if (done % 4 === 0 || done === total) {
          onProgress?.({ done, total, matchId: job.matchId });
        }
      },
      job.fuel,
      job.arena,
    );
    return {
      matchId: job.matchId,
      aId: job.aId,
      bId: job.bId,
      winnerId: result.winner === null ? null : result.winner === "a" ? job.aId : job.bId,
      result,
    };
  });
}
