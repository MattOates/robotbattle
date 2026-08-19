/**
 * The test bench: does this change actually make my robot better?
 *
 * Runs a robot against a list of opponents many times over and reports a row
 * per matchup. Pure and synchronous so it can be unit-tested directly; the
 * worker in `trials.worker.ts` is only a wrapper that keeps it off the UI
 * thread.
 *
 * Two details make the numbers trustworthy:
 *
 *  - Each trial uses a different seed, and spawn positions are jittered from
 *    that seed, so trials are genuinely different matches rather than N copies
 *    of one match.
 *  - The subject alternates between entry slots, so nothing it wins or loses
 *    can be an artefact of which side of the arena it started on.
 */

import { runMatch } from "../sim/match.js";
import { makeManifest } from "../sim/world.js";
import { checkScript } from "../sim/world.js";
import { FUEL_PRESETS, TERRAIN_PRESETS, type FuelConfig, type TerrainConfig } from "../sim/types.js";

export type ContenderKind = "arena" | "library" | "snapshot" | "working";

export interface Contender {
  id: string;
  label: string;
  source: string;
  kind: ContenderKind;
}

export interface TrialRequest {
  subject: { label: string; source: string };
  opponents: Contender[];
  /** Matches per opponent. */
  trials: number;
  seedBase: number;
  /**
   * The conditions to fight under.
   *
   * Both optional and both defaulted, so an old caller still runs \u2014 but a
   * bench that cannot vary them is a bench that can only answer questions
   * about one arena. Tuning a robot for hills means being able to run it
   * against hills fifty times.
   */
  fuel?: FuelConfig;
  terrain?: TerrainConfig;
}

/** What a report was produced under. Carried so a shared table is not ambiguous. */
export interface TrialConditions {
  fuel: FuelConfig;
  terrain: TerrainConfig;
}

export interface MatchupRow {
  opponentId: string;
  label: string;
  kind: ContenderKind;
  wins: number;
  losses: number;
  draws: number;
  trials: number;
  winRate: number;
  /** Mean match length in ticks — a proxy for how decisive the matchup is. */
  avgTicks: number;
  /** Mean health the subject finished with, including zeroes for losses. */
  avgHealth: number;
}

export interface TrialReport {
  rows: MatchupRow[];
  totalMatches: number;
  overallWinRate: number;
  /**
   * The conditions these numbers came from.
   *
   * A report travels to other people in a shared session, and a win rate means
   * nothing without knowing what it was fought over \u2014 74% on flat ground and
   * 74% in the hills are different claims about a robot.
   */
  conditions: TrialConditions;
  /** Set when the run could not happen at all. */
  error: string | null;
}

export interface TrialProgress {
  done: number;
  total: number;
}

/** Seeds are spread far apart per matchup so no two matchups share a match. */
const SEED_STRIDE = 100_000;

export function runTrials(
  request: TrialRequest,
  onProgress?: (progress: TrialProgress) => void,
): TrialReport {
  const conditions: TrialConditions = {
    fuel: request.fuel ?? FUEL_PRESETS.arena,
    terrain: request.terrain ?? TERRAIN_PRESETS.off,
  };
  const subjectCheck = checkScript(request.subject.source);
  if (!subjectCheck.ok) {
    return {
      rows: [],
      totalMatches: 0,
      overallWinRate: 0,
      conditions,
      error: `Your robot doesn't compile: ${subjectCheck.error?.message ?? "unknown error"}`,
    };
  }
  if (request.opponents.length === 0) {
    return {
      rows: [],
      totalMatches: 0,
      overallWinRate: 0,
      conditions,
      error: "Pick someone to fight.",
    };
  }

  const trials = Math.max(1, Math.floor(request.trials));
  const total = trials * request.opponents.length;
  let done = 0;
  const rows: MatchupRow[] = [];

  request.opponents.forEach((opponent, matchupIndex) => {
    if (!checkScript(opponent.source).ok) {
      rows.push(emptyRow(opponent, trials));
      done += trials;
      onProgress?.({ done, total });
      return;
    }

    let wins = 0;
    let losses = 0;
    let draws = 0;
    let tickTotal = 0;
    let healthTotal = 0;

    for (let i = 0; i < trials; i++) {
      // Alternate sides so a positional quirk cannot masquerade as skill.
      const subjectFirst = i % 2 === 0;
      const entries = subjectFirst
        ? [{ source: request.subject.source }, { source: opponent.source }]
        : [{ source: opponent.source }, { source: request.subject.source }];
      const subjectIndex = subjectFirst ? 0 : 1;

      const result = runMatch(
        makeManifest(entries, {
          seed: request.seedBase + matchupIndex * SEED_STRIDE + i,
          fuel: conditions.fuel,
          terrain: conditions.terrain,
        }),
      );

      if (result.winnerId === null) draws++;
      else if (result.winnerId === subjectIndex) wins++;
      else losses++;

      tickTotal += result.ticks;
      healthTotal += result.standings.find((s) => s.id === subjectIndex)?.health ?? 0;

      done++;
      // Reporting every match would flood the channel on a 400-match sweep.
      if (done % 10 === 0 || done === total) onProgress?.({ done, total });
    }

    rows.push({
      opponentId: opponent.id,
      label: opponent.label,
      kind: opponent.kind,
      wins,
      losses,
      draws,
      trials,
      winRate: (wins / trials) * 100,
      avgTicks: Math.round(tickTotal / trials),
      avgHealth: Math.round((healthTotal / trials) * 10) / 10,
    });
  });

  const totalWins = rows.reduce((n, r) => n + r.wins, 0);
  const totalMatches = rows.reduce((n, r) => n + r.trials, 0);

  return {
    rows,
    totalMatches,
    overallWinRate: totalMatches === 0 ? 0 : (totalWins / totalMatches) * 100,
    conditions,
    error: null,
  };
}

/** An opponent whose script is broken counts as no contest, not as wins. */
function emptyRow(opponent: Contender, trials: number): MatchupRow {
  return {
    opponentId: opponent.id,
    label: `${opponent.label} (won't compile)`,
    kind: opponent.kind,
    wins: 0,
    losses: 0,
    draws: trials,
    trials,
    winRate: 0,
    avgTicks: 0,
    avgHealth: 0,
  };
}
