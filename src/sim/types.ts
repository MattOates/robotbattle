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
import { clamp } from "./math.js";
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

/**
 * The scheduling quantum: instructions a robot may execute before the VM
 * preempts it and moves on to the next robot.
 *
 * This is an implementation constraint, not a game resource. It is the same for
 * every robot, refilled in full every tick, and nothing in the world can raise
 * or lower it. It exists to bound the work one tick can cost — so a runaway
 * `loop` cannot hang the sim — and to bound it *identically on every peer*, so
 * that where a handler gets suspended is part of the deterministic state rather
 * than a function of how fast the machine is.
 */
export const OPS_PER_TICK = 2000;

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

/**
 * Fuel: the one thing in the arena that is consumed and can be replaced.
 *
 * Deliberately unrelated to `OPS_PER_TICK`. Thinking is free and equal for
 * everybody; only *actuated* work costs — driving, turning, slewing, firing,
 * pinging. The passive sense cone is not actuated and stays free: every robot
 * has it always on, so pricing it would only be a constant added to `basal`.
 *
 * Running dry is a brownout, never a death. Capability scales toward
 * `floorFactor` and stops there, which also makes the economy self-limiting:
 * as fuel drops, top speed drops, so the cost of driving drops, so an empty
 * robot approaches the floor asymptotically instead of falling off a cliff.
 * That matters because every robot written before fuel existed still has to be
 * able to finish a match. See `fuelFactor` for the shape of the fall.
 */
export const MAX_FUEL = 100;

export const FUEL = {
  /**
   * Fraction of full capability left at an empty tank. Never 0.
   *
   * Low on purpose: running dry should be something a player works to avoid,
   * not a mild handicap. At a tenth of normal a robot is still alive, still
   * shooting and still able to crawl to the next cell, but it has effectively
   * lost the fight until it finds one.
   *
   * This is the endpoint of the curve in `fuelFactor`, which is deliberately
   * not a straight line: the penalty grows with the square of how empty the
   * tank is, so lowering this floor sharpens the last stretch far more than it
   * touches the first.
   */
  floorFactor: 0.1,

  // ---- per tick ----
  /** Paid every tick simply for being alive, so idling in a corner still costs. */
  basal: 0.02,
  /** Scaled by how much of the available top speed is actually being used. */
  drive: 0.05,
  /** Per degree the chassis actually rotated. */
  bodyTurn: 0.01,
  /** Per degree the turret and radar actually slewed. */
  slew: 0.005,

  // ---- per use ----
  /** Multiplied by firing power, so a heavy shot costs what it is worth. */
  fire: 0.8,
  /** A ping reaches three times as far as the cone; it is the expensive sense. */
  ping: 1.5,
} as const;

/**
 * How generous a match is. Travels in the manifest, so a replay and every peer
 * spawn the identical sequence of cells.
 */
export interface FuelConfig {
  /**
   * Whether the mechanic exists in this match at all.
   *
   * Off means off in both directions: nothing spawns, and nothing is spent
   * either. Stopping the spawns alone would be the cruellest possible setting,
   * since robots would still drain and brown out with nothing to refuel from.
   */
  enabled: boolean;
  /** Ticks between spawn attempts. */
  spawnEveryTicks: number;
  /** Nothing spawns while this many cells are already out. */
  maxOnField: number;
  /** Fuel restored by one cell. */
  amount: number;
  /** Pickup radius, added to the robot's own. */
  radius: number;
}

/**
 * The tournament runs leaner than the arena on purpose. Scarcer fuel means
 * brownouts bite, which separates robots that budget their movement from ones
 * that drive flat out — and a knockout wants to be decided by something.
 */
export const FUEL_PRESETS = {
  arena: { enabled: true, spawnEveryTicks: 90, maxOnField: 6, amount: 25, radius: 10 },
  tournament: { enabled: true, spawnEveryTicks: 120, maxOnField: 4, amount: 20, radius: 10 },
  /**
   * The mechanic switched off. The rest of the numbers are kept rather than
   * zeroed so that a screen which lets you toggle it can put back what you had.
   */
  off: { enabled: false, spawnEveryTicks: 90, maxOnField: 6, amount: 25, radius: 10 },
} as const satisfies Record<string, FuelConfig>;

/**
 * A manifest can arrive from a remote host, so its numbers are input, not
 * fact. `spawnEveryTicks: 0` would spawn without bound on every peer.
 */
export function clampFuelConfig(cfg: FuelConfig): FuelConfig {
  return {
    enabled: cfg.enabled,
    spawnEveryTicks: Math.max(1, Math.min(36000, Math.round(cfg.spawnEveryTicks))),
    maxOnField: Math.max(0, Math.min(64, Math.round(cfg.maxOnField))),
    amount: clamp(cfg.amount, 0, MAX_FUEL),
    radius: clamp(cfg.radius, 0, 200),
  };
}

/** A pickup sitting in the arena, waiting to be driven over. */
export interface FuelCell {
  id: number;
  x: number;
  y: number;
  /** How much fuel absorbing it restores. */
  amount: number;
}

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
  /** 0..MAX_FUEL. Drains from actuated work; refilled by driving over a cell. */
  fuel: number;
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
  type: "muzzle" | "impact" | "explosion" | "wallHit" | "ping" | "pickup";
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
  fuel: FuelCell[];
  effects: Effect[];
  terrain: TerrainField;
  nextBulletId: number;
  nextFuelId: number;
  /** Spawn rules for this match, carried in the manifest so replays agree. */
  fuelConfig: FuelConfig;
  /** Set once fewer than two robots remain, or the tick limit is reached. */
  over: boolean;
  winnerId: number | null;
  /** Matches are capped so a stalemate cannot run forever. */
  maxTicks: number;
}
