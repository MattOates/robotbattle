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
import type { ChatMessage } from "../store/types.js";

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
  /**
   * A prod aimed at one peer who is holding everyone up.
   *
   * Distinct from `notice` so the receiving screen can actually draw attention
   * to itself — a line of text in a lobby somebody has stopped looking at is
   * not a nudge.
   */
  | { t: "nudge"; text: string }

  // ---- matches ----
  | { t: "start"; matchId: string; manifest: MatchManifest; label: string }
  | { t: "hash"; matchId: string; tick: number; hash: string }
  /** Host declares the official outcome. */
  | { t: "result"; matchId: string; result: MatchResult }

  // ---- tournament ----
  | { t: "bracket"; bracket: Bracket }

  // ---- workshop sessions ----
  /**
   * The host is *showing* this robot. Read-only for everyone, and carrying its
   * source because guests do not have the host's library.
   *
   * Deliberately separate from `session`: browsing must not drag the editable
   * document or the conversation along with it, or the chat fragments across
   * robots nobody is working on.
   */
  | { t: "view"; robotId: string; name: string; color: string; source: string }
  /** This robot is now the editable one, and the one chat is attached to. */
  | { t: "session"; robotId: string; name: string; color: string }
  /** Everything said about a robot so far, sent on join and on a session change. */
  | { t: "chatHistory"; robotId: string; messages: ChatMessage[] }
  /** Filed against the robot it was said about, not whatever is on screen. */
  | { t: "chat"; robotId: string; text: string; at: number }
  /** A Yjs sync or awareness update, base64 encoded. */
  | { t: "ydoc"; kind: "sync" | "awareness"; data: string }
  /** The owner's test-bench result, so nobody else has to burn the CPU. */
  | { t: "bench"; robotId: string; report: unknown }
  /** The owner's battle record for a robot, summaries only. */
  | { t: "history"; robotId: string; entries: unknown[] }
  /** Removed from the room by the host. */
  | { t: "kick"; reason: string }
  /** The host has closed the room. */
  | { t: "endSession" }

  // ---- trade ----
  /** What this peer is willing to show. */
  | { t: "shelf"; robots: Array<{ id: string; name: string; color: string }> }
  | { t: "peek"; robotId: string }
  | { t: "peekResult"; robotId: string; source: string | null }
  | { t: "copyRequest"; robotId: string }
  | { t: "copyResponse"; robotId: string; source: string | null; reason: string | null }
  /**
   * An unsolicited hand-over: "have this one".
   *
   * The mirror of `copyRequest`, and worth having as well as it — asking for
   * something you can see on a shelf and giving something away are different
   * intentions, and only one of them requires knowing what to ask for. Consent
   * still sits with the receiver: nothing is written to a library until they
   * accept, because an offer that wrote itself in would be a way to fill
   * someone's storage with junk.
   */
  | { t: "offer"; robotId: string; name: string; color: string; source: string }
  /** So the giver's screen can stop saying "waiting". */
  | { t: "offerResult"; robotId: string; accepted: boolean };

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
  "hello", "roster", "ready", "entry", "notice", "nudge",
  "start", "hash", "result",
  "bracket",
  "view", "session", "chatHistory", "chat", "ydoc", "bench", "history",
  "kick", "endSession",
  "shelf", "peek", "peekResult", "copyRequest", "copyResponse", "offer", "offerResult",
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

/**
 * Clean a batch of chat history arriving from another browser.
 *
 * Dropping malformed entries rather than the whole batch means one bad line
 * cannot cost you the rest of the conversation.
 */
export function sanitiseChat(messages: unknown, max = 200): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  const out: ChatMessage[] = [];
  for (const raw of messages.slice(-max)) {
    if (typeof raw !== "object" || raw === null) continue;
    const m = raw as Partial<ChatMessage>;
    if (typeof m.text !== "string" || typeof m.id !== "string") continue;
    out.push({
      id: m.id.slice(0, 64),
      at: typeof m.at === "number" && Number.isFinite(m.at) ? m.at : Date.now(),
      author: sanitiseText(m.author, 24) || "Someone",
      authorPeerId: sanitiseText(m.authorPeerId, 64),
      text: m.text.slice(0, MAX_CHAT_LENGTH),
    });
  }
  return out;
}

/**
 * What one peer says it is willing to show.
 *
 * Enough to *draw* the robot, not to run it: people recognise their robots by
 * shape and colour, and a table of names alone is unreadable. The script is
 * still the thing that has to be asked for.
 */
export interface ShelfItem {
  id: string;
  name: string;
  color: string;
  locomotion: "skid" | "steered";
}

/** Cap on a shelf, so nobody can push a thousand rows into someone's screen. */
export const MAX_SHELF = 60;

export function sanitiseShelf(robots: unknown): ShelfItem[] {
  if (!Array.isArray(robots)) return [];
  const out: ShelfItem[] = [];
  for (const raw of robots.slice(0, MAX_SHELF)) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Partial<ShelfItem>;
    if (typeof r.id !== "string") continue;
    out.push({
      id: r.id.slice(0, 64),
      name: sanitiseText(r.name, 32) || "Unnamed",
      color: /^#[0-9a-fA-F]{6}$/.test(r.color ?? "") ? r.color! : "#8a8f98",
      // Anything but the one other chassis is drawn as the common one.
      locomotion: r.locomotion === "steered" ? "steered" : "skid",
    });
  }
  return out;
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
