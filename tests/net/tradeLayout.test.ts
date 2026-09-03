import { describe, expect, it } from "vitest";
import { sanitiseGoods, sanitiseLayout } from "../../src/net/protocol.js";
import { Library } from "../../src/store/library.js";
import { MemoryStore } from "../../src/store/storage.js";
import { offeredGoods, tableKey } from "../../src/ui/tradeShelf.js";
import { TOUR_ROBOT } from "../../src/bots/index.js";

/**
 * A layout arrives from somebody else's browser, so it is untrusted like
 * everything else on the wire — and unusually easy to make harmful by
 * accident. A coordinate of `Infinity` would be applied without complaint and
 * the receiver's canvas would be empty, their {robot} somewhere off in the
 * dark, with nothing to say why.
 */
describe("a layout off the wire", () => {
  it("keeps an ordinary one", () => {
    expect(sanitiseLayout({ robot: { x: 10, y: 20 } })).toEqual({ robot: { x: 10, y: 20 } });
  });

  it("drops a position that is not a finite pair of numbers", () => {
    expect(
      sanitiseLayout({
        good: { x: 1, y: 2 },
        infinite: { x: Infinity, y: 0 },
        nan: { x: NaN, y: 0 },
        text: { x: "3", y: 4 },
        missing: { x: 5 },
        nothing: null,
      }),
    ).toEqual({ good: { x: 1, y: 2 } });
  });

  it("refuses a position far outside any canvas", () => {
    expect(sanitiseLayout({ far: { x: 1e9, y: 0 } })).toBeUndefined();
  });

  it("caps how many blocks it will name", () => {
    const huge = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`k${i}`, { x: i, y: i }]),
    );
    expect(Object.keys(sanitiseLayout(huge)!).length).toBeLessThanOrEqual(64);
  });

  it("treats no layout as no layout rather than an empty one", () => {
    expect(sanitiseLayout(undefined)).toBeUndefined();
    expect(sanitiseLayout({})).toBeUndefined();
    expect(sanitiseLayout("nonsense")).toBeUndefined();
  });
});

describe("giving a robot away", () => {
  function libraryWith(layout?: Record<string, { x: number; y: number }>) {
    const store = new MemoryStore();
    const library = new Library(store);
    const robot = library.create(TOUR_ROBOT);
    if (layout) library.setLayout(robot.id, layout);
    return { library, robot: library.get(robot.id)! };
  }

  it("packs the layout with it", () => {
    const { library, robot } = libraryWith({ robot: { x: 0, y: 0 }, "on:start": { x: 300, y: 0 } });
    const goods = offeredGoods(
      { robots: [robot], arenas: [], blocks: [] },
      [tableKey("robot", robot.id)],
      "robot",
      robot.id,
    );
    expect(goods).toMatchObject({ kind: "robot" });
    expect((goods as { layout?: unknown }).layout).toEqual({
      robot: { x: 0, y: 0 },
      "on:start": { x: 300, y: 0 },
    });
    expect(library).toBeDefined();
  });

  it("survives the round trip and lands in the receiver's library", () => {
    const sent = { kind: "robot", name: "R", color: "#ff8800", source: TOUR_ROBOT,
      layout: { robot: { x: 4, y: 8 } } };
    const received = sanitiseGoods(JSON.parse(JSON.stringify(sent)))!;
    expect(received.kind).toBe("robot");

    const theirs = new Library(new MemoryStore());
    const added = theirs.importTraded(
      (received as { source: string }).source,
      "Sam",
      1,
      (received as { layout?: Record<string, { x: number; y: number }> }).layout,
    );
    expect(theirs.get(added.id)!.layout).toEqual({ robot: { x: 4, y: 8 } });
  });

  it("arrives usable when the sender had no layout at all", () => {
    // Every robot written before layouts existed, and every one only ever
    // written as text. The receiver lays it out canonically on first open.
    const received = sanitiseGoods({ kind: "robot", name: "R", color: "#ff8800", source: TOUR_ROBOT })!;
    expect((received as { layout?: unknown }).layout).toBeUndefined();
    const theirs = new Library(new MemoryStore());
    const added = theirs.importTraded((received as { source: string }).source, "Sam", 1, undefined);
    expect(theirs.get(added.id)!.layout).toBeUndefined();
    expect(theirs.get(added.id)!.source).toBe(TOUR_ROBOT);
  });
});
