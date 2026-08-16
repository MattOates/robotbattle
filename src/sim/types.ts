/**
 * Simulation state types and tuning constants.
 *
 * Everything here is plain data. The rule that keeps peers in sync is that the
 * physical state below is the *only* thing that determines the next tick — no
 * wall-clock time, no rendering state, no unordered iteration.
 */

import type { Locomotion } from "../lang/ast.js";
import type { Chunk } from "../lang/bytecode.js";
import type { RuntimeError, Vm } from "../lang/vm.js";
import type { Rng } from "./rng.js";

/** Simulation rate. Rendering interpolates between these at 60fps. */
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

/**
 * Identical for every chassis, by design. A circle is rotation-invariant, so
 * "same hitbox for everyone" is exactly true rather than approximately true,
 * and the two locomotion types differ only in how they move.
 */
export const ROBOT_RADIUS = 18;

export const MAX_HEALTH = 100;

/** Instructions each robot may execute per tick before being suspended. */
export const FUEL_PER_TICK = 2000;

/** Shared turret specification — identical on both chassis. */
export const TURRET = {
  /** Degrees per second the turret can slew. */
  slewRate: 200,
  /** Heat added per unit of firing power. */
  heatPerPower: 0.7,
  /** Heat shed per tick. */
  coolRate: 0.06,
  minPower: 1,
  maxPower: 3,
} as const;

/**
 * The passive sense cone: wide, short, and locked to the chassis heading.
 *
 * Shortened twice since the radar arrived, from 320 to 260 to 195. The cone is
 * what a robot notices without trying, and it should cover about the space it
 * is driving through — anything further away is the radar's job, and a cone
 * that reached across the arena would leave the radar nothing to be better at.
 */
export const SENSE = {
  /** Half-angle of the cone, in degrees. */
  halfAngle: 30,
  range: 195,
} as const;

/**
 * The radar beam: narrow, long, and aimed independently of both body and
 * turret.
 *
 * Three times the cone's reach and a fifth of its width, so it is a genuinely
 * different instrument rather than a better one — it finds robots far outside
 * the cone, but only exactly where it is pointed, and only when a script
 * deliberately sends a ping.
 */
export const RADAR = {
  /** Half-angle of the beam, in degrees. A fifth of the cone's. */
  halfAngle: 6,
  /** Three times the cone's range. */
  range: SENSE.range * 3,
  /** Degrees per second the radar can slew. Lighter than a turret. */
  slewRate: 260,
  /** Ticks before another ping can be sent. */
  cooldown: 12,
} as const;

export const BULLET = {
  /** Faster for weaker shots, so power trades speed for damage. */
  baseSpeed: 460,
  speedPerPower: 40,
  damagePerPower: 5,
  radius: 3,
} as const;

/** Per-locomotion movement characteristics. */
export interface ChassisSpec {
  locomotion: Locomotion;
  /** Pixels per second. */
  maxSpeed: number;
  /** Pixels per second squared. */
  acceleration: number;
  /** Braking is stronger than acceleration, as on a real vehicle. */
  braking: number;
  /** Skid steer only: degrees per second it can rotate, including on the spot. */
  turnRate: number;
  /** Steered only: maximum steering angle in degrees. */
  maxSteer: number;
  /** Steered only: distance between axles, which sets the turning circle. */
  wheelbase: number;
}

export interface Bullet {
  id: number;
  ownerId: number;
  x: number;
  y: number;
  /** Degrees; bullets fly straight. */
  heading: number;
  speed: number;
  power: number;
  alive: boolean;
}

/** How the chassis is currently being asked to turn. */
export type HeadingMode = "free" | "goal";

export interface Robot {
  id: number;
  /** Display label under the robot. Scripts may change it at runtime. */
  name: string;
  /** Name as declared in the script, used in the roster and results. */
  declaredName: string;
  color: string;
  locomotion: Locomotion;

  x: number;
  y: number;
  /** Chassis heading in degrees; 0 is +x (right), increasing clockwise. */
  heading: number;
  /** Current forward speed in px/s; negative is reverse. */
  speed: number;

  /** Turret heading in ABSOLUTE degrees, independent of the chassis. */
  turret: number;
  gunHeat: number;

  /** Radar heading in ABSOLUTE degrees, independent of chassis and turret. */
  radar: number;
  /** Ticks remaining before another ping may be sent. */
  pingHeat: number;

  health: number;
  alive: boolean;

  // ---- actuator goals, set by the script, slewed toward by the sim ----
  /** -1..1 fraction of max speed. */
  throttle: number;
  headingMode: HeadingMode;
  /** Absolute heading the chassis is steering toward, when headingMode is "goal". */
  headingGoal: number;
  /** Current steering angle for steered chassis, in degrees. */
  steer: number;
  /** Absolute heading the turret is slewing toward. */
  turretGoal: number;
  /** Non-zero while sweeping: half-width of the sweep in degrees. */
  sweepAmplitude: number;
  /** +1 or -1: which way the sweep is currently going. */
  sweepDir: number;
  /** Absolute heading the radar is slewing toward. */
  radarGoal: number;
  /** Non-zero while the radar is sweeping: half-width in degrees. */
  radarSweepAmplitude: number;
  radarSweepDir: number;

  // ---- scoring and telemetry ----
  // These are observational: nothing in the tick loop reads them, and they are
  // deliberately left out of `hashWorld` because they are fully derived from
  // state that is already hashed.
  kills: number;
  damageDealt: number;
  damageTaken: number;
  shotsFired: number;
  shotsHit: number;
  /** Tick at which this robot died, or -1 while alive. Used for placings. */
  diedAtTick: number;

  // ---- script ----
  vm: Vm;
  chunk: Chunk;
  scriptError: RuntimeError | null;
}

/** Transient visual events produced by a tick, consumed by the renderer. */
export interface Effect {
  type: "muzzle" | "impact" | "explosion" | "wallHit" | "ping";
  x: number;
  y: number;
  /** Degrees, where meaningful. */
  heading: number;
  tick: number;
  /** How far the effect reaches, for the ones that are not point-sized. */
  range?: number;
}

/**
 * Terrain hook. Milestone 1 ships a flat field; milestone 4 replaces it with
 * seeded noise (hills for the mechanical theme, viscosity for the biological
 * one). Keeping the seam here means that change never touches the step loop.
 */
export interface TerrainField {
  /** Multiplier applied to a robot's max speed at a point. 1 is unobstructed. */
  speedAt(x: number, y: number): number;
}

export const FLAT_TERRAIN: TerrainField = {
  speedAt: () => 1,
};

export interface World {
  tick: number;
  width: number;
  height: number;
  rng: Rng;
  robots: Robot[];
  bullets: Bullet[];
  effects: Effect[];
  terrain: TerrainField;
  nextBulletId: number;
  /** Set once fewer than two robots remain, or the tick limit is reached. */
  over: boolean;
  winnerId: number | null;
  /** Matches are capped so a stalemate cannot run forever. */
  maxTicks: number;
}
