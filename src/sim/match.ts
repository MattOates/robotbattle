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
    ticks: world.tick,
    finalHash: hashWorld(world),
    standings: ranked.map((r, i) => ({
      id: r.id,
      name: r.declaredName,
      health: r.health,
      kills: r.kills,
      damageDealt: r.damageDealt,
      place: i + 1,
    })),
  };
}
