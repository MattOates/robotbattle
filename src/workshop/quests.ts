/**
 * What to do next, and why it was worth doing.
 *
 * The game has a Workshop, an Arena, a Tournament, a Trade table, nineteen
 * lessons, a test bench, a map editor and a behaviour inspector, and the menu
 * presents them as six cards of equal weight with a paragraph each. That is a
 * directory, not a game. An adult reads the six paragraphs and picks; a child
 * reads none of them, clicks the first one, and meets an empty editor.
 *
 * So: quests. A level is a handful of them, each one walking somebody into
 * exactly one thing the game can already do, and each one paying out something
 * they can see — a new opponent, a new shelf, a new tab. Finishing a level's
 * quests is what offers the next level, which is the only way the game ever
 * suggests moving up.
 *
 * Three rules hold the whole thing together:
 *
 *  1. **Nothing here blocks.** A quest is a suggestion with a reward attached.
 *     Everything a quest would unlock is reachable by changing your level in
 *     settings, and a locked pane says which quest opens it rather than
 *     pretending not to exist.
 *  2. **They are in order, and the order is the argument.** Each reward line is
 *     a remark about what just happened — "nothing happened, did it?" only
 *     means anything after the fight it refers to — so only the current quest
 *     listens. What keeps that from becoming busywork is `settle`: a quest
 *     whose condition is already true when it becomes current finishes on the
 *     spot, in its place in the order. Being ahead of the game is not a reason
 *     to be made to do it again; it is also not a reason to be told the
 *     punchline first.
 *  3. **This module is pure.** No React, no storage, no DOM. `advance` is a
 *     function from (what has happened, what just happened) to (what is now
 *     true), which is what lets `tests/workshop/quests.test.ts` drive a player
 *     from cold start to level-up without a browser.
 */

import type { Level } from "../ui/level.js";
import type { Pane, PanelName } from "../ui/panes.js";
import type { ScreenName } from "../ui/router.js";
import { AIM_AND_CHASE, PICK_YOUR_RANGE, SEE_AND_CHASE, type TourSignal } from "../ui/tour/steps.js";

/**
 * A quest reads the same signals the tour does — see `ui/tour/steps.ts`, where
 * the union lives. One set of emitters, two readers.
 */
export type QuestSignal = TourSignal;

/**
 * What counts as having done a step.
 *
 * Deliberately looser than the tour's gates. The tour is choreography and can
 * demand an exact set of opponents; a quest is an achievement and should not
 * care whether you beat the Duck on its own or alongside two others. Where the
 * tour asks "did they do the thing I just told them to", a quest asks "have
 * they ever done this".
 */
export type QuestGate =
  | { kind: "screen"; screen: ScreenName }
  | { kind: "pane"; pane: Pane }
  /** Case-insensitive, on canonical words, so either vocabulary matches. */
  | { kind: "sourceHas"; needle: string }
  /** A fight happened at all. */
  | { kind: "fought" }
  /** A fight was won — against a named sample bot, or against anybody. */
  | { kind: "won"; against?: string }
  | { kind: "saved" }
  /** Any signal of this kind, with nothing more asked of it. */
  | { kind: "did"; what: SimpleSignal };

/** The signal kinds a `did` gate can name: the ones carrying no detail worth matching. */
export type SimpleSignal =
  | "benchRun"
  | "blockTaken"
  | "mapDrawn"
  | "lessonDone"
  | "arenaPlayed"
  | "tradeGiven"
  | "cardAdded"
  | "fixApplied";

export interface Step {
  id: string;
  /** What to do, in both registers. Runs through `fillVocab` at render time. */
  say: { full: string; simple: string };
  gate: QuestGate;
  /** Where doing it happens, for the quest log's "take me there" button. */
  goTo?: { screen: ScreenName; pane?: Pane };
  /**
   * *How* to do it — one or two sentences, shown in the helper panel beside
   * the {robot} while this step is the one being worked on.
   *
   * `say` is the instruction and this is the explanation, and they are separate
   * because they are read in different places and at different lengths: `say`
   * has to fit on one line of the journey bar, and this does not have to fit
   * anywhere.
   */
  help?: { full: string; simple: string };
  /**
   * A one-tap "put this in for me".
   *
   * Carried over from the tour, which is the only part of it worth carrying:
   * a beginner who has just lost twice does not need to be told to write
   * something they have never seen, they need to see it appear and then be
   * told what it does. `applySnippet` in `ui/tour/steps.ts` does the grafting,
   * and every snippet is compiled by `tests/bots/tourRobot.test.ts`.
   */
  insert?: { label: string; snippet: string; replaces?: string };
}

/**
 * What finishing a quest hands over.
 *
 * The reward is the advertisement. "You beat the Duck" is a fact about the
 * past; "Hunter is unlocked, and he shoots back" is a reason to keep going, and
 * at the end of a level it is the reason to move up.
 */
export type Reward =
  | { kind: "unlock"; pane?: Pane; panel?: PanelName; mode?: ScreenName; say: string }
  | { kind: "opponent"; botId: string; say: string }
  | { kind: "levelUp"; say: string };

export interface Quest {
  id: string;
  level: Level;
  title: { full: string; simple: string };
  /** One glyph. The quest log is a list a seven-year-old scans rather than reads. */
  icon: string;
  steps: readonly Step[];
  reward: Reward;
}

// ---------------------------------------------------------------------------

/**
 * Explorer: build a robot that wins a fight.
 *
 * The arc is the tour's, with the tour's own discovery kept: the starter robot
 * cannot fight, and finding that out by watching it lose is worth more than
 * being told. So the fight comes before the shooting, and losing it is the
 * thing that makes the next quest make sense.
 */
const EXPLORER: Quest[] = [
  {
    id: "first-spark",
    level: "explorer",
    icon: "✨",
    title: { full: "Wake it up", simple: "Wake it up" },
    steps: [
      {
        id: "open-workshop",
        say: { full: "Open the Workshop", simple: "Go to your workshop" },
        help: {
          full: "The Workshop is where a {robot} is written, tested and kept. Everything else in the game is somewhere to take one afterwards.",
          simple: "The workshop is where your {robot} lives. You build it here, and then you fight with it.",
        },
        gate: { kind: "screen", screen: "workshop" },
        goTo: { screen: "workshop" },
      },
      {
        id: "make-it-move",
        say: {
          full: "Give it something to do when the fight starts",
          simple: "Tell it to move when the fight starts",
        },
        help: {
          full: "`on start` runs once, at the beginning. Everything between it and `end` is what your {robot} does first.",
          simple: "`on start` happens once, right at the beginning. `drive forward 60` means go, at a bit over half speed.",
        },
        gate: { kind: "sourceHas", needle: "drive" },
        goTo: { screen: "workshop", pane: "editor" },
      },
    ],
    reward: {
      kind: "unlock",
      pane: "trial",
      say: "Your {robot} can move. Now it needs somebody to move at.",
    },
  },
  {
    id: "watch-it-lose",
    level: "explorer",
    icon: "🥊",
    title: { full: "Have a fight", simple: "Have a fight" },
    steps: [
      {
        id: "fight",
        say: { full: "Fight the Sitting Duck", simple: "Fight the Sitting Duck" },
        help: {
          full: "The Duck does not move and does not shoot. Watch what happens — and what does not.",
          simple: "Tick the Duck, then press Start. The Duck cannot move or shoot. Just watch.",
        },
        gate: { kind: "fought" },
        goTo: { screen: "workshop", pane: "trial" },
      },
    ],
    reward: {
      kind: "unlock",
      say: "Nothing happened, did it? The Duck cannot shoot — but neither can you.",
    },
  },
  {
    id: "open-your-eyes",
    level: "explorer",
    icon: "👀",
    title: { full: "Notice things", simple: "Notice things" },
    steps: [
      {
        id: "sense",
        say: {
          full: "Do something when your {robot} senses another one",
          simple: "Do something when you see somebody",
        },
        help: {
          full: "`on sense robot` wakes up when something comes into view. `event.bearing` is which way it is, and `event.distance` is how far.",
          simple: "`on sense robot` happens when your {robot} spots somebody. `event.bearing` is which way they are.",
        },
        insert: { label: "Start it off for me", snippet: AIM_AND_CHASE },
        gate: { kind: "sourceHas", needle: "on sense robot" },
        goTo: { screen: "workshop", pane: "editor" },
      },
      {
        id: "shoot",
        say: { full: "Now {fire} at what you found", simple: "Shoot at what you see" },
        help: {
          full: "Point the {turret} first, then {fire}. A shot leaves on the first tick the gun has come round to what it was aimed at, so aiming and firing on the same line works.",
          simple: "`fire 2` shoots. Point the {turret} at them first, or the shot goes the wrong way.",
        },
        insert: {
          label: "I would rather you did it",
          snippet: SEE_AND_CHASE,
          replaces: "sense robot",
        },
        gate: { kind: "sourceHas", needle: "fire" },
        goTo: { screen: "workshop", pane: "editor" },
      },
    ],
    reward: {
      kind: "opponent",
      botId: "hunter",
      say: "Hunter is unlocked. Careful — Hunter shoots back.",
    },
  },
  {
    id: "keep-it-safe",
    level: "explorer",
    icon: "💾",
    title: { full: "Keep it", simple: "Keep it" },
    steps: [
      {
        id: "save",
        say: { full: "Save a version of your {robot}", simple: "Save your {robot}" },
        help: {
          full: "A saved version is kept forever and can be fought, so you can find out whether your next change actually helped.",
          simple: "Press Save version. It keeps a copy, so you can always come back to this one.",
        },
        gate: { kind: "saved" },
        goTo: { screen: "workshop" },
      },
    ],
    reward: {
      kind: "unlock",
      say: "Saved. Every version you keep is one you can go back to, or fight.",
    },
  },
  {
    id: "beat-the-hunter",
    level: "explorer",
    icon: "🏆",
    title: { full: "Beat the Hunter", simple: "Beat the Hunter" },
    steps: [
      {
        id: "win",
        say: { full: "Win a fight against Hunter", simple: "Win a fight against Hunter" },
        help: {
          full: "Hunter shoots back and chases. One shot for everything is a compromise: heavy is slow and hits hard, light is fast and does not. Choose by how far away they are.",
          simple: "Hunter shoots back. Try hitting hard when they are close, and firing light when they are far away.",
        },
        insert: {
          label: "Write it for me",
          snippet: PICK_YOUR_RANGE,
          replaces: "sense robot",
        },
        gate: { kind: "won", against: "hunter" },
        goTo: { screen: "workshop", pane: "trial" },
      },
    ],
    reward: {
      kind: "levelUp",
      say: "You beat a {robot} that fights back. There is more of this game — want it?",
    },
  },
];

/**
 * Builder: make a {robot} with a plan.
 *
 * The through-line is that a good {robot} is not a longer list of instructions
 * but one that decides, remembers, and is made of parts you can lift out and
 * use again. Each quest is one of those three, and the last two are the two
 * things you cannot do alone.
 */
const BUILDER: Quest[] = [
  {
    id: "make-a-choice",
    level: "builder",
    icon: "🔀",
    title: { full: "Make it choose", simple: "Make it choose" },
    steps: [
      {
        id: "if",
        say: {
          full: "Use an `if` so it does one thing up close and another far away",
          simple: "Make it do one thing up close and another far away",
        },
        gate: { kind: "sourceHas", needle: "if " },
        goTo: { screen: "workshop", pane: "editor" },
      },
    ],
    reward: { kind: "unlock", say: "It has an opinion now, not just a habit." },
  },
  {
    id: "remember-something",
    level: "builder",
    icon: "🧠",
    title: { full: "Make it remember", simple: "Make it remember" },
    steps: [
      {
        id: "var",
        say: {
          full: "Keep a number between events with `var` and `set`",
          simple: "Make it remember a number",
        },
        gate: { kind: "sourceHas", needle: "var " },
        goTo: { screen: "workshop", pane: "editor" },
      },
    ],
    reward: {
      kind: "unlock",
      panel: "behaviours",
      say: "Your blocks shelf is open. A behaviour you name is one you can use twice.",
    },
  },
  {
    id: "reuse-a-behaviour",
    level: "builder",
    icon: "🧩",
    title: { full: "Reuse a behaviour", simple: "Use a piece twice" },
    steps: [
      {
        id: "take",
        say: {
          full: "Take a block off the shelf and drop it into a {robot}",
          simple: "Put one of your pieces into another {robot}",
        },
        gate: { kind: "did", what: "blockTaken" },
        goTo: { screen: "workshop", pane: "editor" },
      },
    ],
    reward: {
      kind: "unlock",
      pane: "bench",
      say: "The test bench is open. One fight is luck; fifty is an answer.",
    },
  },
  {
    id: "prove-it",
    level: "builder",
    icon: "📊",
    title: { full: "Prove it is better", simple: "Prove it got better" },
    steps: [
      {
        id: "bench",
        say: {
          full: "Run a batch on the test bench and read the win rate",
          simple: "Fight lots of times and see how often you win",
        },
        gate: { kind: "did", what: "benchRun" },
        goTo: { screen: "workshop", pane: "bench" },
      },
    ],
    reward: {
      kind: "unlock",
      mode: "arena",
      say: "The {arena} is open. Sample {robots} are practice; people are not.",
    },
  },
  {
    id: "fight-a-person",
    level: "builder",
    icon: "🤝",
    title: { full: "Fight a real person", simple: "Fight a real person" },
    steps: [
      {
        id: "arena",
        say: {
          full: "Play a match in the {arena} with somebody else",
          simple: "Have a fight with somebody else",
        },
        gate: { kind: "did", what: "arenaPlayed" },
        goTo: { screen: "arena" },
      },
    ],
    reward: {
      kind: "levelUp",
      say: "That is the whole game, played properly. The rest is depth — have it?",
    },
  },
];

/**
 * Engineer: nothing is unlocked here, because nothing is locked.
 *
 * An Engineer already has every pane, shelf and mode from the moment they
 * arrive, so these quests hand out no permissions. They are a list of the
 * things the game is proudest of and which nothing else in the interface tells
 * you are there — the inspector, leading a moving target, the tournament.
 */
const ENGINEER: Quest[] = [
  {
    id: "read-the-machine",
    level: "engineer",
    icon: "🔬",
    title: { full: "Read what it actually did", simple: "See what it really did" },
    steps: [
      {
        id: "inspect",
        say: {
          full: "Open the Behaviour Inspector after a fight",
          simple: "Look at what your {robot} was thinking",
        },
        gate: { kind: "did", what: "fixApplied" },
        goTo: { screen: "workshop", pane: "trial" },
      },
    ],
    reward: { kind: "unlock", say: "Guessing is optional now." },
  },
  {
    id: "draw-a-place",
    level: "engineer",
    icon: "🗺️",
    title: { full: "Build somewhere to fight", simple: "Draw a place to fight" },
    steps: [
      {
        id: "map",
        say: { full: "Draw an arena in the map editor", simple: "Draw a place" },
        gate: { kind: "did", what: "mapDrawn" },
        goTo: { screen: "workshop", pane: "map" },
      },
    ],
    reward: { kind: "unlock", say: "Walls change everything a {robot} thought it knew." },
  },
  {
    id: "hand-it-over",
    level: "engineer",
    icon: "🎁",
    title: { full: "Give something away", simple: "Give something away" },
    steps: [
      {
        id: "trade",
        say: {
          full: "Give somebody a {robot} or a block at the trade table",
          simple: "Give somebody one of your {robots}",
        },
        gate: { kind: "did", what: "tradeGiven" },
        goTo: { screen: "trade" },
      },
    ],
    reward: {
      kind: "levelUp",
      say: "A block with a `given` clause is the only thing here worth posting to a stranger.",
    },
  },
];

export const QUESTS: readonly Quest[] = [...EXPLORER, ...BUILDER, ...ENGINEER];

export function questsFor(level: Level): Quest[] {
  return QUESTS.filter((q) => q.level === level);
}

export function questById(id: string): Quest | undefined {
  return QUESTS.find((q) => q.id === id);
}

// ---------------------------------------------------------------------------

/**
 * Does this signal satisfy this gate?
 *
 * Total over both unions and the only place a quest gate is interpreted, for
 * the same reason `isSatisfied` is in the tour: it is what makes the whole
 * system testable without a browser.
 */
export function satisfies(gate: QuestGate, signal: QuestSignal): boolean {
  switch (gate.kind) {
    case "screen":
      return signal.kind === "screen" && signal.screen === gate.screen;
    case "pane":
      return signal.kind === "pane" && signal.pane === gate.pane;
    case "sourceHas":
      return (
        signal.kind === "source" && signal.text.toLowerCase().includes(gate.needle.toLowerCase())
      );
    case "fought":
      return signal.kind === "trial";
    case "won":
      return (
        signal.kind === "trial" &&
        signal.won &&
        (gate.against === undefined || signal.opponents.includes(gate.against))
      );
    case "saved":
      return signal.kind === "saved";
    case "did":
      return signal.kind === gate.what;
  }
}

/** Every step id, in quest order. The order steps are meant to be met in. */
export function stepIds(quest: Quest): string[] {
  return quest.steps.map((s) => s.id);
}

/** A quest is done when all of its steps are. */
export function isQuestDone(quest: Quest, done: ReadonlySet<string>): boolean {
  return quest.steps.every((s) => done.has(`${quest.id}/${s.id}`));
}

/** The key a step is recorded under. Namespaced, so two quests may share a step name. */
export function stepKey(quest: Quest, step: Step): string {
  return `${quest.id}/${step.id}`;
}

export interface Advance {
  /** Step keys newly met. */
  steps: string[];
  /** Quests finished by those steps, in the order they finished. */
  quests: Quest[];
  /** True when one of them was the level's last. */
  levelUp: boolean;
}

/**
 * Is this gate a fact about the world, or a report of something that happened?
 *
 * The distinction is what lets the quests be a sequence without making anybody
 * repeat themselves. A *state* gate — "your script contains `drive`" — can be
 * checked at any moment against the script as it stands, so a quest that
 * becomes current with its condition already true finishes on the spot. An
 * *event* gate — "you fought", "you saved" — cannot be recovered after the
 * fact, so it is only ever met by the signal that reports it.
 */
function isStateGate(gate: QuestGate): boolean {
  return gate.kind === "sourceHas";
}

/** The world, for the state gates to be checked against. */
export interface World {
  /** The script currently being edited, if any. */
  source: string | null;
}

/**
 * What one signal changes.
 *
 * **Only the current quest listens.** This was the whole of a bug worth
 * recording: it used to offer every signal to every quest at the level, on the
 * reasoning that somebody who is ahead of the game should not be made to do it
 * again. That reasoning is right and the implementation of it was wrong,
 * because these quests are not a set of achievements — they are an argument,
 * in order:
 *
 *   move → have a fight → *notice that nothing happened* → add shooting → win
 *
 * and the starter {robot} handed to anybody who skips the tour already
 * contains `drive`, `on sense robot`, `fire` and an `if`. So three quests
 * completed on the first render, "Notice things" sat in the trophy shelf above
 * "Have a fight", and the fight quest congratulated the player with "the Duck
 * cannot shoot — but neither can you" about a {robot} that shoots very well.
 * The reward lines are only true in order, because each one is a remark about
 * what just happened.
 *
 * What is kept from the old reasoning is `settle` below, which is the honest
 * form of "you have already done this".
 *
 * Steps *within* a quest stay unordered. They read as a checklist and they are
 * one: doing the second thing first ticks the second box, and no reward line
 * depends on which came first.
 */
export function advance(level: Level, done: ReadonlySet<string>, signal: QuestSignal): Advance {
  const quest = currentQuest(level, done);
  if (!quest) return { steps: [], quests: [], levelUp: false };

  const steps: string[] = [];
  for (const step of quest.steps) {
    const key = stepKey(quest, step);
    if (done.has(key)) continue;
    if (!satisfies(step.gate, signal)) continue;
    steps.push(key);
  }
  if (steps.length === 0) return { steps: [], quests: [], levelUp: false };

  const after = new Set([...done, ...steps]);
  if (!isQuestDone(quest, after)) return { steps, quests: [], levelUp: false };
  return {
    steps,
    quests: [quest],
    levelUp: quest.reward.kind === "levelUp",
  };
}

/**
 * Credit whatever is already true, without waiting to be told again.
 *
 * Called whenever the world changes or a quest completes. It walks forward
 * through the quests — settling one can make the next current, and that one
 * may also already be satisfied — and meets every *state* gate that the world
 * currently answers.
 *
 * This is what stops the ordering rule above from becoming busywork. A player
 * whose {robot} already drives does not have to delete the line and type it
 * again to be told they have a {robot} that drives; the quest simply arrives
 * already finished, in its place in the order, with its reward line still
 * making sense.
 *
 * The loop is bounded by the number of quests at the level, since each pass
 * either finishes one or stops.
 */
export function settle(level: Level, done: ReadonlySet<string>, world: World): Advance {
  const steps: string[] = [];
  const quests: Quest[] = [];
  let levelUp = false;
  let known = new Set(done);

  for (let guard = questsFor(level).length; guard > 0; guard--) {
    const quest = currentQuest(level, known);
    if (!quest) break;

    const met: string[] = [];
    for (const step of quest.steps) {
      const key = stepKey(quest, step);
      if (known.has(key) || !isStateGate(step.gate)) continue;
      if (world.source === null) continue;
      if (!satisfies(step.gate, { kind: "source", text: world.source })) continue;
      met.push(key);
    }
    if (met.length === 0) break;

    steps.push(...met);
    known = new Set([...known, ...met]);
    if (!isQuestDone(quest, known)) break;

    quests.push(quest);
    if (quest.reward.kind === "levelUp") levelUp = true;
  }

  return { steps, quests, levelUp };
}

/**
 * Everything the finished quests have handed over.
 *
 * Derived from what is done rather than stored, so it cannot drift out of step
 * with the quest table: adding a reward to a quest somebody already finished
 * grants it, and removing one takes it back, with no migration either way.
 */
export function unlocks(done: ReadonlySet<string>): {
  panes: Pane[];
  panels: PanelName[];
  modes: ScreenName[];
  opponents: string[];
} {
  const panes: Pane[] = [];
  const panels: PanelName[] = [];
  const modes: ScreenName[] = [];
  const opponents: string[] = [];

  for (const quest of QUESTS) {
    if (!isQuestDone(quest, done)) continue;
    const r = quest.reward;
    if (r.kind === "unlock") {
      if (r.pane) panes.push(r.pane);
      if (r.panel) panels.push(r.panel);
      if (r.mode) modes.push(r.mode);
    } else if (r.kind === "opponent") {
      opponents.push(r.botId);
    }
  }

  return { panes, panels, modes, opponents };
}

/**
 * The quest to show at the top of the log: the first unfinished one at this
 * level, or nothing at all once the level is done.
 */
export function currentQuest(level: Level, done: ReadonlySet<string>): Quest | null {
  return questsFor(level).find((q) => !isQuestDone(q, done)) ?? null;
}

/** The next thing to actually do — the first unmet step of the current quest. */
export function nextStep(level: Level, done: ReadonlySet<string>): { quest: Quest; step: Step } | null {
  const quest = currentQuest(level, done);
  if (!quest) return null;
  const step = quest.steps.find((s) => !done.has(stepKey(quest, s)));
  return step ? { quest, step } : null;
}
