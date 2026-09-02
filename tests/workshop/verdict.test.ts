import { describe, expect, it } from "vitest";
import { verdict, type MatchFacts } from "../../src/workshop/verdict.js";
import { fillVocab } from "../../src/learn/markdown.js";
import type { ScriptCoverage } from "../../src/sim/inspection.js";
import type { RobotTelemetry } from "../../src/store/types.js";

function robot(over: Partial<RobotTelemetry> = {}): RobotTelemetry {
  return {
    robotId: 0,
    name: "Mine",
    place: 2,
    survived: true,
    survivedTicks: 3600,
    health: 40,
    kills: 0,
    damageDealt: 0,
    damageTaken: 0,
    shotsFired: 0,
    shotsHit: 0,
    instructions: 1000,
    suspensions: 0,
    eventsDropped: 0,
    errors: 0,
    lastError: null,
    ...over,
  };
}

function coverage(events: Record<string, { queued: number; handled: number }>): ScriptCoverage {
  return {
    sourceHash: "x",
    lines: {},
    events: Object.fromEntries(
      Object.entries(events).map(([k, v]) => [k, { ...v, dropped: 0 }]),
    ),
  };
}

const facts = (over: Partial<MatchFacts> = {}): MatchFacts => ({
  mine: robot(),
  field: [robot(), robot({ robotId: 1, name: "Them", place: 1 })],
  ticks: 3600,
  ...over,
});

const ids = (f: MatchFacts) => verdict(f).map((v) => v.id);

/**
 * The point of the whole module: the useful thing about a match is usually
 * something the robot *never did*, which is exactly what a table of what it
 * did cannot show.
 */
describe("what the robot never did", () => {
  it("leads with never having fired", () => {
    expect(ids(facts())[0]).toBe("never-fired");
  });

  it("says whether it even saw anybody, because the fix differs", () => {
    const ran = { start: { queued: 1, handled: 1 } };
    const blind = verdict(
      facts({ coverage: coverage({ ...ran, "sense robot": { queued: 0, handled: 0 } }) }),
    ).find((v) => v.id === "never-fired")!;
    expect(blind.fix!.say.simple).toContain("never saw");
    expect(blind.fix!.cardId).toBe("turret-sweep");

    const seeing = verdict(
      facts({ coverage: coverage({ ...ran, "sense robot": { queued: 9, handled: 9 } }) }),
    ).find((v) => v.id === "never-fired")!;
    expect(seeing.fix!.say.simple).toContain("saw them");
    expect(seeing.fix!.cardId).toBe("fire");
  });

  it("says nothing ran at the start, which reads as a broken game otherwise", () => {
    const out = ids(facts({ coverage: coverage({ start: { queued: 1, handled: 0 } }) }));
    expect(out[0]).toBe("never-started");
  });

  it("notices seeing somebody and doing nothing about it", () => {
    const out = ids(
      facts({
        mine: robot({ shotsFired: 3, shotsHit: 1 }),
        coverage: coverage({ start: { queued: 1, handled: 1 }, "sense robot": { queued: 4, handled: 0 } }),
      }),
    );
    expect(out).toContain("saw-nothing-done");
  });
});

describe("what went wrong", () => {
  it("puts a runtime error above everything", () => {
    const out = ids(facts({ mine: robot({ errors: 2, lastError: "line 4: nope" }) }));
    expect(out[0]).toBe("errors");
  });

  it("mentions the wall only when it is a habit", () => {
    const once = coverage({ start: { queued: 1, handled: 1 }, "hit wall": { queued: 3, handled: 3 } });
    expect(ids(facts({ mine: robot({ shotsFired: 2 }), coverage: once }))).not.toContain("walls");
    const lots = coverage({ start: { queued: 1, handled: 1 }, "hit wall": { queued: 44, handled: 44 } });
    expect(ids(facts({ mine: robot({ shotsFired: 2 }), coverage: lots }))).toContain("walls");
  });

  it("calls out shooting a lot and never hitting", () => {
    const out = ids(facts({ mine: robot({ shotsFired: 12, shotsHit: 0 }) }));
    expect(out).toContain("all-missed");
    expect(verdict(facts({ mine: robot({ shotsFired: 12, shotsHit: 0 }) }))[0]!.fix!.cardId).toBe(
      "turret-aim",
    );
  });

  it("does not call one unlucky shot a miss problem", () => {
    expect(ids(facts({ mine: robot({ shotsFired: 2, shotsHit: 0 }) }))).not.toContain("all-missed");
  });
});

describe("how it went", () => {
  it("always says whether you won", () => {
    expect(ids(facts({ mine: robot({ place: 1, shotsFired: 3, shotsHit: 2 }) }))).toContain("won");
    expect(ids(facts({ mine: robot({ shotsFired: 3, shotsHit: 2 }) }))).toContain("lost");
  });

  /**
   * Winning is not the most interesting thing about a match where the robot
   * never fired a shot — it means the other one destroyed itself on a wall.
   */
  it("ranks winning below the reason it happened", () => {
    const out = ids(facts({ mine: robot({ place: 1 }) }));
    expect(out.indexOf("never-fired")).toBeLessThan(out.indexOf("won"));
  });

  it("counts hits both ways", () => {
    const out = verdict(
      facts({
        mine: robot({ shotsFired: 6, shotsHit: 3, damageTaken: 20 }),
        field: [robot({ shotsHit: 3 }), robot({ robotId: 1, place: 1, shotsHit: 7 })],
      }),
    );
    const trading = out.find((v) => v.id === "trading")!;
    expect(trading.say.simple).toContain("3 times");
    expect(trading.say.simple).toContain("7 times");
  });
});

describe("the words", () => {
  it("resolves every placeholder in both worlds", () => {
    // A dozen shapes of match, so every finding is produced at least once.
    const cases: MatchFacts[] = [
      facts(),
      facts({ mine: robot({ errors: 1, lastError: "line 2: bad" }) }),
      facts({ mine: robot({ place: 1, shotsFired: 9, shotsHit: 4 }) }),
      facts({ mine: robot({ shotsFired: 12, shotsHit: 0 }) }),
      facts({ coverage: coverage({ start: { queued: 1, handled: 0 } }) }),
      facts({
        mine: robot({ shotsFired: 2 }),
        coverage: coverage({
          start: { queued: 1, handled: 1 },
          "sense robot": { queued: 5, handled: 0 },
          "hit wall": { queued: 60, handled: 0 },
        }),
      }),
    ];
    for (const one of cases) {
      for (const finding of verdict(one)) {
        for (const theme of ["mechanical", "biological"] as const) {
          for (const text of [
            finding.say.full,
            finding.say.simple,
            finding.fix?.say.full ?? "",
            finding.fix?.say.simple ?? "",
          ]) {
            expect(fillVocab(text, theme), `${finding.id}: ${text}`).not.toMatch(/[{}]/);
          }
        }
      }
    }
  });

  it("gives every finding both registers and an icon", () => {
    for (const finding of verdict(facts({ mine: robot({ shotsFired: 12, shotsHit: 0 }) }))) {
      expect(finding.icon.length).toBeGreaterThan(0);
      expect(finding.say.full.length).toBeGreaterThan(0);
      expect(finding.say.simple.length).toBeGreaterThan(0);
    }
  });
});
