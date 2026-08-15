/**
 * World construction and the bridge between a script and the simulation.
 *
 * A match is fully determined by its manifest — scripts, seed, arena size —
 * because there is no human input once it starts. That is what lets every peer
 * simulate independently and still see the identical match, and what makes a
 * manifest double as a replay file.
 */

import { compile } from "../lang/compiler.js";
import { parse } from "../lang/parser.js";
import type { RoboScriptError } from "../lang/errors.js";
import type { PropRef, Value } from "../lang/bytecode.js";
import { Vm, toNum, toText, type VmHost } from "../lang/vm.js";
import { clamp, cosDeg, normalizeAngle, sinDeg } from "./math.js";
import { Rng } from "./rng.js";
import {
  BULLET,
  FLAT_TERRAIN,
  MAX_HEALTH,
  ROBOT_RADIUS,
  TURRET,
  type Robot,
  type World,
} from "./types.js";

/** One competitor's entry. */
export interface Entry {
  /** RoboScript source. */
  source: string;
  /** Optional override for the on-screen colour, e.g. chosen in the lobby. */
  color?: string;
}

/** Everything needed to reproduce a match exactly. */
export interface MatchManifest {
  entries: Entry[];
  seed: number;
  width: number;
  height: number;
  maxTicks: number;
  /** Bumped whenever simulation behaviour changes, so peers can refuse a mismatch. */
  simVersion: number;
}

/**
 * Bumped whenever simulation behaviour changes, so peers on different builds
 * refuse to share a match rather than silently desyncing.
 *
 * 2 — seeded spawn jitter, so different seeds give genuinely different matches.
 */
export const SIM_VERSION = 2;

/**
 * How far a spawn may vary from its slot on the ring.
 *
 * Without this, spawn position is a pure function of entry index, so for the
 * many robots that never call `random()` every seed produced the identical
 * match — which made "run 100 trials" meaningless and gave the Arena a
 * positional meta. Jitter is drawn from the world RNG, so a given seed is still
 * perfectly reproducible.
 */
const SPAWN_JITTER = {
  /** Fraction of the gap to the next slot; kept below half so slots never swap. */
  angleFraction: 0.34,
  minRadiusScale: 0.78,
  maxRadiusScale: 1,
  /** Degrees either side of "facing the middle". */
  heading: 45,
} as const;

export function makeManifest(
  entries: Entry[],
  opts: Partial<Omit<MatchManifest, "entries">> = {},
): MatchManifest {
  return {
    entries,
    seed: opts.seed ?? 12345,
    width: opts.width ?? 900,
    height: opts.height ?? 620,
    maxTicks: opts.maxTicks ?? 30 * 120, // two minutes
    simVersion: SIM_VERSION,
  };
}

export interface CompileResult {
  ok: boolean;
  error?: RoboScriptError;
}

/** Parse + compile without building a world. Used by the editor for live checking. */
export function checkScript(source: string): CompileResult {
  try {
    compile(parse(source));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err as RoboScriptError };
  }
}

export function createWorld(manifest: MatchManifest): World {
  const rng = new Rng(manifest.seed);
  const world: World = {
    tick: 0,
    width: manifest.width,
    height: manifest.height,
    rng,
    robots: [],
    bullets: [],
    effects: [],
    terrain: FLAT_TERRAIN,
    nextBulletId: 1,
    over: false,
    winnerId: null,
    maxTicks: manifest.maxTicks,
  };

  const n = manifest.entries.length;
  const cx = manifest.width / 2;
  const cy = manifest.height / 2;
  const ringRadius = Math.min(manifest.width, manifest.height) * 0.34;

  const slot = 360 / Math.max(1, n);

  manifest.entries.forEach((entry, index) => {
    const ast = parse(entry.source);
    const program = compile(ast);

    // An even ring so nobody starts with a positional edge, jittered from the
    // seed so that no two matches are the same. Draws happen in entry order,
    // which keeps the whole thing reproducible.
    const spread = slot * SPAWN_JITTER.angleFraction;
    const angle = slot * index + rng.range(-spread, spread);
    const radius =
      ringRadius * rng.range(SPAWN_JITTER.minRadiusScale, SPAWN_JITTER.maxRadiusScale);
    const facing = normalizeAngle(
      angle + 180 + rng.range(-SPAWN_JITTER.heading, SPAWN_JITTER.heading),
    );

    const robot: Robot = {
      id: index,
      name: ast.name,
      declaredName: ast.name,
      color: entry.color ?? ast.color,
      locomotion: ast.locomotion,
      x: cx + cosDeg(angle) * radius,
      y: cy + sinDeg(angle) * radius,
      heading: facing,
      speed: 0,
      turret: facing,
      gunHeat: 0,
      health: MAX_HEALTH,
      alive: true,
      throttle: 0,
      headingMode: "free",
      headingGoal: facing,
      steer: 0,
      turretGoal: facing,
      sweepAmplitude: 0,
      sweepDir: 1,
      kills: 0,
      damageDealt: 0,
      damageTaken: 0,
      shotsFired: 0,
      shotsHit: 0,
      diedAtTick: -1,
      vm: null as unknown as Vm,
      chunk: program,
      scriptError: null,
    };
    robot.vm = new Vm(program, makeHost(world, robot));
    world.robots.push(robot);
  });

  return world;
}

/**
 * The script's entire view of the world. Note what is absent: no way to read
 * another robot's private state except through sense events, and no way to
 * reach anything outside the simulation at all.
 */
function makeHost(world: World, robot: Robot): VmHost {
  return {
    readProp(ref: PropRef): Value {
      if (ref.obj === "me") {
        switch (ref.prop) {
          case "x":
            return robot.x;
          case "y":
            return robot.y;
          case "heading":
            return robot.heading;
          case "speed":
            return robot.speed;
          case "health":
            return robot.health;
          // Reported relative to the chassis, so `me.turret` composes directly
          // with the relative bearings that events hand you.
          case "turret":
            return normalizeAngle(robot.turret - robot.heading);
          case "gunheat":
            return robot.gunHeat;
          case "ammo":
            return robot.gunHeat <= 0 ? 1 : 0;
          case "score":
            return robot.kills;
          default:
            return null;
        }
      }
      if (ref.obj === "arena") {
        switch (ref.prop) {
          case "width":
            return world.width;
          case "height":
            return world.height;
          case "time":
            return world.tick;
          case "robots":
            return world.robots.reduce((acc, r) => acc + (r.alive ? 1 : 0), 0);
          default:
            return null;
        }
      }
      return null;
    },

    doAction(kind: string, args: Value[]): void {
      if (!robot.alive) return;
      const a0 = args.length > 0 ? toNum(args[0]!) : 0;
      switch (kind) {
        case "drive":
          robot.throttle = clamp(a0 / 100, -1, 1);
          return;
        case "stop":
          robot.throttle = 0;
          return;
        case "turnBodyTo":
          robot.headingMode = "goal";
          robot.headingGoal = normalizeAngle(a0);
          return;
        case "turnBodyBy":
          robot.headingMode = "goal";
          robot.headingGoal = normalizeAngle(robot.heading + a0);
          return;
        case "turretTurnTo":
          robot.sweepAmplitude = 0;
          robot.turretGoal = normalizeAngle(a0);
          return;
        case "turretTurnBy":
          robot.sweepAmplitude = 0;
          robot.turretGoal = normalizeAngle(robot.turret + a0);
          return;
        case "turretAim":
          // Bearings from events are relative to the chassis, so aiming is a
          // one-liner: `turret.aim at event.bearing`.
          robot.sweepAmplitude = 0;
          robot.turretGoal = normalizeAngle(robot.heading + a0);
          return;
        case "turretSweep":
          robot.sweepAmplitude = clamp(Math.abs(a0), 0, 180);
          robot.turretGoal = normalizeAngle(robot.heading + robot.sweepAmplitude * robot.sweepDir);
          return;
        case "fire":
          fire(world, robot, a0);
          return;
        default:
          return;
      }
    },

    setName(name: string): void {
      // Cap the label so nobody can push a wall of text across the arena.
      robot.name = name.slice(0, 24);
    },

    random(): number {
      return world.rng.nextFloat();
    },

    randomInt(min: number, max: number): number {
      return world.rng.int(min, max);
    },
  };
}

/** Fire the turret, if it has cooled. */
export function fire(world: World, robot: Robot, powerRaw: number): void {
  if (robot.gunHeat > 0 || !robot.alive) return;
  const power = clamp(Math.round(powerRaw) || TURRET.minPower, TURRET.minPower, TURRET.maxPower);
  const speed = BULLET.baseSpeed - BULLET.speedPerPower * power;
  const muzzle = ROBOT_RADIUS + BULLET.radius + 1;

  world.bullets.push({
    id: world.nextBulletId++,
    ownerId: robot.id,
    x: robot.x + cosDeg(robot.turret) * muzzle,
    y: robot.y + sinDeg(robot.turret) * muzzle,
    heading: robot.turret,
    speed,
    power,
    alive: true,
  });

  robot.gunHeat = TURRET.heatPerPower * power;
  robot.shotsFired++;
  world.effects.push({
    type: "muzzle",
    x: robot.x + cosDeg(robot.turret) * muzzle,
    y: robot.y + sinDeg(robot.turret) * muzzle,
    heading: robot.turret,
    tick: world.tick,
  });
  // `bullet hit` / `bullet missed` are raised later, by the bullet's own fate
  // in step.ts — not here, because at this point we don't know which it is.
}

export { toText };
