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
import type { DuelRecord } from "../tournament/round.js";
import type { Standing } from "../tournament/qualifier.js";
import type { ChatMessage } from "../store/types.js";
import {
  WALL,
  clampTerrainConfig,
  clampWalls,
  type ArenaSpec,
  type TerrainConfig,
  type Wall,
} from "../sim/types.js";

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
  /**
   * The whole draw, from the host, who is authoritative about it.
   *
   * Carries the entrants' scripts as well as the shape of the tree, because
   * every peer replays the matches locally — the same bargain the Arena makes,
   * and the reason entering is an act of publishing rather than of showing.
   */
  | { t: "bracket"; bracket: Bracket }
  /**
   * The qualifying table: everybody against everybody, once, before the draw.
   *
   * Not a result in itself — it decides who is seeded through a round that
   * cannot pair off, and it is worth showing because it is the only place the
   * whole field is compared directly.
   */
  | { t: "tourQualifier"; standings: Standing[]; done: number; total: number }
  /** Robots put forward for the draw, before it is made. */
  | { t: "tourField"; entrants: Array<{ id: string; ownerName: string; robot: RobotEntry }> }
  /** The host is playing a round out; a number to watch while waiting. */
  | { t: "tourProgress"; round: number; done: number; total: number }
  /** How every tie of a round was settled, including what to replay. */
  | { t: "tourRound"; round: number; records: DuelRecord[] }

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
  /**
   * A remark to the whole room, in the lobby.
   *
   * Deliberately not the `chat` above, which is a note *about a robot* and is
   * kept in its owner's library. This is talk while you are arranging
   * something — "ready when you are", "give me a minute" — and it is gone when
   * the room closes. Nothing stores it, so it carries no id and no author: the
   * room already knows who sent it, and a line nobody keeps needs no identity
   * beyond the moment it arrived.
   */
  | { t: "say"; text: string; at: number }
  /** Removed from the room by the host. */
  | { t: "kick"; reason: string }
  /** The host has closed the room. */
  | { t: "endSession" }

  // ---- trade ----
  //
  // Every one of these names a thing by `kind` and `id` together. Neither is
  // enough alone: ids are only unique within a library's own idea of a kind,
  // and a block's id is the robot it lives in plus its name.
  /** What this peer is willing to show. */
  | { t: "shelf"; items: ShelfItem[] }
  /** "May I read that?" — the goods, for looking at, not for keeping. */
  | { t: "peek"; kind: TradeKind; id: string }
  | { t: "peekResult"; kind: TradeKind; id: string; goods: TradeGoods | null }
  /** "May I have that?" — answered by a person, never automatically. */
  | { t: "copyRequest"; kind: TradeKind; id: string }
  | {
      t: "copyResponse";
      kind: TradeKind;
      id: string;
      goods: TradeGoods | null;
      reason: string | null;
    }
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
  | { t: "offer"; kind: TradeKind; id: string; goods: TradeGoods }
  /** So the giver's screen can stop saying "waiting". */
  | { t: "offerResult"; kind: TradeKind; id: string; accepted: boolean };

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
  "bracket", "tourField", "tourProgress", "tourRound", "tourQualifier",
  "view", "session", "chatHistory", "chat", "say", "ydoc", "bench", "history",
  "kick", "endSession",
  "shelf", "peek", "peekResult", "copyRequest", "copyResponse", "offer", "offerResult",
]);

/** Cap on a chat line, so nobody can paste a wall of text into the tray. */
export const MAX_CHAT_LENGTH = 400;

/** Cap on a shared script, generous but not unbounded. */
export const MAX_SOURCE_LENGTH = 64 * 1024;

/**
 * Clean an arena arriving from another browser.
 *
 * `isMessage` only checks the type tag, so everything inside a message is still
 * unvalidated at this point. An arena is the one payload that goes straight
 * into a simulation, where a NaN coordinate is not a display glitch but a
 * desync — so it is clamped through exactly the same functions `createWorld`
 * uses, and a peer cannot hand over a map that its own build would refuse.
 *
 * Returns null rather than a repaired object when the shape is wrong entirely,
 * so a caller can decline the offer instead of accepting an empty arena.
 */
export function sanitiseArenaSpec(value: unknown): ArenaSpec | null {
  if (typeof value !== "object" || value === null) return null;
  const spec = value as { terrain?: unknown; walls?: unknown };
  if (typeof spec.terrain !== "object" || spec.terrain === null) return null;
  if (spec.walls !== undefined && !Array.isArray(spec.walls)) return null;
  const walls = Array.isArray(spec.walls)
    ? spec.walls.filter(
        (w): w is Wall =>
          typeof w === "object" &&
          w !== null &&
          typeof (w as Wall).x1 === "number" &&
          typeof (w as Wall).y1 === "number" &&
          typeof (w as Wall).x2 === "number" &&
          typeof (w as Wall).y2 === "number",
      )
    : [];
  return {
    terrain: clampTerrainConfig(spec.terrain as TerrainConfig),
    walls: clampWalls(walls),
  };
}

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
 * The three things a person can hand to another person.
 *
 * A robot is a whole personality, a place is somewhere to fight, and a block is
 * one behaviour. They are traded through one set of messages rather than three,
 * because everything around the goods themselves — putting something out,
 * reading it, asking for it, giving it, agreeing to take it — is identical in
 * all three cases, and three parallel copies of that would drift apart.
 */
export type TradeKind = "robot" | "arena" | "block";

export const TRADE_KINDS: readonly TradeKind[] = ["robot", "arena", "block"];

/**
 * What one peer says it is willing to show.
 *
 * Enough to *recognise* the thing, never enough to use it. People know their
 * robots by shape and colour and a table of names alone is unreadable, so a
 * robot row carries both; a place says how many walls it has; a block says
 * which event it fits, since that is what decides where it can go. The goods
 * themselves still have to be asked for.
 */
export interface ShelfItem {
  kind: TradeKind;
  id: string;
  name: string;
  /** Robots only. */
  color?: string;
  locomotion?: "skid" | "steered";
  /** Places only. */
  walls?: number;
  /** Blocks only: the event it is `given`, and which robot it was written in. */
  event?: string;
  from?: string;
}

/**
 * The goods, as they travel.
 *
 * A discriminated union rather than a bag of optional fields, so that every
 * reader is made to say which kind it is handling before it can touch the
 * payload — the alternative is a `source` that is sometimes a script, sometimes
 * a block, and sometimes not there at all.
 */
export type TradeGoods =
  | { kind: "robot"; name: string; color: string; source: string }
  | { kind: "arena"; name: string; spec: ArenaSpec }
  | { kind: "block"; name: string; text: string; from: string };

/** Cap on a shelf, so nobody can push a thousand rows into someone's screen. */
export const MAX_SHELF = 60;

function asKind(value: unknown): TradeKind {
  // Anything unrecognised is treated as a robot, which is the kind every peer
  // has always understood.
  return value === "arena" || value === "block" ? value : "robot";
}

export function sanitiseShelf(items: unknown): ShelfItem[] {
  if (!Array.isArray(items)) return [];
  const out: ShelfItem[] = [];
  for (const raw of items.slice(0, MAX_SHELF)) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Partial<ShelfItem>;
    if (typeof r.id !== "string") continue;
    const kind = asKind(r.kind);
    const item: ShelfItem = {
      kind,
      id: r.id.slice(0, 128),
      name: sanitiseText(r.name, 40) || "Unnamed",
    };
    if (kind === "robot") {
      item.color = /^#[0-9a-fA-F]{6}$/.test(r.color ?? "") ? r.color! : "#8a8f98";
      // Anything but the one other chassis is drawn as the common one.
      item.locomotion = r.locomotion === "steered" ? "steered" : "skid";
    }
    if (kind === "arena") {
      const walls = typeof r.walls === "number" && Number.isFinite(r.walls) ? r.walls : 0;
      item.walls = Math.max(0, Math.min(WALL.maxCount, Math.round(walls)));
    }
    if (kind === "block") {
      item.event = sanitiseText(r.event, 40);
      item.from = sanitiseText(r.from, 32);
    }
    out.push(item);
  }
  return out;
}

/** Cap on a block's text. Generous, but a block is not a whole script. */
export const MAX_BLOCK_LENGTH = 8 * 1024;

/**
 * Clean goods arriving from another browser.
 *
 * Returns null rather than a repaired object when the shape is wrong, so a
 * caller declines the trade instead of writing an empty robot into a library.
 */
export function sanitiseGoods(value: unknown): TradeGoods | null {
  if (typeof value !== "object" || value === null) return null;
  const g = value as { kind?: unknown; name?: unknown; [k: string]: unknown };
  const name = sanitiseText(g.name, 40) || "Unnamed";

  if (g.kind === "arena") {
    const spec = sanitiseArenaSpec(g["spec"]);
    return spec ? { kind: "arena", name, spec } : null;
  }
  if (g.kind === "block") {
    const text = sanitiseText(g["text"], MAX_BLOCK_LENGTH);
    if (!text.trim()) return null;
    return { kind: "block", name, text, from: sanitiseText(g["from"], 32) || "someone" };
  }
  // Robot, and the default: an unrecognised kind is read as the one every peer
  // has always understood rather than dropped.
  const source = sanitiseText(g["source"], MAX_SOURCE_LENGTH);
  if (!source.trim()) return null;
  const color = g["color"];
  return {
    kind: "robot",
    name,
    color: typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#8a8f98",
    source,
  };
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
