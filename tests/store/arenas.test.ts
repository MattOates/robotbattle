/**
 * The arena library.
 *
 * Mostly ordinary CRUD, with two things worth pinning: everything is clamped on
 * the way in, so a stored arena can always be handed straight to a match; and
 * credit for a traded map survives, while a copy you made of it does not claim
 * to be theirs.
 */

import { describe, expect, it } from "vitest";
import { ArenaLibrary, blankArena, normaliseSpec } from "../../src/store/arenas.js";
import { MemoryStore } from "../../src/store/storage.js";
import { TERRAIN_PRESETS, WALL, type ArenaSpec } from "../../src/sim/types.js";

const WALLS = [
  { x1: 10, y1: 10, x2: 200, y2: 10 },
  { x1: 200, y1: 10, x2: 200, y2: 300 },
];

function lib() {
  return new ArenaLibrary(new MemoryStore());
}

describe("saving a place", () => {
  it("round-trips through storage", () => {
    const arenas = lib();
    const made = arenas.create("Long Corridor", { terrain: TERRAIN_PRESETS.off, walls: WALLS });
    expect(arenas.list()).toHaveLength(1);
    expect(arenas.get(made.id)?.spec.walls).toEqual(WALLS);
  });

  it("starts blank rather than on a random map", () => {
    // Somebody opening the editor to lay out a maze wants a blank sheet, and
    // hills are one click away. Matches `makeManifest`'s own default.
    expect(blankArena().terrain.enabled).toBe(false);
    expect(blankArena().walls).toEqual([]);
  });

  it("never stores a name that would render as nothing", () => {
    const arenas = lib();
    expect(arenas.create("   ").name).toBe("New arena");
    const made = arenas.create("Fine");
    expect(arenas.rename(made.id, "  ")?.name).toBe("Fine");
  });
});

describe("what goes in is what a match will accept", () => {
  it("clamps on the way in, not on the way out", () => {
    const arenas = lib();
    const dirty: ArenaSpec = {
      terrain: { enabled: true, seed: 3.7, featureSize: 0, amplitude: 5 },
      walls: [
        { x1: 10.4, y1: 10.6, x2: 200.5, y2: 10.6 },
        // Too short to be anything but a stray click.
        { x1: 0, y1: 0, x2: 2, y2: 0 },
        { x1: NaN, y1: 0, x2: 100, y2: 0 },
      ],
    };
    const made = arenas.create("Messy", dirty);
    // featureSize 0 would divide by zero in `makeTerrain` on every peer at once.
    expect(made.spec.terrain.featureSize).toBeGreaterThanOrEqual(20);
    expect(made.spec.terrain.amplitude).toBeLessThanOrEqual(1);
    // Whole pixels, so two peers cannot disagree about a coordinate.
    expect(made.spec.walls).toEqual([{ x1: 10, y1: 11, x2: 201, y2: 11 }]);
  });

  it("refuses to store more walls than a match will carry", () => {
    const many = Array.from({ length: WALL.maxCount + 20 }, (_, i) => ({
      x1: 0,
      y1: i,
      x2: 100,
      y2: i,
    }));
    expect(normaliseSpec({ terrain: TERRAIN_PRESETS.off, walls: many }).walls).toHaveLength(
      WALL.maxCount,
    );
  });
});

describe("credit", () => {
  it("records who a traded map came from", () => {
    const arenas = lib();
    const got = arenas.importTraded("Their Maze", { terrain: TERRAIN_PRESETS.off, walls: WALLS }, "Sam");
    expect(got.origin?.from).toBe("Sam");
    expect(arenas.get(got.id)?.origin?.from).toBe("Sam");
  });

  it("does not let a copy claim to be theirs", () => {
    // The one dishonest thing this store could do.
    const arenas = lib();
    const got = arenas.importTraded("Their Maze", { terrain: TERRAIN_PRESETS.off, walls: WALLS }, "Sam");
    const mine = arenas.duplicate(got.id)!;
    expect(mine.origin).toBeUndefined();
    expect(mine.spec.walls).toEqual(got.spec.walls);
  });

  it("falls back to a word rather than an empty name", () => {
    const arenas = lib();
    expect(arenas.importTraded("M", blankArena(), "   ").origin?.from).toBe("someone");
  });
});

describe("removing", () => {
  it("takes only the one asked for", () => {
    const arenas = lib();
    const a = arenas.create("A");
    const b = arenas.create("B");
    arenas.remove(a.id);
    expect(arenas.list().map((x) => x.id)).toEqual([b.id]);
  });
});
