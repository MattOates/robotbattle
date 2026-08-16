/**
 * The radar: a second way of seeing, with a different bargain.
 *
 * The cone is wide, short and free — it reports whatever wanders into it. The
 * beam is narrow, long and deliberate — it reports only where it was pointed,
 * and only when a script asks. These tests pin that bargain down, because it is
 * the whole reason the instrument exists: make it as wide as the cone and it is
 * strictly better, make it as short and there is no reason to aim it.
 */

import { describe, expect, it } from "vitest";
import { createWorld, makeManifest, ping } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { RADAR, SENSE } from "../../src/sim/types.js";
import type { Robot, World } from "../../src/sim/types.js";
import { Vm } from "../../src/lang/vm.js";

/** A script that subscribes to both kinds of sighting and records nothing. */
const WATCHER = `name "Watcher"
chassis tank
color #7fd1e0
on sense robot
  set name = "cone"
end
on ping robot
  set name = "beam"
end
on ping wall
  set name = "wall"
end
`;

/** Two robots, placed exactly where the test wants them. */
function twoRobots(): { world: World; me: Robot; them: Robot } {
  const world = createWorld(
    makeManifest([{ source: WATCHER }, { source: WATCHER }], {
      seed: 5,
      width: 3000,
      height: 3000,
    }),
  );
  const [me, them] = world.robots as [Robot, Robot];
  me.x = 1500;
  me.y = 1500;
  me.heading = 0;
  me.turret = 0;
  me.radar = 0;
  me.radarGoal = 0;
  return { world, me, them };
}

/** Everything a robot was told during `run`, by event name. */
function eventsDuring(run: () => void): Array<{ name: string; payload: Record<string, unknown> }> {
  const seen: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const real = Vm.prototype.enqueue;
  Vm.prototype.enqueue = function (this: Vm, name, payload) {
    seen.push({ name, payload: payload as Record<string, unknown> });
    return real.call(this, name, payload);
  };
  try {
    run();
  } finally {
    Vm.prototype.enqueue = real;
  }
  return seen;
}

/** Place `them` at a distance and bearing from `me`, and ping. */
function pingAt(distance: number, offBeamDegrees: number) {
  const { world, me, them } = twoRobots();
  const radians = (offBeamDegrees * Math.PI) / 180;
  them.x = me.x + Math.cos(radians) * distance;
  them.y = me.y + Math.sin(radians) * distance;
  return eventsDuring(() => ping(world, me));
}

describe("the beam's reach", () => {
  it("finds a robot far beyond the sense cone", () => {
    const found = pingAt(SENSE.range * 2, 0);
    const hit = found.find((e) => e.name === "ping robot");
    expect(hit).toBeDefined();
    expect(hit!.payload["distance"]).toBeCloseTo(SENSE.range * 2, 5);
  });

  it("reaches three times as far as the cone, and no further", () => {
    expect(RADAR.range).toBe(SENSE.range * 3);
    expect(pingAt(RADAR.range - 10, 0).some((e) => e.name === "ping robot")).toBe(true);
    expect(pingAt(RADAR.range + 10, 0).some((e) => e.name === "ping robot")).toBe(false);
  });
});

describe("the beam's width", () => {
  it("is a fifth of the cone's", () => {
    expect(RADAR.halfAngle * 5).toBe(SENSE.halfAngle);
  });

  it("misses a robot the cone would have caught", () => {
    // Twenty degrees off the nose is well inside the thirty-degree cone and
    // well outside the six-degree beam: the same robot, seen by one instrument
    // and not the other, which is the trade the whole feature rests on.
    const off = 20;
    expect(off).toBeLessThan(SENSE.halfAngle);
    expect(off).toBeGreaterThan(RADAR.halfAngle);
    expect(pingAt(200, off).some((e) => e.name === "ping robot")).toBe(false);
    expect(pingAt(200, RADAR.halfAngle - 1).some((e) => e.name === "ping robot")).toBe(true);
  });

  it("reports the wall instead when the beam finds nobody", () => {
    // Pointing it at empty space is not wasted: the beam is a rangefinder too,
    // so it comes back with how much room is that way.
    const { world, me, them } = twoRobots();
    // Stand near the left wall and look at it; the other robot is off to one
    // side, well outside the beam.
    me.x = RADAR.range / 2;
    me.radar = 180;
    me.radarGoal = 180;
    them.x = me.x + 200;
    them.y = me.y + 200;

    const found = eventsDuring(() => ping(world, me));
    expect(found.some((e) => e.name === "ping robot")).toBe(false);
    const wall = found.find((e) => e.name === "ping wall");
    expect(wall).toBeDefined();
    expect(wall!.payload["distance"]).toBeLessThan(RADAR.range);
  });

  it("says nothing at all when even the wall is out of reach", () => {
    // The one case where a ping comes back empty, kept honest here because the
    // arena is normally small enough that it never happens.
    const found = pingAt(200, 40);
    expect(found).toEqual([]);
  });
});

describe("pointing it", () => {
  it("is independent of the body and the turret", () => {
    const { world, me, them } = twoRobots();
    // Body facing right, turret facing left, radar facing down.
    me.heading = 0;
    me.turret = 180;
    me.radar = 90;
    me.radarGoal = 90;
    them.x = me.x;
    them.y = me.y + 400;

    const found = eventsDuring(() => ping(world, me));
    const hit = found.find((e) => e.name === "ping robot");
    expect(hit).toBeDefined();
    // Bearings are relative to the chassis everywhere in this language, so a
    // contact 90 degrees to the right reads as +90 whatever the turret is doing.
    expect(hit!.payload["bearing"]).toBeCloseTo(90, 5);
  });

  it("slews toward its own goal without disturbing the turret", () => {
    const { world, me } = twoRobots();
    me.radarGoal = 90;
    me.turretGoal = 0;
    const turretBefore = me.turret;
    step(world);
    expect(me.radar).toBeGreaterThan(0);
    expect(me.radar).toBeLessThanOrEqual(90);
    expect(me.turret).toBe(turretBefore);
  });
});

describe("the cost of looking", () => {
  it("cannot ping again until the beam has recovered", () => {
    const { world, me, them } = twoRobots();
    them.x = me.x + 400;
    them.y = me.y;

    expect(eventsDuring(() => ping(world, me)).some((e) => e.name === "ping robot")).toBe(true);
    expect(me.pingHeat).toBe(RADAR.cooldown);
    // Straight away again: nothing, because the beam is still recovering.
    expect(eventsDuring(() => ping(world, me)).some((e) => e.name === "ping robot")).toBe(false);

    for (let i = 0; i < RADAR.cooldown; i++) step(world);
    expect(me.pingHeat).toBe(0);
    expect(eventsDuring(() => ping(world, me)).some((e) => e.name === "ping robot")).toBe(true);
  });

  it("leaves a mark the renderer can draw, reaching as far as it looked", () => {
    const { world, me, them } = twoRobots();
    them.x = me.x + 300;
    them.y = me.y;
    ping(world, me);
    const effect = world.effects.find((e) => e.type === "ping");
    expect(effect).toBeDefined();
    // It stops at what it found, so a ping visibly ends on its contact.
    expect(effect!.range).toBeCloseTo(300, 5);
    expect(effect!.heading).toBe(me.radar);
  });
});

describe("which instrument saw it", () => {
  it("tells the two apart by which handler runs", () => {
    // The same robot, close enough for both. The cone raises `sense robot` on
    // its own; the beam raises `ping robot` only because a ping was sent.
    const { world, me, them } = twoRobots();
    them.x = me.x + 120;
    them.y = me.y;

    const fromBeam = eventsDuring(() => ping(world, me));
    expect(fromBeam.map((e) => e.name)).toContain("ping robot");
    expect(fromBeam.map((e) => e.name)).not.toContain("sense robot");

    const fromCone = eventsDuring(() => step(world));
    expect(fromCone.map((e) => e.name)).toContain("sense robot");
    expect(fromCone.map((e) => e.name)).not.toContain("ping robot");
  });
});
