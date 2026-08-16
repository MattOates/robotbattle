/**
 * Qualifying: everybody plays everybody, once.
 *
 * This exists to answer one question honestly — who sits out?
 *
 * A knockout draw that is not a power of two has to leave somebody unpaired in
 * any round with an odd number of robots left. Handing that to whoever happens
 * to hold the odd slot is a free pass decided by the shuffle, and a free pass
 * into a semi-final is worth a great deal. So the field plays a round robin
 * first, and the resulting order decides every bye in the tournament: when a
 * round cannot pair off, the best qualifier still standing is seeded through.
 *
 * One match per pair rather than eleven. A qualifier is a ranking, not a
 * verdict — the eleven-match ties are where the tournament is actually decided,
 * and n(n-1)/2 ties of eleven would be a wait nobody would sit through.
 */

import { runMatch } from "../sim/match.js";
import { checkScript } from "../sim/world.js";
import { duelManifest, type Duellist } from "./duel.js";

export interface QualifierEntrant {
  id: string;
  robot: Duellist;
}

export interface Standing {
  id: string;
  wins: number;
  losses: number;
  draws: number;
  played: number;
  /** Health left across every match, the first tiebreak after wins. */
  health: number;
  /** True when the script would not compile, so nothing was played. */
  broken: boolean;
}

export interface QualifierProgress {
  done: number;
  total: number;
}

/** How many matches a field of `n` has to play to qualify. */
export function qualifierMatches(n: number): number {
  return (n * (n - 1)) / 2;
}

/**
 * Whether a draw of this size will ever need a bye.
 *
 * Halve and round up until one is left: any odd count above one on the way
 * leaves somebody unpaired. That is every field except a power of two, which is
 * exactly when the qualifier is worth running.
 */
export function needsQualifier(entrants: number): boolean {
  for (let count = entrants; count > 1; count = Math.ceil(count / 2)) {
    if (count % 2 === 1) return true;
  }
  return false;
}

/**
 * Play the round robin and rank the field.
 *
 * Sides are assigned from a canonical ordering of the two scripts rather than
 * from the order the pair happens to come up in, so a robot's record does not
 * depend on where it sits in the list — the same reason the eleven-match ties
 * do it.
 */
export function runQualifier(
  entrants: readonly QualifierEntrant[],
  seedBase: number,
  onProgress?: (progress: QualifierProgress) => void,
): Standing[] {
  const table = new Map<string, Standing>();
  for (const entrant of entrants) {
    table.set(entrant.id, {
      id: entrant.id,
      wins: 0,
      losses: 0,
      draws: 0,
      played: 0,
      health: 0,
      broken: !checkScript(entrant.robot.source).ok,
    });
  }

  const total = qualifierMatches(entrants.length);
  let done = 0;

  for (let i = 0; i < entrants.length; i++) {
    for (let j = i + 1; j < entrants.length; j++) {
      const x = entrants[i]!;
      const y = entrants[j]!;
      const xs = table.get(x.id)!;
      const ys = table.get(y.id)!;
      done++;

      // A script that will not compile cannot play. It loses everything, which
      // is the only ranking that makes sense, and no match is simulated.
      if (xs.broken || ys.broken) {
        if (xs.broken && !ys.broken) {
          ys.wins++;
          ys.played++;
          xs.losses++;
          xs.played++;
        } else if (ys.broken && !xs.broken) {
          xs.wins++;
          xs.played++;
          ys.losses++;
          ys.played++;
        }
        if (done % 8 === 0 || done === total) onProgress?.({ done, total });
        continue;
      }

      // Seeded from the pair itself rather than from where the two happen to
      // sit in the list, so a robot's record cannot change with the order the
      // field was collected in.
      const seed = pairSeed(seedBase, x.id, y.id);
      // Ordered by script, and by id when two entries are the same script —
      // which happens the moment somebody enters a robot they were given.
      const xFirst =
        x.robot.source !== y.robot.source ? x.robot.source < y.robot.source : x.id <= y.id;
      const manifest = duelManifest(x.robot, y.robot, seed, xFirst);
      const result = runMatch(manifest);

      const xIndex = xFirst ? 0 : 1;
      const yIndex = xFirst ? 1 : 0;
      xs.health += healthOf(result.standings, xIndex);
      ys.health += healthOf(result.standings, yIndex);
      xs.played++;
      ys.played++;

      // A match still going when the clock runs out is awarded on health and
      // then on entry order; when there is nothing to separate them that is a
      // coin toss, so it counts as a draw here.
      const timedOut = result.ticks >= manifest.maxTicks;
      const level =
        healthOf(result.standings, xIndex) === healthOf(result.standings, yIndex) &&
        damageOf(result.standings, xIndex) === damageOf(result.standings, yIndex);

      if (result.winnerId === null || (timedOut && level)) {
        xs.draws++;
        ys.draws++;
      } else if (result.winnerId === xIndex) {
        xs.wins++;
        ys.losses++;
      } else {
        ys.wins++;
        xs.losses++;
      }

      if (done % 8 === 0 || done === total) onProgress?.({ done, total });
    }
  }

  return rank([...table.values()]);
}

/**
 * Best first: wins, then health left, then draws, then id.
 *
 * The last of those is not a judgement, only a rule — two robots with identical
 * records have to come out in *some* order, and it has to be the same order on
 * every screen in the room.
 */
export function rank(standings: readonly Standing[]): Standing[] {
  return [...standings].sort(
    (a, b) =>
      b.wins - a.wins || b.health - a.health || b.draws - a.draws || a.id.localeCompare(b.id),
  );
}

/** A seed for one pairing: stable, and the same whichever way round it comes. */
export function pairSeed(base: number, idA: string, idB: string): number {
  const key = idA <= idB ? `${idA}|${idB}` : `${idB}|${idA}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (base + Math.abs(hash)) & 0x7fffffff;
}

function healthOf(standings: Array<{ id: number; health: number }>, index: number): number {
  return standings.find((s) => s.id === index)?.health ?? 0;
}

function damageOf(standings: Array<{ id: number; damageDealt: number }>, index: number): number {
  return standings.find((s) => s.id === index)?.damageDealt ?? 0;
}
