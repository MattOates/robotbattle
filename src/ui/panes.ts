/**
 * What the Workshop is made of, named once.
 *
 * These were local to `screens/Workshop.tsx`, which was fine while the Workshop
 * was the only thing that had an opinion about them. It is not any more: a
 * player's level decides which panes and shelves exist at all, and the quest
 * system hands out panes as rewards. Both of those need the names without
 * pulling in the Workshop itself — it is lazily loaded and is the biggest chunk
 * in the bundle, so importing it from the shell would undo that.
 *
 * Deliberately a `.ts` file with no JSX: there is no jsdom in this project, so
 * anything that needs a unit test has to live outside a component.
 */

/** A tab in the Workshop's right-hand column. */
export type Pane = "editor" | "map" | "trial" | "bench" | "history";

export const PANE_LABELS: Record<Pane, string> = {
  editor: "Editor",
  map: "Map",
  trial: "Trial",
  bench: "Test bench",
  history: "History",
};

/**
 * What each pane is called to somebody who has not met the word "bench".
 *
 * Not a translation of the label — a different name for the same tab, chosen
 * for what you would go there to do rather than what it is.
 */
export const PANE_LABELS_SIMPLE: Record<Pane, string> = {
  editor: "Build",
  map: "Places",
  trial: "Fight",
  bench: "Practice",
  history: "Past fights",
};

/**
 * Which tabs each kind of thing gets.
 *
 * An arena has no Editor because there is no script, and no History because a
 * map does not accumulate one: battle records are filed against a robot, and
 * "this wall layout used to win" is not a sentence. What it keeps is Trial and
 * Test bench, which is the point of editing a map inside the Workshop at all —
 * you draw a labyrinth and immediately find out whether anything can solve it.
 */
export const ROBOT_PANES: readonly Pane[] = ["editor", "trial", "bench", "history"];
export const ARENA_PANES: readonly Pane[] = ["map", "trial", "bench"];

/** A collapsible shelf in the Workshop's left-hand column. */
export type PanelName = "robots" | "behaviours" | "arenas" | "room" | "chat" | "session";

/**
 * How a robot is authored. Three views over one script — see
 * `workshop/compose.ts`: the stored form is always RoboScript text, so a robot
 * built out of cards opens unchanged in the editor, which is the whole reason
 * a beginner's work is not a dead end.
 */
export type Authoring = "cards" | "blocks" | "guided" | "text";

export const AUTHORING_LABELS: Record<Authoring, string> = {
  cards: "Cards",
  blocks: "Blocks",
  guided: "Sentences",
  text: "Code",
};
