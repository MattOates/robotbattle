/**
 * Frame interpolation.
 *
 * The simulation runs at a fixed 30Hz because determinism demands a fixed
 * timestep, but 30Hz looks juddery. So the renderer keeps the last two
 * simulation states and draws somewhere between them, giving smooth 60fps
 * motion without the physics ever seeing a variable timestep.
 */

import { normalizeAngle } from "../sim/math.js";
import type { World } from "../sim/types.js";
import type { Locomotion } from "../lang/ast.js";

export interface RobotSnap {
  id: number;
  x: number;
  y: number;
  heading: number;
  turret: number;
  /** Absolute radar heading, drawn on the hull like the turret. */
  radar: number;
  alive: boolean;
  health: number;
  name: string;
  color: string;
  locomotion: Locomotion;
}

export interface BulletSnap {
  id: number;
  x: number;
  y: number;
  heading: number;
  power: number;
}

export interface Snapshot {
  tick: number;
  robots: RobotSnap[];
  bullets: BulletSnap[];
}

export function snapshot(world: World): Snapshot {
  return {
    tick: world.tick,
    robots: world.robots.map((r) => ({
      id: r.id,
      x: r.x,
      y: r.y,
      heading: r.heading,
      turret: r.turret,
      radar: r.radar,
      alive: r.alive,
      health: r.health,
      name: r.name,
      color: r.color,
      locomotion: r.locomotion,
    })),
    bullets: world.bullets.map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      heading: b.heading,
      power: b.power,
    })),
  };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolate an angle the short way round, so 179 -> -179 doesn't spin. */
export function lerpAngle(a: number, b: number, t: number): number {
  return normalizeAngle(a + normalizeAngle(b - a) * t);
}
