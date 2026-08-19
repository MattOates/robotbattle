/**
 * Fuel: the one consumable in the arena.
 *
 * The properties worth pinning are the ones that would be silent if they broke
 * — a tank that goes negative, a spawn that depends on wall-clock order, a
 * brownout that becomes a death. The last matters most: every robot written
 * before fuel existed still has to be able to finish a match.
 */

import { describe, expect, it } from "vitest";
import { createWorld, makeManifest, spendFuel } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { hashWorld } from "../../src/sim/hash.js";
import {
  FUEL_PRESETS,
  MAX_FUEL,
  ROBOT_RADIUS,
  type FuelConfig,
} from "../../src/sim/types.js";

const IDLE = `name "Idle"\nchassis tank\n`;
const DRIVER = `name "Driver"\nchassis tank\non start\n  drive forward 100\nend\n`;

function world(sources: string[], fuel?: Partial<FuelConfig>, seed = 7) {
  return createWorld(
    makeManifest(
      sources.map((source) => ({ source })),
      { seed, fuel: { ...FUEL_PRESETS.arena, ...fuel } },
    ),
  );
}

/** A field so barren that only spending is under test. */
const NO_SPAWN = { maxOnField: 0 };

describe("fuel", () => {
  it("spawns the identical sequence of cells from the same seed", () => {
    const a = world([IDLE], {}, 99);
    const b = world([IDLE], {}, 99);
    for (let i = 0; i < 600; i++) {
      step(a);
      step(b);
    }
    expect(a.fuel.length).toBeGreaterThan(0);
    expect(hashWorld(a)).toBe(hashWorld(b));
    expect(a.fuel).toEqual(b.fuel);
  });

  it("honours the cap on how many cells are out at once", () => {
    const w = world([IDLE], { spawnEveryTicks: 1, maxOnField: 3 });
    for (let i = 0; i < 200; i++) step(w);
    expect(w.fuel.length).toBe(3);
  });

  it("charges a driving robot more than an idle one", () => {
    const idle = world([IDLE], NO_SPAWN);
    const driver = world([DRIVER], NO_SPAWN);
    for (let i = 0; i < 300; i++) {
      step(idle);
      step(driver);
    }
    expect(driver.robots[0]!.fuel).toBeLessThan(idle.robots[0]!.fuel);
  });

  it("charges an idle robot something, so a corner is never free", () => {
    const w = world([IDLE], NO_SPAWN);
    for (let i = 0; i < 300; i++) step(w);
    expect(w.robots[0]!.fuel).toBeLessThan(MAX_FUEL);
  });

  it("never goes negative, however long the tank has been empty", () => {
    const w = world([DRIVER], NO_SPAWN);
    const r = w.robots[0]!;
    r.fuel = 0.01;
    for (let i = 0; i < 400; i++) step(w);
    expect(r.fuel).toBe(0);
    spendFuel(r, 1000);
    expect(r.fuel).toBe(0);
  });

  it("browns out rather than stopping: an empty robot still moves", () => {
    const w = world([DRIVER], NO_SPAWN);
    const r = w.robots[0]!;
    for (let i = 0; i < 40; i++) step(w);
    r.fuel = 0;
    for (let i = 0; i < 40; i++) step(w);
    expect(Math.abs(r.speed)).toBeGreaterThan(0);
    expect(r.alive).toBe(true);
  });

  it("leaves a starving robot slower than a fed one", () => {
    const fed = world([DRIVER], NO_SPAWN);
    const starved = world([DRIVER], NO_SPAWN);
    for (let i = 0; i < 30; i++) {
      step(fed);
      starved.robots[0]!.fuel = 0;
      step(starved);
    }
    expect(starved.robots[0]!.speed).toBeLessThan(fed.robots[0]!.speed);
  });

  it("never kills: an empty robot survives a whole match", () => {
    const w = world([IDLE, IDLE], NO_SPAWN);
    for (const r of w.robots) r.fuel = 0;
    for (let i = 0; i < 1200; i++) step(w);
    expect(w.robots.every((r) => r.alive)).toBe(true);
  });

  it("absorbs a cell it is sitting on, exactly once and for exactly its worth", () => {
    const w = world([IDLE], NO_SPAWN);
    const r = w.robots[0]!;
    r.fuel = 10;
    w.fuel.push({ id: 1, x: r.x, y: r.y, amount: 25 });
    step(w);
    expect(w.fuel).toHaveLength(0);
    // One tick of idle upkeep is also charged, hence the tolerance.
    expect(r.fuel).toBeCloseTo(35, 1);
  });

  it("never fills past the top of the tank", () => {
    const w = world([IDLE], NO_SPAWN);
    const r = w.robots[0]!;
    w.fuel.push({ id: 1, x: r.x, y: r.y, amount: 90 });
    step(w);
    expect(r.fuel).toBe(MAX_FUEL);
  });

  it("gives one cell to exactly one robot", () => {
    const w = world([IDLE, IDLE], NO_SPAWN);
    for (const r of w.robots) r.fuel = 10;
    // Parked side by side, just touching, with the cell between them so it is
    // genuinely in reach of both.
    const [a, b] = [w.robots[0]!, w.robots[1]!];
    b.x = a.x + ROBOT_RADIUS * 2;
    b.y = a.y;
    w.fuel.push({ id: 1, x: a.x + ROBOT_RADIUS, y: a.y, amount: 25 });
    const before = a.fuel + b.fuel;
    step(w);
    const gained = a.fuel + b.fuel - before;
    expect(gained).toBeLessThan(25);
    expect(gained).toBeGreaterThan(20);
  });

  it("refuses a manifest that would spawn without bound", () => {
    const w = world([IDLE], { spawnEveryTicks: 0, maxOnField: 10_000 });
    expect(w.fuelConfig.spawnEveryTicks).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 200; i++) step(w);
    expect(w.fuel.length).toBeLessThanOrEqual(64);
  });

  it("puts fuel in the hash, so peers cannot disagree about it silently", () => {
    const w = world([IDLE], NO_SPAWN);
    const before = hashWorld(w);
    w.fuel.push({ id: 1, x: 100, y: 100, amount: 25 });
    expect(hashWorld(w)).not.toBe(before);
    w.fuel = [];
    w.robots[0]!.fuel -= 1;
    expect(hashWorld(w)).not.toBe(before);
  });
});
