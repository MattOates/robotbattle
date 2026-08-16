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
import { angleDelta, atan2Deg, clamp, cosDeg, hypot, normalizeAngle, sinDeg } from "./math.js";
import { Rng } from "./rng.js";
import {
  BULLET,
  FLAT_TERRAIN,
  MAX_HEALTH,
  RADAR,
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
export const SIM_VERSION = 4;

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
    const radius = ringRadius * rng.range(SPAWN_JITTER.minRadiusScale, SPAWN_JITTER.maxRadiusScale);
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
      radar: facing,
      pingHeat: 0,
      health: MAX_HEALTH,
      alive: true,
      throttle: 0,
      headingMode: "free",
      headingGoal: facing,
      steer: 0,
      turretGoal: facing,
      sweepAmplitude: 0,
      sweepDir: 1,
      radarGoal: facing,
      radarSweepAmplitude: 0,
      radarSweepDir: 1,
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
          case "radar":
            // Relative to the chassis, exactly like the turret: a bearing you
            // can hand straight back to `radar.aim at`.
            return normalizeAngle(robot.radar - robot.heading);
          case "pingheat":
            return robot.pingHeat;
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
        case "radarTurnTo":
          robot.radarSweepAmplitude = 0;
          robot.radarGoal = normalizeAngle(a0);
          return;
        case "radarTurnBy":
          robot.radarSweepAmplitude = 0;
          robot.radarGoal = normalizeAngle(robot.radar + a0);
          return;
        case "radarAim":
          robot.radarSweepAmplitude = 0;
          robot.radarGoal = normalizeAngle(robot.heading + a0);
          return;
        case "radarSweep":
          robot.radarSweepAmplitude = clamp(Math.abs(a0), 0, 180);
          robot.radarGoal = normalizeAngle(
            robot.heading + robot.radarSweepAmplitude * robot.radarSweepDir,
          );
          return;
        case "ping":
          ping(world, robot);
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

/**
 * Send the radar beam.
 *
 * Deliberately immediate rather than a travelling pulse: a ping is a question a
 * script asks *now*, and an answer that arrived several ticks later would be
 * about where a robot used to be. The narrowness is what it pays for the reach
 * — a beam a fifth as wide as the cone will miss a robot that a cone would
 * catch, so a script has to point it somewhere for a reason.
 *
 * The beam reports the nearest robot in it, and otherwise the wall it reaches
 * — so in an arena this size a ping is almost never silent: pointing it at
 * empty space still tells you how much room is in that direction. It says
 * nothing at all only when even the wall is out of reach.
 */
export function ping(world: World, robot: Robot): void {
  if (!robot.alive || robot.pingHeat > 0) return;
  robot.pingHeat = RADAR.cooldown;

  let best: Robot | null = null;
  let bestDist = Infinity;
  for (const other of world.robots) {
    if (other.id === robot.id || !other.alive) continue;
    const dx = other.x - robot.x;
    const dy = other.y - robot.y;
    const dist = hypot(dx, dy);
    if (dist > RADAR.range || dist >= bestDist) continue;
    const offBeam = angleDelta(robot.radar, atan2Deg(dy, dx));
    if (offBeam < -RADAR.halfAngle || offBeam > RADAR.halfAngle) continue;
    best = other;
    bestDist = dist;
  }

  const wallDist = distanceToWall(world, robot.x, robot.y, robot.radar);

  world.effects.push({
    type: "ping",
    x: robot.x,
    y: robot.y,
    heading: robot.radar,
    tick: world.tick,
    range: Math.min(RADAR.range, best ? bestDist : wallDist),
  });

  if (best) {
    robot.vm.enqueue("ping robot", {
      // Bearings are relative to the chassis everywhere in this language, so a
      // ping return drops straight into `turn body by` or `turret.aim at`.
      bearing: angleDelta(robot.heading, atan2Deg(best.y - robot.y, best.x - robot.x)),
      distance: bestDist,
      heading: best.heading,
      speed: best.speed,
      health: best.health,
      name: best.name,
      x: best.x,
      y: best.y,
    });
    return;
  }

  if (wallDist <= RADAR.range) {
    robot.vm.enqueue("ping wall", {
      bearing: angleDelta(robot.heading, robot.radar),
      distance: wallDist,
    });
  }
}

/**
 * Distance from a point to the arena boundary along a heading.
 *
 * Measured from the hull rather than from the centre, and shared with the sense
 * cone in `step.ts` — a wall reported at two different distances by the cone
 * and the radar would be a bug nobody could explain.
 */
export function distanceToWall(world: World, x: number, y: number, heading: number): number {
  const dx = cosDeg(heading);
  const dy = sinDeg(heading);
  let best = Infinity;
  if (dx > 1e-9) best = Math.min(best, (world.width - x) / dx);
  if (dx < -1e-9) best = Math.min(best, -x / dx);
  if (dy > 1e-9) best = Math.min(best, (world.height - y) / dy);
  if (dy < -1e-9) best = Math.min(best, -y / dy);
  return best === Infinity ? Infinity : Math.max(0, best - ROBOT_RADIUS);
}

export { toText };
