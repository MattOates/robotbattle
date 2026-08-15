/**
 * Turning a room full of people into a match.
 *
 * The host does this once and broadcasts the result. Everyone else plays that
 * manifest locally — which is why a peer disconnecting mid-battle changes
 * nothing: their script is already on every machine.
 */

import { makeManifest, type Entry, type MatchManifest } from "../sim/world.js";
import type { RobotEntry } from "./protocol.js";
import type { PeerId } from "./transport.js";
import { newId } from "../store/storage.js";

export interface Participant {
  peerId: PeerId;
  displayName: string;
  robot: RobotEntry;
}

export const ARENA_SIZE = { width: 900, height: 620 } as const;

/**
 * Build the manifest for a match.
 *
 * Participants are sorted by peer id so that every peer, given the same room,
 * would construct byte-identical entries — which is what makes the host's
 * manifest verifiable rather than merely trusted.
 */
export function manifestFromParticipants(
  participants: readonly Participant[],
  seed: number,
  options: { maxTicks?: number } = {},
): MatchManifest {
  const ordered = [...participants].sort((a, b) => a.peerId.localeCompare(b.peerId));
  const entries: Entry[] = ordered.map((p) => ({
    source: p.robot.source,
    color: p.robot.color,
  }));
  return makeManifest(entries, {
    seed,
    width: ARENA_SIZE.width,
    height: ARENA_SIZE.height,
    ...(options.maxTicks !== undefined ? { maxTicks: options.maxTicks } : {}),
  });
}

/** Which manifest entry belongs to which peer, after the sort above. */
export function entryIndexFor(
  participants: readonly Participant[],
  peerId: PeerId,
): number | null {
  const ordered = [...participants].sort((a, b) => a.peerId.localeCompare(b.peerId));
  const index = ordered.findIndex((p) => p.peerId === peerId);
  return index < 0 ? null : index;
}

export function newMatchId(): string {
  return newId("match");
}

/** A seed nobody can have picked in advance to suit their robot. */
export function newMatchSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) & 0x7fffffff;
}
