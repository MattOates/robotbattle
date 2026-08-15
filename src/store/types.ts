/**
 * What the Workshop remembers between sessions.
 *
 * Note what a `BattleRecord` does NOT contain: any per-tick state. A manifest
 * fully determines a match, so storing the manifest stores the whole battle,
 * re-watchable frame for frame, for a few kilobytes.
 */

import type { MatchManifest } from "../sim/world.js";
import type { MatchResult } from "../sim/match.js";

/** A saved, named version of a robot's source. */
export interface Snapshot {
  id: string;
  label: string;
  source: string;
  createdAt: number;
  /** Pinned snapshots are offered first as trial opponents. */
  pinned: boolean;
}

export interface StoredRobot {
  id: string;
  /** Cached from the script's `name`, so the library can render without parsing. */
  name: string;
  /** Cached from the script's `color`, for the roster chip. */
  color: string;
  /** The working copy — what the editor shows. */
  source: string;
  createdAt: number;
  updatedAt: number;
  snapshots: Snapshot[];
}

/** Everything measured about one robot in one battle. */
export interface RobotTelemetry {
  robotId: number;
  name: string;
  place: number;
  survived: boolean;
  /** Ticks alive; equal to the match length for a survivor. */
  survivedTicks: number;

  // --- combat ---
  health: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  shotsFired: number;
  shotsHit: number;

  // --- script execution ---
  /** Total VM instructions run. A rough measure of how hard the robot thinks. */
  instructions: number;
  /** Handlers that ran out of fuel mid-tick. High means slow reactions. */
  suspensions: number;
  /** Events discarded because the robot's queue was full. */
  eventsDropped: number;
  /** Runtime errors that aborted a handler. */
  errors: number;
  /** Most recent runtime error, if any. */
  lastError: string | null;
}

export type BattleMode = "trial" | "arena" | "tournament";

export interface BattleRecord {
  id: string;
  at: number;
  mode: BattleMode;
  /** The whole battle, replayable. */
  manifest: MatchManifest;
  result: MatchResult;
  telemetry: RobotTelemetry[];
  /** Which of your library robots took part, if any. */
  myRobotId: string | null;
  /** Index into the manifest entries for your robot. */
  myEntryIndex: number | null;
}

/**
 * A durable win/loss tally per opponent.
 *
 * Deriving this from BattleRecords would be tidier, but records are pruned to
 * stay inside the storage budget and the tally has to outlive them.
 */
export interface HeadToHead {
  /** Your robot's library id. */
  robotId: string;
  opponent: string;
  wins: number;
  losses: number;
  draws: number;
  lastPlayed: number;
}
