/**
 * Qualifying, and the thing it exists for: byes that were earned.
 *
 * The property worth protecting is not the table itself but what it decides —
 * that the robot waved through a round is the best one still standing, and that
 * topping the table is worth one free pass rather than a walk to the final.
 */

import { describe, expect, it } from "vitest";
import {
  needsQualifier,
  qualifierMatches,
  rank,
  runQualifier,
  type QualifierEntrant,
  type Standing,
} from "../../src/tournament/qualifier.js";
import { advance, buildBracket, nextMatch, type Entrant } from "../../src/net/bracket.js";
import { DODGER, HUNTER, RACER, SPINNER } from "../../src/bots/index.js";

const SOURCES = [HUNTER, RACER, SPINNER, DODGER];

function field(n: number): Entrant[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    ownerName: `Player ${i % 4}`,
    robot: { name: `Bot ${i}`, color: "#ff8800", source: SOURCES[i % SOURCES.length]! },
  }));
}

const forQualifier = (entrants: Entrant[]): QualifierEntrant[] =>
  entrants.map((e) => ({ id: e.id, robot: e.robot }));

describe("when it is worth running", () => {
  it("is needed for any field that is not a power of two", () => {
    for (const n of [2, 4, 8, 16, 32]) expect(needsQualifier(n)).toBe(false);
    for (const n of [3, 5, 6, 7, 9, 10, 20, 21]) expect(needsQualifier(n)).toBe(true);
  });

  it("costs one match per pair", () => {
    expect(qualifierMatches(5)).toBe(10);
    expect(qualifierMatches(20)).toBe(190);
  });
});

describe("the table", () => {
  const standings = runQualifier(forQualifier(field(6)), 4242);

  it("plays everybody against everybody once", () => {
    expect(standings).toHaveLength(6);
    for (const row of standings) {
      expect(row.played).toBe(5);
      expect(row.wins + row.losses + row.draws).toBe(5);
    }
  });

  it("is reproducible from its seed", () => {
    expect(runQualifier(forQualifier(field(6)), 4242)).toEqual(standings);
  });

  it("does not depend on the order the field is listed in", () => {
    // Otherwise the qualifier would rank robots by where they sat in a list,
    // which is exactly the arbitrariness it exists to remove.
    const reversed = runQualifier([...forQualifier(field(6))].reverse(), 4242);
    const byId = (rows: Standing[]) =>
      Object.fromEntries(rows.map((r) => [r.id, `${r.wins}-${r.losses}-${r.draws}`]));
    expect(byId(reversed)).toEqual(byId(standings));
  });

  it("ranks best first, on wins and then on health", () => {
    for (let i = 1; i < standings.length; i++) {
      const above = standings[i - 1]!;
      const below = standings[i]!;
      expect(
        above.wins > below.wins || (above.wins === below.wins && above.health >= below.health),
      ).toBe(true);
    }
  });

  it("puts a robot that will not compile last, without simulating it", () => {
    const broken: QualifierEntrant = {
      id: "broken",
      robot: { name: "Broken", color: "#ff8800", source: "chassis banana\n" },
    };
    const table = runQualifier([...forQualifier(field(3)), broken], 9);
    expect(table.at(-1)!.id).toBe("broken");
    expect(table.at(-1)!.wins).toBe(0);
    expect(table.at(-1)!.broken).toBe(true);
  });

  it("orders a dead heat the same way on every screen", () => {
    const tied: Standing[] = [
      { id: "b", wins: 2, losses: 0, draws: 1, played: 3, health: 50, broken: false },
      { id: "a", wins: 2, losses: 0, draws: 1, played: 3, health: 50, broken: false },
    ];
    expect(rank(tied).map((r) => r.id)).toEqual(["a", "b"]);
    expect(rank([...tied].reverse()).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("what the table decides", () => {
  /** Play a bracket out, always letting the first-listed entrant win. */
  function playOut(start: ReturnType<typeof buildBracket>) {
    let current = start;
    const seeded: Array<{ round: number; id: string }> = [];
    for (;;) {
      for (const [round, matches] of current.rounds.entries()) {
        for (const match of matches) {
          if (match.bye && match.winner && !seeded.some((s) => s.id === match.winner)) {
            seeded.push({ round, id: match.winner });
          }
        }
      }
      const match = nextMatch(current);
      if (!match) break;
      current = advance(current, match.id, match.a!);
    }
    return { final: current, seeded };
  }

  it("seeds the best qualifier still standing, not whoever holds an odd slot", () => {
    // Five entrants: rounds of 3 then 2, so somebody sits out the first round.
    const entrants = field(5);
    const ranking = ["e3", "e1", "e0", "e2", "e4"];
    const bracket = buildBracket(entrants, 77, ranking);

    const bye = bracket.rounds[0]!.find((m) => m.bye);
    expect(bye?.winner).toBe("e3");
  });

  it("is worth one free pass, not a walk to the final", () => {
    // The top qualifier survives every tie here, so without a rule against it
    // the same robot would take the bye in every odd round.
    const ranking = ["e0", "e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"];
    const { seeded } = playOut(buildBracket(field(9), 3, ranking));
    const counts = new Map<string, number>();
    for (const entry of seeded) counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
    for (const [id, count] of counts) {
      expect(count, `${id} was seeded through ${count} times`).toBe(1);
    }
  });

  it("still runs a draw when there is no table at all", () => {
    // A field that is a power of two never needs one, and must not depend on it.
    const bracket = buildBracket(field(8), 5);
    expect(bracket.ranking).toEqual([]);
    expect(bracket.rounds[0]!.filter((m) => m.bye)).toHaveLength(0);
    expect(playOut(bracket).final.champion).not.toBeNull();
  });
});
