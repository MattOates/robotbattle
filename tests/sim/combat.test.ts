import { describe, expect, it } from "vitest";
import { createWorld, makeManifest } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { BULLET, MAX_HEALTH, TURRET } from "../../src/sim/types.js";

function world(sources: string[], seed = 3) {
  return createWorld(makeManifest(sources.map((source) => ({ source })), { seed }));
}

describe("firing", () => {
  it("spawns a bullet and heats the gun", () => {
    const w = world([`chassis tank\non start\n  fire 2\nend\n`]);
    step(w);
    expect(w.bullets).toHaveLength(1);
    expect(w.bullets[0]!.power).toBe(2);
    // The gun also cools once within the same tick it fired.
    expect(w.robots[0]!.gunHeat).toBeCloseTo(TURRET.heatPerPower * 2 - TURRET.coolRate, 9);
  });

  it("refuses to fire again until the gun cools", () => {
    const w = world([`chassis tank\non tick\n  fire 3\nend\n`]);
    step(w);
    expect(w.bullets).toHaveLength(1);
    step(w);
    // Still hot, so the second shot is simply not taken.
    expect(w.bullets).toHaveLength(1);
  });

  it("clamps power into the legal range", () => {
    const w = world([`chassis tank\non start\n  fire 99\nend\n`]);
    step(w);
    expect(w.bullets[0]!.power).toBe(TURRET.maxPower);
  });

  it("trades damage against bullet speed", () => {
    const weak = world([`chassis tank\non start\n  fire 1\nend\n`]);
    const strong = world([`chassis tank\non start\n  fire 3\nend\n`]);
    step(weak);
    step(strong);
    expect(weak.bullets[0]!.speed).toBeGreaterThan(strong.bullets[0]!.speed);
  });
});

describe("bullets hitting robots", () => {
  it("damages the target and tells both robots", () => {
    const shooter = `chassis tank\non start\n  turret.turn to 0\n  fire 2\nend\non bullet hit\n  set name = "got them"\nend\n`;
    const victim = `chassis tank\non hit by bullet\n  set name = "ow " + event.power\nend\n`;
    const w = world([shooter, victim]);
    const a = w.robots[0]!;
    const b = w.robots[1]!;

    a.x = 100;
    a.y = 300;
    a.heading = 0;
    a.turret = 0;
    a.turretGoal = 0;
    b.x = 220;
    b.y = 300;
    b.throttle = 0;

    for (let i = 0; i < 20 && b.health === MAX_HEALTH; i++) step(w);

    expect(b.health).toBe(MAX_HEALTH - BULLET.damagePerPower * 2);
    // Events reach both ends of the shot.
    for (let i = 0; i < 3; i++) step(w);
    expect(b.name).toBe("ow 2");
    expect(a.name).toBe("got them");
    expect(a.damageDealt).toBeCloseTo(BULLET.damagePerPower * 2, 9);
  });

  it("cannot hit the robot that fired it", () => {
    const w = world([`chassis tank\non tick\n  fire 3\nend\n`]);
    const r = w.robots[0]!;
    for (let i = 0; i < 30; i++) step(w);
    expect(r.health).toBe(MAX_HEALTH);
  });

  it("does not tunnel through a target at full speed", () => {
    // A power-1 bullet is the fastest; the swept collision test must still
    // catch it against an 18px target.
    const w = world([
      `chassis tank\non start\n  turret.turn to 0\n  fire 1\nend\n`,
      `chassis tank\n`,
    ]);
    const a = w.robots[0]!;
    const b = w.robots[1]!;
    a.x = 100;
    a.y = 300;
    a.heading = 0;
    a.turret = 0;
    a.turretGoal = 0;
    b.x = 400;
    b.y = 300;
    b.throttle = 0;

    for (let i = 0; i < 40 && b.health === MAX_HEALTH; i++) step(w);
    expect(b.health).toBeLessThan(MAX_HEALTH);
  });

  it("reports a miss to the shooter", () => {
    const w = world([
      `chassis tank\non start\n  turret.turn to 180\n  fire 1\nend\non bullet missed\n  set name = "missed"\nend\n`,
    ]);
    const a = w.robots[0]!;
    a.x = 60;
    a.y = 300;
    a.heading = 180;
    a.turret = 180;
    a.turretGoal = 180;
    for (let i = 0; i < 40 && a.name !== "missed"; i++) step(w);
    expect(a.name).toBe("missed");
  });
});

describe("ending a match", () => {
  it("declares the survivor the winner", () => {
    const w = world([`chassis tank\n`, `chassis tank\n`]);
    // Just low enough that a single collision scrape finishes it off.
    w.robots[1]!.health = 0.5;
    w.robots[1]!.x = w.robots[0]!.x + 20;
    w.robots[1]!.y = w.robots[0]!.y;
    for (let i = 0; i < 20 && !w.over; i++) step(w);
    expect(w.over).toBe(true);
    expect(w.winnerId).toBe(0);
  });

  it("decides a timeout on health", () => {
    const w = createWorld(
      makeManifest([{ source: `chassis tank\n` }, { source: `chassis tank\n` }], {
        maxTicks: 5,
      }),
    );
    w.robots[0]!.health = 40;
    w.robots[1]!.health = 90;
    while (!w.over) step(w);
    expect(w.winnerId).toBe(1);
  });
});
