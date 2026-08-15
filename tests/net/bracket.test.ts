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
    peerId: `p${i + 1}`,
    displayName: `Player ${i + 1}`,
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
    expect(b.entrants.map((e) => e.peerId)).not.toEqual(a.entrants.map((e) => e.peerId));
  });

  it("keeps everyone who entered", () => {
    const bracket = buildBracket(entrants(7), 3);
    expect(bracket.entrants.map((e) => e.peerId).sort()).toEqual(
      entrants(7).map((e) => e.peerId).sort(),
    );
  });

  it("sizes the bracket to the next power of two", () => {
    expect(buildBracket(entrants(8), 1).rounds[0]).toHaveLength(4);
    expect(buildBracket(entrants(5), 1).rounds[0]).toHaveLength(4);
    expect(buildBracket(entrants(3), 1).rounds[0]).toHaveLength(2);
    expect(buildBracket(entrants(2), 1).rounds[0]).toHaveLength(1);
  });

  it("names the closing rounds properly", () => {
    const bracket = buildBracket(entrants(8), 1);
    expect(roundName(bracket, 2)).toBe("Final");
    expect(roundName(bracket, 1)).toBe("Semi-finals");
    expect(roundName(bracket, 0)).toBe("Quarter-finals");
  });
});

describe("byes", () => {
  it("gives nobody two byes in the first round", () => {
    const bracket = buildBracket(entrants(5), 7);
    const byes = bracket.rounds[0]!.filter((m) => m.bye);
    expect(byes).toHaveLength(3);
    expect(new Set(byes.map((m) => m.winner)).size).toBe(3);
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
      expect(finished.entrants.some((e) => e.peerId === finished.champion)).toBe(true);
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

  it("carries a winner into the right slot of the next round", () => {
    const bracket = buildBracket(entrants(8), 11);
    const match = bracket.rounds[0]![0]!;
    const next = advance(bracket, match.id, match.a!);
    expect(next.rounds[1]![0]!.a).toBe(match.a);
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
