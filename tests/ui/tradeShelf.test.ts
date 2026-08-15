/**
 * What a trading room is allowed to see.
 *
 * The rule under test is the one the network depends on: a robot is visible
 * only while its owner has it on the table, and an id alone buys nothing.
 */

import { describe, expect, it } from "vitest";
import {
  offeredSource,
  pruneOffered,
  shelfFor,
  toggleOffered,
} from "../../src/ui/tradeShelf.js";
import { Library } from "../../src/store/library.js";
import { MemoryStore } from "../../src/store/storage.js";
import { HUNTER, RACER } from "../../src/bots/index.js";

function library(): { hunter: string; racer: string; robots: ReturnType<Library["list"]> } {
  const lib = new Library(new MemoryStore());
  const hunter = lib.create(HUNTER);
  const racer = lib.create(RACER);
  return { hunter: hunter.id, racer: racer.id, robots: lib.list() };
}

describe("the table", () => {
  it("shows nothing until something is put out", () => {
    const { robots } = library();
    expect(shelfFor(robots, [])).toEqual([]);
  });

  it("shows enough to draw a robot, never its script", () => {
    const { hunter, robots } = library();
    const shelf = shelfFor(robots, [hunter]);
    expect(shelf).toEqual([
      { id: hunter, name: "Hunter", color: "#ff8800", locomotion: "skid" },
    ]);
    expect(JSON.stringify(shelf)).not.toContain("on start");
  });

  it("carries the chassis, so a card can be drawn the way the arena draws it", () => {
    // Racer is a car and Hunter a tank; someone scanning the table recognises
    // their own robot by that shape as much as by the name.
    const { hunter, racer, robots } = library();
    expect(shelfFor(robots, [hunter, racer]).map((r) => r.locomotion)).toEqual([
      "skid",
      "steered",
    ]);
  });

  it("keeps the order things were put out in", () => {
    const { hunter, racer, robots } = library();
    expect(shelfFor(robots, [racer, hunter]).map((r) => r.name)).toEqual(["Racer", "Hunter"]);
  });

  it("hands over the script of an offered robot", () => {
    const { hunter, robots } = library();
    expect(offeredSource(robots, [hunter], hunter)).toBe(HUNTER);
  });

  it("refuses a robot that was never offered, even by the right id", () => {
    // The whole point: knowing the id is not permission. This is what an
    // incoming `peek` from another person's browser is asking.
    const { hunter, racer, robots } = library();
    expect(offeredSource(robots, [hunter], racer)).toBeNull();
  });

  it("refuses one that has been taken back", () => {
    const { hunter, robots } = library();
    const after = toggleOffered([hunter], hunter);
    expect(after).toEqual([]);
    expect(offeredSource(robots, after, hunter)).toBeNull();
  });

  it("refuses junk in place of an id", () => {
    const { robots } = library();
    for (const nonsense of [null, undefined, 42, { id: "x" }, ["x"]]) {
      expect(offeredSource(robots, ["anything"], nonsense)).toBeNull();
    }
  });

  it("drops what is no longer in the library", () => {
    const { hunter, racer, robots } = library();
    const kept = robots.filter((r) => r.id === hunter);
    expect(pruneOffered([hunter, racer], kept)).toEqual([hunter]);
    // And a deleted robot cannot be read through a stale table entry.
    expect(offeredSource(kept, [racer], racer)).toBeNull();
  });

  it("puts out and takes back without disturbing the rest", () => {
    const { hunter, racer } = library();
    expect(toggleOffered([], hunter)).toEqual([hunter]);
    expect(toggleOffered([hunter], racer)).toEqual([hunter, racer]);
    expect(toggleOffered([hunter, racer], hunter)).toEqual([racer]);
  });
});
