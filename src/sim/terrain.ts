/**
 * Terrain: the shape of the ground.
 *
 * One scalar field, 0..1, sampled anywhere in the arena. The two art packs read
 * the same number two ways — mechanical as height, so it is hills; biological as
 * viscosity, so it is thick and thin patches of goop. The rule underneath is the
 * same either way, and it is about the *gradient*, not the value: climbing costs
 * more and moves slower, running down costs less and moves faster, and crossing
 * along a contour is exactly as cheap as flat ground.
 *
 * Everything here is built from `+ - * /`, `Math.floor`, `Math.imul` and
 * `Math.sqrt`. Those are the operations IEEE-754 requires to be correctly
 * rounded, so every peer gets bit-identical ground. `Math.sin`, `Math.pow` and
 * friends are implementation-defined and would desync a match — see the note at
 * the top of `math.ts`, and the scanner in `tests/determinism/determinism.test.ts`
 * that walks this directory and enforces it.
 *
 * The field is a pure function of its config. It holds no mutable state, makes
 * no RNG draws, and therefore never needs to be hashed or replayed — only the
 * four numbers that generated it do.
 */

import { atan2Deg, clamp, cosDeg, hypot, sinDeg } from "./math.js";
import { RADAR, TERRAIN, type TerrainConfig } from "./types.js";

export interface TerrainField {
  /** Height at a point, 0..1. Mechanical draws it as elevation, biological as viscosity. */
  heightAt(x: number, y: number): number;
  /** Rate of change per pixel, as [dh/dx, dh/dy]. */
  gradientAt(x: number, y: number): readonly [number, number];
}

/** Featureless ground. What a match runs on when terrain is switched off. */
export const FLAT_TERRAIN: TerrainField = {
  heightAt: () => 0.5,
  gradientAt: () => [0, 0],
};

/**
 * Integer hash of a lattice point. Two rounds of `Math.imul` mixing, in the
 * style of `Rng`'s seeding — we only need the low three bits to be well
 * distributed, since all they do is pick one of eight gradient directions.
 */
function hashLattice(ix: number, iy: number, seed: number): number {
  let h = (ix | 0) * 0x27d4eb2d;
  h = Math.imul(h ^ (iy | 0), 0x165667b1);
  h = Math.imul(h ^ (seed | 0), 0x9e3779b1);
  h ^= h >>> 15;
  return (h ^ (h >>> 13)) >>> 0;
}

/**
 * Eight unit gradients: the four axes and the four diagonals. Using unit
 * vectors rather than the classic (1,1)-style ones keeps the noise's amplitude
 * even in every direction, which matters here because the gradient *is* the
 * mechanic — a field that was steeper on the diagonals would quietly make
 * north-east the expensive way to drive.
 */
const D = 0.7071067811865476; // sqrt(2)/2
const GRADIENTS: readonly (readonly [number, number])[] = [
  [1, 0],
  [D, D],
  [0, 1],
  [-D, D],
  [-1, 0],
  [-D, -D],
  [0, -1],
  [D, -D],
];

/** Quintic fade, 6t^5 - 15t^4 + 10t^3. Flat first and second derivatives at 0 and 1. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** One octave of Perlin gradient noise. Output is roughly -1..1. */
function perlin(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  const dot = (cx: number, cy: number): number => {
    const g = GRADIENTS[hashLattice(cx, cy, seed) & 7]!;
    return g[0] * (x - cx) + g[1] * (y - cy);
  };

  const u = fade(fx);
  const v = fade(fy);

  const n00 = dot(x0, y0);
  const n10 = dot(x0 + 1, y0);
  const n01 = dot(x0, y0 + 1);
  const n11 = dot(x0 + 1, y0 + 1);

  const a = n00 + u * (n10 - n00);
  const b = n01 + u * (n11 - n01);
  // 2D Perlin peaks at sqrt(2)/2; scale so a full-amplitude ridge reaches 1.
  return (a + v * (b - a)) * 1.4142135623730951;
}

/**
 * The generator.
 *
 * Three octaves, each twice the frequency and half the weight of the last, so
 * the map has both broad hills worth routing around and smaller undulations
 * that make the broad ones feel like ground rather than like ramps.
 */
export function makeTerrain(cfg: TerrainConfig, width: number, height: number): TerrainField {
  if (!cfg.enabled) return FLAT_TERRAIN;

  const scale = 1 / cfg.featureSize;
  // Weights sum to 1 so the octave mix cannot push the field outside -1..1.
  const OCTAVES: readonly (readonly [number, number])[] = [
    [1, 0.5714285714285714], // 4/7
    [2, 0.2857142857142857], // 2/7
    [4, 0.14285714285714285], // 1/7
  ];

  /**
   * Fade the field toward flat near the walls.
   *
   * Robots spawn around the edge and are pushed back by `clampToArena`, so a
   * cliff along a wall would be terrain nobody chose to be on. The band is
   * generous on purpose: the interesting ground should be in the middle, where
   * a script has room to decide what to do about it.
   */
  const margin = TERRAIN.edgeMargin;
  const edgeFade = (x: number, y: number): number => {
    const d = Math.min(Math.min(x, width - x), Math.min(y, height - y));
    return clamp(d / margin, 0, 1);
  };

  const heightAt = (x: number, y: number): number => {
    let n = 0;
    for (const [freq, weight] of OCTAVES) {
      n += perlin(x * scale * freq, y * scale * freq, cfg.seed + freq) * weight;
    }
    const shaped = clamp(n, -1, 1) * cfg.amplitude * edgeFade(x, y);
    return clamp(0.5 + 0.5 * shaped, 0, 1);
  };

  return {
    heightAt,
    /**
     * Central difference rather than an analytic derivative. It is six adds and
     * a divide, it cannot drift out of agreement with `heightAt`, and it stays
     * correct if the octave mix is ever retuned.
     */
    gradientAt(x: number, y: number): readonly [number, number] {
      const e = TERRAIN.gradientEpsilon;
      const dx = (heightAt(x + e, y) - heightAt(x - e, y)) / (2 * e);
      const dy = (heightAt(x, y + e) - heightAt(x, y - e)) / (2 * e);
      return [dx, dy];
    },
  };
}

/**
 * Convert a per-pixel rate into the units scripts and tuning constants use:
 * height-percent gained per 100 pixels travelled. A robot crossing 100px of
 * ground at a slope of 40 climbs 40% of the arena's full height range.
 */
function toSlopeUnits(perPixel: number): number {
  return perPixel * 100 * 100;
}

/** Steepness of the ground under a point, 0..100. Direction-free. */
export function slopeAt(field: TerrainField, x: number, y: number): number {
  const [gx, gy] = field.gradientAt(x, y);
  return clamp(toSlopeUnits(hypot(gx, gy)), 0, 100);
}

/**
 * Absolute bearing of steepest ascent. Flat ground has no uphill, so it reports
 * 0 rather than an arbitrary direction shaken out of two zeroes.
 */
export function uphillAt(field: TerrainField, x: number, y: number): number {
  const [gx, gy] = field.gradientAt(x, y);
  if (gx === 0 && gy === 0) return 0;
  return atan2Deg(gy, gx);
}

/**
 * Signed climb along a heading, normalised to -1..1 against `TERRAIN.refSlope`.
 *
 * +1 is straight up something as steep as the field is meant to get, -1 is
 * straight down it, and 0 is either flat ground or — the case worth knowing —
 * travelling along a contour, across the slope rather than against it.
 */
export function climbAlong(
  field: TerrainField,
  x: number,
  y: number,
  heading: number,
): number {
  const [gx, gy] = field.gradientAt(x, y);
  const alongPerPixel = gx * cosDeg(heading) + gy * sinDeg(heading);
  return clamp(toSlopeUnits(alongPerPixel) / TERRAIN.refSlope, -1, 1);
}

/**
 * How far the beam gets before the ground rises far enough to stop it.
 *
 * `allowance` is how much higher than the observer the ground may be and still
 * be seen over. A robot is not a periscope, so this is small: from a valley
 * floor the surrounding ridges box you in, and from the top of the highest hill
 * nothing blocks you at all.
 *
 * Distance is `i * step` rather than a running total on purpose. Repeated
 * `d += step` accumulates rounding differently depending on how the arithmetic
 * is scheduled, and two peers that disagree about where a beam stopped would
 * disagree about who is on the radar.
 */
export function beamReach(
  field: TerrainField,
  x: number,
  y: number,
  heading: number,
  maxRange: number,
  allowance: number,
): number {
  const ceiling = field.heightAt(x, y) + allowance;
  const dx = cosDeg(heading);
  const dy = sinDeg(heading);
  const step = RADAR.occlusionStep;
  const steps = Math.floor(maxRange / step);
  for (let i = 1; i <= steps; i++) {
    const d = i * step;
    if (field.heightAt(x + dx * d, y + dy * d) > ceiling) return d;
  }
  return maxRange;
}
