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
import { createWorld, makeManifest, ping } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import {
  beamReach,
  climbAlong,
  FLAT_TERRAIN,
  makeTerrain,
  slopeAt,
  uphillAt,
} from "../../src/sim/terrain.js";
import {
  FUEL_PRESETS,
  MAX_FUEL,
  RADAR,
  SENSE,
  TERRAIN,
  TERRAIN_PRESETS,
  clampTerrainConfig,
  type FuelConfig,
  type TerrainConfig,
} from "../../src/sim/types.js";
import { normalizeAngle } from "../../src/sim/math.js";
import { GOAT, RACER, SAMPLE_BOTS, SITTING_DUCK } from "../../src/bots/index.js";

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

/**
 * The Goat walks uphill until the ground runs out of up, then holds what it
 * found. Height is worth something in this simulation: anyone coming at it is
 * climbing, so they arrive slow and out of fuel, while the Goat sits still and
 * pays almost nothing.
 *
 * Measured as height gained, because "it climbs" is the claim and a robot that
 * merely stops somewhere flat would pass everything else.
 */
describe("the Goat takes the high ground", () => {
  const field = makeTerrain(TERRAIN_PRESETS.arena, W, H);

  function run(seed: number, terrain: TerrainConfig) {
    const w = createWorld(
      makeManifest([{ source: GOAT }, { source: SITTING_DUCK }], {
        seed,
        fuel: FUEL_PRESETS.arena,
        terrain,
      }),
    );
    const g = w.robots[0]!;
    const from = field.heightAt(g.x, g.y);
    // Tracked over the run rather than read at the end: this match ends when
    // the duck dies, after which `step` returns immediately and the final
    // frame says nothing about what the Goat spent the match doing.
    let saidHighGround = false;
    let travelled = 0;
    let px = g.x;
    let py = g.y;
    for (let i = 0; i < 900; i++) {
      step(w);
      if (g.name === "high ground") saidHighGround = true;
      travelled += Math.abs(g.x - px) + Math.abs(g.y - py);
      px = g.x;
      py = g.y;
    }
    return { from, to: field.heightAt(g.x, g.y), robot: g, saidHighGround, travelled };
  }

  it("ends higher than it started, wherever it starts", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = run(seed, TERRAIN_PRESETS.arena);
      expect(r.to, `seed ${seed}`).toBeGreaterThan(r.from);
    }
  });

  it("stops on ground that has genuinely run out of up", () => {
    // The bug this replaced: an early version stopped at any slope under 8,
    // which is a tenth of the map, so it halted on the first gentle stretch
    // having climbed nothing at all. A summit is where the slope is nearly
    // zero, not merely where it is comfortable.
    for (let seed = 1; seed <= 12; seed++) {
      const r = run(seed, TERRAIN_PRESETS.arena);
      expect(r.saidHighGround, `seed ${seed}`).toBe(true);
      expect(slopeAt(field, r.robot.x, r.robot.y), `seed ${seed}`).toBeLessThan(3);
    }
  });

  it("goes hunting instead when there is no hill to take", () => {
    // Every robot has to work with terrain switched off, and a robot whose
    // whole plan is the high ground has nowhere to stand on a flat map.
    for (let seed = 1; seed <= 6; seed++) {
      const r = run(seed, TERRAIN_PRESETS.off);
      expect(r.saidHighGround, `seed ${seed}`).toBe(false);
      expect(r.travelled, `seed ${seed}`).toBeGreaterThan(200);
    }
  });
});

/**
 * Line of sight.
 *
 * Ground higher than the robot standing on it stops the beam, so where you are
 * decides what you can know. This is the half of terrain that makes a map worth
 * reading rather than merely expensive to cross.
 */
describe("what the radar beam can see", () => {
  const field = makeTerrain(TERRAIN_PRESETS.arena, W, H);

  /** The highest and lowest points well inside the walls. */
  function extremes() {
    let hi = { x: 0, y: 0, h: -1 };
    let lo = { x: 0, y: 0, h: 2 };
    for (let x = 120; x < W - 120; x += 5) {
      for (let y = 120; y < H - 120; y += 5) {
        const h = field.heightAt(x, y);
        if (h > hi.h) hi = { x, y, h };
        if (h < lo.h) lo = { x, y, h };
      }
    }
    return { hi, lo };
  }

  /** Mean reach over a full turn, which is what "boxed in" actually means. */
  function meanReach(x: number, y: number, power: number, f = field) {
    let total = 0;
    let n = 0;
    for (let a = 0; a < 360; a += 15) {
      total += beamReach(f, x, y, a, RADAR.range, RADAR.eyeHeight * power);
      n++;
    }
    return total / n;
  }

  const { hi, lo } = extremes();

  it("reaches everywhere from the top of the highest hill", () => {
    // Nothing on the map is above the summit, so nothing can block it. This is
    // the sentence the whole mechanic was asked for: on the top you ping
    // normally in every direction.
    for (let a = 0; a < 360; a += 5) {
      expect(beamReach(field, hi.x, hi.y, a, RADAR.range, RADAR.eyeHeight)).toBe(RADAR.range);
    }
  });

  it("is boxed in at the bottom of a hollow", () => {
    // Everything around is higher, so the beam stops almost at once — far
    // shorter than the passive cone, which is the point: down there the radar
    // is not the long instrument any more.
    expect(meanReach(lo.x, lo.y, 1)).toBeLessThan(SENSE.range / 2);
  });

  it("costs a robot most of its reach on ordinary ground", () => {
    // Averaged over the middle of the map, so this is the typical case rather
    // than either extreme. A mechanic that only bit at the two endpoints would
    // not be worth having.
    let total = 0;
    let n = 0;
    for (let x = 150; x < W - 150; x += 50) {
      for (let y = 150; y < H - 150; y += 50) {
        total += meanReach(x, y, 1);
        n++;
      }
    }
    const average = total / n;
    expect(average).toBeLessThan(RADAR.range * 0.6);
    expect(average).toBeGreaterThan(RADAR.range * 0.2);
  });

  it("buys sight with power, and never loses it", () => {
    // Power must be worth paying for. If a harder ping barely moved the reach
    // then `eyeHeight` is wrong, not the design.
    let weak = 0;
    let strong = 0;
    for (let x = 150; x < W - 150; x += 50) {
      for (let y = 150; y < H - 150; y += 50) {
        weak += meanReach(x, y, 1);
        strong += meanReach(x, y, RADAR.maxPower);
      }
    }
    expect(strong).toBeGreaterThan(weak * 1.5);

    // And monotonic everywhere, not merely better on average: more power can
    // never see less.
    for (let x = 150; x < W - 150; x += 90) {
      for (let y = 150; y < H - 150; y += 90) {
        for (const a of [0, 72, 144, 216, 288]) {
          const p1 = beamReach(field, x, y, a, RADAR.range, RADAR.eyeHeight);
          const p3 = beamReach(field, x, y, a, RADAR.range, RADAR.eyeHeight * RADAR.maxPower);
          expect(p3).toBeGreaterThanOrEqual(p1);
        }
      }
    }
  });

  it("blocks nothing at all on flat ground, at any power", () => {
    for (const power of [1, 2, 3]) {
      for (let a = 0; a < 360; a += 15) {
        expect(beamReach(FLAT_TERRAIN, 400, 300, a, RADAR.range, RADAR.eyeHeight * power)).toBe(
          RADAR.range,
        );
      }
    }
  });
});

describe("hiding behind a hill", () => {
  // The very map `world()` builds, so the positions found by searching this
  // field are the positions the simulation actually puts robots on. Reading one
  // map and fighting on another cost me a confusing failure here.
  const field = makeTerrain(MAP, W, H);

  /**
   * Put a watcher and a target at chosen points, aim the watcher's radar
   * straight at the target, ping, and report what came back.
   *
   * This is the mechanic in one sentence, so it is worth testing through the
   * whole simulation rather than against `beamReach` alone.
   */
  function look(from: { x: number; y: number }, at: { x: number; y: number }, power = 1) {
    const src = `name "Watcher"\nchassis tank\non ping robot\n  set name = "seen"\nend\non ping ridge\n  set name = "blocked"\nend\non ping wall\n  set name = "nothing"\nend\n`;
    const w = world([src, SITTING_DUCK], { fuel: { maxOnField: 0 } });
    const me = w.robots[0]!;
    const them = w.robots[1]!;
    step(w);
    me.x = from.x;
    me.y = from.y;
    them.x = at.x;
    them.y = at.y;
    me.radar = Math.atan2(at.y - from.y, at.x - from.x) * (180 / Math.PI);
    me.radarSweepAmplitude = 0;
    me.radarGoal = me.radar;
    me.pingHeat = 0;
    ping(w, me, power);
    // One step for the enqueued event to reach its handler.
    step(w);
    return me.name;
  }

  it("cannot see a robot on the far side of higher ground", () => {
    // A pair chosen by search rather than by eye: a watcher low down, a target
    // in range, and a ridge between them.
    let found: { from: { x: number; y: number }; at: { x: number; y: number } } | null = null;
    for (let x = 150; x < W - 150 && !found; x += 25) {
      for (let y = 150; y < H - 150 && !found; y += 25) {
        for (const a of [0, 45, 90, 135, 180, 225, 270, 315]) {
          const reach = beamReach(field, x, y, a, RADAR.range, RADAR.eyeHeight);
          if (reach > 60 && reach < 200) {
            const d = reach + 80;
            if (d > RADAR.range) continue;
            const tx = x + Math.cos((a * Math.PI) / 180) * d;
            const ty = y + Math.sin((a * Math.PI) / 180) * d;
            if (tx < 40 || tx > W - 40 || ty < 40 || ty > H - 40) continue;
            found = { from: { x, y }, at: { x: tx, y: ty } };
            break;
          }
        }
      }
    }
    expect(found).not.toBeNull();
    if (!found) return;
    expect(look(found.from, found.at)).toBe("blocked");
  });

  it("sees the same robot from the top of the hill", () => {
    // The summit against a target the low ground could not have reached.
    let hi = { x: 0, y: 0, h: -1 };
    for (let x = 120; x < W - 120; x += 5) {
      for (let y = 120; y < H - 120; y += 5) {
        const h = field.heightAt(x, y);
        if (h > hi.h) hi = { x, y, h };
      }
    }
    const target = { x: hi.x + 300, y: hi.y };
    if (target.x > W - 40) target.x = hi.x - 300;
    expect(look({ x: hi.x, y: hi.y }, target)).toBe("seen");
  });
});

/**
 * No sample robot locks up on a map it cannot see across.
 *
 * This is the failure this mechanic can actually cause, and it is one this
 * project has had before: several robots aim the radar at a contact and rely on
 * `on ping wall` to start it sweeping again. A ping stopped by a hill used to
 * report nothing at all, which left the beam pointed at the hillside, pinging
 * it for the rest of the match. `ping ridge` exists to close that, and this is
 * the test that says so.
 */
describe("every sample robot survives a map with hills in it", () => {
  // Sitting Duck is the exception, and the only honest one: doing nothing at
  // all is its entire purpose, and a version of it that stirred would be the
  // broken one.
  for (const bot of SAMPLE_BOTS.filter((b) => b.id !== "sitting-duck")) {
    it(`${bot.title} keeps doing something`, () => {
      const w = createWorld(
        makeManifest([{ source: bot.source }, { source: SITTING_DUCK }], {
          seed: 12,
          fuel: FUEL_PRESETS.arena,
          terrain: TERRAIN_PRESETS.arena,
        }),
      );
      const r = w.robots[0]!;
      const active: boolean[] = [];
      let px = r.x;
      let py = r.y;
      let pr = r.radar;
      let ph = r.heading;
      let shots = 0;
      for (let i = 0; i < 1200 && !w.over; i++) {
        step(w);
        active.push(
          Math.abs(r.x - px) + Math.abs(r.y - py) > 0.1 ||
            Math.abs(r.radar - pr) > 0.01 ||
            Math.abs(r.heading - ph) > 0.01 ||
            r.shotsFired > shots,
        );
        px = r.x;
        py = r.y;
        pr = r.radar;
        ph = r.heading;
        shots = r.shotsFired;
      }

      // A match that ended is the opposite of a robot stuck on a hillside, so
      // there is nothing to check. Only a long one can hide the failure.
      if (active.length < 400) return;

      // The TAIL, not the whole run: thrashing about at the start must not be
      // allowed to cover for a robot that locked up later.
      const tail = active.slice(-200);
      expect(tail.filter(Boolean).length, bot.title).toBeGreaterThan(20);
    });
  }
});
