/**
 * The tick.
 *
 * The order of the phases below is part of the simulation contract: change it
 * and every peer must change it together, or matches desync. Sensing happens
 * before scripts run so that a script always acts on the state it was told
 * about, and physics happens after so that an action taken this tick has effect
 * this tick.
 *
 * Robots are always visited in id order. Never iterate a Set or Map here.
 */

import {
  FUEL_PER_TICK,
  ROBOT_RADIUS,
  SENSE,
  RADAR,
  TURRET,
  BULLET,
  DT,
  MAX_HEALTH,
} from "./types.js";
import { distanceToWall } from "./world.js";
import type { Bullet, Robot, World } from "./types.js";
import {
  angleDelta,
  atan2Deg,
  clamp,
  cosDeg,
  hypot,
  moveToward,
  normalizeAngle,
  sinDeg,
  turnToward,
} from "./math.js";
import { specFor, steerForHeadingError, steeredAngularVelocity } from "./chassis.js";

export function step(world: World): void {
  if (world.over) return;

  // Effects are per-tick and consumed by the renderer.
  world.effects = [];

  if (world.tick === 0) {
    for (const r of world.robots) r.vm.enqueue("start", {});
  }

  senseAll(world);
  enqueueTicks(world);
  runScripts(world);
  moveRobots(world);
  resolveRobotCollisions(world);
  moveBullets(world);
  coolGuns(world);
  checkEnd(world);

  world.tick++;
}

// ---- phase: sensing ------------------------------------------------------

/**
 * The sense cone is rigidly attached to the chassis heading and identical on
 * both locomotion types. We report only the NEAREST thing of each kind per
 * tick: a robot surrounded by five others should get the most urgent fact, not
 * five events that overflow its queue.
 */
function senseAll(world: World): void {
  for (const r of world.robots) {
    if (!r.alive) continue;

    // --- nearest robot in cone ---
    if (r.vm.handles("sense robot") && !r.vm.hasQueued("sense robot")) {
      let best: Robot | null = null;
      let bestDist = Infinity;
      for (const other of world.robots) {
        if (other.id === r.id || !other.alive) continue;
        const dx = other.x - r.x;
        const dy = other.y - r.y;
        const dist = hypot(dx, dy);
        if (dist > SENSE.range || dist >= bestDist) continue;
        const bearing = angleDelta(r.heading, atan2Deg(dy, dx));
        if (bearing < -SENSE.halfAngle || bearing > SENSE.halfAngle) continue;
        best = other;
        bestDist = dist;
      }
      if (best) {
        r.vm.enqueue("sense robot", {
          bearing: angleDelta(r.heading, atan2Deg(best.y - r.y, best.x - r.x)),
          distance: bestDist,
          heading: best.heading,
          speed: best.speed,
          health: best.health,
          name: best.name,
          x: best.x,
          y: best.y,
        });
      }
    }

    // --- nearest incoming bullet in cone ---
    if (r.vm.handles("sense bullet") && !r.vm.hasQueued("sense bullet")) {
      let best: Bullet | null = null;
      let bestDist = Infinity;
      for (const b of world.bullets) {
        if (!b.alive || b.ownerId === r.id) continue;
        const dx = b.x - r.x;
        const dy = b.y - r.y;
        const dist = hypot(dx, dy);
        if (dist > SENSE.range || dist >= bestDist) continue;
        const bearing = angleDelta(r.heading, atan2Deg(dy, dx));
        if (bearing < -SENSE.halfAngle || bearing > SENSE.halfAngle) continue;
        best = b;
        bestDist = dist;
      }
      if (best) {
        r.vm.enqueue("sense bullet", {
          bearing: angleDelta(r.heading, atan2Deg(best.y - r.y, best.x - r.x)),
          distance: bestDist,
          heading: best.heading,
          speed: best.speed,
          power: best.power,
          x: best.x,
          y: best.y,
        });
      }
    }

    // --- wall straight ahead ---
    if (r.vm.handles("sense wall") && !r.vm.hasQueued("sense wall")) {
      const dist = distanceToWall(world, r.x, r.y, r.heading);
      if (dist <= SENSE.range) {
        r.vm.enqueue("sense wall", { bearing: 0, distance: dist });
      }
    }
  }
}

// ---- phase: scripts ------------------------------------------------------

function enqueueTicks(world: World): void {
  for (const r of world.robots) {
    if (!r.alive) continue;
    // Only queue a tick if the previous one has been dealt with, so a slow
    // handler can never build an unbounded backlog.
    if (r.vm.handles("tick") && !r.vm.hasQueued("tick")) {
      r.vm.enqueue("tick", {});
    }
  }
}

function runScripts(world: World): void {
  for (const r of world.robots) {
    if (!r.alive) continue;
    r.vm.run(FUEL_PER_TICK);
    if (r.vm.lastError) r.scriptError = r.vm.lastError;
  }
}

// ---- phase: robot motion -------------------------------------------------

function moveRobots(world: World): void {
  for (const r of world.robots) {
    if (!r.alive) continue;
    const spec = specFor(r.locomotion);

    // Terrain currently returns 1 everywhere; milestone 4 makes this hills or
    // viscosity depending on the theme.
    const terrainFactor = world.terrain.speedAt(r.x, r.y);
    const maxSpeed = spec.maxSpeed * terrainFactor;

    // --- longitudinal: accelerate toward the throttle target ---
    const targetSpeed = r.throttle * maxSpeed;
    // Slowing down (or reversing direction) uses the stronger braking rate.
    const closingToZero = Math.abs(targetSpeed) < Math.abs(r.speed) || targetSpeed * r.speed < 0;
    const rate = (closingToZero ? spec.braking : spec.acceleration) * DT;
    r.speed = moveToward(r.speed, targetSpeed, rate);

    // --- rotation ---
    if (r.locomotion === "skid") {
      // Skid steer turns at a fixed rate regardless of speed, and can pivot on
      // the spot. This is the slow-but-agile half of the trade.
      if (r.headingMode === "goal") {
        r.heading = turnToward(r.heading, r.headingGoal, spec.turnRate * DT);
      }
      r.steer = 0;
    } else {
      // Steered locomotion can only rotate while moving, and only as tightly as
      // its steering lock allows — the turning circle is emergent, not a rule.
      if (r.headingMode === "goal") {
        r.steer = steerForHeadingError(spec, angleDelta(r.heading, r.headingGoal));
      } else {
        r.steer = moveToward(r.steer, 0, spec.maxSteer * 2 * DT);
      }
      const omega = steeredAngularVelocity(spec, r.speed, r.steer);
      r.heading = normalizeAngle(r.heading + omega * DT);
    }

    // --- turret, independent of the chassis ---
    updateTurret(r);

    // --- translate ---
    r.x += cosDeg(r.heading) * r.speed * DT;
    r.y += sinDeg(r.heading) * r.speed * DT;

    // --- walls ---
    const hitWall = clampToArena(world, r);
    if (hitWall) {
      // A scrape costs a little health and kills momentum, which discourages
      // hiding in a corner without being punishing.
      r.health = Math.max(0, r.health - 0.4);
      r.speed = 0;
      r.vm.enqueue("hit wall", {
        bearing: angleDelta(r.heading, hitWall.normal + 180),
        distance: 0,
      });
      world.effects.push({
        type: "wallHit",
        x: r.x,
        y: r.y,
        heading: hitWall.normal,
        tick: world.tick,
      });
      if (r.health <= 0) killRobot(world, r, null);
    }
  }
}

/**
 * Turret slew. The turret carries an absolute heading, so it stays pointed at
 * the world while the chassis turns underneath it — which is exactly what makes
 * `turret.aim at event.bearing` behave the way a beginner expects.
 */
function updateTurret(r: Robot): void {
  if (r.sweepAmplitude > 0) {
    // Sweeping oscillates around the CURRENT chassis heading, so the search
    // pattern follows the robot as it drives.
    const goal = normalizeAngle(r.heading + r.sweepAmplitude * r.sweepDir);
    if (Math.abs(angleDelta(r.turret, goal)) < 2) {
      r.sweepDir = -r.sweepDir;
      r.turretGoal = normalizeAngle(r.heading + r.sweepAmplitude * r.sweepDir);
    } else {
      r.turretGoal = goal;
    }
  }
  r.turret = turnToward(r.turret, r.turretGoal, TURRET.slewRate * DT);

  // The radar slews on exactly the same rules as the turret, on its own goal:
  // one more thing pointing where it was told, independent of both the body
  // and the gun.
  if (r.radarSweepAmplitude > 0) {
    const goal = normalizeAngle(r.heading + r.radarSweepAmplitude * r.radarSweepDir);
    if (Math.abs(angleDelta(r.radar, goal)) < 2) {
      r.radarSweepDir = -r.radarSweepDir;
      r.radarGoal = normalizeAngle(r.heading + r.radarSweepAmplitude * r.radarSweepDir);
    } else {
      r.radarGoal = goal;
    }
  }
  r.radar = turnToward(r.radar, r.radarGoal, RADAR.slewRate * DT);
}

interface WallHit {
  normal: number;
}

/** Keep a robot inside the arena; returns the wall it touched, if any. */
function clampToArena(world: World, r: Robot): WallHit | null {
  let hit: WallHit | null = null;
  if (r.x < ROBOT_RADIUS) {
    r.x = ROBOT_RADIUS;
    hit = { normal: 0 };
  } else if (r.x > world.width - ROBOT_RADIUS) {
    r.x = world.width - ROBOT_RADIUS;
    hit = { normal: 180 };
  }
  if (r.y < ROBOT_RADIUS) {
    r.y = ROBOT_RADIUS;
    hit = { normal: 90 };
  } else if (r.y > world.height - ROBOT_RADIUS) {
    r.y = world.height - ROBOT_RADIUS;
    hit = { normal: -90 };
  }
  return hit;
}

/**
 * Robots are solid. Overlaps are resolved by pushing both apart equally, which
 * is symmetric and so does not depend on iteration order for its outcome.
 */
function resolveRobotCollisions(world: World): void {
  const robots = world.robots;
  for (let i = 0; i < robots.length; i++) {
    const a = robots[i]!;
    if (!a.alive) continue;
    for (let j = i + 1; j < robots.length; j++) {
      const b = robots[j]!;
      if (!b.alive) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = hypot(dx, dy);
      const minDist = ROBOT_RADIUS * 2;
      if (dist >= minDist) continue;

      // Exactly coincident robots have no separation axis; nudge along x.
      const nx = dist > 1e-9 ? dx / dist : 1;
      const ny = dist > 1e-9 ? dy / dist : 0;
      const overlap = (minDist - dist) / 2;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;

      a.speed = 0;
      b.speed = 0;
      a.health = Math.max(0, a.health - 0.5);
      b.health = Math.max(0, b.health - 0.5);

      const bearingAtoB = atan2Deg(dy, dx);
      a.vm.enqueue("hit robot", {
        bearing: angleDelta(a.heading, bearingAtoB),
        distance: dist,
        name: b.name,
        health: b.health,
        x: b.x,
        y: b.y,
      });
      b.vm.enqueue("hit robot", {
        bearing: angleDelta(b.heading, normalizeAngle(bearingAtoB + 180)),
        distance: dist,
        name: a.name,
        health: a.health,
        x: a.x,
        y: a.y,
      });

      if (a.health <= 0) killRobot(world, a, null);
      if (b.health <= 0) killRobot(world, b, null);
    }
  }
}

// ---- phase: bullets ------------------------------------------------------

function moveBullets(world: World): void {
  for (const b of world.bullets) {
    if (!b.alive) continue;
    const x0 = b.x;
    const y0 = b.y;
    b.x += cosDeg(b.heading) * b.speed * DT;
    b.y += sinDeg(b.heading) * b.speed * DT;

    // Swept test: a fast bullet moves ~15px per tick against an 18px radius, so
    // a naive endpoint check would occasionally tunnel through a target.
    let hitRobot: Robot | null = null;
    let hitT = Infinity;
    for (const r of world.robots) {
      if (!r.alive || r.id === b.ownerId) continue;
      const t = segmentCircleHit(x0, y0, b.x, b.y, r.x, r.y, ROBOT_RADIUS);
      if (t !== null && t < hitT) {
        hitT = t;
        hitRobot = r;
      }
    }

    if (hitRobot) {
      b.alive = false;
      const damage = BULLET.damagePerPower * b.power;
      hitRobot.health = clamp(hitRobot.health - damage, 0, MAX_HEALTH);
      hitRobot.damageTaken += damage;
      const shooter = world.robots[b.ownerId];
      if (shooter) {
        shooter.damageDealt += damage;
        shooter.shotsHit++;
      }

      const impactX = x0 + (b.x - x0) * hitT;
      const impactY = y0 + (b.y - y0) * hitT;
      world.effects.push({
        type: "impact",
        x: impactX,
        y: impactY,
        heading: b.heading,
        tick: world.tick,
      });

      hitRobot.vm.enqueue("hit by bullet", {
        // Where the shot came FROM, so `turn body by event.bearing + 90` does
        // the obvious evasive thing.
        bearing: angleDelta(hitRobot.heading, normalizeAngle(b.heading + 180)),
        distance: 0,
        power: b.power,
        health: hitRobot.health,
        x: impactX,
        y: impactY,
      });

      if (shooter && shooter.alive) {
        shooter.vm.enqueue("bullet hit", {
          bearing: angleDelta(
            shooter.heading,
            atan2Deg(hitRobot.y - shooter.y, hitRobot.x - shooter.x),
          ),
          distance: hypot(hitRobot.x - shooter.x, hitRobot.y - shooter.y),
          name: hitRobot.name,
          health: hitRobot.health,
          power: b.power,
          x: hitRobot.x,
          y: hitRobot.y,
        });
      }

      if (hitRobot.health <= 0) killRobot(world, hitRobot, shooter ?? null);
      continue;
    }

    // Off the edge of the arena.
    if (b.x < 0 || b.y < 0 || b.x > world.width || b.y > world.height) {
      b.alive = false;
      const shooter = world.robots[b.ownerId];
      if (shooter && shooter.alive) {
        shooter.vm.enqueue("bullet missed", { power: b.power, x: b.x, y: b.y });
      }
    }
  }

  // Compact in place, preserving order so ids stay comparable across peers.
  world.bullets = world.bullets.filter((b) => b.alive);
}

/**
 * Earliest intersection of segment (x0,y0)->(x1,y1) with a circle, as a
 * fraction along the segment, or null. Pure arithmetic and Math.sqrt, so it is
 * exactly reproducible.
 */
function segmentCircleHit(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  radius: number,
): number | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;

  const a = dx * dx + dy * dy;
  if (a < 1e-12) {
    return fx * fx + fy * fy <= radius * radius ? 0 : null;
  }
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  const t2 = (-b + sq) / (2 * a);
  if (t2 >= 0 && t2 <= 1) return t2;
  return null;
}

// ---- phase: housekeeping -------------------------------------------------

function coolGuns(world: World): void {
  for (const r of world.robots) {
    if (!r.alive) continue;
    if (r.gunHeat > 0) r.gunHeat = Math.max(0, r.gunHeat - TURRET.coolRate);
    // The radar recovers in whole ticks rather than by a heat rate: a ping is
    // an instant either-or, so counting ticks is what a script can reason about.
    if (r.pingHeat > 0) r.pingHeat = Math.max(0, r.pingHeat - 1);
  }
}

function killRobot(world: World, victim: Robot, killer: Robot | null): void {
  if (!victim.alive) return;
  victim.alive = false;
  victim.health = 0;
  victim.speed = 0;
  victim.diedAtTick = world.tick;
  if (killer && killer.id !== victim.id) killer.kills++;

  world.effects.push({ type: "explosion", x: victim.x, y: victim.y, heading: 0, tick: world.tick });

  for (const r of world.robots) {
    if (!r.alive || r.id === victim.id) continue;
    r.vm.enqueue("robot destroyed", {
      bearing: angleDelta(r.heading, atan2Deg(victim.y - r.y, victim.x - r.x)),
      distance: hypot(victim.x - r.x, victim.y - r.y),
      name: victim.name,
      x: victim.x,
      y: victim.y,
    });
  }
}

function checkEnd(world: World): void {
  const alive = world.robots.filter((r) => r.alive);
  if (alive.length <= 1 && world.robots.length > 1) {
    world.over = true;
    world.winnerId = alive[0]?.id ?? null;
    return;
  }
  if (world.tick + 1 >= world.maxTicks) {
    world.over = true;
    // A timeout is decided on health, then damage dealt — rewarding the robot
    // that was winning rather than declaring a draw.
    let best: Robot | null = null;
    for (const r of world.robots) {
      if (!r.alive) continue;
      if (
        !best ||
        r.health > best.health ||
        (r.health === best.health && r.damageDealt > best.damageDealt)
      ) {
        best = r;
      }
    }
    world.winnerId = best?.id ?? null;
  }
}
