import { describe, expect, it } from "vitest";
import { runTrials, type Contender, type TrialRequest } from "../../src/workshop/trials.js";
import { DODGER, HUNTER, RACER, SITTING_DUCK, SPINNER } from "../../src/bots/index.js";

const opponent = (id: string, label: string, source: string): Contender => ({
  id,
  label,
  source,
  kind: "arena",
});

const request = (overrides: Partial<TrialRequest> = {}): TrialRequest => ({
  subject: { label: "Hunter", source: HUNTER },
  opponents: [
    opponent("duck", "Sitting Duck", SITTING_DUCK),
    opponent("spinner", "Spinner", SPINNER),
  ],
  trials: 20,
  seedBase: 1000,
  ...overrides,
});

describe("the test bench", () => {
  it("gives an identical table for an identical request", () => {
    // Reproducibility is the whole point: a change in the numbers has to mean
    // a change in the robot, not a change in the dice.
    expect(runTrials(request())).toEqual(runTrials(request()));
  });

  it("produces different numbers for a different seed base", () => {
    const a = runTrials(request({ seedBase: 1 }));
    const b = runTrials(request({ seedBase: 999 }));
    expect(b).not.toEqual(a);
  });

  it("counts every trial exactly once", () => {
    const report = runTrials(request({ trials: 15 }));
    expect(report.totalMatches).toBe(30);
    for (const row of report.rows) {
      expect(row.wins + row.losses + row.draws).toBe(15);
    }
  });

  it("beats a robot that does nothing", () => {
    const report = runTrials(
      request({ opponents: [opponent("duck", "Sitting Duck", SITTING_DUCK)], trials: 20 }),
    );
    expect(report.rows[0]!.winRate).toBeGreaterThan(70);
  });

  it("reports a row per opponent, in the order given", () => {
    const report = runTrials(
      request({
        opponents: [
          opponent("racer", "Racer", RACER),
          opponent("dodger", "Dodger", DODGER),
          opponent("duck", "Sitting Duck", SITTING_DUCK),
        ],
        trials: 6,
      }),
    );
    expect(report.rows.map((r) => r.label)).toEqual(["Racer", "Dodger", "Sitting Duck"]);
  });

  it("computes the overall rate across all matchups", () => {
    const report = runTrials(request({ trials: 10 }));
    const wins = report.rows.reduce((n, r) => n + r.wins, 0);
    expect(report.overallWinRate).toBeCloseTo((wins / report.totalMatches) * 100, 6);
  });

  it("reports progress that reaches the total", () => {
    const seen: number[] = [];
    const report = runTrials(request({ trials: 10 }), (p) => seen.push(p.done));
    expect(seen[seen.length - 1]).toBe(report.totalMatches);
  });

  it("is not fooled by which side the robot starts on", () => {
    // A robot fighting an identical copy of itself should land near 50%. If
    // spawn slot conferred an advantage, this would sit near 0 or 100.
    const report = runTrials({
      subject: { label: "Hunter", source: HUNTER },
      opponents: [opponent("self", "Hunter (copy)", HUNTER)],
      trials: 60,
      seedBase: 7,
    });
    expect(report.rows[0]!.winRate).toBeGreaterThan(25);
    expect(report.rows[0]!.winRate).toBeLessThan(75);
  });

  it("refuses to run when your own robot is broken", () => {
    const report = runTrials(request({ subject: { label: "Broken", source: "on tick" } }));
    expect(report.error).toContain("doesn't compile");
    expect(report.rows).toEqual([]);
  });

  it("marks a broken opponent rather than crediting a win", () => {
    const report = runTrials(
      request({ opponents: [opponent("bad", "Broken", "chassis wobbly")], trials: 5 }),
    );
    expect(report.rows[0]!.label).toContain("won't compile");
    expect(report.rows[0]!.wins).toBe(0);
    expect(report.rows[0]!.draws).toBe(5);
  });

  it("asks for an opponent when given none", () => {
    expect(runTrials(request({ opponents: [] })).error).toBe("Pick someone to fight.");
  });
});
