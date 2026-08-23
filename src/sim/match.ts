/**
 * Running a whole match headlessly.
 *
 * Used by tests, by the tournament runner, and (in milestone 2) by peers that
 * want to verify a result without rendering it.
 */

import { hashWorld } from "./hash.js";
import { step } from "./step.js";
import type { World } from "./types.js";
import { createWorld, type MatchManifest } from "./world.js";

export interface MatchResult {
  winnerId: number | null;
  /**
   * The side that won, counting from zero, or null for a mutual wipe.
   *
   * Optional because a `BattleRecord` saved before teams existed is read back
   * off disk as a plain object, and a required field would be a type that lies
   * about the data it describes.
   */
  winnerTeam?: number | null;
  winnerName: string | null;
  ticks: number;
  /** Final hash — two peers agreeing here agree on the whole match. */
  finalHash: string;
  standings: Standing[];
}

export interface Standing {
  id: number;
  name: string;
  health: number;
  kills: number;
  damageDealt: number;
  /** Which side, counting from zero. Absent on records saved before teams. */
  team?: number;
  /** 1 is the winner. */
  place: number;
}

/** Run to completion and report. */
export function runMatch(manifest: MatchManifest): MatchResult {
  const world = createWorld(manifest);
  while (!world.over && world.tick < manifest.maxTicks) step(world);
  return summarise(world);
}

/**
 * Run a match and record a hash every `interval` ticks. Comparing two of these
 * streams pinpoints the exact tick at which two peers diverged.
 */
export function runMatchWithHashes(
  manifest: MatchManifest,
  interval = 1,
): { result: MatchResult; hashes: string[] } {
  const world = createWorld(manifest);
  const hashes: string[] = [];
  while (!world.over && world.tick < manifest.maxTicks) {
    if (world.tick % interval === 0) hashes.push(hashWorld(world));
    step(world);
  }
  hashes.push(hashWorld(world));
  return { result: summarise(world), hashes };
}

export function summarise(world: World): MatchResult {
  // Survivors first, then by how long they lasted — a robot that died later
  // placed better than one that died early.
  const ranked = [...world.robots].sort((a, b) => {
    // The winning side fills the top places, so a team that won together is
    // read as having won together rather than being interleaved with the
    // losers it happened to outlive. Below that, the original rules stand.
    if (world.winnerTeam !== null) {
      const aWon = a.team === world.winnerTeam;
      const bWon = b.team === world.winnerTeam;
      if (aWon !== bWon) return aWon ? -1 : 1;
    }
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive && b.alive) {
      if (b.health !== a.health) return b.health - a.health;
      return b.damageDealt - a.damageDealt;
    }
    return b.diedAtTick - a.diedAtTick;
  });

  const winner = world.winnerId !== null ? world.robots[world.winnerId] : undefined;

  return {
    winnerId: world.winnerId,
    winnerName: winner?.declaredName ?? null,
    winnerTeam: world.winnerTeam,
    ticks: world.tick,
    finalHash: hashWorld(world),
    standings: ranked.map((r, i) => ({
      id: r.id,
      name: r.declaredName,
      health: r.health,
      kills: r.kills,
      damageDealt: r.damageDealt,
      team: r.team,
      place: i + 1,
    })),
  };
}
