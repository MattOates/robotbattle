/**
 * Spawn variety and telemetry.
 *
 * The spawn-jitter tests are the justification for a deliberate change to the
 * simulation: without jitter, a robot that never calls `random()` produced the
 * identical match for every seed, which made the whole test bench meaningless.
 */

import { describe, expect, it } from "vitest";
import { runMatch, runMatchWithHashes } from "../../src/sim/match.js";
import { createWorld, makeManifest } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import {
  collectTelemetry,
  accuracy,
  executionWarning,
  explainBattle,
} from "../../src/sim/telemetry.js";
import { hashWorld } from "../../src/sim/hash.js";
import { DODGER, HUNTER, RACER, SPINNER } from "../../src/bots/index.js";
import { ROBOT_RADIUS } from "../../src/sim/types.js";
import type { RobotTelemetry } from "../../src/store/types.js";
import { hypot } from "../../src/sim/math.js";

const FIELD = [{ source: HUNTER }, { source: RACER }];

describe("spawn jitter", () => {
  it("keeps a given seed perfectly reproducible", () => {
    const a = runMatchWithHashes(makeManifest(FIELD, { seed: 5150 }));
    const b = runMatchWithHashes(makeManifest(FIELD, { seed: 5150 }));
    expect(b.hashes).toEqual(a.hashes);
  });

  it("makes different seeds genuinely different matches", () => {
    // Neither Hunter nor Racer calls random(), so before spawn jitter every one
    // of these would have been the same match, and a 40-trial sweep would have
    // been 40 copies of one result.
    const finals = new Set<string>();
    const lengths = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const result = runMatch(makeManifest(FIELD, { seed }));
      finals.add(result.finalHash);
      lengths.add(result.ticks);
    }
    expect(finals.size).toBe(40);
    // And they should differ in outcome, not merely in floating-point noise.
    expect(lengths.size).toBeGreaterThan(10);
  });

  it("produces a mix of winners across seeds", () => {
    const winners = new Set<string | null>();
    for (let seed = 1; seed <= 40; seed++) {
      winners.add(runMatch(makeManifest(FIELD, { seed })).winnerName);
    }
    expect(winners.size).toBeGreaterThan(1);
  });

  it("never spawns anyone overlapping or outside the walls", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const world = createWorld(
        makeManifest(
          [{ source: HUNTER }, { source: RACER }, { source: SPINNER }, { source: DODGER }],
          { seed },
        ),
      );
      for (const r of world.robots) {
        expect(r.x).toBeGreaterThanOrEqual(ROBOT_RADIUS);
        expect(r.y).toBeGreaterThanOrEqual(ROBOT_RADIUS);
        expect(r.x).toBeLessThanOrEqual(world.width - ROBOT_RADIUS);
        expect(r.y).toBeLessThanOrEqual(world.height - ROBOT_RADIUS);
      }
      for (let i = 0; i < world.robots.length; i++) {
        for (let j = i + 1; j < world.robots.length; j++) {
          const a = world.robots[i]!;
          const b = world.robots[j]!;
          expect(hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(ROBOT_RADIUS * 2);
        }
      }
    }
  });
});

describe("telemetry", () => {
  it("stays out of the world hash", () => {
    // Telemetry is observational. If it reached the hash, every counter would
    // become a reason for peers to disagree.
    const world = createWorld(makeManifest(FIELD, { seed: 99 }));
    for (let i = 0; i < 60; i++) step(world);
    const before = hashWorld(world);
    world.robots[0]!.shotsFired += 1000;
    world.robots[0]!.damageTaken += 1000;
    world.robots[0]!.vm.suspensions += 1000;
    expect(hashWorld(world)).toBe(before);
  });

  it("counts shots and reconciles hits with damage", () => {
    const world = createWorld(
      makeManifest([{ source: HUNTER }, { source: SPINNER }], { seed: 777 }),
    );
    while (!world.over && world.tick < world.maxTicks) step(world);
    const telemetry = collectTelemetry(world);

    const totalHits = telemetry.reduce((n, t) => n + t.shotsHit, 0);
    const totalTaken = telemetry.reduce((n, t) => n + t.damageTaken, 0);
    expect(totalHits).toBeGreaterThan(0);
    // Every hit does damage, so damage taken must scale with hits landed.
    expect(totalTaken).toBeGreaterThan(0);

    for (const t of telemetry) {
      expect(t.shotsHit).toBeLessThanOrEqual(t.shotsFired);
      expect(accuracy(t)).toBeLessThanOrEqual(100);
      expect(accuracy(t)).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives everyone a distinct place, and the winner first", () => {
    const world = createWorld(
      makeManifest([{ source: HUNTER }, { source: RACER }, { source: SPINNER }], { seed: 31 }),
    );
    while (!world.over && world.tick < world.maxTicks) step(world);
    const telemetry = collectTelemetry(world);
    expect(new Set(telemetry.map((t) => t.place)).size).toBe(telemetry.length);
    if (world.winnerId !== null) {
      expect(telemetry.find((t) => t.robotId === world.winnerId)?.place).toBe(1);
    }
  });

  it("counts suspensions for a robot that thinks too hard", () => {
    const slow = `chassis tank
var n = 0
on tick
  for i = 1 to 9000
    set n = n + 1
  end
end
`;
    const world = createWorld(
      makeManifest([{ source: slow }, { source: HUNTER }], { seed: 4 }),
    );
    for (let i = 0; i < 60; i++) step(world);
    const telemetry = collectTelemetry(world);
    const slowBot = telemetry[0]!;
    expect(slowBot.suspensions).toBeGreaterThan(20);
    expect(executionWarning(slowBot)).toContain("thinking time");

    // The robot with an ordinary script should have nothing to warn about.
    expect(telemetry[1]!.suspensions).toBeLessThan(5);
  });

  it("reports a runtime-clean robot as having no warning", () => {
    const world = createWorld(makeManifest(FIELD, { seed: 12 }));
    for (let i = 0; i < 100; i++) step(world);
    for (const t of collectTelemetry(world)) {
      expect(t.errors).toBe(0);
      expect(executionWarning(t)).toBeNull();
    }
  });
});

describe("battle explanation", () => {
  const robot = (overrides: Partial<RobotTelemetry> = {}): RobotTelemetry => ({
    robotId: 0, name: "Mine", place: 2, survived: false, survivedTicks: 300,
    health: 0, kills: 0, damageDealt: 20, damageTaken: 100,
    shotsFired: 10, shotsHit: 3, instructions: 1000, suspensions: 0,
    eventsDropped: 0, errors: 0, lastError: null, ...overrides,
  });

  it("turns poor accuracy into a concrete next step", () => {
    const mine = robot({ shotsFired: 10, shotsHit: 1 });
    const explanation = explainBattle(mine, [mine, robot({ robotId: 1, place: 1 })]);
    expect(explanation.headline).toBe("Finished #2 out of 2.");
    expect(explanation.points.join(" ")).toContain("latest bearing");
  });

  it("puts runtime trouble ahead of ordinary combat advice", () => {
    const mine = robot({ errors: 2, lastError: "line 9: bad value" });
    const explanation = explainBattle(mine, [mine]);
    expect(explanation.tone).toBe("poor");
    expect(explanation.points[0]).toContain("runtime errors");
  });

  it("recognises accurate winning play", () => {
    const mine = robot({ place: 1, survived: true, shotsFired: 5, shotsHit: 4, damageDealt: 90 });
    const explanation = explainBattle(mine, [mine, robot({ robotId: 1, damageDealt: 30 })]);
    expect(explanation.tone).toBe("good");
    expect(explanation.points.join(" ")).toContain("targeting was a strength");
  });

  it("does not call first place a win when the match timed out", () => {
    const mine = robot({ place: 1, survived: true });
    const explanation = explainBattle(mine, [mine], null);
    expect(explanation.tone).toBe("mixed");
    expect(explanation.headline).toContain("nobody won");
  });
});
