import { beforeEach, describe, expect, it } from "vitest";
import { Library, STARTER_SCRIPT, deriveMeta } from "../../src/store/library.js";
import { MemoryStore } from "../../src/store/storage.js";
import { HUNTER, RACER } from "../../src/bots/index.js";

let store: MemoryStore;
let library: Library;

beforeEach(() => {
  store = new MemoryStore();
  library = new Library(store);
});

describe("robots", () => {
  it("starts empty and survives a round trip", () => {
    expect(library.list()).toEqual([]);
    const robot = library.create(HUNTER);
    // A fresh Library over the same store is what a page reload looks like.
    expect(new Library(store).list()).toHaveLength(1);
    expect(new Library(store).get(robot.id)?.source).toBe(HUNTER);
  });

  it("derives name and colour from the script", () => {
    const robot = library.create(HUNTER);
    expect(robot.name).toBe("Hunter");
    expect(robot.color).toBe("#ff8800");
  });

  it("re-derives them when the script changes", () => {
    const robot = library.create(HUNTER);
    const updated = library.updateSource(robot.id, RACER);
    expect(updated?.name).toBe("Racer");
    expect(updated?.color).toBe("#ffd166");
  });

  it("keeps the last good name while the script is broken", () => {
    // Mid-keystroke the script rarely parses; the library must not flicker.
    const robot = library.create(HUNTER);
    const updated = library.updateSource(robot.id, 'name "Hunt');
    expect(updated?.name).toBe("Hunter");
    expect(updated?.source).toBe('name "Hunt');
  });

  it("gives a usable starter script that compiles", () => {
    expect(deriveMeta(STARTER_SCRIPT)).not.toBeNull();
  });

  it("duplicates without carrying the original's history", () => {
    const robot = library.create(HUNTER);
    library.saveSnapshot(robot.id, "v1");
    const copy = library.duplicate(robot.id);
    expect(copy?.source).toBe(HUNTER);
    expect(copy?.id).not.toBe(robot.id);
    expect(copy?.snapshots).toEqual([]);
    expect(library.get(robot.id)?.snapshots).toHaveLength(1);
  });

  it("removes a robot", () => {
    const robot = library.create(HUNTER);
    library.remove(robot.id);
    expect(library.list()).toEqual([]);
  });

  it("survives a corrupted entry rather than throwing", () => {
    store.set("robots", "{not json");
    expect(library.list()).toEqual([]);
  });
});

describe("snapshots", () => {
  it("freezes the working copy and leaves it editable", () => {
    const robot = library.create(HUNTER);
    library.saveSnapshot(robot.id, "v1 first try");
    library.updateSource(robot.id, RACER);

    const stored = library.get(robot.id)!;
    expect(stored.source).toBe(RACER);
    expect(stored.snapshots[0]!.source).toBe(HUNTER);
    expect(stored.snapshots[0]!.label).toBe("v1 first try");
  });

  it("orders newest first", () => {
    const robot = library.create(HUNTER);
    library.saveSnapshot(robot.id, "one");
    library.saveSnapshot(robot.id, "two");
    expect(library.get(robot.id)?.snapshots.map((s) => s.label)).toEqual(["two", "one"]);
  });

  it("names a snapshot automatically when none is given", () => {
    const robot = library.create(HUNTER);
    library.saveSnapshot(robot.id, "   ");
    expect(library.get(robot.id)?.snapshots[0]!.label).toBe("v1");
  });

  it("restores a snapshot over the working copy", () => {
    const robot = library.create(HUNTER);
    library.saveSnapshot(robot.id, "good");
    library.updateSource(robot.id, RACER);
    library.restoreSnapshot(robot.id, library.get(robot.id)!.snapshots[0]!.id);

    const stored = library.get(robot.id)!;
    expect(stored.source).toBe(HUNTER);
    expect(stored.name).toBe("Hunter");
    // Restoring is not destructive: the snapshot is still there.
    expect(stored.snapshots).toHaveLength(1);
  });

  it("keeps a traded script as a version that says where it came from", () => {
    const robot = library.importTraded(HUNTER, "Ada", 1_700_000_000_000);

    expect(robot.source).toBe(HUNTER);
    expect(robot.name).toBe("Hunter");
    const version = library.get(robot.id)!.snapshots[0]!;
    expect(version.label).toBe("From Ada");
    expect(version.source).toBe(HUNTER);
    expect(version.origin).toEqual({
      kind: "trade",
      from: "Ada",
      at: 1_700_000_000_000,
      robotName: "Hunter",
    });
  });

  it("survives the trade after the robot has been edited beyond recognition", () => {
    // The whole point of recording it against the version: the working copy
    // moves on, and the credit does not.
    const robot = library.importTraded(HUNTER, "Ada");
    library.updateSource(robot.id, RACER);

    const stored = library.get(robot.id)!;
    expect(stored.name).toBe("Racer");
    expect(stored.snapshots[0]!.origin?.from).toBe("Ada");
    expect(stored.snapshots[0]!.origin?.robotName).toBe("Hunter");
  });

  it("names an anonymous trader rather than leaving a blank", () => {
    const robot = library.importTraded(HUNTER, "   ");
    expect(library.get(robot.id)!.snapshots[0]!.label).toBe("From someone");
  });

  it("adds a traded version to a robot you already have", () => {
    const robot = library.create(HUNTER);
    library.saveSnapshot(robot.id, "mine");
    library.addTradedVersion(robot.id, RACER, "Bob");

    const stored = library.get(robot.id)!;
    expect(stored.source).toBe(RACER);
    expect(stored.snapshots.map((s) => s.label)).toEqual(["From Bob", "mine"]);
    expect(stored.snapshots[0]!.origin?.from).toBe("Bob");
    // Your own history is not retrospectively credited to anyone.
    expect(stored.snapshots[1]!.origin).toBeUndefined();
  });

  it("pins, renames and removes", () => {
    const robot = library.create(HUNTER);
    const snap = library.saveSnapshot(robot.id, "v1")!;

    library.togglePin(robot.id, snap.id);
    expect(library.get(robot.id)?.snapshots[0]!.pinned).toBe(true);
    library.togglePin(robot.id, snap.id);
    expect(library.get(robot.id)?.snapshots[0]!.pinned).toBe(false);

    library.renameSnapshot(robot.id, snap.id, "renamed");
    expect(library.get(robot.id)?.snapshots[0]!.label).toBe("renamed");

    library.removeSnapshot(robot.id, snap.id);
    expect(library.get(robot.id)?.snapshots).toEqual([]);
  });
});
