import { describe, expect, it } from "vitest";
import { MemoryStore, writeJson } from "../../src/store/storage.js";
import { WorkshopPrefs } from "../../src/store/workshop.js";

describe("WorkshopPrefs", () => {
  it("remembers selections and accordion state", () => {
    const store = new MemoryStore();
    const prefs = new WorkshopPrefs(store);
    prefs.setPane("history");
    prefs.setSelectedRobotId("robot_a");
    prefs.setSelectedArenaId("arena_b");
    prefs.setAccordion("behaviours", false);

    const restored = new WorkshopPrefs(store);
    expect(restored.pane("editor")).toBe("history");
    expect(restored.selectedRobotId()).toBe("robot_a");
    expect(restored.selectedArenaId()).toBe("arena_b");
    expect(restored.accordion("behaviours", true)).toBe(false);
  });

  it("falls back from corrupt or unknown values", () => {
    const store = new MemoryStore();
    writeJson(store, "workshopLayout", { pane: "elsewhere", accordions: { robots: "yes" } });
    const prefs = new WorkshopPrefs(store);
    expect(prefs.pane("editor")).toBe("editor");
    expect(prefs.accordion("robots", true)).toBe(true);
  });
});
