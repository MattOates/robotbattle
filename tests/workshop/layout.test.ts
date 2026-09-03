import { describe, expect, it } from "vitest";
import { fromSource } from "../../src/workshop/compose.js";
import {
  isComplete,
  layoutKey,
  layoutKeys,
  pruneLayout,
  tidyBands,
} from "../../src/workshop/layout.js";
import { SAMPLE_BOTS, TOUR_ROBOT } from "../../src/bots/index.js";
import { translate } from "../../src/learn/translate.js";
import { applyLayout, readLayout, topBlocks } from "../../src/ui/blocks/arrange.js";
import { loadWorkspace } from "./helpers/workspace.js";

const keysOf = (src: string) => layoutKeys(fromSource(src));

/**
 * A position has to be remembered against what a block *is*, not where it
 * happens to sit. The block ids in `blocks/bridge.ts` are derived from
 * position — right for telling a peer which block you are on, wrong for
 * remembering where one goes, because inserting a handler at the top shifts
 * every id by one and lands every remembered position on the wrong block.
 */
describe("naming a block so its place can be remembered", () => {
  it("survives another handler being added above it", () => {
    const before = keysOf('name "R"\nchassis tank\n\non sense robot\n  stop\nend');
    const after = keysOf(
      'name "R"\nchassis tank\n\non start\n  stop\nend\n\non sense robot\n  stop\nend',
    );
    // The sensing handler kept its name; only a new one appeared.
    expect(before).toContain("on:sense robot");
    expect(after).toContain("on:sense robot");
    expect(after).toContain("on:start");
  });

  it("is the same in both vocabularies", () => {
    // A traded robot arrives in the other world's words and must land on the
    // same keys, or every position it brought with it is wasted.
    const src = 'name "R"\nchassis tank\n\non hit by bullet\n  stop\nend';
    expect(keysOf(src)).toEqual(keysOf(translate(src, "biological")));
  });

  it("names a behaviour by its name, not its `given`", () => {
    const s = fromSource(
      'name "R"\nchassis tank\n\ncan dodge given hit by bullet\n  stop\nend\n\ncan weave given hit by bullet\n  stop\nend',
    );
    expect(s.blocks.map(layoutKey)).toEqual(["robot", "can:dodge", "can:weave"]);
  });

  it("gives a half-typed behaviour no key at all", () => {
    // Remembering where an unnamed block sat means remembering it against the
    // next unnamed one.
    const s = fromSource('name "R"\nchassis tank\n\ncan\n  stop\nend');
    expect(s.blocks.map(layoutKey)).toContain(null);
  });

  it("is unique within every robot in the game", () => {
    for (const { id, source } of [
      ...SAMPLE_BOTS.map((b) => ({ id: b.id, source: b.source })),
      { id: "tour", source: TOUR_ROBOT },
    ]) {
      const keys = keysOf(source);
      expect(new Set(keys).size, id).toBe(keys.length);
    }
  });
});

/**
 * The arrangement is canonical so that two people who started from the same
 * robot and changed different parts of it end up with recognisably the same
 * picture — which is the whole point of tidying rather than merely stacking.
 */
describe("the canonical arrangement", () => {
  const src = [
    'name "R"',
    "chassis tank",
    "",
    "can helper",
    "  stop",
    "end",
    "",
    "on hit wall",
    "  stop",
    "end",
    "",
    "on start",
    "  stop",
    "end",
    "",
    "can dodge given hit by bullet",
    "  stop",
    "end",
    "",
    "on sense robot",
    "  stop",
    "end",
  ].join("\n");

  it("gives the declarations a row of their own, as a title bar", () => {
    /*
     * Alone, because they are not behaviour: they are what the {robot} is, and
     * there is exactly one of them. Sharing the row with `on start` made the
     * heading read as the first of several handlers.
     */
    expect(tidyBands(fromSource(src))[0]!.keys).toEqual(["robot"]);
  });

  it("puts `start` at the same left margin as every other handler", () => {
    // It is behaviour — the first thing that happens — so it lines up with
    // the things that happen next rather than with the declarations.
    const bands = tidyBands(fromSource(src));
    expect(bands[1]).toEqual({ event: "start", keys: ["on:start"] });
  });

  it("bands the rest by event, in the language's order not the file's", () => {
    const bands = tidyBands(fromSource(src));
    const events = bands.slice(1).map((b) => b.event);
    /*
     * `EVENT_NAMES` order, which is the sensing events, then the collisions,
     * then the rest — not the order the file happens to be in and not
     * alphabetical. `hit wall` before `hit by bullet` because that is where
     * the language puts them.
     */
    expect(events.filter(Boolean)).toEqual([
      "start",
      "sense robot",
      "hit wall",
      "hit by bullet",
    ]);
  });

  it("keeps a behaviour beside the event it is declared `given`", () => {
    const bands = tidyBands(fromSource(src));
    const band = bands.find((b) => b.event === "hit by bullet")!.keys;
    // With no `on hit by bullet`, the behaviour *is* the handler.
    expect(band).toContain("can:dodge");
  });

  it("puts the library before the things that use it", () => {
    /*
     * A behaviour that names no event is a *part* — something a handler
     * `do`es — and it is read before the handler, not after. Boid is written
     * entirely this way: `fold`, `remember`, `fly` and `forget` are the
     * vocabulary and everything else is a sentence built out of it. Put last,
     * the reader meets every call before the thing it calls.
     */
    const bands = tidyBands(fromSource(src));
    const library = bands.findIndex((b) => b.keys.includes("can:helper"));
    const firstHandler = bands.findIndex((b) => b.event !== null && b.event !== "start");
    expect(library).toBeGreaterThan(0);
    expect(library).toBeLessThan(firstHandler);
  });

  it("keeps the library after the starting work, not before it", () => {
    const bands = tidyBands(fromSource(src));
    expect(bands.map((b) => b.keys)).toEqual([
      ["robot"],
      ["on:start"],
      ["can:helper"],
      ["on:sense robot"],
      ["on:hit wall"],
      ["can:dodge"],
    ]);
  });

  it("is the same picture however the file is ordered", () => {
    // The property that makes two people's changes comparable.
    const shuffled = [
      'name "R"',
      "chassis tank",
      "",
      "on sense robot",
      "  stop",
      "end",
      "",
      "on start",
      "  stop",
      "end",
      "",
      "can helper",
      "  stop",
      "end",
      "",
      "on hit wall",
      "  stop",
      "end",
      "",
      "can dodge given hit by bullet",
      "  stop",
      "end",
    ].join("\n");
    expect(tidyBands(fromSource(shuffled))).toEqual(tidyBands(fromSource(src)));
  });

  it("moves only the new band when a handler is added", () => {
    const before = tidyBands(fromSource(src));
    const after = tidyBands(fromSource(`${src}\n\non tick\n  stop\nend`));
    // Every band that existed before is still there, in the same order.
    const same = (a: { keys: string[] }, b: { keys: string[] }) => a.keys.join() === b.keys.join();
    expect(after.filter((b) => before.some((x) => same(x, b)))).toEqual(before);
  });

  it("names every block exactly once across the bands", () => {
    for (const { source } of SAMPLE_BOTS) {
      const sketch = fromSource(source);
      const flat = tidyBands(sketch).flatMap((b) => b.keys);
      expect(new Set(flat).size).toBe(flat.length);
      expect(flat.sort()).toEqual(layoutKeys(sketch).sort());
    }
  });
});

describe("keeping stored positions honest", () => {
  const sketch = fromSource('name "R"\nchassis tank\n\non start\n  stop\nend');

  it("forgets a position whose block is gone", () => {
    // A renamed behaviour is a new key, and the old one would sit in storage
    // forever — and come back if the name were ever reused.
    const pruned = pruneLayout(
      { robot: { x: 0, y: 0 }, "on:start": { x: 1, y: 1 }, "can:gone": { x: 2, y: 2 } },
      sketch,
    );
    expect(Object.keys(pruned).sort()).toEqual(["on:start", "robot"]);
  });

  it("knows when a layout does not cover the script", () => {
    expect(isComplete(undefined, sketch)).toBe(false);
    expect(isComplete({ robot: { x: 0, y: 0 } }, sketch)).toBe(false);
    expect(isComplete({ robot: { x: 0, y: 0 }, "on:start": { x: 1, y: 1 } }, sketch)).toBe(true);
  });
});

/**
 * Reading and applying positions, against a real workspace.
 *
 * The measuring half of the arrangement needs a rendered canvas and cannot be
 * checked here — but matching a stored position to the block it belongs to
 * can, and that is the half where being wrong is silent: a layout that lands
 * on the wrong block moves somebody's work without telling them.
 */
describe("positions, through a real workspace", () => {
  const src = [
    'name "R"',
    "chassis tank",
    "",
    "on start",
    "  stop",
    "end",
    "",
    "can dodge given hit by bullet",
    "  stop",
    "end",
  ].join("\n");

  it("names every top-level block the script has", () => {
    const { ws, sketch } = loadWorkspace(src);
    expect([...topBlocks(ws, sketch).keys()].sort()).toEqual([
      "can:dodge",
      "on:start",
      "robot",
    ]);
    ws.dispose();
  });

  it("puts a block back exactly where it was left", () => {
    const { ws, sketch } = loadWorkspace(src);
    topBlocks(ws, sketch).get("can:dodge")!.moveBy(320, 210);
    const remembered = readLayout(ws, sketch);
    expect(remembered["can:dodge"]).toEqual({ x: 320, y: 210 });
    ws.dispose();

    // A fresh workspace, the same script, the remembered positions.
    const reopened = loadWorkspace(src);
    applyLayout(reopened.ws, reopened.sketch, remembered);
    expect(
      topBlocks(reopened.ws, reopened.sketch).get("can:dodge")!.getRelativeToSurfaceXY(),
    ).toMatchObject({ x: 320, y: 210 });
    reopened.ws.dispose();
  });

  it("follows a block that moved in the file rather than a position", () => {
    /*
     * The whole reason the key is not the block id. `on start` was written
     * first and is now written second; its remembered position has to follow
     * the handler, not the slot.
     */
    const moved = [
      'name "R"',
      "chassis tank",
      "",
      "can dodge given hit by bullet",
      "  stop",
      "end",
      "",
      "on start",
      "  stop",
      "end",
    ].join("\n");

    const first = loadWorkspace(src);
    topBlocks(first.ws, first.sketch).get("on:start")!.moveBy(500, 40);
    const remembered = readLayout(first.ws, first.sketch);
    first.ws.dispose();

    const second = loadWorkspace(moved);
    applyLayout(second.ws, second.sketch, remembered);
    const blocks = topBlocks(second.ws, second.sketch);
    expect(blocks.get("on:start")!.getRelativeToSurfaceXY()).toMatchObject({ x: 500, y: 40 });
    expect(blocks.get("can:dodge")!.getRelativeToSurfaceXY()).not.toMatchObject({ x: 500, y: 40 });
    second.ws.dispose();
  });

  it("ignores a remembered position for a block that is gone", () => {
    const { ws, sketch } = loadWorkspace(src);
    applyLayout(ws, sketch, { "can:vanished": { x: 900, y: 900 } });
    for (const block of topBlocks(ws, sketch).values()) {
      expect(block.getRelativeToSurfaceXY().x).not.toBe(900);
    }
    ws.dispose();
  });
});

/**
 * The geometry, as far as it can be checked without a rendered canvas.
 *
 * `tidy` needs real block sizes and so needs an SVG workspace, which these
 * tests do not have. What can be checked is the shape the sizes are poured
 * into: which blocks share a row, and in what order — which is the half that
 * decides whether two people's robots are comparable.
 */
describe("the shape of a tidy", () => {
  const src = [
    'name "R"',
    "chassis tank",
    "",
    "on start",
    "  stop",
    "end",
    "",
    "can dodge given sense robot",
    "  stop",
    "end",
    "",
    "on sense robot",
    "  stop",
    "end",
    "",
    "can helper",
    "  stop",
    "end",
  ].join("\n");

  it("keeps the declarations out of every handler row", () => {
    // They are placed in the corner by `tidy`; their band exists so that the
    // key is accounted for, not so that it takes a row beside a handler.
    const bands = tidyBands(fromSource(src));
    expect(bands[0]!.keys).toEqual(["robot"]);
    expect(bands.slice(1).flatMap((b) => b.keys)).not.toContain("robot");
  });

  it("puts the handler and its behaviours on one row, handler first", () => {
    // Same event, one idea: `can dodge given sense robot` runs when the
    // sensing handler does, and reading them as a row says so.
    const band = tidyBands(fromSource(src)).find((b) => b.event === "sense robot")!;
    expect(band.keys).toEqual(["on:sense robot", "can:dodge"]);
  });

  it("starts with `start`, so it can share the heading's line", () => {
    const bands = tidyBands(fromSource(src));
    expect(bands[1]!.event).toBe("start");
  });

  it("reads the behaviours that answer to nothing before their callers", () => {
    const bands = tidyBands(fromSource(src));
    const library = bands.findIndex((b) => b.keys.includes("can:helper"));
    const handlers = bands.findIndex((b) => b.event !== null && b.event !== "start");
    expect(library).toBeGreaterThan(0);
    expect(library).toBeLessThan(handlers);
  });
});

/**
 * The line beside the heading is `on start`'s, whether or not there is any.
 *
 * A robot with nothing to do at the start is worth noticing, and an empty
 * space where the starting work goes says it at a glance. Sliding the next
 * handler up into the gap would say nothing at all — and would put a
 * `sense robot` block exactly where a reader has learnt to find `start`.
 *
 * `tidy` needs a rendered canvas, so what is checked here is the part that
 * decides it: that `start` is always its own band and always the first, so the
 * geometry has one row to hold open and knows which.
 */
describe("the reserved line", () => {
  const withStart = 'name "R"\nchassis tank\n\non start\n  stop\nend\n\non hit wall\n  stop\nend';
  const without = 'name "R"\nchassis tank\n\non hit wall\n  stop\nend\n\non sense robot\n  stop\nend';

  it("gives `start` a band of its own, first after the heading", () => {
    const bands = tidyBands(fromSource(withStart));
    expect(bands[0]!.keys).toEqual(["robot"]);
    expect(bands[1]).toEqual({ event: "start", keys: ["on:start"] });
  });

  it("has no start band at all when there is no start code", () => {
    // Which is what leaves the row empty rather than filled by the next one.
    expect(tidyBands(fromSource(without)).some((b) => b.event === "start")).toBe(false);
  });

  it("reserves nothing for any other event", () => {
    /*
     * Every other event is absent from most robots, and a row held open for
     * each would be a page of gaps. Only the events a robot actually handles
     * get a band.
     */
    const bands = tidyBands(fromSource(without));
    expect(bands.map((b) => b.event)).toEqual([null, "sense robot", "hit wall"]);
  });
});
