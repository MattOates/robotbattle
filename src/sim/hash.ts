/**
 * World state hashing — the divergence tripwire.
 *
 * Every peer simulates the same match independently, so we need a cheap way to
 * notice the moment two peers stop agreeing. Hashing the full physical state
 * each tick gives us that: if two peers' hash streams differ at tick N, the bug
 * is in whatever ran at tick N.
 *
 * Floats are hashed by their exact bits rather than by a rounded decimal,
 * because rounding would hide precisely the tiny divergences we are hunting.
 */

import type { World } from "./types.js";

const scratch = new DataView(new ArrayBuffer(8));

/** FNV-1a, 64-bit, carried in two 32-bit halves to stay in exact integer range. */
export class Hasher {
  private h1 = 0x811c9dc5; // low half
  private h2 = 0xcbf29ce4; // high half

  byte(b: number): void {
    this.h1 = Math.imul(this.h1 ^ (b & 0xff), 0x01000193) >>> 0;
    this.h2 = Math.imul(this.h2 ^ (b & 0xff), 0x01000193) >>> 0;
    // Cross-feed the halves so the result behaves like a 64-bit hash rather
    // than two independent 32-bit ones.
    this.h2 = (this.h2 ^ (this.h1 >>> 16)) >>> 0;
  }

  int(v: number): void {
    const n = v | 0;
    this.byte(n);
    this.byte(n >>> 8);
    this.byte(n >>> 16);
    this.byte(n >>> 24);
  }

  /** Hash the exact IEEE-754 bits, so 0.1 + 0.2 and 0.30000000000000004 differ. */
  float(v: number): void {
    scratch.setFloat64(0, v);
    for (let i = 0; i < 8; i++) this.byte(scratch.getUint8(i));
  }

  bool(v: boolean): void {
    this.byte(v ? 1 : 0);
  }

  text(s: string): void {
    this.int(s.length);
    for (let i = 0; i < s.length; i++) this.int(s.charCodeAt(i));
  }

  /** Final value as a 16-character hex string. */
  digest(): string {
    return (
      (this.h2 >>> 0).toString(16).padStart(8, "0") + (this.h1 >>> 0).toString(16).padStart(8, "0")
    );
  }
}

/**
 * Hash everything that affects future ticks. Deliberately excludes `effects`,
 * which are render-only, and excludes VM internals, which are reached through
 * the state they produce.
 */
export function hashWorld(world: World): string {
  const h = new Hasher();
  h.int(world.tick);
  h.int(world.width);
  h.int(world.height);
  h.bool(world.over);
  h.int(world.winnerId ?? -1);

  // The terrain field itself is immutable and derived, so there is nothing in it
  // to hash each tick \u2014 but the recipe that made it is worth four bytes. Two
  // peers that disagree about the map would otherwise diverge slowly, as their
  // robots drifted apart over ground that was never the same; hashing the config
  // turns that into a mismatch at tick 0, which is what a tripwire is for.
  h.bool(world.terrainConfig.enabled);
  h.int(world.terrainConfig.seed);
  h.int(world.terrainConfig.featureSize);
  h.float(world.terrainConfig.amplitude);

  const [rngHi, rngLo] = world.rng.getState();
  h.int(rngHi);
  h.int(rngLo);

  h.int(world.robots.length);
  for (const r of world.robots) {
    h.int(r.id);
    h.float(r.x);
    h.float(r.y);
    h.float(r.heading);
    h.float(r.speed);
    h.float(r.turret);
    h.float(r.gunHeat);
    h.float(r.radar);
    h.float(r.pingHeat);
    h.int(r.pendingPower);
    h.float(r.health);
    h.float(r.fuel);
    h.bool(r.alive);
    h.float(r.throttle);
    h.float(r.headingGoal);
    h.float(r.steer);
    h.float(r.turretGoal);
    h.float(r.sweepAmplitude);
    h.int(r.sweepDir);
    h.float(r.radarGoal);
    h.float(r.radarSweepAmplitude);
    h.int(r.radarSweepDir);
    h.int(r.kills);
    h.float(r.damageDealt);
    h.int(r.diedAtTick);
    // The label is script-controlled state, so it belongs in the hash.
    h.text(r.name);
  }

  // Cells are part of the physical state: two peers disagreeing about where
  // fuel is would diverge the moment somebody drove over it.
  h.int(world.fuel.length);
  h.int(world.nextFuelId);
  for (const f of world.fuel) {
    h.int(f.id);
    h.float(f.x);
    h.float(f.y);
    h.float(f.amount);
  }

  h.int(world.bullets.length);
  for (const b of world.bullets) {
    h.int(b.id);
    h.int(b.ownerId);
    h.float(b.x);
    h.float(b.y);
    h.float(b.heading);
    h.float(b.speed);
    h.int(b.power);
  }

  return h.digest();
}
