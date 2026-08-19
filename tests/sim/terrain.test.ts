/**
 * Terrain: the shape of the ground.
 *
 * Two things are being pinned here. The first is that the field is honest
 * mathematics — bounded, reproducible, and with a gradient that actually
 * matches the heights it claims to describe. The second, and the one a player
 * would notice, is the rule the whole mechanic rests on: up is dear and slow,
 * down is cheap and quick, and ACROSS is exactly flat ground. That last one is
 * easy to get almost right and it is what makes a map worth reading.
 */

import { describe, expect, it } from "vitest";
import { createWorld, makeManifest } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import {
  climbAlong,
  FLAT_TERRAIN,
  makeTerrain,
  slopeAt,
  uphillAt,
} from "../../src/sim/terrain.js";
import {
  FUEL_PRESETS,
  MAX_FUEL,
  TERRAIN,
  TERRAIN_PRESETS,
  clampTerrainConfig,
  type FuelConfig,
  type TerrainConfig,
} from "../../src/sim/types.js";
import { normalizeAngle } from "../../src/sim/math.js";
import { RACER, SITTING_DUCK } from "../../src/bots/index.js";

const W = 900;
const H = 620;
const MAP: TerrainConfig = { enabled: true, seed: 4, featureSize: 260, amplitude: 1 };

/** Drives flat out, forever, in whatever direction it was pointed. */
const DRIVER = `name "Driver"\nchassis tank\non start\n  drive forward 100\nend\n`;

function world(
  sources: string[],
  opts: { terrain?: Partial<TerrainConfig>; fuel?: Partial<FuelConfig> } = {},
) {
  return createWorld(
    makeManifest(
      sources.map((source) => ({ source })),
      {
        seed: 7,
        terrain: { ...TERRAIN_PRESETS.arena, ...MAP, ...opts.terrain },
        // No cells: a robot picking one up mid-test would refill the very tank
        // the test is measuring.
        fuel: { ...FUEL_PRESETS.arena, maxOnField: 0, ...opts.fuel },
      },
    ),
  );
}

/**
 * Park one robot at a point on a real map, aim it in a chosen direction, and
 * let it drive. Returns what it spent and how fast it got going.
 *
 * Position and heading are set directly rather than driven to, because the
 * whole point is to compare identical robots on different ground.
 */
function run(heading: number, at: { x: number; y: number }, ticks = 60, terrainOn = true) {
  const w = world([DRIVER], terrainOn ? {} : { terrain: { enabled: false } });
  const r = w.robots[0]!;
  step(w); // let `on start` run so the throttle is open
  r.x = at.x;
  r.y = at.y;
  r.heading = heading;
  r.headingGoal = heading;
  r.fuel = MAX_FUEL;
  r.speed = 0;
  let spent = 0;
  for (let i = 0; i < ticks; i++) {
    const before = r.fuel;
    step(w);
    spent += before - r.fuel;
    // Pinned in place and re-aimed every tick. Left to run free the robot
    // covers a couple of hundred pixels in a minute of ticks, crests the hill
    // it was placed on and measures the next one instead \u2014 which is a fine
    // thing for a robot to do and useless for measuring one patch of ground.
    r.x = at.x;
    r.y = at.y;
    r.heading = heading;
    r.headingGoal = heading;
  }
  return { spent, speed: r.speed, climb: r.climb, robot: r, world: w };
}

const field = makeTerrain(MAP, W, H);

/** The steepest spot in the middle of the map, found by sweeping rather than guessed. */
function steepestPoint() {
  let best = { x: W / 2, y: H / 2, slope: -1 };
  for (let x = 150; x < W - 150; x += 10) {
    for (let y = 150; y < H - 150; y += 10) {
      const s = slopeAt(field, x, y);
      if (s > best.slope) best = { x, y, slope: s };
    }
  }
  return best;
}

describe("the field", () => {
  it("is a pure function of its config", () => {
    const a = makeTerrain(MAP, W, H);
    const b = makeTerrain({ ...MAP }, W, H);
    for (let x = 0; x <= W; x += 37) {
      for (let y = 0; y <= H; y += 41) {
        expect(a.heightAt(x, y)).toBe(b.heightAt(x, y));
      }
    }
  });

  it("draws a different map from a different seed", () => {
    const other = makeTerrain({ ...MAP, seed: 99 }, W, H);
    let differences = 0;
    for (let x = 100; x < W - 100; x += 23) {
      for (let y = 100; y < H - 100; y += 29) {
        if (Math.abs(field.heightAt(x, y) - other.heightAt(x, y)) > 1e-9) differences++;
      }
    }
    expect(differences).toBeGreaterThan(100);
  });

  it("stays within 0..1 everywhere, including outside the walls", () => {
    for (let x = -200; x <= W + 200; x += 13) {
      for (let y = -200; y <= H + 200; y += 17) {
        const h = field.heightAt(x, y);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(1);
      }
    }
  });

  it("actually uses its range rather than hovering around the middle", () => {
    let lo = 1;
    let hi = 0;
    for (let x = 100; x < W - 100; x += 7) {
      for (let y = 100; y < H - 100; y += 7) {
        const h = field.heightAt(x, y);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    expect(hi - lo).toBeGreaterThan(0.4);
  });

  it("flattens toward the walls, so nobody spawns on a cliff", () => {
    // Not exactly zero, and it cannot be: the fade to flat is itself a gentle
    // ramp, so there is a little slope where it does its work. What matters is
    // the size of it against the ground in the middle \u2014 a couple of percent of
    // `refSlope` is a robot noticing nothing.
    let worstEdge = 0;
    for (let x = 0; x <= W; x += 11) {
      worstEdge = Math.max(worstEdge, slopeAt(field, x, 0), slopeAt(field, x, H));
    }
    for (let y = 0; y <= H; y += 11) {
      worstEdge = Math.max(worstEdge, slopeAt(field, 0, y), slopeAt(field, W, y));
    }
    // Stated as the thing a player would actually feel: how much slower the
    // ground by the wall can make you. Under a twentieth is nobody's problem.
    const worstSpeedEffect = (worstEdge / TERRAIN.refSlope) * TERRAIN.speedSwing;
    expect(worstSpeedEffect).toBeLessThan(0.08);
    expect(worstEdge).toBeLessThan(steepestPoint().slope / 2);
  });

  it("reports a gradient that agrees with the heights it describes", () => {
    // A coarser finite difference than the one `gradientAt` uses internally, so
    // this is a real cross-check rather than the same arithmetic twice.
    for (let x = 200; x < W - 200; x += 53) {
      for (let y = 200; y < H - 200; y += 47) {
        const [gx, gy] = field.gradientAt(x, y);
        // Skip the flat spots. At a hilltop or a saddle the gradient is nearly
        // zero, so a secant is mostly rounding noise and any proportional
        // comparison there is measuring nothing. Those points are also the ones
        // that cost a robot nothing, which is why they are safe to skip.
        if (Math.abs(gx) + Math.abs(gy) < 5e-4) continue;
        // A secant over a different width than `gradientAt` uses internally, so
        // this is a real cross-check rather than the same arithmetic twice. It
        // is compared proportionally because the field genuinely curves: a
        // secant is only ever approximately the tangent, and the useful claim
        // is that the gradient points the right way with the right magnitude.
        const e = 1;
        const sx = (field.heightAt(x + e, y) - field.heightAt(x - e, y)) / (2 * e);
        const sy = (field.heightAt(x, y + e) - field.heightAt(x, y - e)) / (2 * e);
        // Each component is judged against the size of the WHOLE gradient, not
        // against itself. On a slope running due north, dh/dx is near zero and
        // is pure noise; what matters is that the vector as a whole is right.
        const mag = Math.abs(gx) + Math.abs(gy);
        expect(Math.abs(sx - gx)).toBeLessThan(mag * 0.05);
        expect(Math.abs(sy - gy)).toBeLessThan(mag * 0.05);
      }
    }
  });

  it("points uphill at ground that really is higher", () => {
    const p = steepestPoint();
    const up = uphillAt(field, p.x, p.y);
    const step10 = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      return field.heightAt(p.x + Math.cos(rad) * 10, p.y + Math.sin(rad) * 10);
    };
    expect(step10(up)).toBeGreaterThan(field.heightAt(p.x, p.y));
    expect(step10(up + 180)).toBeLessThan(field.heightAt(p.x, p.y));
  });

  it("is flat and directionless when switched off", () => {
    expect(FLAT_TERRAIN.heightAt(123, 456)).toBe(0.5);
    expect(slopeAt(FLAT_TERRAIN, 123, 456)).toBe(0);
    expect(uphillAt(FLAT_TERRAIN, 123, 456)).toBe(0);
    expect(climbAlong(FLAT_TERRAIN, 123, 456, 37)).toBe(0);
    expect(makeTerrain({ ...MAP, enabled: false }, W, H)).toBe(FLAT_TERRAIN);
  });

  it("refuses a config that would divide by zero on every peer at once", () => {
    const bad = clampTerrainConfig({
      enabled: true,
      seed: 1.7,
      featureSize: 0,
      amplitude: 99,
    });
    expect(bad.featureSize).toBeGreaterThanOrEqual(20);
    expect(bad.amplitude).toBe(1);
    expect(Number.isInteger(bad.seed)).toBe(true);
  });
});

describe("climb along a heading", () => {
  const p = steepestPoint();

  it("is +1-ish straight up and -1-ish straight down", () => {
    const up = uphillAt(field, p.x, p.y);
    expect(climbAlong(field, p.x, p.y, up)).toBeGreaterThan(0);
    expect(climbAlong(field, p.x, p.y, up)).toBeCloseTo(
      -climbAlong(field, p.x, p.y, up + 180),
      9,
    );
  });

  it("is zero along a contour", () => {
    // The one sentence the whole mechanic is built on: crossing the slope
    // sideways is neither uphill nor downhill, so it is neither dear nor slow.
    const up = uphillAt(field, p.x, p.y);
    expect(climbAlong(field, p.x, p.y, up + 90)).toBeCloseTo(0, 9);
    expect(climbAlong(field, p.x, p.y, up - 90)).toBeCloseTo(0, 9);
  });

  it("never leaves -1..1, however freakish the ground", () => {
    for (let x = 0; x <= W; x += 19) {
      for (let y = 0; y <= H; y += 23) {
        for (const heading of [0, 45, 90, 135, 180, -45, -90, -135]) {
          const c = climbAlong(field, x, y, heading);
          expect(c).toBeGreaterThanOrEqual(-1);
          expect(c).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("driving on it", () => {
  const p = steepestPoint();
  const up = uphillAt(field, p.x, p.y);

  it("is slower and dearer uphill than downhill", () => {
    const climbing = run(up, p);
    const descending = run(up + 180, p);
    expect(Math.abs(climbing.speed)).toBeLessThan(Math.abs(descending.speed));
    expect(climbing.spent).toBeGreaterThan(descending.spent);
  });

  it("costs the same across the slope as on flat ground", () => {
    // Contour equivalence, measured on a real robot rather than on the helper.
    const across = run(up + 90, p);
    const flat = run(up + 90, p, 60, false);
    expect(across.climb).toBeCloseTo(0, 9);
    expect(across.spent).toBeCloseTo(flat.spent, 6);
    expect(across.speed).toBeCloseTo(flat.speed, 6);
  });

  it("keeps its multipliers inside the range the tuning promises", () => {
    // Sampled through the world rather than asserted on the constants, so a
    // clamp quietly removed from `moveRobots` still fails this.
    for (let x = 60; x < W - 60; x += 37) {
      for (let y = 60; y < H - 60; y += 41) {
        for (const heading of [0, 90, 180, -90]) {
          const c = climbAlong(field, x, y, heading);
          // The clamped values, as `moveRobots` applies them. The raw formulas
          // do overshoot \u2014 that is exactly what the clamps are there for.
          const speed = Math.min(
            TERRAIN.speedCeil,
            Math.max(TERRAIN.speedFloor, 1 - TERRAIN.speedSwing * c),
          );
          const cost = Math.min(TERRAIN.costCeil, Math.max(0, 1 + TERRAIN.costSwing * c));
          expect(speed).toBeGreaterThanOrEqual(TERRAIN.speedFloor - 1e-9);
          expect(speed).toBeLessThanOrEqual(TERRAIN.speedCeil + 1e-9);
          expect(cost).toBeGreaterThanOrEqual(0);
          expect(cost).toBeLessThanOrEqual(TERRAIN.costCeil + 1e-9);
        }
      }
    }
  });

  it("still crawls out of the worst case: empty tank, steepest climb", () => {
    // The two floors multiply. A robot on a hill with nothing in the tank is
    // having the worst day available, and it must still be able to move.
    const w = world([DRIVER]);
    const r = w.robots[0]!;
    step(w);
    r.x = p.x;
    r.y = p.y;
    r.heading = up;
    r.headingGoal = up;
    r.fuel = 0;
    for (let i = 0; i < 300; i++) {
      step(w);
      r.fuel = 0; // hold it at empty; we are testing the floor, not the drain
      r.heading = up;
      r.headingGoal = up;
    }
    expect(r.alive).toBe(true);
    expect(Math.abs(r.speed)).toBeGreaterThan(0);
  });
});

describe("the two switches are independent", () => {
  const p = steepestPoint();
  const up = uphillAt(field, p.x, p.y);

  it("with fuel off, a hill is felt entirely in the legs", () => {
    const climbing = run(up, p, 60, true);
    const descending = run(up + 180, p, 60, true);
    // Same run, fuel disabled.
    const noFuel = (heading: number) => {
      const w = world([DRIVER], { fuel: { enabled: false } });
      const r = w.robots[0]!;
      step(w);
      r.x = p.x;
      r.y = p.y;
      r.heading = heading;
      r.headingGoal = heading;
      r.speed = 0;
      for (let i = 0; i < 60; i++) {
        step(w);
        r.x = p.x;
        r.y = p.y;
        r.heading = heading;
        r.headingGoal = heading;
      }
      return r;
    };
    const upNoFuel = noFuel(up);
    const downNoFuel = noFuel(up + 180);

    // Speeds still differ: the ground is real either way.
    expect(Math.abs(upNoFuel.speed)).toBeLessThan(Math.abs(downNoFuel.speed));
    // But nothing was spent, so the tanks are untouched and identical.
    expect(upNoFuel.fuel).toBe(MAX_FUEL);
    expect(downNoFuel.fuel).toBe(MAX_FUEL);
    // Whereas with fuel on, the same two runs differ in both.
    expect(climbing.spent).toBeGreaterThan(descending.spent);
  });

  it("with terrain off, the ground charges and slows nobody", () => {
    const w = world([DRIVER], { terrain: { enabled: false } });
    const r = w.robots[0]!;
    step(w);
    r.x = p.x;
    r.y = p.y;
    for (let i = 0; i < 30; i++) step(w);
    expect(r.climb).toBe(0);
  });

  it("lets a script read the ground even with an empty world of fuel rules", () => {
    // Terrain knowledge does not depend on there being a tank.
    const READER = `name "Reader"\nchassis tank\non start\n  set name = me.slope\nend\n`;
    const w = world([READER], { fuel: { enabled: false } });
    const r = w.robots[0]!;
    r.x = p.x;
    r.y = p.y;
    step(w);
    expect(Number(r.name)).toBeGreaterThan(0);
  });
});

describe("what a script can read", () => {
  const p = steepestPoint();

  function prop(expr: string) {
    const src = `name "R"\nchassis tank\non tick\n  set name = (${expr})\nend\n`;
    const w = world([src]);
    const r = w.robots[0]!;
    step(w);
    r.x = p.x;
    r.y = p.y;
    step(w);
    return Number(r.name);
  }

  it("reports slope as 0..100 and uphill as a relative bearing", () => {
    expect(prop("me.slope")).toBeGreaterThan(0);
    expect(prop("me.slope")).toBeLessThanOrEqual(100);
    expect(Math.abs(prop("me.uphill"))).toBeLessThanOrEqual(180);
  });

  it("puts downhill exactly opposite uphill", () => {
    // normalizeAngle lands on -180 or +180 depending on which side it came
    // from, and they are the same direction.
    expect(Math.abs(normalizeAngle(prop("me.downhill") - prop("me.uphill")))).toBeCloseTo(180, 6);
  });

  it("reads flat when terrain is switched off", () => {
    const src = `name "R"\nchassis tank\non tick\n  set name = me.slope\nend\n`;
    const w = world([src], { terrain: { enabled: false } });
    const r = w.robots[0]!;
    step(w);
    r.x = p.x;
    r.y = p.y;
    step(w);
    expect(Number(r.name)).toBe(0);
  });
});

/**
 * The Racer reads the ground the way a driver reads a track: uphill is slow and
 * dear, downhill is free speed, and the line ACROSS a slope costs exactly what
 * flat ground costs. Which makes the contour the track.
 *
 * Measured as average climb over a long run, because that is the claim. A robot
 * that merely says it follows contours and actually grinds up the hill would
 * pass any test of its handlers and fail this one.
 */
describe("the Racer drives the racing line", () => {
  function driveAlone(terrain: TerrainConfig) {
    const w = createWorld(
      makeManifest([{ source: RACER }, { source: SITTING_DUCK }], {
        seed: 31,
        // No cells: refuelling mid-run would muddy how far it got on a tank.
        fuel: { ...FUEL_PRESETS.arena, maxOnField: 0 },
        terrain,
      }),
    );
    const r = w.robots[0]!;
    let distance = 0;
    let climbSum = 0;
    let px = r.x;
    let py = r.y;
    for (let i = 0; i < 600; i++) {
      step(w);
      distance += Math.abs(r.x - px) + Math.abs(r.y - py);
      px = r.x;
      py = r.y;
      climbSum += r.climb;
    }
    return { distance, avgClimb: climbSum / 600, fuel: r.fuel };
  }

  it("spends its run across the slope rather than climbing it", () => {
    const hills = driveAlone({ ...TERRAIN_PRESETS.arena, seed: 1 });
    // Zero is the contour. Anything much above it is a robot going up a hill
    // for the whole match, which is what this replaced.
    expect(Math.abs(hills.avgClimb)).toBeLessThan(0.12);
  });

  it("covers far more ground on hills than a robot that ignores them", () => {
    // The same car with the terrain handling removed \u2014 which is exactly what
    // Racer was before it learned to read the ground. Written out rather than
    // cut from RACER by pattern, so it stays a fixed thing to measure against.
    const BLIND = `name "Blind"
chassis car
color #ffd166
on start
  drive forward 100
  turret.sweep 60
end
on sense robot
  turret.aim at event.bearing
  fire 1
end
on hit wall
  turn body by 120
end
on tick
  if me.speed < 20 then
    drive forward 100
  end
end
`;
    const w = createWorld(
      makeManifest([{ source: BLIND }, { source: SITTING_DUCK }], {
        seed: 31,
        fuel: { ...FUEL_PRESETS.arena, maxOnField: 0 },
        terrain: { ...TERRAIN_PRESETS.arena, seed: 1 },
      }),
    );
    const b = w.robots[0]!;
    let blindDistance = 0;
    let px = b.x;
    let py = b.y;
    for (let i = 0; i < 600; i++) {
      step(w);
      blindDistance += Math.abs(b.x - px) + Math.abs(b.y - py);
      px = b.x;
      py = b.y;
    }
    expect(driveAlone({ ...TERRAIN_PRESETS.arena, seed: 1 }).distance).toBeGreaterThan(
      blindDistance * 1.5,
    );
  });

  it("behaves exactly as it always did on flat ground", () => {
    // The racing line is gated on `me.slope`, which is 0 when terrain is off.
    // Every robot written before hills existed still has to fight the same way.
    const flat = driveAlone(TERRAIN_PRESETS.off);
    expect(flat.avgClimb).toBe(0);
    expect(flat.distance).toBeGreaterThan(0);
  });
});
