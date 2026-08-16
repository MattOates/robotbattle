/**
 * Bracket bugs surface only after people have already invested a tournament's
 * worth of time in them, so this suite plays whole tournaments out.
 */

import { describe, expect, it } from "vitest";
import {
  advance,
  buildBracket,
  isComplete,
  nextMatch,
  roundName,
  type Bracket,
  type Entrant,
} from "../../src/net/bracket.js";

function entrants(n: number): Entrant[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    ownerName: `Player ${i + 1}`,
    robot: { name: `Bot ${i + 1}`, color: "#ff8800", source: "chassis tank\n" },
  }));
}

/** Play every match, always letting the first-listed entrant win. */
function playOut(bracket: Bracket): Bracket {
  let current = bracket;
  let guard = 0;
  for (;;) {
    const match = nextMatch(current);
    if (!match) break;
    current = advance(current, match.id, match.a!);
    if (++guard > 200) throw new Error("bracket never finished");
  }
  return current;
}

describe("building", () => {
  it("is reproducible from a seed", () => {
    expect(buildBracket(entrants(6), 42)).toEqual(buildBracket(entrants(6), 42));
  });

  it("draws differently for a different seed", () => {
    const a = buildBracket(entrants(8), 1);
    const b = buildBracket(entrants(8), 2);
    expect(b.entrants.map((e) => e.id)).not.toEqual(a.entrants.map((e) => e.id));
  });

  it("keeps everyone who entered", () => {
    const bracket = buildBracket(entrants(7), 3);
    expect(bracket.entrants.map((e) => e.id).sort()).toEqual(
      entrants(7)
        .map((e) => e.id)
        .sort(),
    );
  });

  it("pairs everybody off in the first round", () => {
    // Not padded up to a power of two: a field of twenty plays ten ties, so
    // nobody sits out the round their robot was entered for.
    expect(buildBracket(entrants(8), 1).rounds[0]).toHaveLength(4);
    expect(buildBracket(entrants(5), 1).rounds[0]).toHaveLength(3);
    expect(buildBracket(entrants(3), 1).rounds[0]).toHaveLength(2);
    expect(buildBracket(entrants(2), 1).rounds[0]).toHaveLength(1);
    expect(buildBracket(entrants(20), 1).rounds.map((r) => r.length)).toEqual([10, 5, 3, 2, 1]);
  });

  it("halves the field each round until one is left", () => {
    for (const n of [2, 3, 5, 6, 7, 9, 12, 17, 20, 31, 64]) {
      const rounds = buildBracket(entrants(n), n).rounds.map((r) => r.length);
      expect(rounds.at(-1)).toBe(1);
      // Each round is exactly what the round below it can produce.
      for (let i = 1; i < rounds.length; i++) {
        expect(rounds[i]).toBe(Math.ceil(rounds[i - 1]! / 2));
      }
    }
  });

  it("names the closing rounds properly", () => {
    const bracket = buildBracket(entrants(8), 1);
    expect(roundName(bracket, 2)).toBe("Final");
    expect(roundName(bracket, 1)).toBe("Semi-finals");
    expect(roundName(bracket, 0)).toBe("Quarter-finals");
  });
});

describe("byes", () => {
  it("never leaves more than one robot out of a round", () => {
    // The whole point of pairing off rather than padding: an odd count means
    // exactly one robot goes through unopposed, and an even count means none.
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 12, 17, 20, 21, 31]) {
      let bracket = buildBracket(entrants(n), n * 3);
      for (;;) {
        for (const round of bracket.rounds) {
          expect(round.filter((m) => m.bye).length).toBeLessThanOrEqual(1);
        }
        const match = nextMatch(bracket);
        if (!match) break;
        bracket = advance(bracket, match.id, match.a!);
      }
      // And the robot with the bye comes in at the next round, having played
      // nothing — which is only ever one robot.
      expect(bracket.rounds.every((r) => r.filter((m) => m.bye).length <= 1)).toBe(true);
    }
  });

  it("gives the odd one out a place in the next round, once that round is drawn", () => {
    let bracket = buildBracket(entrants(5), 7);
    const byes = bracket.rounds[0]!.filter((m) => m.bye);
    expect(byes).toHaveLength(1);
    const throughId = byes[0]!.winner;
    expect(throughId).not.toBeNull();

    // Pairings are made when a round finishes, not before: who sits out the
    // next one depends on everybody who survives this one.
    expect(bracket.rounds[1]!.flatMap((m) => [m.a, m.b])).toEqual([null, null, null, null]);
    for (;;) {
      const match = nextMatch(bracket);
      if (!match || match.round > 0) break;
      bracket = advance(bracket, match.id, match.a!);
    }
    expect(bracket.rounds[1]!.flatMap((m) => [m.a, m.b])).toContain(throughId);
  });

  it("resolves byes without needing a match played", () => {
    const bracket = buildBracket(entrants(3), 5);
    // With three entrants one gets a bye, so only one real match is playable.
    const playable = bracket.rounds[0]!.filter((m) => m.winner === null);
    expect(playable).toHaveLength(1);
    expect(playable[0]!.a).not.toBeNull();
    expect(playable[0]!.b).not.toBeNull();
  });

  it("never offers a bye match as something to play", () => {
    for (let n = 2; n <= 12; n++) {
      const bracket = buildBracket(entrants(n), n);
      const match = nextMatch(bracket);
      if (match) {
        expect(match.a).not.toBeNull();
        expect(match.b).not.toBeNull();
      }
    }
  });
});

describe("playing out", () => {
  it("reaches exactly one champion for any number of entrants", () => {
    for (let n = 2; n <= 17; n++) {
      const finished = playOut(buildBracket(entrants(n), n * 13));
      expect(isComplete(finished), `${n} entrants`).toBe(true);
      expect(finished.champion, `${n} entrants`).not.toBeNull();
      // The champion has to be someone who actually entered.
      expect(finished.entrants.some((e) => e.id === finished.champion)).toBe(true);
    }
  });

  it("stops offering matches once it is done", () => {
    const finished = playOut(buildBracket(entrants(6), 9));
    expect(nextMatch(finished)).toBeNull();
  });

  it("does not start a round before the previous one has finished", () => {
    const bracket = buildBracket(entrants(8), 4);
    const first = nextMatch(bracket)!;
    expect(first.round).toBe(0);
    const afterOne = advance(bracket, first.id, first.a!);
    // Three quarter-finals still outstanding, so the next match is one of them.
    expect(nextMatch(afterOne)!.round).toBe(0);
  });

  it("carries winners into the next round once the round below is settled", () => {
    let bracket = buildBracket(entrants(8), 11);
    const first = bracket.rounds[0]![0]!.a!;

    // One result is not enough: the next round is drawn from the whole set of
    // survivors, so nothing moves up until the round is done.
    bracket = advance(bracket, bracket.rounds[0]![0]!.id, first);
    expect(bracket.rounds[1]!.flatMap((m) => [m.a, m.b]).every((id) => id === null)).toBe(true);

    const winners = [first];
    for (const match of bracket.rounds[0]!.slice(1)) {
      winners.push(match.a!);
      bracket = advance(bracket, match.id, match.a!);
    }
    expect(bracket.rounds[1]!.flatMap((m) => [m.a, m.b])).toEqual(winners);
    // And each new match remembers which ties fed it, for drawing the tree.
    expect(bracket.rounds[1]![0]!.from).toEqual([
      bracket.rounds[0]![0]!.id,
      bracket.rounds[0]![1]!.id,
    ]);
  });

  it("ignores a result for someone who was not in the match", () => {
    const bracket = buildBracket(entrants(8), 2);
    const match = nextMatch(bracket)!;
    expect(advance(bracket, match.id, "nobody")).toEqual(bracket);
  });

  it("ignores a second result for the same match", () => {
    const bracket = buildBracket(entrants(4), 6);
    const match = nextMatch(bracket)!;
    const once = advance(bracket, match.id, match.a!);
    expect(advance(once, match.id, match.b!)).toEqual(once);
  });

  it("leaves the original bracket untouched", () => {
    // Every mode broadcasts the bracket, so accidental mutation would desync
    // everyone's view of the tournament.
    const bracket = buildBracket(entrants(4), 8);
    const snapshot = JSON.stringify(bracket);
    advance(bracket, nextMatch(bracket)!.id, nextMatch(bracket)!.a!);
    expect(JSON.stringify(bracket)).toBe(snapshot);
  });
});
