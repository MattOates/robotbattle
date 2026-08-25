/**
 * What each tour says, and the single rule that decides when a step is done.
 *
 * Plain TypeScript with no JSX on purpose. `vite.config.ts` points vitest at
 * `tests/**\/*.test.ts` and there is no jsdom in the project, so a `.ts` module
 * is the only place tour logic can live and still be tested. Everything that
 * needs the DOM is in `Tour.tsx`; everything that can be reasoned about is
 * here.
 *
 * Copy goes through `fillVocab` at render time, so `{robot}` and friends are
 * written once and read in whichever world the player chose.
 */

import type { TourId } from "../../store/tour.js";

/**
 * The `data-tour` values the overlay may point at.
 *
 * A named union rather than free strings so that renaming an anchor in the
 * Workshop and forgetting to rename it here is a type error rather than a step
 * that silently loses its arrow and centres itself.
 */
export const TOUR_ANCHORS = [
  "arena",
  "menu-modes",
  "menu-workshop",
  "editor",
  "editor-tab",
  "trial-tab",
  "bench-tab",
  "opponent-chips",
  "trial-start",
  "save-version",
  "robot-list",
  // Arena and Tournament.
  "lobby-name",
  "lobby-robot",
  "lobby-ready",
  "lobby-config",
  "lobby-start",
  "tournament-table",
  "tournament-draw",
] as const;

export type TourAnchor = (typeof TOUR_ANCHORS)[number];

/**
 * What the Workshop tells the tour about, as it happens.
 *
 * Deliberately a description of events rather than of state. A gate asking
 * "did they just win against the Duck" cannot be answered by looking at the
 * Workshop, only by being told — and a signal is also what the avatar's
 * reactions will later hang off.
 */
export type TourSignal =
  /** A screen was opened. Sent when it mounts, so navigation advances a step. */
  | { kind: "screen"; screen: string }
  | { kind: "pane"; pane: string }
  | { kind: "opponents"; ids: readonly string[] }
  | { kind: "source"; text: string }
  | { kind: "trialStart"; opponents: readonly string[] }
  | { kind: "trial"; opponents: readonly string[]; won: boolean }
  | { kind: "saved" }
  /** The Next button. Only ever satisfies a `next` gate. */
  | { kind: "next" };

export type Gate =
  /** Narration: the reader presses Next when they have read it. */
  | { kind: "next" }
  /** They went somewhere. */
  | { kind: "screen"; screen: string }
  /** They opened a particular tab. */
  | { kind: "pane"; pane: string }
  /** Exactly this set of opponents is ticked — no more, no fewer. */
  | { kind: "opponents"; exactly: readonly string[] }
  | { kind: "trialWon"; against: readonly string[] }
  | { kind: "trialLost"; against: readonly string[] }
  /**
   * A fight was *started*, whoever wins.
   *
   * For the one step where waiting for the end is a two-minute wait for
   * nothing: a robot that cannot shoot against a Duck that cannot shoot back
   * has no way to end a match, so it runs to the tick limit. The lesson —
   * "you never fired" — is plain within seconds, so the tour moves on as soon
   * as the match is under way and talks over the top of it.
   */
  | { kind: "trialStarted"; against: readonly string[] }
  /**
   * A fight happened, win or lose.
   *
   * For the step where the *point* is losing but losing cannot be promised.
   * The player beats Hunter about four times in ten, and a step that waits for
   * a defeat would strand those four staring at a victory screen being told to
   * try harder. So the fight is the gate and the copy after it copes with both.
   */
  | { kind: "trialRan"; against: readonly string[] }
  /** The script grew something. Matched case-insensitively on canonical words. */
  | { kind: "sourceHas"; needle: string }
  | { kind: "saved" };

export interface TourStep {
  id: string;
  /**
   * Which screen this step belongs on.
   *
   * The tour starts on the menu and finishes in the Workshop, so both screens
   * mount it and each shows only the steps that are its own. Defaults to the
   * Workshop, which is where all but the first few live.
   */
  screen?: "menu" | "workshop";
  /** Where to point. Null centres the card, for steps that are about nothing. */
  anchor: TourAnchor | null;
  placement: "top" | "bottom" | "left" | "right";
  /** May contain `{robot}` and the rest of the `fillVocab` placeholders. */
  title: string;
  body: string;
  gate: Gate;
  /**
   * Things this step has asked the player to look at.
   *
   * The card is moved out of their way, by however much the screen allows. A
   * step saying "watch what it does" that then sits on the arena is worse than
   * one on the wrong side of its anchor, so this outranks `placement`.
   */
  keepClear?: readonly TourAnchor[];
  /**
   * A one-click "put this in my {robot}" button.
   *
   * Offered rather than demanded. A beginner who has just lost twice does not
   * need to be told to write something they have never seen; they need to see
   * it appear and then be told what it does.
   */
  insert?: {
    label: string;
    snippet: string;
    /**
     * An `on ...` handler this snippet stands in for, if any.
     *
     * The second combat fix rewrites the block the first one added, and two
     * `on sense robot` handlers in one script is a compile error — so an
     * insert has to be able to say "instead of", not only "as well as".
     */
    replaces?: string;
  };
}

/** Set equality, order-insensitive — the chips have no meaningful order. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((x) => seen.has(x));
}

/**
 * The whole advance rule.
 *
 * Pure, total, and the only place a gate is interpreted — which is what makes
 * the tour testable without a browser.
 */
export function isSatisfied(gate: Gate, signal: TourSignal): boolean {
  switch (gate.kind) {
    case "next":
      return signal.kind === "next";
    case "screen":
      return signal.kind === "screen" && signal.screen === gate.screen;
    case "pane":
      return signal.kind === "pane" && signal.pane === gate.pane;
    case "opponents":
      return signal.kind === "opponents" && sameSet(signal.ids, gate.exactly);
    case "trialWon":
      return signal.kind === "trial" && signal.won && sameSet(signal.opponents, gate.against);
    case "trialLost":
      return signal.kind === "trial" && !signal.won && sameSet(signal.opponents, gate.against);
    case "trialStarted":
      return signal.kind === "trialStart" && sameSet(signal.opponents, gate.against);
    case "trialRan":
      return signal.kind === "trial" && sameSet(signal.opponents, gate.against);
    case "sourceHas":
      return (
        signal.kind === "source" &&
        signal.text.toLowerCase().includes(gate.needle.toLowerCase())
      );
    case "saved":
      return signal.kind === "saved";
  }
}

/**
 * Put a step's snippet into a script.
 *
 * Pure and string-based rather than an editor operation, so the rule about
 * what happens to an existing handler is testable without a CodeMirror
 * instance. Appends by default; replaces a whole `on <event> ... end` block
 * when the step says it stands in for one.
 */
export function applySnippet(source: string, insert: NonNullable<TourStep["insert"]>): string {
  const trimmed = source.replace(/\s+$/, "");
  if (!insert.replaces) return `${trimmed}\n${insert.snippet}`;

  const lines = trimmed.split("\n");
  const open = lines.findIndex((line) => line.trim() === `on ${insert.replaces}`);
  if (open === -1) return `${trimmed}\n${insert.snippet}`;

  // Handlers do not nest, so the next unindented `end` closes this one.
  const close = lines.findIndex((line, i) => i > open && line.trim() === "end");
  if (close === -1) return `${trimmed}\n${insert.snippet}`;

  const before = lines.slice(0, open).join("\n").replace(/\s+$/, "");
  const after = lines.slice(close + 1).join("\n").replace(/^\s+/, "");
  return [before, insert.snippet.trim(), after].filter((part) => part !== "").join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Snippets
//
// Real RoboScript in canonical words, translated into the reader's vocabulary
// on the way into the editor. `tests/bots/tourRobot.test.ts` compiles every one
// of them, so a snippet that does not parse cannot be shipped.

const AIM_AND_CHASE = `
on sense robot
  -- Something came into view. event.bearing is which way it is.
  turret.aim at event.bearing
  turn body by event.bearing
  drive forward 80
end
`;

const SEE_AND_CHASE = `
on sense robot
  turret.aim at event.bearing
  fire 2
  turn body by event.bearing
  drive forward 80
end
`;

const PICK_YOUR_RANGE = `
on sense robot
  turret.aim at event.bearing
  turn body by event.bearing
  if event.distance < 150 then
    fire 3
    drive forward 40
  else
    fire 1
    drive forward 100
  end
end
`;

// ---------------------------------------------------------------------------

/**
 * The Workshop tour: one honest win, one honest loss, then the fix.
 *
 * The shape is the point. Beating the Sitting Duck teaches the loop — write,
 * run, win — and would teach nothing else, because the Duck does not move or
 * shoot. Losing to the Spinner immediately afterwards is what turns "I have a
 * robot" into "I have a robot that is not good enough yet", which is the whole
 * game. Neither beat is narrated: both are real matches the player watched.
 */
export const WORKSHOP_TOUR: readonly TourStep[] = [
  {
    id: "hello",
    screen: "menu",
    anchor: null,
    placement: "bottom",
    title: "Hello {name}",
    body: "I am {helper}. Five minutes and you will have a {robot} that wins a fight — and you will have written the part that matters yourself. Say if you would rather get on with it alone; the button is bottom right of every card.",
    gate: { kind: "next" },
  },
  {
    id: "the-modes",
    screen: "menu",
    anchor: "menu-modes",
    placement: "right",
    title: "This is everything there is",
    body: "The **Workshop** is where you write a {robot} and try it out on your own. The **{Arena}** puts everyone's into one fight at once, and a **Tournament** draws them against each other — both of those want other people. **Learn** is the long version of what I am about to show you, and **Reference** is the dictionary.",
    gate: { kind: "next" },
  },
  {
    id: "to-the-workshop",
    screen: "menu",
    anchor: "menu-workshop",
    placement: "right",
    title: "We want the Workshop",
    body: "Everything starts there. Open it.",
    gate: { kind: "screen", screen: "workshop" },
  },
  {
    id: "meet",
    anchor: "editor",
    placement: "right",
    title: "This is your {robot}",
    body: "Three lines at the top give it a name, a colour and a body. Everything below them is a list of things to do **when something happens** — nothing runs on its own.",
    gate: { kind: "next" },
  },
  {
    id: "on-start",
    anchor: "editor",
    placement: "right",
    title: "`on start` runs once",
    body: "It fires the moment the match begins, and then never again. Right now it sets off driving, and that is genuinely everything your {robot} knows how to do.",
    gate: { kind: "next" },
  },
  {
    id: "open-trial",
    anchor: "trial-tab",
    placement: "bottom",
    title: "Does it work?",
    body: "There is exactly one way to find out. Open the **Trial**.",
    gate: { kind: "pane", pane: "trial" },
  },
  {
    id: "pick-duck",
    anchor: "opponent-chips",
    placement: "top",
    keepClear: ["opponent-chips"],
    title: "Pick a fight",
    body: "These are who you can fight. Start with **Sitting Duck** — tick it, and untick everything else. One opponent at a time tells you far more than five at once.",
    gate: { kind: "opponents", exactly: ["sitting-duck"] },
  },
  {
    id: "duck-first-go",
    anchor: "trial-start",
    placement: "top",
    keepClear: ["arena"],
    title: "Go on then",
    body: "The Duck does not move, does not aim and does not shoot. How hard can it be?",
    gate: { kind: "trialStarted", against: ["sitting-duck"] },
  },
  {
    id: "arm-it",
    anchor: "editor",
    placement: "right",
    keepClear: ["arena"],
    title: "You are going to lose this",
    body: "Watch for a moment. Neither of you can shoot, so nobody dies and the clock decides it — and you have been wearing yourself down on the walls while the Duck sat there untouched. Losing to something that does nothing at all is a good place to start. `on sense {robot}` wakes up when something comes into view, `event.bearing` is which way it is, and `event.distance` is how far. Point the {turret} at it, {fire}, and go after it.",
    gate: { kind: "sourceHas", needle: "on sense" },
    insert: { label: "Start it off for me", snippet: AIM_AND_CHASE },
  },
  {
    id: "add-fire",
    anchor: "editor",
    placement: "right",
    title: "Now make it shoot",
    body: "That block now points the {turret} at whatever it sees and goes after it — but it still never pulls the trigger. Put `{fire} 2` on its own line just under the `turret.aim` line, and mind the indentation. The 2 is how much of a shot to spend: harder shots hurt more and cost more.",
    gate: { kind: "sourceHas", needle: "fire" },
    insert: {
      label: "I would rather you did it",
      snippet: SEE_AND_CHASE,
      replaces: "sense robot",
    },
  },
  {
    id: "beat-duck",
    anchor: "trial-start",
    placement: "top",
    keepClear: ["arena"],
    title: "Try that again",
    body: "Same {robot}, same Duck. Run it.",
    gate: { kind: "trialWon", against: ["sitting-duck"] },
  },
  {
    id: "won",
    anchor: null,
    placement: "bottom",
    title: "That is a win",
    body: "Though in fairness the Duck was not trying. Let us find something that is.",
    gate: { kind: "next" },
  },
  {
    id: "pick-hunter",
    anchor: "opponent-chips",
    placement: "top",
    keepClear: ["opponent-chips"],
    title: "Now fight the Hunter",
    body: "Untick the Duck and tick **Hunter** instead. It does everything yours does — sweeps, spots, chases, shoots — and it has been doing it for longer.",
    gate: { kind: "opponents", exactly: ["hunter"] },
  },
  {
    id: "meet-the-wall",
    anchor: "trial-start",
    placement: "top",
    keepClear: ["arena"],
    title: "Run it",
    body: "Watch where the shots come from, and how close you are when they land.",
    gate: { kind: "trialRan", against: ["hunter"] },
  },
  {
    id: "pick-your-range",
    anchor: "editor",
    placement: "right",
    title: "That one fights back",
    body: "Against the Hunter your {robot} wins about four times in ten — a coin toss you lose slightly more than you win. It charges in at one speed whatever the range, so it arrives slowly and shoots cheaply. Decide instead: far away, close the gap fast and save your shot. Up close, hit hard and hold still enough to aim.",
    gate: { kind: "sourceHas", needle: "if event.distance" },
    insert: {
      label: "Rewrite it to pick its range",
      snippet: PICK_YOUR_RANGE,
      replaces: "sense robot",
    },
  },
  {
    id: "beat-hunter",
    anchor: "trial-start",
    placement: "top",
    keepClear: ["arena"],
    title: "Again",
    body: "Same fight, better {robot}. It will not win every time — nothing does — but it now wins more of them than it loses.",
    gate: { kind: "trialWon", against: ["hunter"] },
  },
  {
    id: "save",
    anchor: "save-version",
    placement: "right",
    title: "Keep it",
    body: "Save a version. The Workshop keeps every one you save, so you can always get back to the {robot} that worked.",
    gate: { kind: "saved" },
  },
  {
    id: "whats-next",
    anchor: "bench-tab",
    placement: "bottom",
    title: "One match is luck",
    body: "The **Test bench** runs the same fight fifty times and tells you how often you really win. Try the Toolkit next — it will beat you, and working out why is the rest of the game.",
    gate: { kind: "next" },
  },
];

/** Shorter, and started by hand rather than sprung on anyone. */
export const ARENA_TOUR: readonly TourStep[] = [
  {
    id: "arena-name",
    anchor: "lobby-name",
    placement: "bottom",
    title: "An {arena} needs other people",
    body: "This is the name they will see. Host a room and send the link, or paste in a code somebody sent you.",
    gate: { kind: "next" },
  },
  {
    id: "arena-robot",
    anchor: "lobby-robot",
    placement: "right",
    title: "Bring a {robot}",
    body: "Pick which of yours takes the field. You can change it right up until you say you are ready.",
    gate: { kind: "next" },
  },
  {
    id: "arena-config",
    anchor: "lobby-config",
    placement: "left",
    title: "The host sets the rules",
    body: "Sides, friendly fire, {fuel} and the {ground} everyone fights on. Everybody gets the same world — that is what makes it a fair fight.",
    gate: { kind: "next" },
  },
  {
    id: "arena-ready",
    anchor: "lobby-ready",
    placement: "top",
    title: "Say when",
    body: "The host cannot start until everyone has. Last one running wins.",
    gate: { kind: "next" },
  },
];

export const TOURNAMENT_TOUR: readonly TourStep[] = [
  {
    id: "tour-enter",
    anchor: "tournament-table",
    placement: "top",
    title: "Everyone enters",
    body: "Drag a {robot} from your library onto the table to enter it. Enter as many as you like — they are all drawn against each other.",
    gate: { kind: "next" },
  },
  {
    id: "tour-config",
    anchor: "lobby-config",
    placement: "left",
    title: "Set the world first",
    body: "{Fuel} and {ground} lock once the draw is made, because every round has to be comparable to the last.",
    gate: { kind: "next" },
  },
  {
    id: "tour-draw",
    anchor: "tournament-draw",
    placement: "bottom",
    title: "Make the draw",
    body: "The host draws when everyone is in. Every tie is settled over eleven matches, and you can watch the ones that decided it.",
    gate: { kind: "next" },
  },
];

export const TOURS: Record<TourId, readonly TourStep[]> = {
  workshop: WORKSHOP_TOUR,
  arena: ARENA_TOUR,
  tournament: TOURNAMENT_TOUR,
};
