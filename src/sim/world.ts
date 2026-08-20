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
import {
  angleDelta,
  atan2Deg,
  clamp,
  closestPointOnSegment,
  cosDeg,
  hypot,
  normalizeAngle,
  raySegmentDistance,
  sinDeg,
} from "./math.js";
import { Rng } from "./rng.js";
import { beamReach, FLAT_TERRAIN, makeTerrain, slopeAt, uphillAt } from "./terrain.js";
import {
  BULLET,
  clampFuelConfig,
  clampTerrainConfig,
  clampWalls,
  FUEL,
  FUEL_PRESETS,
  MAX_FUEL,
  MAX_HEALTH,
  RADAR,
  ROBOT_RADIUS,
  TERRAIN_PRESETS,
  TURRET,
  WALL,
  type FuelCell,
  type FuelConfig,
  type Robot,
  type TerrainConfig,
  type Wall,
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
  /** How much fuel the arena hands out. Part of the manifest so replays agree. */
  fuel: FuelConfig;
  /** The shape of the ground. Four numbers, from which every peer draws the same map. */
  terrain: TerrainConfig;
  /**
   * The authored half of the map: segments somebody placed. Optional so every
   * manifest saved before walls existed — including every stored `BattleRecord`
   * — still replays, as the wall-free match it was.
   */
  walls?: Wall[];
  /** Bumped whenever simulation behaviour changes, so peers can refuse a mismatch. */
  simVersion: number;
}

/**
 * Bumped whenever simulation behaviour changes, so peers on different builds
 * refuse to share a match rather than silently desyncing.
 *
 * 2 — seeded spawn jitter, so different seeds give genuinely different matches.
 * 5 — fuel: a consumable resource, spawned pickups, and two new sense events.
 * 6 — committed shots: `fire` waits for the gun to come round, so a handler can
 *     aim and shoot at the same place and leading a target becomes possible.
 * 7 — terrain: the ground has a gradient, which changes what movement costs and
 *     how fast it happens. Ships switched off, but the manifest shape changed,
 *     so an older peer must refuse the match rather than guess at a flat map.
 * 8 — line of sight: the radar beam is stopped by ground higher than the robot
 *     standing on it, and `ping` gained a power that buys the height to see
 *     over more of it. Flat ground blocks nothing, so a match without terrain
 *     is unaffected \u2014 but what the beam finds is now a function of the map.
 * 9 \u2014 walls: hand-placed segments that block motion. They do not stop bullets
 *     and do not stop the radar beam, but they are reported by `sense wall` and
 *     `ping wall`, and fuel now avoids spawning inside one \u2014 which moves the
 *     RNG stream, so an older peer must refuse the match rather than drift.
 */
export const SIM_VERSION = 9;

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
    fuel: opts.fuel ?? FUEL_PRESETS.arena,
    // Off by default. Terrain changes every balance number in the game, so it
    // is something a host turns on, never something that arrives unannounced.
    terrain: opts.terrain ?? TERRAIN_PRESETS.off,
    // Empty by default for the same reason terrain is off by default: a match
    // gains walls because a host asked for them, never by surprise.
    walls: opts.walls ?? [],
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
  // Note what this does NOT do: draw from `rng`. The map is hashed out of its
  // own seed, so adding terrain left every existing spawn position untouched.
  const terrainConfig = clampTerrainConfig(manifest.terrain ?? TERRAIN_PRESETS.off);
  const world: World = {
    tick: 0,
    width: manifest.width,
    height: manifest.height,
    rng,
    robots: [],
    bullets: [],
    fuel: [],
    effects: [],
    terrain: terrainConfig.enabled
      ? makeTerrain(terrainConfig, manifest.width, manifest.height)
      : FLAT_TERRAIN,
    nextBulletId: 1,
    nextFuelId: 1,
    // Clamped on the way in: a manifest is input from a remote host, not fact.
    fuelConfig: clampFuelConfig(manifest.fuel ?? FUEL_PRESETS.arena),
    terrainConfig,
    // Clamped for the same reason as the two configs above, plus one of its
    // own: an unbounded wall list would let one peer decide how much work every
    // other peer does per tick.
    walls: clampWalls(manifest.walls),
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
      pendingPower: 0,
      health: MAX_HEALTH,
      fuel: MAX_FUEL,
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
      climb: 0,
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

  // Spawns are drawn on a ring without any knowledge of the walls, so on a
  // hand-drawn map somebody can land half-inside one. Nudging afterwards rather
  // than rejecting-and-redrawing is deliberate: it touches no RNG, so every
  // existing seed keeps the exact spawn positions it had on a wall-free arena,
  // and only a match that actually has walls is affected at all.
  for (const robot of world.robots) {
    pushOutOfWalls(world, robot);
  }

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
          case "fuel":
            return robot.fuel;
          case "aiming":
            // 1 while a committed shot is waiting for the gun to come round.
            // Re-aiming now would move the goal and delay it further, so this
            // is how a script says "leave the gun alone, it is busy".
            return robot.pendingPower > 0 ? 1 : 0;
          // Terrain reads are free: you can feel the ground you are standing on
          // without spending anything to find out. Flat when terrain is off, so
          // a script written for hills is harmless on a flat map.
          case "slope":
            return slopeAt(world.terrain, robot.x, robot.y);
          case "uphill":
            return normalizeAngle(uphillAt(world.terrain, robot.x, robot.y) - robot.heading);
          // The easy way, which is simply the hard way reversed. Given a name of
          // its own because a script that wants out of trouble should not have
          // to know that adding 180 is how you turn around.
          case "downhill":
            return normalizeAngle(
              uphillAt(world.terrain, robot.x, robot.y) + 180 - robot.heading,
            );
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
          ping(world, robot, a0);
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

/**
 * Charge a robot for actuated work. Clamped at zero, because the floor is a
 * brownout rather than a debt — there is nothing below empty.
 */
export function spendFuel(world: World, robot: Robot, amount: number): void {
  if (!world.fuelConfig.enabled || amount <= 0) return;
  robot.fuel = Math.max(0, robot.fuel - amount);
}

/**
 * How much of its capability a robot currently has, from its tank.
 *
 * The penalty grows with the *square* of how empty the tank is, so it is barely
 * there until the tank actually gets low and then bites hard: a robot at three
 * quarters keeps 94% of itself, at half 78%, at a quarter 49%, and at empty the
 * floor. Under a straight line, half a tank cost 45% of a robot's capability,
 * which punished a robot for the ordinary state of not having topped up
 * recently. Running low should be an emergency; running down should not.
 *
 * Written as a plain multiplication rather than a logarithm on purpose.
 * `Math.log` is not required to be correctly rounded, so it varies between
 * engines and would desync peers — `tests/determinism/determinism.test.ts` bans
 * it outright. `+ - *` are exact under IEEE 754, and a squared term traces the
 * same "flat, then falling away" shape a decay curve would.
 *
 * Exactly 1 when the mechanic is off, so a match without fuel is the match the
 * game had before fuel existed rather than one quietly scaled by a full tank.
 */
export function fuelFactor(world: World, robot: Robot): number {
  if (!world.fuelConfig.enabled) return 1;
  const empty = 1 - clamp(robot.fuel / MAX_FUEL, 0, 1);
  return 1 - (1 - FUEL.floorFactor) * empty * empty;
}

/**
 * Ask for a shot.
 *
 * The shot is *committed*, not discharged: if the gun already bears on what it
 * was last aimed at, it leaves immediately, and otherwise it waits for the
 * turret to come round and leaves the moment it does. That is what makes
 * `turret.aim at <somewhere> ... fire` mean one thing rather than two, and it
 * is what makes leading a moving target possible — a script has to predict
 * where the target will be after the slew *and* after the flight.
 *
 * A gun that is still cooling ignores the request outright, exactly as before,
 * so spamming `fire` costs nothing.
 */
export function fire(world: World, robot: Robot, powerRaw: number): void {
  if (robot.gunHeat > 0 || !robot.alive) return;
  const power = clamp(Math.round(powerRaw) || TURRET.minPower, TURRET.minPower, TURRET.maxPower);
  if (gunBears(robot)) {
    releaseShot(world, robot, power);
    return;
  }
  robot.pendingPower = power;
}

/**
 * Whether the gun is pointing where it was told to.
 *
 * A sweeping turret has no aim to wait for — its goal is a moving target of its
 * own making — so a sweep-and-shoot robot fires the instant it asks to, the way
 * it always did.
 */
export function gunBears(robot: Robot): boolean {
  if (robot.sweepAmplitude > 0) return true;
  return Math.abs(angleDelta(robot.turret, robot.turretGoal)) <= TURRET.fireTolerance;
}

/** Discharge a committed shot along the barrel. */
export function releaseShot(world: World, robot: Robot, powerRaw: number): void {
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
  spendFuel(world, robot, FUEL.fire * power);
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
 * What it reports is ranked by what a script most needs to know: a robot
 * first, then a fuel cell, and otherwise the wall it reaches
 * — so in an arena this size a ping is almost never silent: pointing it at
 * empty space still tells you how much room is in that direction. It says
 * nothing at all only when even the wall is out of reach.
 */
export function ping(world: World, robot: Robot, powerRaw: number = RADAR.minPower): void {
  if (!robot.alive || robot.pingHeat > 0) return;
  robot.pingHeat = RADAR.cooldown;
  const power = clamp(Math.round(powerRaw) || RADAR.minPower, RADAR.minPower, RADAR.maxPower);
  spendFuel(world, robot, FUEL.ping * power);

  // Two different questions, and this is the one place in the simulation where
  // the two kinds of wall genuinely differ.
  //
  // `wallDist` is what to REPORT: the nearest wall of either kind, because a
  // script asking "how much room is that way" means any wall.
  //
  // `boundaryDist` is what STOPS the beam. A placed wall does not — the beam
  // carries straight over it and can find a robot on the other side. That is a
  // deliberate choice about scope: walls block motion and nothing else, so
  // adding them retunes no combat number. It also means a labyrinth is a place
  // you can see across but not drive across, which is the interesting shape for
  // it to have.
  const wallDist = distanceToWall(world, robot.x, robot.y, robot.radar);
  const boundaryDist = distanceToBoundary(world, robot.x, robot.y, robot.radar);

  /**
   * How far this beam actually gets.
   *
   * Ground higher than the robot standing on it stops the beam dead, so where
   * you are standing decides what you can know. On the top of the highest hill
   * this is the full range in every direction; on a valley floor it is a box,
   * and pointed straight uphill it is almost nothing. A harder ping sees over
   * proportionally higher ground, which is the way out of a hole.
   *
   * With terrain off the field is level everywhere, so nothing is ever higher
   * than the observer and this is always the full range. No branch needed.
   */
  const sight = beamReach(
    world.terrain,
    robot.x,
    robot.y,
    robot.radar,
    RADAR.range,
    RADAR.eyeHeight * power,
  );
  const reach = Math.min(RADAR.range, boundaryDist, sight);
  /** True when the ground, rather than distance or the boundary, stopped it. */
  const blocked = sight < RADAR.range && sight < boundaryDist;

  let best: Robot | null = null;
  let bestDist = Infinity;
  for (const other of world.robots) {
    if (other.id === robot.id || !other.alive) continue;
    const dx = other.x - robot.x;
    const dy = other.y - robot.y;
    const dist = hypot(dx, dy);
    if (dist > reach || dist >= bestDist) continue;
    const offBeam = angleDelta(robot.radar, atan2Deg(dy, dx));
    if (offBeam < -RADAR.halfAngle || offBeam > RADAR.halfAngle) continue;
    best = other;
    bestDist = dist;
  }

  // Only looked for when the beam found no robot: a robot is always the more
  // urgent fact, and reporting both would need a second event anyway.
  let cell: FuelCell | null = null;
  let cellDist = Infinity;
  if (!best && world.fuelConfig.enabled) {
    for (const f of world.fuel) {
      const dx = f.x - robot.x;
      const dy = f.y - robot.y;
      const dist = hypot(dx, dy);
      if (dist > reach || dist >= cellDist) continue;
      const offBeam = angleDelta(robot.radar, atan2Deg(dy, dx));
      if (offBeam < -RADAR.halfAngle || offBeam > RADAR.halfAngle) continue;
      cell = f;
      cellDist = dist;
    }
  }

  world.effects.push({
    type: "ping",
    x: robot.x,
    y: robot.y,
    heading: robot.radar,
    tick: world.tick,
    // Whatever stopped it first, so the drawn wedge ends where the beam really
    // ended -- at a contact, at a wall, or against a ridge.
    range: Math.min(reach, best ? bestDist : cell ? cellDist : Infinity),
  });

  // Terrain is reported alongside whatever else the beam found, rather than
  // taking a place in the precedence chain below. It has to be: the ground is
  // everywhere, so it would either always win or never be reached. One ping,
  // one cost, two facts — a sweep that returns both the contact and the shape
  // of the ground between here and there is the honest reading of a radar.
  if (world.terrainConfig.enabled && robot.vm.handles("ping slope")) {
    const tx = robot.x + cosDeg(robot.radar) * reach;
    const ty = robot.y + sinDeg(robot.radar) * reach;
    const there = world.terrain.heightAt(tx, ty);
    robot.vm.enqueue("ping slope", {
      bearing: angleDelta(robot.heading, robot.radar),
      distance: reach,
      rise: (there - world.terrain.heightAt(robot.x, robot.y)) * 100,
      height: there * 100,
    });
  }

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

  if (cell) {
    robot.vm.enqueue("ping fuel", {
      bearing: angleDelta(robot.heading, atan2Deg(cell.y - robot.y, cell.x - robot.x)),
      distance: cellDist,
      amount: cell.amount,
      x: cell.x,
      y: cell.y,
    });
    return;
  }

  // Before the wall, because the wall is behind it and cannot have been seen.
  // This is also what keeps a blocked beam from reporting nothing at all: a
  // robot that aimed its radar and then heard silence would go on pinging the
  // same ridge forever, which is exactly how a robot locks up.
  if (blocked) {
    const tx = robot.x + cosDeg(robot.radar) * reach;
    const ty = robot.y + sinDeg(robot.radar) * reach;
    const there = world.terrain.heightAt(tx, ty);
    robot.vm.enqueue("ping ridge", {
      bearing: angleDelta(robot.heading, robot.radar),
      distance: reach,
      rise: (there - world.terrain.heightAt(robot.x, robot.y)) * 100,
      height: there * 100,
    });
    return;
  }

  if (wallDist <= reach) {
    robot.vm.enqueue("ping wall", {
      bearing: angleDelta(robot.heading, robot.radar),
      distance: wallDist,
    });
  }
}

/**
 * Distance from a point to the arena BOUNDARY along a heading.
 *
 * The four outer sides only. Separate from `distanceToWall` because the
 * boundary and a placed wall differ in exactly one way — the boundary stops the
 * radar beam and a placed wall does not — and `ping` needs the boundary alone
 * to work out how far its beam gets.
 *
 * Measured from the hull rather than from the centre.
 */
export function distanceToBoundary(world: World, x: number, y: number, heading: number): number {
  const dx = cosDeg(heading);
  const dy = sinDeg(heading);
  let best = Infinity;
  if (dx > 1e-9) best = Math.min(best, (world.width - x) / dx);
  if (dx < -1e-9) best = Math.min(best, -x / dx);
  if (dy > 1e-9) best = Math.min(best, (world.height - y) / dy);
  if (dy < -1e-9) best = Math.min(best, -y / dy);
  return best === Infinity ? Infinity : Math.max(0, best - ROBOT_RADIUS);
}

/**
 * Distance to the nearest wall of EITHER kind along a heading — the boundary,
 * or a segment somebody placed.
 *
 * This is what the language means by "wall". A script has no way to ask which
 * kind it found and no reason to want one: both stop you dead, and `on sense
 * wall` written against the boundary works unchanged inside a labyrinth. That
 * is the whole reason walls were built as segments rather than as a new
 * obstacle with its own events.
 *
 * Shared with the sense cone in `step.ts` — a wall reported at two different
 * distances by the cone and the radar would be a bug nobody could explain.
 */
export function distanceToWall(world: World, x: number, y: number, heading: number): number {
  let best = distanceToBoundary(world, x, y, heading);
  if (world.walls.length === 0) return best;

  const dx = cosDeg(heading);
  const dy = sinDeg(heading);
  // Array order, and a plain minimum, so the result cannot depend on how the
  // list was iterated.
  for (const w of world.walls) {
    const t = raySegmentDistance(x, y, dx, dy, w.x1, w.y1, w.x2, w.y2);
    if (t === null) continue;
    // Hull-relative like the boundary case, and pulled in by the wall's own
    // half-thickness, so "distance 0" means touching rather than overlapping.
    const d = t - ROBOT_RADIUS - WALL.halfThickness;
    if (d < best) best = d < 0 ? 0 : d;
  }
  return best;
}

/**
 * Push a robot clear of every wall it is inside, in place.
 *
 * Returns the normal of the last wall it had to be pushed off, or null if it
 * was already clear. Used both at spawn and every tick from `step.ts`, so a
 * robot arriving inside a wall and a robot driving into one are resolved by the
 * identical code.
 *
 * Walls are visited in array order and each push is applied immediately, so
 * with two overlapping walls the outcome depends on their order in the list —
 * which is fixed by the manifest and therefore the same on every peer. An
 * order-independent solve would be nicer and is not worth the machinery.
 */
export function pushOutOfWalls(world: World, robot: Robot): { normal: number } | null {
  if (world.walls.length === 0) return null;
  const reach = ROBOT_RADIUS + WALL.halfThickness;
  const reachSq = reach * reach;
  let hit: { normal: number } | null = null;

  for (const w of world.walls) {
    const [nx, ny, distSq] = closestPointOnSegment(robot.x, robot.y, w.x1, w.y1, w.x2, w.y2);
    if (distSq >= reachSq) continue;

    let ex = robot.x - nx;
    let ey = robot.y - ny;
    let len = hypot(ex, ey);
    if (len < 1e-9) {
      // Dead centre on the wall's own line: there is no direction "out", so the
      // normal is undefined and normalising it would give NaN. Fall back to the
      // wall's own perpendicular, which is the direction it would have been in
      // a moment earlier or later.
      ex = -(w.y2 - w.y1);
      ey = w.x2 - w.x1;
      len = hypot(ex, ey);
      if (len < 1e-9) continue;
    }
    robot.x = nx + (ex / len) * reach;
    robot.y = ny + (ey / len) * reach;
    hit = { normal: atan2Deg(ey / len, ex / len) };
  }
  return hit;
}

export { toText };
