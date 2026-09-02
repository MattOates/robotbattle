/**
 * How much game you are being shown, and how it is dressed.
 *
 * The game grew as one surface for one kind of player: somebody who can read
 * "Lean pickings. Anything that drives everywhere will be crawling by the end"
 * and type `turret.aim at event.bearing` without being taught to. That player
 * still exists and loses nothing here — `engineer` is the game exactly as it
 * was. The other two levels are the same game with fewer doors open at once and
 * bigger handles on the ones that are.
 *
 * A level is asked for once, on the welcome screen, in terms of age, and is a
 * plain setting afterwards. It is never a score and never a permission: nothing
 * a level hides is unreachable, and the quest system (`workshop/quests.ts`)
 * exists to walk somebody up rather than to lock them down.
 *
 * Pure data with no React and no DOM, so `tests/ui/level.test.ts` can assert the
 * table is coherent — that every pane a level names is a real pane, that the
 * levels nest, and that nothing is stranded.
 */

import { ARENA_PANES, ROBOT_PANES, type Authoring, type Pane, type PanelName } from "./panes.js";
import type { ScreenName } from "./router.js";
import type { FireLevel, FuelLevel, TerrainLevel } from "./matchSettings.js";

export const LEVELS = ["explorer", "builder", "engineer"] as const;
export type Level = (typeof LEVELS)[number];

/** Which stylesheet the same components are rendered through. */
export type Skin = "playground" | "instrument";

/** Which of the two registers the copy tables are read in. */
export type Register = "simple" | "full";

export interface LevelSpec {
  id: Level;
  label: string;
  /** What the level is for, in one line, for the welcome cards and settings. */
  blurb: string;
  /** Ages this is aimed at. A hint on a card, never stored and never checked. */
  ageHint: string;
  skin: Skin;
  register: Register;
  /** Authoring views offered, most approachable first. The first is the default. */
  authoring: readonly Authoring[];
  /** Read everything aloud unless they turn it off. */
  voiceDefault: boolean;
  /** Which Workshop tabs exist. Intersected with what the thing being edited has. */
  panes: readonly Pane[];
  /** Which sidebar shelves exist. */
  sidebar: readonly PanelName[];
  /** Which stations of the spine are lit on the menu. */
  modes: readonly ScreenName[];
  /**
   * What a fight is set to before anybody touches the settings.
   *
   * Explorer fights have no fuel and flat ground on purpose. Both are good
   * mechanics and both are a second thing to explain at the moment somebody is
   * still working out why their robot drove into a wall.
   */
  match: { fuel: FuelLevel; terrain: TerrainLevel; fire: FireLevel };
}

/**
 * Deliberately spelled out per level rather than expressed as a diff against
 * the one below. The table is the specification — being able to read one row
 * and know exactly what that player sees is worth the repetition, and it is
 * what the tests check.
 */
export const LEVEL_SPECS: Readonly<Record<Level, LevelSpec>> = {
  explorer: {
    id: "explorer",
    label: "Explorer",
    blurb:
      "Big buttons and picture cards, with everything read out loud. Build a robot by tapping, and watch it fight.",
    ageHint: "About 6 to 8",
    skin: "playground",
    register: "simple",
    /*
     * Cards, and only cards.
     *
     * Cards and blocks are the same catalogue drawn twice, and cards ask
     * less of the person using them: nothing to drag, nothing to aim at, one
     * column that reads top to bottom like a list, and every value a slider or
     * a dropdown. Blocks ask for a mouse gesture before they ask for an idea.
     * At six to eight that is the wrong order.
     */
    authoring: ["cards"],
    voiceDefault: true,
    /*
     * One tab. Not two.
     *
     * No bench and no history: both are ways of asking "is this actually
     * better", which is not a question you have yet at the point where the
     * answer to "did it win" is still interesting on its own. And no Trial
     * either, at first — the opening quest hands it over the moment the
     * {robot} can move, which takes about twenty seconds and makes the reward
     * a real one. A first screen with a single tab on it is also a first
     * screen with nothing to get wrong.
     */
    panes: ["editor"],
    sidebar: ["robots"],
    modes: ["learn", "workshop"],
    match: { fuel: "off", terrain: "flat", fire: "on" },
  },
  builder: {
    id: "builder",
    label: "Builder",
    blurb:
      "Cards and sentences, your own behaviours to reuse, places to draw, and real people to fight.",
    ageHint: "About 9 to 11",
    skin: "playground",
    register: "simple",
    /*
     * Blocks first, and the whole language in them — deciding, repeating,
     * remembering, not just a list of actions. This is the level where Scratch
     * is already familiar from school, and where the ideas that need nesting
     * are the ideas worth having. Cards stay as the quieter way back.
     */
    authoring: ["blocks", "cards"],
    /*
     * What a Builder is handed, as against what a Builder earns.
     *
     * The bench, the blocks shelf and the {arena} are all missing here and all
     * given out by this level's own quests — because each of them only makes
     * sense once you have felt the lack of it. A test bench shown to somebody
     * who has never wondered whether a change actually helped is a tab of
     * numbers; a test bench offered the moment they have changed something is
     * the answer to a question they just asked.
     */
    panes: ["editor", "map", "trial", "history"],
    voiceDefault: false,
    sidebar: ["robots", "arenas", "room", "chat", "session"],
    modes: ["learn", "workshop", "trade"],
    match: { fuel: "normal", terrain: "flat", fire: "on" },
  },
  engineer: {
    id: "engineer",
    label: "Engineer",
    blurb: "The whole instrument. Write RoboScript by hand, read the telemetry, run tournaments.",
    ageHint: "12 and up, or anyone who would rather just get on with it",
    skin: "instrument",
    register: "full",
    /*
     * Code and blocks, and no cards.
     *
     * The tabs run Code, Blocks, Cards everywhere they appear — most of the
     * language to least — and a level shows the leading part of that it has
     * earned. So an Engineer opens on code, which is what they came for, with
     * blocks one tab away: that pairing is the crossing itself, since the two
     * are views of one script. Change it in blocks, read what that says in
     * code, change it in code, watch the blocks follow.
     *
     * Cards are dropped here, and this is the one place the levels are not
     * cumulative. Blocks are held to saying everything the language can say —
     * `tests/workshop/parity.test.ts` will not let them be anything less — and
     * cards never will be: they are a flat list with one control per line, and
     * an Engineer's {robot} is full of `can`, `do` and nesting that a card can
     * only show as a lump of text it refuses to edit. Offering a view that
     * cannot hold your work is worse than not offering it.
     */
    authoring: ["text", "blocks"],
    voiceDefault: false,
    panes: ["editor", "map", "trial", "bench", "history"],
    sidebar: ["robots", "behaviours", "arenas", "room", "chat", "session"],
    modes: ["learn", "workshop", "arena", "tournament", "trade", "reference", "about"],
    match: { fuel: "normal", terrain: "rolling", fire: "on" },
  },
};

export const DEFAULT_LEVEL: Level = "engineer";

export function levelSpec(level: Level): LevelSpec {
  return LEVEL_SPECS[level];
}

/** The next level up, or null at the top. */
export function nextLevel(level: Level): Level | null {
  const at = LEVELS.indexOf(level);
  return LEVELS[at + 1] ?? null;
}

/**
 * Read a stored value back.
 *
 * Anything unrecognised — including nothing at all, which is every player who
 * predates this setting — is an Engineer. Guessing lower would take the game
 * away from somebody who already had all of it.
 */
export function parseLevel(value: string | null | undefined): Level {
  return (LEVELS as readonly string[]).includes(value ?? "") ? (value as Level) : DEFAULT_LEVEL;
}

/**
 * Which level an age answers to.
 *
 * The bands are the ones the welcome screen offers. The age itself is never
 * stored — only what it resolved to — because a birthday is not something this
 * game needs to keep, and the level is editable afterwards regardless.
 */
export const AGE_BANDS = [
  { id: "6-8", label: "6 to 8", level: "explorer" },
  { id: "9-11", label: "9 to 11", level: "builder" },
  { id: "12-14", label: "12 to 14", level: "engineer" },
  { id: "15+", label: "15 or older", level: "engineer" },
] as const satisfies readonly { id: string; label: string; level: Level }[];

export type AgeBand = (typeof AGE_BANDS)[number]["id"];

export function levelForAge(band: AgeBand): Level {
  return AGE_BANDS.find((b) => b.id === band)!.level;
}

/**
 * The panes to show for one thing being edited.
 *
 * Two independent filters that both have to pass: what the thing *has* (an
 * arena has no editor) and what the level *shows*. Unlocks earned from quests
 * are unioned into the level's set by the caller, which is why this takes them
 * rather than reading them.
 */
export function panesFor(
  level: Level,
  kind: "robot" | "arena",
  unlocked: readonly Pane[] = [],
): Pane[] {
  const available = kind === "arena" ? ARENA_PANES : ROBOT_PANES;
  const allowed = new Set<Pane>([...LEVEL_SPECS[level].panes, ...unlocked]);
  return available.filter((pane) => allowed.has(pane));
}

/** The same question for a sidebar shelf. */
export function showsPanel(
  level: Level,
  panel: PanelName,
  unlocked: readonly PanelName[] = [],
): boolean {
  return LEVEL_SPECS[level].sidebar.includes(panel) || unlocked.includes(panel);
}

/** And for a station on the menu. */
export function showsMode(
  level: Level,
  mode: ScreenName,
  unlocked: readonly ScreenName[] = [],
): boolean {
  return LEVEL_SPECS[level].modes.includes(mode) || unlocked.includes(mode);
}
