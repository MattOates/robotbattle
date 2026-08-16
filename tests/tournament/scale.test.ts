/**
 * A big draw, and the two ways a tie can have nothing in it.
 *
 * Twenty entrants is the shape a classroom actually produces — a handful of
 * people entering three or four robots each — and it is not a power of two, so
 * it exercises byes at scale. The awkward cases matter more here than at four:
 * with twenty entrants somebody will enter two copies of the same robot, and
 * somebody's robot will not fire a shot.
 */

import { describe, expect, it } from "vitest";
import {
  advance,
  buildBracket,
  isComplete,
  nextMatch,
  type Bracket,
  type Entrant,
} from "../../src/net/bracket.js";
import { runDuel, scoreline, DUEL_MATCHES } from "../../src/tournament/duel.js";
import { DODGER, HUNTER, RACER, SPINNER } from "../../src/bots/index.js";

const SOURCES = [HUNTER, RACER, SPINNER, DODGER];

function field(n: number): Entrant[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    ownerName: `Player ${i % 5}`,
    robot: { name: `Bot ${i}`, color: "#ff8800", source: SOURCES[i % SOURCES.length]! },
  }));
}

/** Play the whole thing out, letting the first-listed entrant win. */
function playOut(bracket: Bracket): { final: Bracket; ties: number } {
  let current = bracket;
  let ties = 0;
  for (;;) {
    const match = nextMatch(current);
    if (!match) break;
    current = advance(current, match.id, match.a!);
    if (++ties > 500) throw new Error("bracket never finished");
  }
  return { final: current, ties };
}

describe("twenty entrants", () => {
  const bracket = buildBracket(field(20), 99);

  it("puts every robot in a first-round tie", () => {
    expect(bracket.entrants).toHaveLength(20);
    // Ten ties, then five, then three, two, one. Not a thirty-two slot draw
    // with twelve byes: everybody's robot fights in the round they entered.
    expect(bracket.rounds.map((r) => r.length)).toEqual([10, 5, 3, 2, 1]);
    expect(bracket.rounds[0]!.filter((m) => m.bye)).toHaveLength(0);
    expect(bracket.rounds[0]!.filter((m) => m.a !== null && m.b !== null)).toHaveLength(10);
  });

  it("leaves exactly one robot out of the odd rounds, and none of the even ones", () => {
    // Five into three and three into two are the only places twenty entrants
    // cannot pair off, and each leaves precisely one robot through.
    const { final } = playOut(bracket);
    expect(final.rounds.map((r) => r.filter((m) => m.bye).length)).toEqual([0, 0, 1, 1, 0]);
  });

  it("never gives the same robot two byes in a row", () => {
    // Rounds of 5 then 3 both leave somebody out. If the odd one out were
    // always the last slot, the same robot would take both and reach the final
    // having played two ties while everyone around it played four.
    for (const n of [5, 6, 11, 20, 21, 22, 43]) {
      const { final } = playOut(buildBracket(field(n), n * 7));
      const byesPerRound = new Map<string, number[]>();
      for (const [round, matches] of final.rounds.entries()) {
        for (const match of matches) {
          if (match.bye && match.winner) {
            byesPerRound.set(match.winner, [...(byesPerRound.get(match.winner) ?? []), round]);
          }
        }
      }

      for (const [id, rounds] of byesPerRound) {
        const consecutive = rounds.some((r, i) => i > 0 && r === rounds[i - 1]! + 1);
        expect(
          consecutive,
          `${id} had byes in rounds ${rounds.join(", ")} of a ${n}-robot draw`,
        ).toBe(false);
      }
    }
  });

  it("everybody is in it exactly once", () => {
    const drawn = bracket.rounds[0]!.flatMap((m) => [m.a, m.b]).filter((id) => id !== null);
    expect(new Set(drawn).size).toBe(20);
    expect(drawn).toHaveLength(20);
  });

  it("needs nineteen ties to find a champion, whatever the shape", () => {
    // n-1 ties for n entrants: no bye is ever "played", and nothing is played
    // twice. The count is the cheapest possible check that the tree is sound.
    const { final, ties } = playOut(bracket);
    expect(ties).toBe(19);
    expect(isComplete(final)).toBe(true);
    // Who wins depends on the draw, which is shuffled; that it is somebody who
    // actually entered is the part worth asserting.
    expect(bracket.entrants.map((e) => e.id)).toContain(final.champion);
  });

  it("never leaves a round half-promoted", () => {
    let current = bracket;
    for (;;) {
      const match = nextMatch(current);
      if (!match) break;
      // Whatever is playable belongs to the earliest unfinished round: a
      // bracket that offered a later match would be promoting somebody before
      // their opponent existed.
      const earliest = current.rounds.findIndex((r) =>
        r.some((m) => m.winner === null && !(m.a === null && m.b === null)),
      );
      expect(match.round).toBe(earliest);
      current = advance(current, match.id, match.a!);
    }
  });
});

describe("ties with nothing in them", () => {
  /** Two robots that cannot hurt each other: no shots, no collisions. */
  const IDLE = 'name "Statue"\nchassis tank\ncolor #7fd1e0\n\non start\n  stop\nend\n';

  it("calls a stalemate a draw rather than awarding it on entry order", () => {
    // The arena settles a timeout on health, then damage, then entry order —
    // so without this the first slot wins, and over eleven matches one side
    // always gets the extra first slot. That would read as a 6-5 win.
    const duel = runDuel(
      { name: "a", color: "#7fd1e0", source: IDLE },
      { name: "b", color: "#7fd1e0", source: IDLE },
      7,
    );
    expect(duel.draws).toBe(DUEL_MATCHES);
    expect(duel.aWins).toBe(0);
    expect(duel.bWins).toBe(0);
    expect(duel.decidedBy).toBe("toss");
    expect(scoreline(duel)).toBe("nothing between them");
    // Somebody still goes through, and there is no match worth watching.
    expect(duel.winner).toBe("a");
    expect(duel.showcase).toBeNull();
  });

  it("is unchanged by swapping the corners", () => {
    const straight = runDuel(
      { name: "a", color: "#7fd1e0", source: IDLE },
      { name: "b", color: "#7fd1e0", source: IDLE },
      7,
    );
    const swapped = runDuel(
      { name: "b", color: "#7fd1e0", source: IDLE },
      { name: "a", color: "#7fd1e0", source: IDLE },
      7,
    );
    expect(swapped.draws).toBe(straight.draws);
    expect(swapped.decidedBy).toBe(straight.decidedBy);
  });

  it("still shows a real kill when one exists", () => {
    // A timeout win is the least watchable match in the set, so a decisive one
    // is preferred for the replay even when it is not the median.
    const duel = runDuel(
      { name: "Hunter", color: "#ff8800", source: HUNTER },
      { name: "Statue", color: "#7fd1e0", source: IDLE },
      21,
    );
    expect(duel.winner).toBe("a");
    expect(duel.showcase).not.toBeNull();
  });
});
