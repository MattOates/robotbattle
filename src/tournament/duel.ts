/**
 * Deciding one tie of a tournament.
 *
 * A single match is a poor judge. Spawn positions are jittered, ties are broken
 * by fractions of health, and plenty of robots beat each other roughly half the
 * time — so a knockout settled by one battle mostly reports the seed. Every tie
 * here is therefore played eleven times and won on the record.
 *
 * The other half of the job is giving people something to *watch*. A win rate
 * is a fact about eleven matches nobody saw, so each duel also picks one real
 * match out of the set — one the winner actually won — and records exactly how
 * to rebuild it. Because a manifest fully determines a match, that is a seed and
 * a side, and any peer can replay it frame for frame and see the same result.
 */

import { runMatch, type MatchResult } from "../sim/match.js";
import { checkScript, makeManifest, type MatchManifest } from "../sim/world.js";
import { ARENA_SIZE } from "../net/matchsetup.js";

/** One side of a tie. */
export interface Duellist {
  name: string;
  color: string;
  source: string;
}

export type Side = "a" | "b";

/**
 * How to replay one match of a duel.
 *
 * Not a recording — a recipe. The match is re-simulated from these three
 * numbers, which is why watching it costs a few kilobytes and cannot disagree
 * with the result it is illustrating.
 */
export interface Showcase {
  seed: number;
  /** Whether `a` took the first manifest slot; the sides alternate. */
  aFirst: boolean;
  /** Who won this particular match — always the winner of the duel. */
  winner: Side;
  /** How long it ran, so the UI can say what it is about to show. */
  ticks: number;
}

export interface DuelResult {
  aWins: number;
  bWins: number;
  draws: number;
  matches: number;
  /** Null only when neither script can be compiled. */
  winner: Side | null;
  /** The winner's share of the matches played, 0-100. */
  winRate: number;
  /**
   * How the tie was settled, for the UI to explain itself. `toss` means there
   * was genuinely nothing between them and the draw picked one.
   */
  decidedBy: "record" | "health" | "toss" | "walkover" | "none";
  /** A match worth watching, or null when nothing was actually played. */
  showcase: Showcase | null;
}

/**
 * Matches per tie. Odd, so the record cannot be level on wins alone, and small
 * enough that a round of a full bracket finishes while people are still
 * interested.
 */
export const DUEL_MATCHES = 11;

/**
 * Build the manifest for one match of a duel.
 *
 * The single source of truth for what a duel match *is*: `runDuel` plays these
 * and the arena replays these, so a showcase cannot drift from the match it
 * claims to be. Colours travel too, because a robot people are watching should
 * be the colour its owner chose.
 */
export function duelManifest(
  a: Duellist,
  b: Duellist,
  seed: number,
  aFirst: boolean,
): MatchManifest {
  const first = aFirst ? a : b;
  const second = aFirst ? b : a;
  return makeManifest(
    [
      { source: first.source, color: first.color },
      { source: second.source, color: second.color },
    ],
    { seed, width: ARENA_SIZE.width, height: ARENA_SIZE.height },
  );
}

/** Which manifest entry a given side occupied. */
export function sideIndex(side: Side, aFirst: boolean): number {
  if (side === "a") return aFirst ? 0 : 1;
  return aFirst ? 1 : 0;
}

interface Candidate {
  seed: number;
  aFirst: boolean;
  ticks: number;
  /** False when the match was still going when the clock ran out. */
  decisive: boolean;
}

/**
 * Play a tie out and report the record.
 *
 * Sides alternate match by match so that no part of the result is an artefact
 * of where a robot spawned. With an odd number of matches one side inevitably
 * starts first once more than the other, which is why the tiebreak below is
 * health rather than anything positional.
 */
export function runDuel(
  a: Duellist,
  b: Duellist,
  seedBase: number,
  matches: number = DUEL_MATCHES,
  onMatch?: (played: number, total: number) => void,
): DuelResult {
  const aOk = checkScript(a.source).ok;
  const bOk = checkScript(b.source).ok;

  // A robot that will not compile cannot fight. Its opponent goes through
  // without a match rather than by winning eleven forfeits, because a scoreline
  // would suggest a contest that never happened.
  if (!aOk || !bOk) {
    const winner: Side | null = aOk && !bOk ? "a" : bOk && !aOk ? "b" : null;
    return {
      aWins: 0,
      bWins: 0,
      draws: 0,
      matches: 0,
      winner,
      winRate: 0,
      decidedBy: winner === null ? "none" : "walkover",
      showcase: null,
    };
  }

  const total = Math.max(1, Math.floor(matches));
  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  let aHealth = 0;
  let bHealth = 0;
  const wonBy: Record<Side, Candidate[]> = { a: [], b: [] };

  // Which corner of the bracket a robot lands in must decide nothing, so the
  // sides are alternated against a canonical order of the two scripts rather
  // than against the order they were handed to us. Swapping the corners then
  // plays the identical eleven matches, and the tie comes out the same way.
  const flip = a.source !== b.source ? a.source > b.source : a.name > b.name;

  for (let i = 0; i < total; i++) {
    const canonicalFirst = i % 2 === 0;
    const aFirst = flip ? !canonicalFirst : canonicalFirst;
    const seed = seedBase + i;
    const manifest = duelManifest(a, b, seed, aFirst);
    const result = runMatch(manifest);

    const health = {
      a: healthOf(result, sideIndex("a", aFirst)),
      b: healthOf(result, sideIndex("b", aFirst)),
    };
    aHealth += health.a;
    bHealth += health.b;

    /**
     * A match that ran out of clock is awarded by the arena on health, then on
     * damage dealt — and when those are level too, on entry order. That last
     * step makes the first slot win, and over an odd number of matches one side
     * always gets the extra first slot, so a pair of robots that cannot hurt
     * each other would come out 6-5 to whoever the alternation favoured. Nobody
     * won that; it is a draw, and calling it one is what keeps the alternation
     * honest.
     */
    const timedOut = result.ticks >= manifest.maxTicks;
    const separated =
      health.a !== health.b ||
      damageOf(result, sideIndex("a", aFirst)) !== damageOf(result, sideIndex("b", aFirst));
    const decisive = !timedOut;

    if (result.winnerId === null || (timedOut && !separated)) {
      draws++;
    } else if (result.winnerId === sideIndex("a", aFirst)) {
      aWins++;
      wonBy.a.push({ seed, aFirst, ticks: result.ticks, decisive });
    } else {
      bWins++;
      wonBy.b.push({ seed, aFirst, ticks: result.ticks, decisive });
    }

    onMatch?.(i + 1, total);
  }

  let winner: Side;
  let decidedBy: DuelResult["decidedBy"];
  if (aWins !== bWins) {
    winner = aWins > bWins ? "a" : "b";
    decidedBy = "record";
  } else if (aHealth !== bHealth) {
    // Level on wins, which an odd number of matches only allows once draws are
    // involved. Total health left over the whole tie is the closest thing to
    // "who was winning" that does not depend on a coin toss.
    winner = aHealth > bHealth ? "a" : "b";
    decidedBy = "health";
  } else {
    // Nothing whatsoever to separate them — two copies of the same robot, or
    // two that cannot hurt each other. Somebody still has to go through, and
    // the screen says plainly that this one was not earned.
    winner = "a";
    decidedBy = "toss";
  }

  const played = aWins + bWins + draws;
  const winnerWins = winner === "a" ? aWins : bWins;

  return {
    aWins,
    bWins,
    draws,
    matches: played,
    winner,
    winRate: played === 0 ? 0 : (winnerWins / played) * 100,
    decidedBy,
    showcase: pickShowcase(wonBy[winner], winner),
  };
}

/**
 * Choose the match to put in front of people.
 *
 * A win that ended in a kill, in preference to one awarded when the clock ran
 * out — a robot standing still as the timer expires is the least watchable
 * thing in the set, and it is the one match where nothing visibly happened.
 *
 * Among those, the *median* by length. The shortest is usually a rout that
 * shows nothing; the longest is usually two robots circling until the limit,
 * and at 30Hz that is a two-minute video of nothing happening. The median is a
 * typical match between these two, which is what somebody trying to learn a
 * robot's behaviour wants.
 *
 * Sorted by length and then by seed so that every peer, given the same duel,
 * picks the same match.
 */
function pickShowcase(candidates: Candidate[], winner: Side): Showcase | null {
  if (candidates.length === 0) return null;
  const decisive = candidates.filter((c) => c.decisive);
  const ordered = [...(decisive.length > 0 ? decisive : candidates)].sort(
    (x, y) => x.ticks - y.ticks || x.seed - y.seed,
  );
  // Lower median, so an even number of wins leans to the shorter of the middle
  // pair rather than picking arbitrarily.
  const pick = ordered[Math.floor((ordered.length - 1) / 2)]!;
  return { seed: pick.seed, aFirst: pick.aFirst, winner, ticks: pick.ticks };
}

function healthOf(result: MatchResult, entryIndex: number): number {
  return result.standings.find((s) => s.id === entryIndex)?.health ?? 0;
}

function damageOf(result: MatchResult, entryIndex: number): number {
  return result.standings.find((s) => s.id === entryIndex)?.damageDealt ?? 0;
}

/** A one-line scoreline, e.g. `7–4` or `6–4 (1 draw)`. */
export function scoreline(result: DuelResult): string {
  if (result.decidedBy === "walkover") return "walkover";
  if (result.decidedBy === "none") return "no contest";
  if (result.decidedBy === "toss") return "nothing between them";
  const winnerWins = result.winner === "a" ? result.aWins : result.bWins;
  const loserWins = result.winner === "a" ? result.bWins : result.aWins;
  const draws = result.draws > 0 ? ` (${result.draws} draw${result.draws === 1 ? "" : "s"})` : "";
  return `${winnerWins}–${loserWins}${draws}`;
}
