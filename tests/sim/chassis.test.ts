/**
 * The two locomotion models must differ in exactly one way — how steering
 * becomes rotation — and be identical in every other respect.
 */

import { describe, expect, it } from "vitest";
import { createWorld, makeManifest } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { DT, ROBOT_RADIUS, SENSE } from "../../src/sim/types.js";
import { SKID, STEERED, specFor, turningRadius } from "../../src/sim/chassis.js";
import { DEG_TO_RAD, angleDelta, hypot } from "../../src/sim/math.js";

function world(sources: string[], seed = 7) {
  return createWorld(makeManifest(sources.map((source) => ({ source })), { seed }));
}

function run(w: ReturnType<typeof world>, ticks: number) {
  for (let i = 0; i < ticks; i++) step(w);
}

describe("skid steer (tracks / cilia)", () => {
  it("rotates on the spot without moving", () => {
    const w = world([`chassis tank\non start\n  turn body by 90\nend\n`]);
    const r = w.robots[0]!;
    const x0 = r.x;
    const y0 = r.y;
    const h0 = r.heading;
    run(w, 40);
    expect(Math.abs(angleDelta(h0, r.heading))).toBeGreaterThan(80);
    // The whole point of skid steer: rotation with zero translation.
    expect(hypot(r.x - x0, r.y - y0)).toBeLessThan(0.001);
  });

  it("turns at its rated rate", () => {
    const w = world([`chassis tank\non start\n  turn body by 170\nend\n`]);
    const r = w.robots[0]!;
    const h0 = r.heading;
    run(w, 2);
    const perTick = Math.abs(angleDelta(h0, r.heading)) / 2;
    expect(perTick).toBeCloseTo(SKID.turnRate * DT, 4);
  });
});

describe("steered (wheels / flagellum)", () => {
  it("cannot rotate while stationary", () => {
    const w = world([`chassis car\non start\n  turn body by 90\nend\n`]);
    const r = w.robots[0]!;
    const h0 = r.heading;
    run(w, 40);
    // No forward speed means no rotation at all — the turning circle is
    // emergent from the bicycle model rather than a special case.
    expect(Math.abs(angleDelta(h0, r.heading))).toBeLessThan(0.0001);
    expect(r.speed).toBe(0);
  });

  it("traces a circle matching wheelbase / tan(maxSteer)", () => {
    // Holding a large heading error keeps the steering at full lock.
    const w = world([`chassis car\non tick\n  drive forward 100\n  turn body by 90\nend\n`]);
    const r = w.robots[0]!;
    run(w, 90); // let speed settle at maximum

    const h0 = r.heading;
    const v = r.speed;
    run(w, 1);
    const omegaDegPerSec = angleDelta(h0, r.heading) / DT;
    const measuredRadius = Math.abs(v / (omegaDegPerSec * DEG_TO_RAD));

    const expected = turningRadius(STEERED);
    expect(expected).toBeCloseTo(STEERED.wheelbase / Math.tan(STEERED.maxSteer * DEG_TO_RAD), 3);
    expect(measuredRadius).toBeCloseTo(expected, 1);
  });

  it("is faster in a straight line than skid steer", () => {
    // Each in its own world: two robots spawned facing the centre would crash
    // into each other long before either reached top speed.
    const car = world([`chassis car\non start\n  drive forward 100\nend\n`]);
    const tank = world([`chassis tank\non start\n  drive forward 100\nend\n`]);
    run(car, 60);
    run(tank, 60);
    expect(car.robots[0]!.speed).toBeGreaterThan(tank.robots[0]!.speed);
    expect(car.robots[0]!.speed).toBeCloseTo(STEERED.maxSpeed, 1);
    expect(tank.robots[0]!.speed).toBeCloseTo(SKID.maxSpeed, 1);
  });
});

describe("what the two share", () => {
  it("uses one hitbox radius for every chassis", () => {
    // The radius is a single global rather than a per-chassis field, so there
    // is nowhere for the two to drift apart.
    expect(specFor("skid")).not.toHaveProperty("radius");
    expect(specFor("steered")).not.toHaveProperty("radius");
    expect(ROBOT_RADIUS).toBeGreaterThan(0);
  });

  it("gives both the same turret slew", () => {
    const build = (chassis: string) =>
      world([`chassis ${chassis}\non start\n  turret.turn to 170\nend\n`]);
    const a = build("tank");
    const b = build("car");
    run(a, 10);
    run(b, 10);
    expect(a.robots[0]!.turret).toBeCloseTo(b.robots[0]!.turret, 9);
  });

  it("rotates the turret independently of the chassis", () => {
    const w = world([`chassis tank\non start\n  turret.turn to 0\n  turn body by 90\nend\n`]);
    const r = w.robots[0]!;
    const h0 = r.heading;
    run(w, 40);
    // The claim is independence: the turret holds the absolute heading it was
    // given while the body turns its own 90 degrees underneath it. Comparing
    // the two headings directly would depend on where the robot happened to
    // spawn, which is jittered per seed.
    expect(r.turret).toBeCloseTo(0, 6);
    expect(angleDelta(h0, r.heading)).toBeCloseTo(90, 4);
  });
});

describe("sense cone", () => {
  it("sees a robot ahead and ignores one behind", () => {
    const script = `chassis tank\nvar hits = 0\non sense robot\n  set hits = hits + 1\n  set name = "seen"\nend\n`;
    const w = world([script, `chassis tank\n`]);
    const observer = w.robots[0]!;
    const target = w.robots[1]!;

    observer.x = 100;
    observer.y = 100;
    observer.heading = 0; // facing +x
    observer.throttle = 0;
    target.x = 100 + SENSE.range * 0.5;
    target.y = 100;
    step(w);
    expect(observer.name).toBe("seen");

    // Directly behind: outside the cone, so nothing is reported.
    const w2 = world([script, `chassis tank\n`]);
    const o2 = w2.robots[0]!;
    const t2 = w2.robots[1]!;
    o2.x = 100;
    o2.y = 100;
    o2.heading = 0;
    t2.x = 100 - SENSE.range * 0.5;
    t2.y = 100;
    step(w2);
    expect(o2.name).not.toBe("seen");
  });

  it("ignores a target beyond its range", () => {
    const script = `chassis tank\non sense robot\n  set name = "seen"\nend\n`;
    const w = world([script, `chassis tank\n`]);
    const o = w.robots[0]!;
    const t = w.robots[1]!;
    o.x = 50;
    o.y = 300;
    o.heading = 0;
    t.x = 50 + SENSE.range + 20;
    t.y = 300;
    step(w);
    expect(o.name).not.toBe("seen");
  });
});
