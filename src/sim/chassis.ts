/**
 * The two locomotion models.
 *
 * They share a hitbox, a turret and a sense cone. The *only* difference is how
 * a steering command becomes motion, which is the whole point: skid steer can
 * pivot on the spot but is slow; steered locomotion is fast but carries a
 * turning circle it cannot escape.
 *
 * Mechanically these are tracks and wheels; biologically they are cilia and a
 * flagellum. Same numbers either way.
 */

import type { Locomotion } from "../lang/ast.js";
import { DEG_TO_RAD, RAD_TO_DEG, clamp, tanDeg } from "./math.js";
import type { ChassisSpec } from "./types.js";

export const SKID: ChassisSpec = {
  locomotion: "skid",
  maxSpeed: 95,
  acceleration: 190,
  braking: 260,
  // Fast rotation, available even at a standstill — this is the trade.
  turnRate: 130,
  maxSteer: 0,
  wheelbase: 0,
};

export const STEERED: ChassisSpec = {
  locomotion: "steered",
  maxSpeed: 165,
  acceleration: 210,
  braking: 300,
  turnRate: 0,
  maxSteer: 32,
  // radius = wheelbase / tan(maxSteer) = 26 / 0.6249 ~= 41.6px at full lock.
  wheelbase: 26,
};

export function specFor(locomotion: Locomotion): ChassisSpec {
  return locomotion === "skid" ? SKID : STEERED;
}

/**
 * Tightest turning radius, in pixels. Infinite (well, very large) for skid
 * steer, which can turn about its own centre.
 */
export function turningRadius(spec: ChassisSpec): number {
  if (spec.locomotion === "skid") return 0;
  return spec.wheelbase / tanDeg(spec.maxSteer);
}

/**
 * Angular velocity in degrees/second for a steered chassis.
 *
 * Bicycle model: omega = v * tan(steer) / wheelbase. Note that this is
 * proportional to v, so at a standstill a steered chassis cannot rotate at all
 * — the turning circle falls straight out of the physics rather than being
 * bolted on as a rule.
 */
export function steeredAngularVelocity(spec: ChassisSpec, speed: number, steer: number): number {
  const s = clamp(steer, -spec.maxSteer, spec.maxSteer);
  return ((speed * tanDeg(s)) / spec.wheelbase) * RAD_TO_DEG;
}

/**
 * Steering angle a steered chassis should adopt to chase a heading error.
 * A plain proportional controller, clamped to the mechanical lock.
 */
export function steerForHeadingError(spec: ChassisSpec, errorDeg: number): number {
  const STEER_GAIN = 0.9;
  return clamp(errorDeg * STEER_GAIN, -spec.maxSteer, spec.maxSteer);
}

export { DEG_TO_RAD };
