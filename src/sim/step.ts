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
  OPS_PER_TICK,
  ROBOT_RADIUS,
  SENSE,
  RADAR,
  TURRET,
  BULLET,
  DT,
  FUEL,
  MAX_FUEL,
  MAX_HEALTH,
  TERRAIN,
  WALL,
} from "./types.js";
import {
  distanceToWall,
  fuelFactor,
  gunBears,
  pushOutOfWalls,
  releaseShot,
  spendFuel,
} from "./world.js";
import type { Bullet, FuelCell, Robot, World } from "./types.js";
import {
  angleDelta,
  atan2Deg,
  clamp,
  closestPointOnSegment,
  cosDeg,
  hypot,
  moveToward,
  normalizeAngle,
  sinDeg,
  turnToward,
} from "./math.js";
import { specFor, steerForHeadingError, steeredAngularVelocity } from "./chassis.js";
import { climbAlong } from "./terrain.js";

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
  collectFuel(world);
  spawnFuel(world);
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

    // --- nearest fuel cell in cone ---
    if (world.fuelConfig.enabled && r.vm.handles("sense fuel") && !r.vm.hasQueued("sense fuel")) {
      let best: FuelCell | null = null;
      let bestDist = Infinity;
      for (const f of world.fuel) {
        const dx = f.x - r.x;
        const dy = f.y - r.y;
        const dist = hypot(dx, dy);
        if (dist > SENSE.range || dist >= bestDist) continue;
        const bearing = angleDelta(r.heading, atan2Deg(dy, dx));
        if (bearing < -SENSE.halfAngle || bearing > SENSE.halfAngle) continue;
        best = f;
        bestDist = dist;
      }
      if (best) {
        r.vm.enqueue("sense fuel", {
          bearing: angleDelta(r.heading, atan2Deg(best.y - r.y, best.x - r.x)),
          distance: bestDist,
          amount: best.amount,
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
    r.vm.run(OPS_PER_TICK);
    if (r.vm.lastError) r.scriptError = r.vm.lastError;
  }
}

// ---- phase: robot motion -------------------------------------------------

function moveRobots(world: World): void {
  for (const r of world.robots) {
    if (!r.alive) continue;
    const spec = specFor(r.locomotion);
    const headingBefore = r.heading;

    // How hard the ground is fighting this robot, -1 (straight down the
    // steepest slope) to +1 (straight up it). Sampled where the robot is now,
    // along the heading it is about to travel on, so the slowdown below and the
    // charge further down describe the same step. Exactly 0 on flat ground, on
    // a disabled map, and — the case that matters — when driving along a
    // contour rather than against it.
    r.climb = climbAlong(world.terrain, r.x, r.y, r.heading);

    // Uphill is slow, downhill is quick. This half depends only on terrain: a
    // match with terrain on and fuel off still has real hills, they just cost
    // nothing to climb because there is nothing to spend.
    const terrainSpeed = clamp(
      1 - TERRAIN.speedSwing * r.climb,
      TERRAIN.speedFloor,
      TERRAIN.speedCeil,
    );
    // Brownout: an empty tank leaves a robot slow and vague, never stopped.
    // Sampled once, before anything is spent, so a robot's capability within a
    // tick is one consistent number rather than drifting as it pays for itself.
    const fuelled = fuelFactor(world, r);
    const maxSpeed = spec.maxSpeed * terrainSpeed * fuelled;

    // --- longitudinal: accelerate toward the throttle target ---
    const targetSpeed = r.throttle * maxSpeed;
    // Slowing down (or reversing direction) uses the stronger braking rate.
    const closingToZero = Math.abs(targetSpeed) < Math.abs(r.speed) || targetSpeed * r.speed < 0;
    // Terrain scales the rate as well as the ceiling. A hill that caps your top
    // speed but lets you reach it instantly is not a hill.
    const rate = (closingToZero ? spec.braking : spec.acceleration) * terrainSpeed * fuelled * DT;
    r.speed = moveToward(r.speed, targetSpeed, rate);

    // --- rotation ---
    if (r.locomotion === "skid") {
      // Skid steer turns at a fixed rate regardless of speed, and can pivot on
      // the spot. This is the slow-but-agile half of the trade.
      if (r.headingMode === "goal") {
        r.heading = turnToward(r.heading, r.headingGoal, spec.turnRate * fuelled * DT);
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
      const omega = steeredAngularVelocity(spec, r.speed, r.steer) * fuelled;
      r.heading = normalizeAngle(r.heading + omega * DT);
    }

    // --- turret, independent of the chassis ---
    updateTurret(world, r, fuelled);

    // A shot committed earlier leaves the moment the gun arrives. Checked here,
    // straight after the slew, so it goes on the tick the turret gets there
    // rather than the one after.
    if (r.pendingPower > 0 && r.gunHeat <= 0 && gunBears(r)) {
      releaseShot(world, r, r.pendingPower);
      r.pendingPower = 0;
    }

    // --- pay for the work actually done, not for asking ---
    // Charged on outcomes: a robot pinned against a wall at full throttle is
    // not moving and is not billed for movement.
    spendFuel(world, r, FUEL.basal);
    if (maxSpeed > 0) {
      // The cost half of terrain, and the only place it applies. It multiplies
      // the drive charge alone: standing on a hill is not expensive, dragging
      // yourself up one is. Computed here rather than beside `terrainSpeed`
      // because it is meaningless without a charge to scale — and leaving it
      // next to the charge is what stops a later refactor from separating them.
      const terrainCost = clamp(1 + TERRAIN.costSwing * r.climb, 0, TERRAIN.costCeil);
      spendFuel(world, r, FUEL.drive * terrainCost * (Math.abs(r.speed) / maxSpeed));
    }
    spendFuel(world, r, FUEL.bodyTurn * Math.abs(angleDelta(headingBefore, r.heading)));

    // --- translate ---
    r.x += cosDeg(r.heading) * r.speed * DT;
    r.y += sinDeg(r.heading) * r.speed * DT;

    // --- walls ---
    const hitWall = resolveWalls(world, r);
    if (hitWall) {
      // A scrape against the EDGE of the map costs a little health, which
      // discourages hiding in a corner without being punishing. A scrape
      // against a placed wall costs nothing.
      //
      // That asymmetry is the whole reason a labyrinth is playable. The 0.4 was
      // tuned for a boundary you touch occasionally; in a maze you are against a
      // wall almost continuously, and measurement put the Racer at 249 bumps in
      // 258 ticks \u2014 dead of attrition before it had solved anything. Charging
      // for it would make the only viable maze robot the one that never moves.
      //
      // It is also the rule the mechanic already promised: a placed wall blocks
      // motion and does nothing else. Health is something else.
      if (hitWall.boundary) r.health = Math.max(0, r.health - 0.4);

      if (hitWall.boundary) {
        // Head-on into the edge of the map: stop dead, as it always has.
        r.speed = 0;
      } else {
        // Against a placed wall, keep the part of the motion that runs ALONG
        // the wall and lose only the part driving into it.
        //
        // `hitWall.normal` points out of the wall, so the angle between it and
        // the heading says how square the contact was: 180 degrees is straight
        // into it and keeps nothing, 90 is running parallel and keeps
        // everything. `sinDeg` of that difference is exactly that fraction.
        //
        // Without this a wall cannot be followed at all. Measured before it
        // existed, a robot grazing a wall at ten degrees covered 61px in three
        // seconds where clear ground would have given it 280 \u2014 it was being
        // stopped dead and made to accelerate again on every tick of contact.
        // Corridors are the normal case in a labyrinth, so that is not a
        // penalty for bad driving, it is a rule against going down a corridor.
        //
        // The boundary keeps the old behaviour deliberately. It is there to
        // discourage hiding in a corner, nothing is ever meant to run along it,
        // and leaving it alone means every match without placed walls plays
        // exactly as it did.
        const into = sinDeg(angleDelta(hitWall.normal, r.heading));
        r.speed = r.speed * (into < 0 ? -into : into);
      }
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
function updateTurret(world: World, r: Robot, fuelled: number): void {
  const turretBefore = r.turret;
  const radarBefore = r.radar;
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
  r.turret = turnToward(r.turret, r.turretGoal, TURRET.slewRate * fuelled * DT);

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
  r.radar = turnToward(r.radar, r.radarGoal, RADAR.slewRate * fuelled * DT);

  const slewed =
    Math.abs(angleDelta(turretBefore, r.turret)) + Math.abs(angleDelta(radarBefore, r.radar));
  spendFuel(world, r, FUEL.slew * slewed);
}

interface WallHit {
  normal: number;
  /**
   * True for the edge of the map, false for a segment somebody placed.
   *
   * The only thing this distinguishes is the scrape damage below. A script
   * cannot see it and has no way to ask \u2014 `on hit wall` is one event, because
   * to a robot the two are the same fact.
   */
  boundary: boolean;
}

/**
 * Keep a robot out of every wall; returns one it touched, if any.
 *
 * The boundary first, then the placed segments. The order matters only in that
 * a robot squeezed between a wall and the edge ends up reported against the
 * wall, which is the more useful of the two facts.
 *
 * Both kinds return the same `WallHit`, which is what makes `on hit wall`
 * behave identically for the edge of the map and for something drawn in the
 * middle of it — the point of building walls as segments rather than as a new
 * kind of obstacle.
 */
function resolveWalls(world: World, r: Robot): WallHit | null {
  let hit: WallHit | null = null;
  if (r.x < ROBOT_RADIUS) {
    r.x = ROBOT_RADIUS;
    hit = { normal: 0, boundary: true };
  } else if (r.x > world.width - ROBOT_RADIUS) {
    r.x = world.width - ROBOT_RADIUS;
    hit = { normal: 180, boundary: true };
  }
  if (r.y < ROBOT_RADIUS) {
    r.y = ROBOT_RADIUS;
    hit = { normal: 90, boundary: true };
  } else if (r.y > world.height - ROBOT_RADIUS) {
    r.y = world.height - ROBOT_RADIUS;
    hit = { normal: -90, boundary: true };
  }
  const placed = pushOutOfWalls(world, r);
  return placed ? { normal: placed.normal, boundary: false } : hit;
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

// ---- phase: fuel ---------------------------------------------------------

/**
 * Absorb any cell a robot is sitting on.
 *
 * Robots are visited in id order and a cell is removed the moment it is taken,
 * so two robots meeting over one cell is settled by id rather than by whichever
 * happened to be checked first — arbitrary, but identically arbitrary on every
 * peer, which is the only property that matters here.
 */
function collectFuel(world: World): void {
  if (world.fuel.length === 0) return;
  const reach = ROBOT_RADIUS + world.fuelConfig.radius;
  let taken = false;

  for (const r of world.robots) {
    if (!r.alive) continue;
    for (const f of world.fuel) {
      if (f.amount <= 0) continue; // already claimed this tick
      if (hypot(f.x - r.x, f.y - r.y) > reach) continue;
      r.fuel = Math.min(MAX_FUEL, r.fuel + f.amount);
      f.amount = 0;
      taken = true;
      world.effects.push({ type: "pickup", x: f.x, y: f.y, heading: 0, tick: world.tick });
    }
  }

  // Compacted the same way bullets are, preserving order.
  if (taken) world.fuel = world.fuel.filter((f) => f.amount > 0);
}

/**
 * How many placements a fuel cell may try before it settles for the last one.
 *
 * Small on purpose. It exists to avoid the obviously silly outcome — a cell
 * inside a wall — not to guarantee a good one, and every extra try is RNG draws
 * spent on every peer for a diminishing return.
 */
const FUEL_SPAWN_TRIES = 8;

/** Is there room for a cell of this radius here, clear of every placed wall? */
function clearOfWalls(world: World, x: number, y: number, radius: number): boolean {
  const reach = radius + WALL.halfThickness;
  const reachSq = reach * reach;
  for (const w of world.walls) {
    const [, , distSq] = closestPointOnSegment(x, y, w.x1, w.y1, w.x2, w.y2);
    if (distSq < reachSq) return false;
  }
  return true;
}

/**
 * Put a new cell out on a fixed cadence.
 *
 * The RNG is only touched when a cell is actually spawned, so a match whose
 * field is full draws nothing and the stream stays a function of what happened
 * rather than of how often we looked.
 */
function spawnFuel(world: World): void {
  const cfg = world.fuelConfig;
  if (!cfg.enabled) return;
  if (world.tick % cfg.spawnEveryTicks !== 0) return;
  if (world.fuel.length >= cfg.maxOnField) return;

  // Kept off the walls so a cell is never half-buried in one, and so it cannot
  // sit where a robot would have to scrape itself to reach it.
  const margin = ROBOT_RADIUS + cfg.radius;
  const loX = margin;
  const hiX = Math.max(margin, world.width - margin);
  const loY = margin;
  const hiY = Math.max(margin, world.height - margin);

  // Placed walls need the same treatment, but they can be anywhere, so a margin
  // will not do it — reject and redraw instead. Bounded rather than a `while`,
  // and it takes the last draw regardless once the tries run out: a map walled
  // so densely that eight draws all land badly must still spawn something, and
  // an unbounded loop on a peer is a hang on every peer at once.
  //
  // Every attempt draws from `world.rng`, so the whole loop is part of the
  // deterministic stream and every peer runs it identically. It does move that
  // stream relative to older builds, which is one of the reasons SIM_VERSION
  // went to 9.
  let x = 0;
  let y = 0;
  for (let attempt = 0; attempt < FUEL_SPAWN_TRIES; attempt++) {
    x = world.rng.range(loX, hiX);
    y = world.rng.range(loY, hiY);
    if (clearOfWalls(world, x, y, cfg.radius)) break;
  }

  world.fuel.push({ id: world.nextFuelId++, x, y, amount: cfg.amount });
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
