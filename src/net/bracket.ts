/**
 * Single-elimination tournament brackets.
 *
 * Pure functions over plain data, deliberately knowing nothing about
 * transports or React, so seeding, byes and progression can be tested exactly
 * — which matters, because bracket bugs only show up when someone has already
 * invested twenty minutes in a tournament.
 */

import { Rng } from "../sim/rng.js";
import type { RobotEntry } from "./protocol.js";

/**
 * One robot in the draw.
 *
 * Keyed by robot rather than by person: someone who puts three robots on the
 * table enters three times, and may well meet themselves in round two. The
 * owner is carried along only so the bracket can say whose robot it is.
 */
export interface Entrant {
  /** Unique within a tournament. */
  id: string;
  /** Who put it forward. */
  ownerName: string;
  robot: RobotEntry;
}

export interface BracketMatch {
  id: string;
  round: number;
  /** Position within the round. */
  slot: number;
  /** Entrant ids; null means "not decided yet" or, in round 0, a bye. */
  a: string | null;
  b: string | null;
  winner: string | null;
  /** True when this match was won without being played. */
  bye: boolean;
}

export interface Bracket {
  entrants: Entrant[];
  rounds: BracketMatch[][];
  champion: string | null;
}

/** Smallest power of two that fits everyone, minimum two. */
function bracketSize(count: number): number {
  let size = 2;
  while (size < count) size *= 2;
  return size;
}

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  // Fisher-Yates, drawing from the seeded RNG so the draw is reproducible and
  // every peer builds the identical bracket from the same seed.
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export function buildBracket(entrants: readonly Entrant[], seed: number): Bracket {
  const drawn = shuffle(entrants, new Rng(seed));
  const size = bracketSize(Math.max(2, drawn.length));
  const byeCount = Math.max(0, size - drawn.length);

  // Entrants drawn first receive the byes. Because the draw is random, this is
  // fair; because byes are then interleaved with real matches, they do not all
  // land in one half of the bracket.
  const byeEntrants = drawn.slice(0, byeCount);
  const playing = drawn.slice(byeCount);

  const pairs: Array<[string | null, string | null]> = [];
  for (let i = 0; i < playing.length; i += 2) {
    pairs.push([playing[i]?.id ?? null, playing[i + 1]?.id ?? null]);
  }

  const firstRound: Array<[string | null, string | null]> = [];
  let byeIndex = 0;
  let pairIndex = 0;
  const totalFirst = size / 2;
  for (let i = 0; i < totalFirst; i++) {
    const takeBye = byeIndex < byeEntrants.length && (i % 2 === 0 || pairIndex >= pairs.length);
    if (takeBye) {
      firstRound.push([byeEntrants[byeIndex]!.id, null]);
      byeIndex++;
    } else if (pairIndex < pairs.length) {
      firstRound.push(pairs[pairIndex]!);
      pairIndex++;
    } else if (byeIndex < byeEntrants.length) {
      firstRound.push([byeEntrants[byeIndex]!.id, null]);
      byeIndex++;
    } else {
      firstRound.push([null, null]);
    }
  }

  const rounds: BracketMatch[][] = [];
  let width = totalFirst;
  for (let round = 0; width >= 1; round++) {
    const matches: BracketMatch[] = [];
    for (let slot = 0; slot < width; slot++) {
      const seeded = round === 0 ? firstRound[slot]! : [null, null];
      matches.push({
        id: `r${round}m${slot}`,
        round,
        slot,
        a: seeded[0] ?? null,
        b: seeded[1] ?? null,
        winner: null,
        bye: false,
      });
    }
    rounds.push(matches);
    if (width === 1) break;
    width = width / 2;
  }

  let bracket: Bracket = { entrants: [...drawn], rounds, champion: null };

  // Resolve byes immediately: a match with only one entrant was never a match.
  for (const match of [...rounds[0]!]) {
    if (match.a !== null && match.b === null) {
      bracket = advance(bracket, match.id, match.a, true);
    }
  }
  return bracket;
}

/** Record a winner and carry them into the next round. */
export function advance(bracket: Bracket, matchId: string, winner: string, bye = false): Bracket {
  const rounds = bracket.rounds.map((round) => round.map((m) => ({ ...m })));
  let found: BracketMatch | undefined;
  for (const round of rounds) {
    const match = round.find((m) => m.id === matchId);
    if (match) {
      found = match;
      break;
    }
  }
  if (!found || found.winner !== null) return bracket;
  if (winner !== found.a && winner !== found.b) return bracket;

  found.winner = winner;
  found.bye = bye;

  const nextRound = rounds[found.round + 1];
  if (!nextRound) {
    return { ...bracket, rounds, champion: winner };
  }
  const target = nextRound[Math.floor(found.slot / 2)];
  if (target) {
    if (found.slot % 2 === 0) target.a = winner;
    else target.b = winner;
  }

  let next: Bracket = { ...bracket, rounds, champion: null };
  // A promotion can create another walkover further up the bracket.
  if (target && target.a !== null && target.b === null && isRoundSettled(next, target.round - 1)) {
    const opponentSlot = target.slot * 2 + (found.slot % 2 === 0 ? 1 : 0);
    const sibling = rounds[found.round]?.[opponentSlot];
    if (sibling && sibling.a === null && sibling.b === null) {
      next = advance(next, target.id, target.a, true);
    }
  }
  return next;
}

function isRoundSettled(bracket: Bracket, round: number): boolean {
  const matches = bracket.rounds[round];
  if (!matches) return true;
  return matches.every((m) => m.winner !== null || (m.a === null && m.b === null));
}

/** The next match that can actually be played, or null when the bracket is done. */
export function nextMatch(bracket: Bracket): BracketMatch | null {
  for (const round of bracket.rounds) {
    for (const match of round) {
      if (match.winner === null && match.a !== null && match.b !== null) return match;
    }
    // Do not look ahead past a round that still has matches outstanding.
    if (round.some((m) => m.winner === null && !(m.a === null && m.b === null))) return null;
  }
  return null;
}

export function isComplete(bracket: Bracket): boolean {
  return bracket.champion !== null;
}

export function entrant(bracket: Bracket, id: string | null): Entrant | undefined {
  if (id === null) return undefined;
  return bracket.entrants.find((e) => e.id === id);
}

export function entrantName(bracket: Bracket, id: string | null): string {
  return entrant(bracket, id)?.robot.name ?? "—";
}

/** Human label for a round, counting back from the final. */
export function roundName(bracket: Bracket, round: number): string {
  const fromEnd = bracket.rounds.length - 1 - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semi-finals";
  if (fromEnd === 2) return "Quarter-finals";
  return `Round ${round + 1}`;
}
