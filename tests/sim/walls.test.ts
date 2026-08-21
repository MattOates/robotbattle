/**
 * Walls: segments somebody placed.
 *
 * Two things are being pinned here. The first is the mechanic — a wall stops a
 * robot dead, wherever it is, and reports itself through the same two events
 * the arena boundary always used. The second is the *scope*, which is the
 * unusual half: a wall stops motion and NOTHING else. Bullets go over it and
 * the radar beam goes through it. Those are easy to "fix" by accident later, so
 * they get tests that say out loud that they are the intended behaviour.
 */

import { describe, expect, it } from "vitest";
import {
  createWorld,
  distanceToBoundary,
  distanceToWall,
  makeManifest,
  ping,
} from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import {
  FUEL_PRESETS,
  MAX_HEALTH,
  ROBOT_RADIUS,
  WALL,
  clampWalls,
  type FuelConfig,
  type Wall,
} from "../../src/sim/types.js";
import { closestPointOnSegment, raySegmentDistance } from "../../src/sim/math.js";
import { Vm } from "../../src/lang/vm.js";

const W = 900;
const H = 620;

/** Drives flat out, forever, in whatever direction it was pointed. */
const DRIVER = `name "Driver"\nchassis tank\non start\n  drive forward 100\nend\n`;

/**
 * Subscribes to both wall events so the `handles()` early-out inside the sim
 * does not skip them. What it does with them does not matter — the spy below is
 * what reads them, for the same reason `events.test.ts` uses one: it sees
 * exactly what a script would, while the match plays out for real.
 */
const WATCHER = `name "Watcher"
chassis tank
var seen = 0
var bumps = 0
on start
  drive forward 100
end
on sense wall
  set seen = event.distance
end
on hit wall
  set bumps = bumps + 1
end
`;

interface Seen {
  name: string;
  payload: Record<string, unknown>;
}

function recordEvents(run: () => void): Seen[] {
  const seen: Seen[] = [];
  const real = Vm.prototype.enqueue;
  Vm.prototype.enqueue = function (this: Vm, name, payload) {
    seen.push({ name, payload: { ...payload } });
    return real.call(this, name, payload);
  };
  try {
    run();
  } finally {
    Vm.prototype.enqueue = real;
  }
  return seen;
}

/** A vertical wall down the middle of the arena. */
const MIDDLE: Wall = { x1: 450, y1: 0, x2: 450, y2: 620 };

function world(sources: string[], walls: Wall[], fuel: Partial<FuelConfig> = { maxOnField: 0 }) {
  return createWorld(
    makeManifest(
      sources.map((source) => ({ source })),
      {
        seed: 7,
        walls,
        // No cells by default: a pickup wandering into a test that is measuring
        // positions is noise, not signal.
        fuel: { ...FUEL_PRESETS.arena, ...fuel },
      },
    ),
  );
}

describe("clampWalls", () => {
  it("drops what would poison a distance computation", () => {
    expect(clampWalls([{ x1: NaN, y1: 0, x2: 100, y2: 0 }])).toEqual([]);
    expect(clampWalls([{ x1: 0, y1: 0, x2: 0, y2: 0 }])).toEqual([]);
    // Shorter than minLength: a stray click, not a wall.
    expect(clampWalls([{ x1: 0, y1: 0, x2: 3, y2: 0 }])).toEqual([]);
    expect(clampWalls(undefined)).toEqual([]);
  });

  it("rounds to whole pixels, so two peers cannot disagree about a coordinate", () => {
    expect(clampWalls([{ x1: 10.4, y1: 20.6, x2: 100.5, y2: 20.6 }])).toEqual([
      { x1: 10, y1: 21, x2: 101, y2: 21 },
    ]);
  });

  it("refuses to carry more than the cap", () => {
    const many: Wall[] = [];
    for (let i = 0; i < WALL.maxCount + 50; i++) {
      many.push({ x1: 0, y1: i, x2: 100, y2: i });
    }
    expect(clampWalls(many)).toHaveLength(WALL.maxCount);
  });
});

describe("geometry", () => {
  it("finds the nearest point on a segment, clamped to its ends", () => {
    // Alongside it: drops a perpendicular.
    expect(closestPointOnSegment(50, 30, 0, 0, 100, 0)).toEqual([50, 0, 900]);
    // Past the end: the answer is the endpoint, not a point on the infinite line.
    expect(closestPointOnSegment(150, 0, 0, 0, 100, 0)).toEqual([100, 0, 2500]);
  });

  it("measures along a ray, and reports a miss as a miss", () => {
    // Straight at it from 100 away.
    expect(raySegmentDistance(0, 0, 1, 0, 100, -50, 100, 50)).toBeCloseTo(100);
    // Behind us.
    expect(raySegmentDistance(0, 0, -1, 0, 100, -50, 100, 50)).toBeNull();
    // Parallel to it: a grazing pass along its length is not a hit.
    expect(raySegmentDistance(0, 0, 1, 0, 100, 0, 200, 0)).toBeNull();
    // Aimed past its end.
    expect(raySegmentDistance(0, 0, 1, 0, 100, 50, 100, 90)).toBeNull();
  });
});

describe("a wall blocks motion", () => {
  it("stops a robot at its face and raises `hit wall`", () => {
    const w = world([DRIVER], [MIDDLE]);
    const r = w.robots[0]!;
    step(w); // let `on start` open the throttle
    r.x = 300;
    r.y = 310;
    r.heading = 0; // due east, straight at the wall
    r.headingGoal = 0;
    for (let i = 0; i < 120; i++) step(w);

    // Parked against the near face, never through it.
    expect(r.x).toBeLessThan(450);
    expect(r.x).toBeCloseTo(450 - ROBOT_RADIUS - WALL.halfThickness, 5);
  });

  it("reports the bump through the same event the boundary uses", () => {
    const w = world([WATCHER], [MIDDLE]);
    const r = w.robots[0]!;
    step(w);
    r.x = 400;
    r.y = 310;
    r.heading = 0;
    r.headingGoal = 0;
    const seen = recordEvents(() => {
      for (let i = 0; i < 60; i++) step(w);
    });
    // `hit wall` fired, and nowhere near the edge of the map — a script cannot
    // tell a placed wall from the boundary, which is the entire point of
    // building walls as segments rather than as a new kind of obstacle.
    expect(seen.some((e) => e.name === "hit wall")).toBe(true);
    expect(r.x).toBeGreaterThan(100);
    expect(r.x).toBeLessThan(450);
  });

  it("nudges a robot that spawned inside one back out", () => {
    // A wall laid straight across the spawn ring.
    const across: Wall = { x1: 0, y1: 310, x2: 900, y2: 310 };
    const w = world([DRIVER, DRIVER, DRIVER, DRIVER], [across]);
    for (const r of w.robots) {
      const [, , distSq] = closestPointOnSegment(r.x, r.y, across.x1, across.y1, across.x2, across.y2);
      const reach = ROBOT_RADIUS + WALL.halfThickness;
      expect(Math.sqrt(distSq)).toBeGreaterThanOrEqual(reach - 1e-6);
    }
  });
});

describe("a wall is seen", () => {
  it("is reported by the sense cone, at its face", () => {
    const w = world([WATCHER], [MIDDLE]);
    const r = w.robots[0]!;
    step(w);
    const seen = recordEvents(() => {
      r.x = 350;
      r.y = 310;
      r.heading = 0;
      r.headingGoal = 0;
      r.speed = 0;
      r.throttle = 0;
      step(w);
    });
    const sensed = seen.find((e) => e.name === "sense wall");
    expect(sensed).toBeDefined();
    // 100px to the wall, less the hull and the wall's own half-thickness.
    expect(sensed!.payload.distance as number).toBeCloseTo(
      100 - ROBOT_RADIUS - WALL.halfThickness,
      0,
    );
  });

  it("is nearer than the boundary behind it", () => {
    const w = world([DRIVER], [MIDDLE]);
    const r = w.robots[0]!;
    r.x = 350;
    r.y = 310;
    // The boundary is 550 away; the wall is 100. `distanceToWall` means either
    // kind, `distanceToBoundary` means only the outer edge.
    expect(distanceToWall(w, 350, 310, 0)).toBeLessThan(150);
    expect(distanceToBoundary(w, 350, 310, 0)).toBeGreaterThan(500);
  });
});

describe("a wall does not block anything else", () => {
  it("lets the radar beam find a robot on the far side", () => {
    const w = world([DRIVER, DRIVER], [MIDDLE]);
    const seeker = w.robots[0]!;
    const target = w.robots[1]!;
    seeker.x = 300;
    seeker.y = 310;
    seeker.heading = 0;
    seeker.radar = 0;
    target.x = 600; // squarely behind the wall
    target.y = 310;

    seeker.pingHeat = 0;
    // Spied rather than read off the VM: DRIVER has no `on ping robot`, so the
    // queue would discard it and the test would be measuring `handles()`.
    const seen = recordEvents(() => ping(w, seeker));
    // The beam went straight over the wall and found them.
    const hit = seen.find((e) => e.name === "ping robot");
    expect(hit).toBeDefined();
    expect(hit!.payload.distance as number).toBeCloseTo(300, 0);
  });

  it("lets a bullet fly over it", () => {
    const w = world([DRIVER, DRIVER], [MIDDLE]);
    const shooter = w.robots[0]!;
    const target = w.robots[1]!;
    shooter.x = 300;
    shooter.y = 310;
    target.x = 600;
    target.y = 310;
    const before = target.health;

    shooter.heading = 0;
    shooter.turret = 0;
    shooter.turretGoal = 0;
    shooter.gunHeat = 0;
    shooter.pendingPower = 3;
    // Long enough for the shot to cross the wall and arrive.
    for (let i = 0; i < 40; i++) {
      step(w);
      shooter.x = 300;
      shooter.y = 310;
      target.x = 600;
      target.y = 310;
    }
    expect(target.health).toBeLessThan(before);
  });
});

describe("fuel keeps out of walls", () => {
  it("never spawns a cell buried in one", () => {
    const walls: Wall[] = [];
    // A dense comb, so a naive uniform draw would land inside one constantly.
    for (let x = 60; x < W - 60; x += 40) {
      walls.push({ x1: x, y1: 40, x2: x, y2: H - 40 });
    }
    const w = world([DRIVER], walls, { maxOnField: 40, spawnEveryTicks: 5 });
    for (let i = 0; i < 3000; i++) step(w);
    expect(w.fuel.length).toBeGreaterThan(5); // cells really did spawn

    let buried = 0;
    for (const f of w.fuel) {
      for (const wall of w.walls) {
        const [, , distSq] = closestPointOnSegment(f.x, f.y, wall.x1, wall.y1, wall.x2, wall.y2);
        if (Math.sqrt(distSq) < WALL.halfThickness) buried++;
      }
    }
    expect(buried).toBe(0);
  });
});

describe("a scrape against a placed wall is free", () => {
  it("does not grind a robot down, the way the edge of the map does", () => {
    // The measurement that forced this rule: charged at the boundary's rate,
    // the Racer bumped 249 times in 258 ticks inside a labyrinth and died of
    // attrition before solving anything. A maze you cannot survive crossing is
    // not a maze. It is also what the mechanic already promised — a placed wall
    // blocks motion and does nothing else, and health is something else.
    const w = world([DRIVER], [MIDDLE]);
    const r = w.robots[0]!;
    step(w);
    r.x = 400;
    r.y = 310;
    r.heading = 0;
    r.headingGoal = 0;
    for (let i = 0; i < 300; i++) step(w);
    expect(r.health).toBe(MAX_HEALTH);
  });

  it("still charges for scraping the edge of the map", () => {
    // The corner-camping deterrent is unchanged; only placed walls are free.
    const w = world([DRIVER], []);
    const r = w.robots[0]!;
    step(w);
    r.x = 800;
    r.y = 310;
    r.heading = 0;
    r.headingGoal = 0;
    for (let i = 0; i < 300; i++) step(w);
    expect(r.health).toBeLessThan(MAX_HEALTH);
  });
});
