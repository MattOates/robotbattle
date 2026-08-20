/**
 * Deterministic math.
 *
 * The whole game rests on every peer computing bit-identical results. IEEE-754
 * `+ - * /` and `Math.sqrt` are required by spec to be correctly rounded, so
 * they are safe. `Math.sin`, `Math.cos`, `Math.tan`, `Math.atan2`, `Math.pow`
 * and friends are explicitly *implementation-defined* — V8, JSC and SpiderMonkey
 * genuinely disagree in the last bits, which is enough to desync a match after a
 * few hundred ticks.
 *
 * So we implement our own using only the exact operations. These are polynomial
 * approximations evaluated the same way everywhere, which makes them slightly
 * less accurate than the platform's but perfectly reproducible. Accuracy is
 * irrelevant here; agreement is everything.
 *
 * Angles are in DEGREES throughout the simulation, matching the DSL, so authors
 * never meet a radian.
 */

/** Angle unit conversion. Both are exact doubles, so the multiply is exact. */
const DEG_TO_RAD = 0.017453292519943295;
const RAD_TO_DEG = 57.29577951308232;

const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;

/** Wrap an angle into [-180, 180). Used everywhere bearings are compared. */
export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

/** Wrap an angle into [0, 360). */
export function normalizeAngle360(deg: number): number {
  const a = deg % 360;
  return a < 0 ? a + 360 : a;
}

/**
 * sin for a radian argument already reduced to [-pi/4, pi/4].
 * Taylor series through x^13; absolute error under 1e-15 across that range,
 * which is essentially double precision.
 */
function sinCore(x: number): number {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-0.16666666666666666 +
          x2 *
            (0.008333333333333333 +
              x2 *
                (-0.0001984126984126984 +
                  x2 * (2.755731922398589e-6 + x2 * -2.505210838544172e-8)))))
  );
}

/** cos for a radian argument already reduced to [-pi/4, pi/4]. */
function cosCore(x: number): number {
  const x2 = x * x;
  return (
    1 +
    x2 *
      (-0.5 +
        x2 *
          (0.041666666666666664 +
            x2 *
              (-0.001388888888888889 + x2 * (2.48015873015873e-5 + x2 * -2.7557319223985893e-7))))
  );
}

/**
 * Reduce to an octant and dispatch to the sin/cos cores.
 * Returns sin when `wantSin`, cos otherwise — sharing the reduction keeps the
 * two functions exactly consistent with each other, which matters because we
 * derive headings from both.
 */
function sinCosDeg(deg: number, wantSin: boolean): number {
  // Reduce to [0, 360) then to a quadrant, tracking sign flips.
  let a = normalizeAngle360(deg);
  let negate = false;

  if (!wantSin) {
    // cos(a) == sin(a + 90)
    a = normalizeAngle360(a + 90);
  }

  if (a >= 180) {
    a -= 180;
    negate = true;
  }
  if (a > 90) {
    a = 180 - a;
  }
  // Now a is in [0, 90]. Use cosCore for the upper half so both cores only ever
  // see arguments within their accurate range.
  const r = a <= 45 ? sinCore(a * DEG_TO_RAD) : cosCore((90 - a) * DEG_TO_RAD);
  return negate ? -r : r;
}

export function sinDeg(deg: number): number {
  return sinCosDeg(deg, true);
}

export function cosDeg(deg: number): number {
  return sinCosDeg(deg, false);
}

export function tanDeg(deg: number): number {
  const c = cosDeg(deg);
  // Guard the asymptote so a 90-degree steering lock can never produce Infinity.
  if (c > -1e-12 && c < 1e-12) return sinDeg(deg) >= 0 ? 1e12 : -1e12;
  return sinDeg(deg) / c;
}

const SQRT3 = 1.7320508075688772;
const PI_OVER_6 = 0.5235987755982988;
const TAN_15 = 0.2679491924311227;

/**
 * atan for 0 <= a <= 1.
 *
 * The Taylor series for atan converges painfully slowly near 1, so we first
 * fold the argument below tan(15 degrees) using
 *   atan(a) = pi/6 + atan((a*sqrt3 - 1) / (sqrt3 + a))
 * after which a degree-15 series is accurate to ~1e-10.
 */
function atanUnit(aIn: number): number {
  let a = aIn;
  let offset = 0;
  if (a > TAN_15) {
    a = (a * SQRT3 - 1) / (SQRT3 + a);
    offset = PI_OVER_6;
  }
  const z = a * a;
  let p = -0.06666666666666667; // -1/15
  p = 0.07692307692307693 + z * p; //  1/13
  p = -0.09090909090909091 + z * p; // -1/11
  p = 0.1111111111111111 + z * p; //  1/9
  p = -0.14285714285714285 + z * p; // -1/7
  p = 0.2 + z * p; //  1/5
  p = -0.3333333333333333 + z * p; // -1/3
  p = 1 + z * p;
  return offset + a * p;
}

function atanRad(x: number): number {
  const a = x < 0 ? -x : x;
  const r = a > 1 ? HALF_PI - atanUnit(1 / a) : atanUnit(a);
  return x < 0 ? -r : r;
}

/**
 * atan2 in degrees, matching the usual (y, x) argument order.
 * Returns a value in [-180, 180).
 */
export function atan2Deg(y: number, x: number): number {
  if (x === 0) {
    if (y > 0) return 90;
    if (y < 0) return -90;
    return 0;
  }
  const a = atanRad(y / x) * RAD_TO_DEG;
  if (x > 0) return a;
  return normalizeAngle(y >= 0 ? a + 180 : a - 180);
}

/** Length of a vector. Math.sqrt is correctly rounded per spec, so it is safe. */
export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Move `current` toward `target` by at most `maxDelta`, taking the short way
 * around the circle. This is the workhorse behind every actuator slew: turret
 * rotation, heading controllers, steering.
 */
export function turnToward(current: number, target: number, maxDelta: number): number {
  const diff = normalizeAngle(target - current);
  if (diff > maxDelta) return normalizeAngle(current + maxDelta);
  if (diff < -maxDelta) return normalizeAngle(current - maxDelta);
  return normalizeAngle(target);
}

/** Move a scalar toward a target by at most `maxDelta`. */
export function moveToward(current: number, target: number, maxDelta: number): number {
  if (target > current) return current + maxDelta > target ? target : current + maxDelta;
  if (target < current) return current - maxDelta < target ? target : current - maxDelta;
  return target;
}

/**
 * Shortest signed angular difference from `from` to `to`, in [-180, 180).
 * Positive means `to` is clockwise of `from` in screen coordinates.
 */
export function angleDelta(from: number, to: number): number {
  return normalizeAngle(to - from);
}

// ---- segment geometry ----------------------------------------------------
//
// Walls are line segments, so both wall questions the simulation ever asks —
// "how far am I from that wall" and "how far along my heading is one" — reduce
// to these two. Both are pure `+ - * /` and `Math.sqrt`, so they satisfy the
// scanner in `tests/determinism/determinism.test.ts` and can be trusted to give
// the same answer on every peer.

/**
 * Nearest point on segment (x1,y1)-(x2,y2) to (px,py), as
 * `[nearestX, nearestY, squaredDistance]`.
 *
 * Squared rather than actual distance because every caller either compares it
 * against a squared threshold or needs the point anyway, and the square root is
 * the expensive part of a routine run once per robot per wall per tick.
 *
 * A degenerate (zero-length) segment collapses to its own start point, which is
 * the right answer and costs nothing to allow. `clampWalls` rejects those long
 * before they reach here, but a routine that returns NaN for one is a routine
 * that desyncs a match rather than failing a test.
 */
export function closestPointOnSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): readonly [number, number, number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  // Parametric position along the segment, clamped to its ends so the answer is
  // a point on the segment rather than on the infinite line through it.
  let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const nx = x1 + dx * t;
  const ny = y1 + dy * t;
  const ex = px - nx;
  const ey = py - ny;
  return [nx, ny, ex * ex + ey * ey];
}

/**
 * Distance from (ox,oy) along the UNIT direction (dx,dy) to segment
 * (x1,y1)-(x2,y2), or null if the ray misses it.
 *
 * The direction must already be a unit vector — every caller has one from
 * `cosDeg`/`sinDeg` of a heading — so the returned parameter is a distance in
 * pixels rather than a fraction of anything.
 *
 * Standard 2D ray/segment cross-product solve. `denom` near zero means the ray
 * and the segment are parallel: a hit would be a grazing pass along the wall's
 * length, which is not something a robot needs told about, so it counts as a
 * miss.
 */
export function raySegmentDistance(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number | null {
  const sx = x2 - x1;
  const sy = y2 - y1;
  const denom = dx * sy - dy * sx;
  if (denom > -1e-9 && denom < 1e-9) return null;
  const qx = x1 - ox;
  const qy = y1 - oy;
  // How far along the SEGMENT the crossing is. Outside 0..1 and the ray passed
  // the segment's line beyond one of its ends.
  const u = (qx * dy - qy * dx) / denom;
  if (u < 0 || u > 1) return null;
  // How far along the RAY. Negative means the wall is behind us.
  const t = (qx * sy - qy * sx) / denom;
  if (t < 0) return null;
  return t;
}

export { PI, DEG_TO_RAD, RAD_TO_DEG };
