/**
 * "Delete everything" meaning everything.
 *
 * This exists because it stopped being true. The button deleted robots,
 * arenas, battles and chat — the four things it was written to delete — and
 * silently went on ignoring lessons read, tours seen, and the name and world,
 * as those were added around it. The result was no way to see the game as a
 * new player sees it without opening devtools, which is precisely the person
 * the onboarding is for.
 *
 * So the test is deliberately written against the *store*, not against a list
 * of features: after a wipe there are no keys at all. Anything added later is
 * covered without anybody having to remember this file exists.
 */

import { describe, expect, it } from "vitest";
import { MemoryStore, wipe } from "../../src/store/storage.js";
import { Library } from "../../src/store/library.js";
import { ArenaLibrary } from "../../src/store/arenas.js";
import { BattleLog } from "../../src/store/battles.js";
import { ChatLog } from "../../src/store/chat.js";
import { Progress } from "../../src/store/progress.js";
import { Tours } from "../../src/store/tour.js";
import { FLAT_ARENA } from "../../src/sim/types.js";

/** A store in the state a player who has been using the game leaves it in. */
function usedStore(): MemoryStore {
  const store = new MemoryStore();

  new Library(store).create('name "Keeper"\nchassis tank\n\non start\n  drive forward 10\nend\n');
  new ArenaLibrary(store).create("Somewhere", FLAT_ARENA);
  new ChatLog(store).append("robot-1", {
    at: Date.now(),
    author: "Someone",
    authorPeerId: "peer-1",
    text: "nice robot",
  });
  new Progress(store).markDone("first-robot");
  const tours = new Tours(store);
  tours.finish("workshop");
  tours.setMuted(true);
  store.set("playerName", "Matt");
  store.set("theme", "biological");
  store.set("onboarded", "yes");

  return store;
}

describe("wipe", () => {
  it("leaves nothing behind at all", () => {
    const store = usedStore();
    expect(store.keys().length).toBeGreaterThan(0);
    wipe(store);
    expect(store.keys()).toEqual([]);
  });

  it("forgets who you are, so the welcome screen comes back", () => {
    const store = usedStore();
    wipe(store);
    expect(store.get("onboarded")).toBeNull();
    expect(store.get("playerName")).toBeNull();
    expect(store.get("theme")).toBeNull();
  });

  it("forgets the tours and the lessons, not just the robots", () => {
    // The two that were being missed. Named individually because they are the
    // difference between "starting over" and "starting over except for the
    // parts that tell you you have been here before".
    const store = usedStore();
    wipe(store);
    expect(new Tours(store).state("workshop")).toBe("unseen");
    expect(new Progress(store).count()).toBe(0);
  });

  it("empties the libraries", () => {
    const store = usedStore();
    wipe(store);
    expect(new Library(store).list()).toEqual([]);
    expect(new ArenaLibrary(store).list()).toEqual([]);
    expect(new BattleLog(store).list()).toEqual([]);
  });

  it("does not mind being run on a store that is already empty", () => {
    const store = new MemoryStore();
    expect(() => wipe(store)).not.toThrow();
    expect(store.keys()).toEqual([]);
  });

  it("leaves a wiped store usable rather than broken", () => {
    // A new player's first action happens against this store immediately.
    const store = usedStore();
    wipe(store);
    const library = new Library(store);
    library.create('name "New"\nchassis tank\n\non start\n  drive forward 10\nend\n');
    expect(library.list()).toHaveLength(1);
  });
});
