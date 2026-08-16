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
  /** Entrant ids; null means "not decided yet", or nobody at all in a bye. */
  a: string | null;
  b: string | null;
  winner: string | null;
  /** True when this slot was taken without a tie being played. */
  bye: boolean;
  /**
   * The matches feeding this slot, by id.
   *
   * Held explicitly rather than worked out from the slot number. Pairings for a
   * round are made when the round below it finishes — because who sits out
   * depends on the qualifying table, not on geometry — so there is no formula
   * that maps a slot to its children, and the tree has to remember.
   */
  from: Array<string | null>;
}

export interface Bracket {
  entrants: Entrant[];
  rounds: BracketMatch[][];
  champion: string | null;
  /**
   * Entrant ids best-first, from the qualifying round robin.
   *
   * This is what decides every bye. Any round with an odd number of robots left
   * has to leave one unpaired, and the free pass goes to the best qualifier
   * still standing rather than to whoever holds an awkward slot. Empty when the
   * field is a power of two, because then no round ever has an odd count and
   * nobody is ever seeded through.
   */
  ranking: string[];
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

/**
 * Draw everyone against somebody.
 *
 * The textbook single-elimination bracket pads the field up to a power of two
 * and hands out byes in the first round: twenty entrants become a thirty-two
 * slot draw with twelve byes, so twelve robots never fight in round one. In a
 * tournament people watch, that is the wrong trade — most of the room would sit
 * through a first round their robot was not in.
 *
 * So every round pairs off as many as it can, and a bye appears only when a
 * round has an odd number left: at most one per round, never more. Twenty
 * entrants play ten ties, then five, then two (one through), then one (one
 * through), then a final. The same nineteen ties either way — it is only a
 * question of when they are played, and this way everybody plays at once.
 *
 * The cost is honest and small: a bye late in a draw is worth more than a bye
 * at the start. It lands on whoever holds the last slot of an odd round, and
 * since the draw itself is shuffled, that is nobody in particular.
 */
export function buildBracket(
  entrants: readonly Entrant[],
  seed: number,
  ranking: readonly string[] = [],
): Bracket {
  const drawn = shuffle(entrants, new Rng(seed));

  // The shape is known from the start — halve and round up — even though who
  // is in each round is not. Drawing the empty rounds now is what lets the
  // screen show the whole tournament ahead of itself.
  const rounds: BracketMatch[][] = [];
  let count = Math.max(2, drawn.length);
  let round = 0;
  for (;;) {
    const width = Math.ceil(count / 2);
    rounds.push(
      Array.from({ length: width }, (_, slot) => ({
        id: `r${round}m${slot}`,
        round,
        slot,
        a: null,
        b: null,
        winner: null,
        bye: false,
        from: [null, null] as Array<string | null>,
      })),
    );
    if (width === 1) break;
    count = width;
    round++;
  }

  const bracket: Bracket = {
    entrants: [...drawn],
    rounds,
    champion: null,
    ranking: [...ranking],
  };
  return seedRound(
    bracket,
    0,
    drawn.map((e) => e.id),
    [],
  );
}

/**
 * Fill in a round: pair the survivors off, and seed the odd one out.
 *
 * The survivors arrive in bracket order — the order they won their ties in —
 * so pairings stay a product of the draw. Only the choice of who sits out
 * consults the qualifying table.
 */
function seedRound(
  bracket: Bracket,
  round: number,
  survivors: readonly string[],
  fromIds: ReadonlyArray<string | null>,
): Bracket {
  const matches = bracket.rounds[round];
  if (!matches) return bracket;

  const order = [...survivors];
  const feeds = new Map<string, string | null>();
  order.forEach((id, i) => feeds.set(id, fromIds[i] ?? null));

  let seeded: string | null = null;
  if (order.length % 2 === 1) {
    // Who has already been waved through once: a robot that has had a bye goes
    // to the back of the queue for the next one. Topping the qualifying table
    // should be worth one free pass, not a walk to the final.
    const already = new Set(
      bracket.rounds.flatMap((r) => r.filter((m) => m.bye).map((m) => m.winner)),
    );
    const fresh = order.filter((id) => !already.has(id));
    const pool = fresh.length > 0 ? fresh : order;
    // Best qualifier still standing takes it. With no qualifying table — a
    // field that never needed one — the last in bracket order does.
    seeded = bracket.ranking.find((id) => pool.includes(id)) ?? pool[pool.length - 1] ?? null;
    if (seeded !== null) order.splice(order.indexOf(seeded), 1);
  }

  const rounds = bracket.rounds.map((r) => r.map((m) => ({ ...m })));
  const target = rounds[round]!;
  for (let slot = 0; slot < target.length; slot++) {
    const match = target[slot]!;
    const a = order[slot * 2] ?? null;
    const b = order[slot * 2 + 1] ?? null;
    match.a = a;
    match.b = b;
    match.from = [
      a === null ? null : (feeds.get(a) ?? null),
      b === null ? null : (feeds.get(b) ?? null),
    ];
  }

  let next: Bracket = { ...bracket, rounds };

  // The seeded robot takes the last slot, alone, and is through the moment the
  // round is drawn — there is nobody for it to play.
  if (seeded !== null) {
    const slot = target.length - 1;
    const match = rounds[round]![slot]!;
    match.a = seeded;
    match.b = null;
    match.from = [feeds.get(seeded) ?? null, null];
    next = advance(next, match.id, seeded, true);
  }
  return next;
}

/**
 * Record a winner, and draw the next round once this one is finished.
 *
 * Nothing is carried forward one winner at a time: the next round cannot be
 * paired until every tie in this one is settled, because which robot sits out
 * depends on the whole set of survivors.
 */
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

  const settled = rounds[found.round]!;
  const complete = settled.every((m) => m.winner !== null);

  if (!rounds[found.round + 1]) {
    return { ...bracket, rounds, champion: complete ? winner : null };
  }
  const next: Bracket = { ...bracket, rounds, champion: null };
  if (!complete) return next;

  // In bracket order, so the pairings that follow are still the draw's doing.
  return seedRound(
    next,
    found.round + 1,
    settled.map((m) => m.winner!),
    settled.map((m) => m.id),
  );
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
