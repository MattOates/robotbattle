/**
 * Committed shots.
 *
 * `fire` does not discharge along wherever the barrel happens to be pointing.
 * It commits a shot, which leaves on the first tick the gun has come round to
 * what it was aimed at. Before this, `turret.aim at X` followed by `fire` shot
 * along the OLD heading, because aiming only sets a goal the turret slews
 * toward over the following ticks — so a handler could never aim and shoot at
 * the same place, and leading a moving target was not expressible at all.
 */

import { describe, expect, it } from "vitest";
import { createWorld, makeManifest } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { TURRET, FUEL_PRESETS } from "../../src/sim/types.js";
import { angleDelta } from "../../src/sim/math.js";

function world(sources: string[], seed = 7) {
  return createWorld(
    makeManifest(
      sources.map((source) => ({ source })),
      { seed, fuel: FUEL_PRESETS.off },
    ),
  );
}

/** Aims a long way off the barrel, then immediately asks to shoot. */
const SWINGER = `name "Swinger"
chassis tank
on start
  turret.aim at 150
  fire 3
end
`;

describe("a committed shot", () => {
  it("waits for the gun instead of firing off the old heading", () => {
    const w = world([SWINGER]);
    const r = w.robots[0]!;
    step(w);
    // The turret cannot cross 150 degrees in one tick, so nothing has left yet.
    expect(w.bullets).toHaveLength(0);
    expect(r.pendingPower).toBe(3);
  });

  it("leaves as soon as the gun bears, and along the barrel", () => {
    const w = world([SWINGER]);
    const r = w.robots[0]!;
    for (let i = 0; i < 60 && w.bullets.length === 0; i++) step(w);
    expect(w.bullets).toHaveLength(1);
    expect(r.pendingPower).toBe(0);
    // Fired where it was aimed, not where the barrel started.
    expect(Math.abs(angleDelta(w.bullets[0]!.heading, r.turretGoal))).toBeLessThanOrEqual(
      TURRET.fireTolerance,
    );
  });

  it("fires at once when the gun already bears", () => {
    const w = world([`name "Ready"\nchassis tank\non start\n  fire 2\nend\n`]);
    step(w);
    expect(w.bullets).toHaveLength(1);
  });

  it("fires at once while sweeping, since a sweep has no aim to wait for", () => {
    // Sweep-and-shoot robots behave exactly as they always did.
    const w = world([`name "Sweeper"\nchassis tank\non start\n  turret.sweep 90\n  fire 2\nend\n`]);
    step(w);
    expect(w.bullets).toHaveLength(1);
  });

  it("still ignores a request while the gun is cooling", () => {
    const w = world([`name "Spammer"\nchassis tank\non tick\n  fire 3\nend\n`]);
    for (let i = 0; i < 20; i++) step(w);
    // One shot, then heat: spamming fire is free and changes nothing.
    expect(w.bullets.length).toBeLessThanOrEqual(1);
  });

  it("lets a handler aim and shoot at the same place", () => {
    // The whole point. Aim a long way round, shoot, and the shell goes there.
    const w = world([SWINGER]);
    const r = w.robots[0]!;
    // After the first tick, so `on start` has actually run and set the goal.
    step(w);
    const goal = r.turretGoal;
    for (let i = 0; i < 60 && w.bullets.length === 0; i++) step(w);
    expect(w.bullets).toHaveLength(1);
    expect(Math.abs(angleDelta(w.bullets[0]!.heading, goal))).toBeLessThanOrEqual(
      TURRET.fireTolerance,
    );
  });

  it("is part of the hashed state, so peers cannot disagree about it", () => {
    const a = world([SWINGER]);
    const b = world([SWINGER]);
    for (let i = 0; i < 5; i++) {
      step(a);
      step(b);
    }
    expect(a.robots[0]!.pendingPower).toBe(b.robots[0]!.pendingPower);
  });
});
