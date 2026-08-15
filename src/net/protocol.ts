/**
 * What peers say to each other.
 *
 * Note what is absent: any per-tick game state. A manifest fully determines a
 * match, so the host sends one `start` and every peer plays the whole battle
 * locally. `hash` messages exist only to *detect* disagreement, never to fix
 * it — there is nothing to reconcile, only a bug to report.
 */

import type { MatchManifest } from "../sim/world.js";
import type { MatchResult } from "../sim/match.js";
import type { PeerId } from "./transport.js";
import type { Bracket } from "./bracket.js";

/** A robot as offered to a room. */
export interface RobotEntry {
  name: string;
  color: string;
  source: string;
}

export interface PeerInfo {
  id: PeerId;
  displayName: string;
  isHost: boolean;
  ready: boolean;
  robot: { name: string; color: string } | null;
}

export type Message =
  // ---- lobby ----
  /** Guest announces itself and its robot. Sent to the host on join. */
  | { t: "hello"; displayName: string; robot: RobotEntry | null }
  /** Host is authoritative about who is present. */
  | { t: "roster"; peers: PeerInfo[] }
  | { t: "ready"; ready: boolean }
  /** Guest swapped robot while in the lobby. */
  | { t: "entry"; robot: RobotEntry | null }
  /** Host explains why the room will not start. */
  | { t: "notice"; text: string }

  // ---- matches ----
  | { t: "start"; matchId: string; manifest: MatchManifest; label: string }
  | { t: "hash"; matchId: string; tick: number; hash: string }
  /** Host declares the official outcome. */
  | { t: "result"; matchId: string; result: MatchResult }

  // ---- tournament ----
  | { t: "bracket"; bracket: Bracket }

  // ---- pair programming ----
  | { t: "chat"; text: string; at: number }
  /** A Yjs sync or awareness update, base64 encoded. */
  | { t: "ydoc"; kind: "sync" | "awareness"; data: string }

  // ---- trade ----
  /** What this peer is willing to show. */
  | { t: "shelf"; robots: Array<{ id: string; name: string; color: string }> }
  | { t: "peek"; robotId: string }
  | { t: "peekResult"; robotId: string; source: string | null }
  | { t: "copyRequest"; robotId: string }
  | { t: "copyResponse"; robotId: string; source: string | null; reason: string | null };

/**
 * Validate an incoming payload before it reaches any mode logic.
 *
 * Everything here arrives from another person's browser, so it is untrusted
 * input. This does not make a malicious peer harmless — but a malformed message
 * should be dropped quietly rather than crashing everyone's lobby.
 */
export function isMessage(payload: unknown): payload is Message {
  if (typeof payload !== "object" || payload === null) return false;
  const t = (payload as { t?: unknown }).t;
  return typeof t === "string" && KNOWN_TYPES.has(t);
}

const KNOWN_TYPES: ReadonlySet<string> = new Set<Message["t"]>([
  "hello", "roster", "ready", "entry", "notice",
  "start", "hash", "result",
  "bracket",
  "chat", "ydoc",
  "shelf", "peek", "peekResult", "copyRequest", "copyResponse",
]);

/** Cap on a chat line, so nobody can paste a wall of text into the tray. */
export const MAX_CHAT_LENGTH = 400;

/** Cap on a shared script, generous but not unbounded. */
export const MAX_SOURCE_LENGTH = 64 * 1024;

/** Trim untrusted strings to something displayable. */
export function sanitiseText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.slice(0, max);
}

export function sanitiseEntry(entry: unknown): RobotEntry | null {
  if (typeof entry !== "object" || entry === null) return null;
  const e = entry as Partial<RobotEntry>;
  if (typeof e.source !== "string") return null;
  return {
    name: sanitiseText(e.name, 32) || "Unnamed",
    color: /^#[0-9a-fA-F]{6}$/.test(e.color ?? "") ? e.color! : "#8a8f98",
    source: e.source.slice(0, MAX_SOURCE_LENGTH),
  };
}
