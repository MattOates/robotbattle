/**
 * What a trading room is allowed to see.
 *
 * The rule under test is the one the network depends on: something is visible
 * only while its owner has it on the table, and knowing its name buys nothing.
 *
 * Three kinds go through the same gate — a robot, a place, a block — and the
 * cases worth having are the ones where they differ. A block has no id of its
 * own, a place is a wall list rather than text, and a block cannot travel alone
 * if it hands off to another block.
 */

import { describe, expect, it } from "vitest";
import {
  allTradeables,
  blockId,
  offeredGoods,
  pruneOffered,
  shelfFor,
  tableKey,
  toggleOffered,
  type Tradeables,
} from "../../src/ui/tradeShelf.js";
import { libraryBlocks } from "../../src/workshop/blocks.js";
import { Library } from "../../src/store/library.js";
import { ArenaLibrary } from "../../src/store/arenas.js";
import { MemoryStore } from "../../src/store/storage.js";
import { TERRAIN_PRESETS } from "../../src/sim/types.js";
import { HUNTER, RACER } from "../../src/bots/index.js";

const TOOLBOX = `name "Toolbox"
chassis tank

can dodge given hit by bullet
  turn body by event.bearing + 90
  do scoot
end

can scoot given hit by bullet
  drive forward 90
end

on start
  drive forward 50
end
`;

const WALLS = [{ x1: 10, y1: 10, x2: 200, y2: 10 }];

function world() {
  const store = new MemoryStore();
  const robotLib = new Library(store);
  const arenaLib = new ArenaLibrary(store);
  const hunter = robotLib.create(HUNTER);
  const racer = robotLib.create(RACER);
  const toolbox = robotLib.create(TOOLBOX);
  const maze = arenaLib.create("Maze", { terrain: TERRAIN_PRESETS.off, walls: WALLS });
  const robots = robotLib.list();
  const lib: Tradeables = { robots, arenas: arenaLib.list(), blocks: libraryBlocks(robots) };
  return {
    lib,
    hunter: hunter.id,
    racer: racer.id,
    toolbox: toolbox.id,
    maze: maze.id,
    dodge: blockId(lib.blocks.find((b) => b.name === "dodge")!),
  };
}

describe("the table", () => {
  it("shows nothing until something is put out", () => {
    expect(shelfFor(world().lib, [])).toEqual([]);
  });

  it("offers all three kinds from one library", () => {
    const kinds = new Set(allTradeables(world().lib).map((i) => i.kind));
    expect(kinds).toEqual(new Set(["robot", "arena", "block"]));
  });

  it("shows enough to recognise a robot, never its script", () => {
    const { lib, hunter } = world();
    const shelf = shelfFor(lib, [tableKey("robot", hunter)]);
    expect(shelf).toEqual([
      { kind: "robot", id: hunter, name: "Hunter", color: "#ff8800", locomotion: "skid" },
    ]);
    expect(JSON.stringify(shelf)).not.toContain("on start");
  });

  it("says how big a place is, without handing over the map", () => {
    const { lib, maze } = world();
    const [row] = shelfFor(lib, [tableKey("arena", maze)]);
    expect(row).toEqual({ kind: "arena", id: maze, name: "Maze", walls: 1 });
    expect(JSON.stringify(row)).not.toContain("x1");
  });

  it("says which event a block fits, without handing over its text", () => {
    const { lib, dodge } = world();
    const [row] = shelfFor(lib, [tableKey("block", dodge)]);
    expect(row!.kind).toBe("block");
    expect(row!.name).toBe("dodge");
    expect(row!.event).toBe("hit by bullet");
    expect(JSON.stringify(row)).not.toContain("turn body");
  });

  it("keeps the order things were put out in, across kinds", () => {
    const { lib, hunter, maze } = world();
    const out = [tableKey("arena", maze), tableKey("robot", hunter)];
    expect(shelfFor(lib, out).map((r) => r.name)).toEqual(["Maze", "Hunter"]);
  });
});

describe("what may leave the table", () => {
  it("hands over the script of an offered robot", () => {
    const { lib, hunter } = world();
    const goods = offeredGoods(lib, [tableKey("robot", hunter)], "robot", hunter);
    expect(goods).toEqual({
      kind: "robot",
      name: "Hunter",
      color: "#ff8800",
      source: HUNTER,
    });
  });

  it("hands over the whole map of an offered place", () => {
    const { lib, maze } = world();
    const goods = offeredGoods(lib, [tableKey("arena", maze)], "arena", maze);
    expect(goods).not.toBeNull();
    if (!goods) throw new Error("unreachable");
    expect(goods.kind).toBe("arena");
    expect(goods.kind === "arena" ? goods.spec.walls : []).toEqual(WALLS);
  });

  it("packs what a block hands off to, or it would not compile there", () => {
    // `dodge` says `do scoot`. Sent on its own it arrives somewhere that has
    // never heard of `scoot`.
    const { lib, dodge } = world();
    const goods = offeredGoods(lib, [tableKey("block", dodge)], "block", dodge);
    if (!goods) throw new Error("unreachable");
    expect(goods.kind).toBe("block");
    const text = goods.kind === "block" ? goods.text : "";
    expect(text).toContain("can dodge");
    expect(text).toContain("can scoot");
  });

  it("refuses something never offered, even by the right name", () => {
    // The whole point: knowing the id is not permission. This is what an
    // incoming `peek` from another person's browser is asking.
    const { lib, hunter, racer, maze, dodge } = world();
    const out = [tableKey("robot", hunter)];
    expect(offeredGoods(lib, out, "robot", racer)).toBeNull();
    expect(offeredGoods(lib, out, "arena", maze)).toBeNull();
    expect(offeredGoods(lib, out, "block", dodge)).toBeNull();
  });

  it("does not let one kind's key open another's", () => {
    // Ids are only unique within a kind, so the kind is part of the question.
    const { lib, hunter } = world();
    expect(offeredGoods(lib, [tableKey("arena", hunter)], "robot", hunter)).toBeNull();
  });

  it("refuses one that has been taken back", () => {
    const { lib, hunter } = world();
    const after = toggleOffered([tableKey("robot", hunter)], tableKey("robot", hunter));
    expect(after).toEqual([]);
    expect(offeredGoods(lib, after, "robot", hunter)).toBeNull();
  });

  it("refuses junk in place of a kind or an id", () => {
    const { lib } = world();
    for (const nonsense of [null, undefined, 42, { id: "x" }, ["x"]]) {
      expect(offeredGoods(lib, ["anything"], "robot", nonsense)).toBeNull();
      expect(offeredGoods(lib, ["anything"], nonsense, "x")).toBeNull();
    }
  });
});

describe("keeping the table honest", () => {
  it("drops what is no longer in the library", () => {
    const { lib, hunter, racer, maze } = world();
    const shrunk: Tradeables = {
      ...lib,
      robots: lib.robots.filter((r) => r.id === hunter),
      arenas: [],
    };
    expect(
      pruneOffered(
        [tableKey("robot", hunter), tableKey("robot", racer), tableKey("arena", maze)],
        shrunk,
      ),
    ).toEqual([tableKey("robot", hunter)]);
  });

  it("drops a block that its robot no longer contains", () => {
    // Nobody thinks of editing a script as deleting something, but it is — so
    // the table is re-checked against the library rather than trusted.
    const { lib, dodge } = world();
    const gone: Tradeables = { ...lib, blocks: [] };
    expect(pruneOffered([tableKey("block", dodge)], gone)).toEqual([]);
    expect(offeredGoods(gone, [tableKey("block", dodge)], "block", dodge)).toBeNull();
  });

  it("puts out and takes back without disturbing the rest", () => {
    const { hunter, racer } = world();
    const a = tableKey("robot", hunter);
    const b = tableKey("robot", racer);
    expect(toggleOffered([], a)).toEqual([a]);
    expect(toggleOffered([a], b)).toEqual([a, b]);
    expect(toggleOffered([a, b], a)).toEqual([b]);
  });
});
