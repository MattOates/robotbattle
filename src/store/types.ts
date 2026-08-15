/**
 * What the Workshop remembers between sessions.
 *
 * Note what a `BattleRecord` does NOT contain: any per-tick state. A manifest
 * fully determines a match, so storing the manifest stores the whole battle,
 * re-watchable frame for frame, for a few kilobytes.
 */

import type { MatchManifest } from "../sim/world.js";
import type { MatchResult } from "../sim/match.js";
import type { Locomotion } from "../lang/ast.js";

/**
 * A version that arrived from someone else rather than from your own editor.
 *
 * Recorded against the version rather than against the robot because a robot
 * accumulates history: a script traded to you, then edited for a week, is still
 * a script that came from somebody, and the version list is where that stays
 * true. Credit is the point — this is what a classroom argues about.
 */
export interface TradeOrigin {
  kind: "trade";
  /** What they were calling themselves at the time. Not an identity. */
  from: string;
  /** When the trade happened. */
  at: number;
  /** What they called the robot, which need not be what you call it. */
  robotName: string;
}

/** A saved, named version of a robot's source. */
export interface Snapshot {
  id: string;
  label: string;
  source: string;
  createdAt: number;
  /** Pinned snapshots are offered first as trial opponents. */
  pinned: boolean;
  /** Absent on versions you saved yourself, which is nearly all of them. */
  origin?: TradeOrigin;
}

export interface StoredRobot {
  id: string;
  /** Cached from the script's `name`, so the library can render without parsing. */
  name: string;
  /** Cached from the script's `color`, for the roster chip. */
  color: string;
  /**
   * Cached from the script's `chassis`, so a robot can be *drawn* without
   * parsing — the same bargain as the name and colour. Absent on anything
   * stored before robots were drawn outside the arena; treat that as "skid".
   */
  locomotion?: Locomotion;
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

/**
 * One line of a conversation about a robot.
 *
 * Kept against the robot rather than against the room, because the advice is
 * what is worth keeping and the room is gone in twenty minutes.
 */
export interface ChatMessage {
  id: string;
  at: number;
  /** Display name at the time it was said; people can rename themselves later. */
  author: string;
  /** Who said it, so your own lines can be shown differently. */
  authorPeerId: string;
  text: string;
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
