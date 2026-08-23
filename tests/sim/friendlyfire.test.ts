/**
 * Whether a bullet stops in a teammate.
 *
 * The distinction the whole setting turns on is *pass through* versus *stop for
 * no damage*. A bullet that stopped in a teammate would make teammates into
 * shields — "park the healthy one in front of the hurt one" — which is a
 * mechanic nobody designed and nobody could counter. So the test below checks
 * the enemy standing behind actually gets hit.
 */

import { describe, expect, it } from "vitest";
import { createWorld, makeManifest, releaseShot } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { hashWorld } from "../../src/sim/hash.js";
import { BULLET, MAX_HEALTH } from "../../src/sim/types.js";

const IDLE = `name "Idle"\nchassis tank\n`;

/** Shooter, a teammate 60 ahead of it, and an enemy 60 behind the teammate. */
function firingLine(friendlyFire: boolean) {
  const w = createWorld(
    makeManifest(
      [
        { source: IDLE, team: 0 },
        { source: IDLE, team: 0 },
        { source: IDLE, team: 1 },
      ],
      { seed: 2, width: 400, height: 200, friendlyFire },
    ),
  );
  const [shooter, mate, foe] = w.robots as [typeof w.robots[0], typeof w.robots[0], typeof w.robots[0]];
  shooter.x = 100;
  shooter.y = 100;
  shooter.turret = 0;
  mate.x = 160;
  mate.y = 100;
  foe.x = 220;
  foe.y = 100;
  releaseShot(w, shooter, 3);
  return { w, shooter, mate, foe };
}

const DAMAGE = BULLET.damagePerPower * 3;

describe("friendly fire on", () => {
  it("stops the shot in a teammate, who takes the damage", () => {
    const { w, mate, foe } = firingLine(true);
    for (let i = 0; i < 20; i++) step(w);
    expect(mate.health).toBe(MAX_HEALTH - DAMAGE);
    expect(foe.health).toBe(MAX_HEALTH);
  });
});

describe("friendly fire off", () => {
  it("leaves the teammate untouched", () => {
    const { w, mate } = firingLine(false);
    for (let i = 0; i < 20; i++) step(w);
    expect(mate.health).toBe(MAX_HEALTH);
  });

  it("flies THROUGH them and hits the enemy behind", () => {
    // The point of the whole setting: a teammate is not cover.
    const { w, foe } = firingLine(false);
    for (let i = 0; i < 20; i++) step(w);
    expect(foe.health).toBe(MAX_HEALTH - DAMAGE);
  });

  it("spares only your OWN side, not everybody", () => {
    // Fired back down the same line by the enemy. The robot in the middle is a
    // teammate of the original shooter but an opponent of this one, so it stops
    // the shot — the rule is about whose bullet it is, not about who is stood
    // in the way.
    const { w, mate, foe } = firingLine(false);
    foe.turret = 180;
    releaseShot(w, foe, 1);
    for (let i = 0; i < 30; i++) step(w);
    expect(mate.health).toBe(MAX_HEALTH - BULLET.damagePerPower * 1);
  });
});

describe("the setting travels with the match", () => {
  it("is part of the hash, so a peer given the other rule is caught at once", () => {
    expect(hashWorld(firingLine(true).w)).not.toBe(hashWorld(firingLine(false).w));
  });

  it("defaults to on, so a manifest saved before teams replays as it did", () => {
    const w = createWorld(makeManifest([{ source: IDLE }, { source: IDLE }], { seed: 1 }));
    expect(w.friendlyFire).toBe(true);
  });
});
