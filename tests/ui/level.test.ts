import { describe, expect, it } from "vitest";
import {
  AGE_BANDS,
  DEFAULT_LEVEL,
  LEVELS,
  LEVEL_SPECS,
  levelForAge,
  nextLevel,
  panesFor,
  parseLevel,
  showsMode,
  showsPanel,
  type Level,
} from "../../src/ui/level.js";
import { ARENA_PANES, ROBOT_PANES, type Pane, type PanelName } from "../../src/ui/panes.js";
import { SCREENS } from "../../src/ui/router.js";
import { FIRE_SETTINGS, FUEL_SETTINGS, TERRAIN_SETTINGS } from "../../src/ui/matchSettings.js";
import { starterRobot } from "../../src/ui/useLibrary.js";
import { TOUR_ROBOT, TOUR_SEED } from "../../src/bots/index.js";
import { Tours } from "../../src/store/tour.js";
import { MemoryStore } from "../../src/store/storage.js";

const ALL_PANES: Pane[] = ["editor", "map", "trial", "bench", "history"];
const ALL_PANELS: PanelName[] = ["robots", "behaviours", "arenas", "room", "chat", "session"];

describe("the level table", () => {
  it("names only things that exist", () => {
    for (const level of LEVELS) {
      const spec = LEVEL_SPECS[level];
      expect(spec.panes.every((p) => ALL_PANES.includes(p))).toBe(true);
      expect(spec.sidebar.every((p) => ALL_PANELS.includes(p))).toBe(true);
      expect(spec.modes.every((m) => (SCREENS as readonly string[]).includes(m))).toBe(true);
      expect(FUEL_SETTINGS[spec.match.fuel]).toBeDefined();
      expect(TERRAIN_SETTINGS[spec.match.terrain]).toBeDefined();
      expect(FIRE_SETTINGS[spec.match.fire]).toBeDefined();
    }
  });

  it("gives every level a way to author and something to author with", () => {
    for (const level of LEVELS) {
      const spec = LEVEL_SPECS[level];
      expect(spec.authoring.length).toBeGreaterThan(0);
      expect(spec.panes).toContain("editor");
      expect(spec.sidebar).toContain("robots");
      expect(spec.modes).toContain("workshop");
    }
  });

  /**
   * The one property the whole design rests on: levelling up only ever adds.
   * A player who moves up and finds something they were using has gone would
   * have been punished for progressing.
   */
  it("nests, so moving up never takes anything away", () => {
    for (const level of LEVELS) {
      const up = nextLevel(level);
      if (!up) continue;
      const below = LEVEL_SPECS[level];
      const above = LEVEL_SPECS[up];
      for (const pane of below.panes) expect(above.panes).toContain(pane);
      for (const panel of below.sidebar) expect(above.sidebar).toContain(panel);
      for (const mode of below.modes) expect(above.modes).toContain(mode);
    }
  });

  /**
   * Authoring is the one exception to that, deliberately.
   *
   * Cards are dropped at Engineer. Blocks are held to saying everything the
   * language can — `tests/workshop/parity.test.ts` enforces it — and cards
   * never will be: they are a flat list with one control per line, and an
   * Engineer's robot is full of `can`, `do` and nesting that a card can only
   * show as a lump of text it refuses to edit. A view that cannot hold your
   * work is worse than no view.
   */
  it("runs the authoring tabs in one order everywhere, most of the language first", () => {
    const ORDER = ["text", "blocks", "cards"];
    for (const level of LEVELS) {
      const ways = LEVEL_SPECS[level].authoring;
      const ranks = ways.map((w) => ORDER.indexOf(w));
      expect(ranks, level).toEqual([...ranks].sort((a, b) => a - b));
      expect(ranks.every((r) => r >= 0), level).toBe(true);
    }
  });

  it("gives the oldest players code and blocks, and not cards", () => {
    expect(LEVEL_SPECS.engineer.authoring).toEqual(["text", "blocks"]);
    expect(LEVEL_SPECS.explorer.authoring).toEqual(["cards"]);
  });

  it("tops out at Engineer with the whole game", () => {
    const top = LEVEL_SPECS.engineer;
    expect(nextLevel("engineer")).toBeNull();
    expect([...top.panes].sort()).toEqual([...ALL_PANES].sort());
    expect([...top.sidebar].sort()).toEqual([...ALL_PANELS].sort());
    expect(top.register).toBe("full");
    expect(top.skin).toBe("instrument");
  });
});

describe("reading a level back", () => {
  it("falls back to the whole game rather than guessing lower", () => {
    // Every player who predates the setting has no stored value, and taking
    // the game away from them would be the one unrecoverable mistake here.
    expect(parseLevel(null)).toBe("engineer");
    expect(parseLevel(undefined)).toBe("engineer");
    expect(parseLevel("")).toBe("engineer");
    expect(parseLevel("wizard")).toBe("engineer");
    expect(DEFAULT_LEVEL).toBe("engineer");
  });

  it("round-trips every real level", () => {
    for (const level of LEVELS) expect(parseLevel(level)).toBe(level);
  });
});

describe("age bands", () => {
  it("cover the ages in order and resolve to real levels", () => {
    expect(AGE_BANDS.length).toBeGreaterThan(0);
    const levels = AGE_BANDS.map((b) => b.level);
    for (const level of levels) expect(LEVELS).toContain(level);
    // Monotonic: an older band never lands on a lower level.
    const rank = (l: Level) => LEVELS.indexOf(l);
    for (let i = 1; i < levels.length; i++) {
      expect(rank(levels[i]!)).toBeGreaterThanOrEqual(rank(levels[i - 1]!));
    }
  });

  it("maps the youngest band to Explorer", () => {
    expect(levelForAge("6-8")).toBe("explorer");
  });
});

describe("filtering", () => {
  it("intersects what the level shows with what the thing has", () => {
    // An arena has no script, so no level can produce an editor tab for one.
    for (const level of LEVELS) {
      expect(panesFor(level, "arena")).not.toContain("editor");
      expect(panesFor(level, "arena").every((p) => ARENA_PANES.includes(p))).toBe(true);
      expect(panesFor(level, "robot").every((p) => ROBOT_PANES.includes(p))).toBe(true);
    }
  });

  it("keeps the declared order rather than the level's", () => {
    // Tabs must not reshuffle when a pane is unlocked mid-session.
    expect(panesFor("engineer", "robot")).toEqual([...ROBOT_PANES]);
  });

  it("lets an unlock add something the level does not show", () => {
    expect(panesFor("explorer", "robot")).not.toContain("bench");
    expect(panesFor("explorer", "robot", ["bench"])).toContain("bench");
    expect(showsPanel("explorer", "behaviours")).toBe(false);
    expect(showsPanel("explorer", "behaviours", ["behaviours"])).toBe(true);
    expect(showsMode("explorer", "trade")).toBe(false);
    expect(showsMode("explorer", "trade", ["trade"])).toBe(true);
  });

  it("never invents a pane the thing does not have, even when unlocked", () => {
    expect(panesFor("explorer", "arena", ["editor"])).not.toContain("editor");
  });
});

describe("what a new player is handed", () => {
  it("gives an Explorer the robot that cannot fight, tour or no tour", () => {
    /*
     * The Explorer quests are the tour told in five steps, and the third of
     * them turns on discovering that your robot never fired. `TOUR_ROBOT` —
     * what skipping the tour normally gets you — already senses and fires, so
     * handing it to an Explorer finishes the argument before it is made.
     */
    const skipped = skippedTours();
    expect(starterRobot(true, "explorer", skipped)).toBe(TOUR_SEED);
    expect(starterRobot(true, "explorer", new Tours(new MemoryStore()))).toBe(TOUR_SEED);
  });

  it("still gives everybody else the finished robot when they skip the tour", () => {
    // Unchanged: skipping the tour should cost you the tour, not the robot it
    // would have produced.
    const skipped = skippedTours();
    expect(starterRobot(true, "builder", skipped)).toBe(TOUR_ROBOT);
    expect(starterRobot(true, "engineer", skipped)).toBe(TOUR_ROBOT);
  });

  it("seeds nothing before a world has been chosen", () => {
    expect(starterRobot(false, "explorer")).toBeNull();
    expect(starterRobot(false, "engineer")).toBeNull();
  });

  /** Built through the public API rather than by hand: the stored shape is
      `Tours`' own business, and a test that reimplements it tests itself. */
  function skippedTours() {
    const tours = new Tours(new MemoryStore());
    tours.skip("workshop");
    return tours;
  }
});
