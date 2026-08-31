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
 *  2. **Signals are recorded whether or not a quest is watching.** A child who
 *     wanders off and saves a robot before being asked to finds that step
 *     already ticked. Being ahead of the game is not a reason to be made to do
 *     it again.
 *  3. **This module is pure.** No React, no storage, no DOM. `advance` is a
 *     function from (what has happened, what just happened) to (what is now
 *     true), which is what lets `tests/workshop/quests.test.ts` drive a player
 *     from cold start to level-up without a browser.
 */

import type { Level } from "../ui/level.js";
import type { Pane, PanelName } from "../ui/panes.js";
import type { ScreenName } from "../ui/router.js";
import type { TourSignal } from "../ui/tour/steps.js";

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
        gate: { kind: "screen", screen: "workshop" },
        goTo: { screen: "workshop" },
      },
      {
        id: "make-it-move",
        say: {
          full: "Give it something to do when the fight starts",
          simple: "Tell it to move when the fight starts",
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
        gate: { kind: "sourceHas", needle: "on sense robot" },
        goTo: { screen: "workshop", pane: "editor" },
      },
      {
        id: "shoot",
        say: { full: "Now {fire} at what you found", simple: "Shoot at what you see" },
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
  /** Step keys newly met by this signal. */
  steps: string[];
  /** Quests finished by those steps. */
  quests: Quest[];
  /** True when one of them was the level's last. */
  levelUp: boolean;
}

/**
 * What one signal changes.
 *
 * Every quest at the level is offered the signal, not only the current one —
 * see rule 2 at the top. A player who saves a {robot} three quests before
 * being asked to should find that step already ticked when they get there, and
 * the alternative is telling somebody to do a thing they have just done.
 *
 * Steps within a quest are *not* ordered by this function either. They read as
 * a checklist and they are one: doing the second thing first ticks the second
 * box.
 */
export function advance(
  level: Level,
  done: ReadonlySet<string>,
  signal: QuestSignal,
): Advance {
  const steps: string[] = [];
  const quests: Quest[] = [];
  let levelUp = false;

  for (const quest of questsFor(level)) {
    const before = isQuestDone(quest, done);
    let touched = false;
    for (const step of quest.steps) {
      const key = stepKey(quest, step);
      if (done.has(key) || steps.includes(key)) continue;
      if (!satisfies(step.gate, signal)) continue;
      steps.push(key);
      touched = true;
    }
    if (!touched || before) continue;

    const after = new Set([...done, ...steps]);
    if (!isQuestDone(quest, after)) continue;
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
