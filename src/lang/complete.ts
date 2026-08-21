/**
 * Context-aware completion for RoboScript.
 *
 * Deliberately editor-agnostic: this module knows the language, and knows
 * nothing about CodeMirror. That keeps it unit-testable, and keeps the editor
 * adapter thin.
 *
 * The important property is that every suggestion is derived from the same
 * tables the parser and compiler use — `EVENT_NAMES`, `EVENT_DOCS`, the action
 * grammar, the property sets, the synonym table. So the dropdown can never
 * offer a word the compiler would then reject, and it renders in whichever
 * vocabulary the player is using.
 *
 * The descriptions matter as much as the list. Someone who has never
 * programmed cannot discover `event.bearing` by guessing, so the popup has to
 * teach as well as complete.
 */

import { EVENT_NAMES, type EventName } from "./ast.js";
import { BUILTIN_SIGNATURES } from "./bytecode.js";
import { ARENA_PROP_NAMES, ME_PROP_NAMES } from "./compiler.js";
import { EVENT_DOCS, eventFields, renderDoc } from "./events.js";
import { scanLine } from "./scan.js";
import { healthPropertyFor, phraseFor, wordFor, type Theme } from "./vocab.js";

export type SuggestionKind =
  "event" | "action" | "keyword" | "property" | "function" | "variable" | "value" | "color";

export interface Suggestion {
  /** Text to insert, already in the player's vocabulary. */
  label: string;
  kind: SuggestionKind;
  /** Short hint shown to the right of the label. */
  detail?: string;
  /** Longer explanation shown in the details pane. */
  info?: string;
}

export interface CompletionResult {
  /** Document offset where the replaced text begins. */
  from: number;
  options: Suggestion[];
}

// ---------------------------------------------------------------------------
// Documentation tables
// ---------------------------------------------------------------------------

const TOP_LEVEL: readonly Suggestion[] = [
  {
    label: "on",
    kind: "keyword",
    detail: "react to something",
    info: "Starts a block that runs when something happens, like `on sense robot`.",
  },
  {
    label: "name",
    kind: "keyword",
    detail: "what you're called",
    info: 'Sets the label shown under your robot. `name "Sparky"`',
  },
  {
    label: "chassis",
    kind: "keyword",
    detail: "which kind of robot",
    info: "Picks how you move. A tank turns on the spot; a car is faster but has a turning circle.",
  },
  {
    label: "color",
    kind: "keyword",
    detail: "your colour",
    info: "Sets your colour on screen, like `color #ff8800`.",
  },
  {
    label: "var",
    kind: "keyword",
    detail: "remember something",
    info: "Makes a new variable you can change later. `var target = none`",
  },
  {
    label: "can",
    kind: "keyword",
    detail: "teach yourself something",
    info: "Names a block of instructions you can use more than once.\n\ncan dodge given hit by bullet\n  turn body by event.bearing + 90\nend\n\nSay `given <event>` and the block can read `event.` — and if you have no `on` block for that event, blocks like it become the handler, in the order you wrote them.",
  },
];

const STATEMENTS: readonly Suggestion[] = [
  {
    label: "set",
    kind: "keyword",
    detail: "change a variable",
    info: 'Changes a variable you already made. `set target = event.bearing`\nYou can also `set name = "hunting"` to change your label mid-match.',
  },
  {
    label: "var",
    kind: "keyword",
    detail: "remember something",
    info: "Makes a new variable. `var seen = 0`",
  },
  {
    label: "if",
    kind: "keyword",
    detail: "only sometimes",
    info: "Runs the lines inside only when something is true.\n\nif event.distance > 120\n  drive forward 90\nelse\n  drive forward 30\nend",
  },
  {
    label: "loop",
    kind: "keyword",
    detail: "go round forever",
    info: "Repeats until you `break` out of it.\n\nloop\n  turret.turn by 10\n  break if me.gunHeat is 0\nend",
  },
  {
    label: "for",
    kind: "keyword",
    detail: "count up",
    info: "Counts from one number to another.\n\nfor i = 1 to 4\n  turret.turn by 90\nend",
  },
  {
    label: "repeat",
    kind: "keyword",
    detail: "a set number of times",
    info: "Does something a fixed number of times.\n\nrepeat 3 times\n  fire\nend",
  },
  {
    label: "break",
    kind: "keyword",
    detail: "leave the loop",
    info: "Jumps out of the loop you are inside. `break if target isnt none`",
  },
  {
    label: "continue",
    kind: "keyword",
    detail: "skip to the next go",
    info: "Skips the rest of this time round the loop and starts the next one.",
  },
  {
    label: "do",
    kind: "keyword",
    detail: "run one of your blocks",
    info: "Runs a block you made with `can`. `do dodge`\nIf the block was given something, hand it over: `do shove with 3`",
  },
  {
    label: "wait",
    kind: "keyword",
    detail: "pause a moment",
    info: "Pauses this block for a while. There are 30 ticks in a second. `wait 5 ticks`",
  },
];

/** Actions, whose words change with the theme. */
function actionSuggestions(theme: Theme): Suggestion[] {
  const drive = wordFor("drive", theme);
  const turret = wordFor("turret", theme);
  const fire = wordFor("fire", theme);
  const body = wordFor("chassis", theme);
  const radar = wordFor("radar", theme);
  const ping = wordFor("ping", theme);
  return [
    {
      label: drive,
      kind: "action",
      detail: "move",
      info: `How hard to push, from 0 to 100. \`${drive} forward 80\` or \`${drive} back 40\`.\nYou keep going until you say otherwise.`,
    },
    {
      label: "stop",
      kind: "action",
      detail: "stop moving",
      info: "Cuts the throttle. Careful: a car cannot steer once it has stopped.",
    },
    {
      label: "turn",
      kind: "action",
      detail: "point somewhere",
      info: `Turns the whole robot. \`turn ${body} by 90\` turns 90 degrees from where you are now; \`turn ${body} to 0\` turns to face a fixed direction.`,
    },
    {
      label: turret,
      kind: "action",
      detail: "aim the gun",
      info: `The ${turret} turns on its own, separately from your body, so you can drive one way and aim another.\n\n${turret}.aim at event.bearing\n${turret}.sweep 45\n${turret}.turn to 0`,
    },
    {
      label: fire,
      kind: "action",
      detail: "shoot",
      info: `Shoots, if the gun has cooled down. Power 1 to 3: stronger shots hurt more but fly slower. \`${fire} 2\``,
    },
    {
      label: radar,
      kind: "action",
      detail: "aim the long look",
      info: `The ${radar} turns on its own, separately from your body and your ${turret}. It looks three times as far as your sense cone but only a fifth as wide, so you have to point it somewhere on purpose.\n\n${radar}.aim at event.bearing\n${radar}.sweep 60\n${radar}.turn to 0`,
    },
    {
      label: ping,
      kind: "action",
      detail: "look down the beam",
      info: `Sends the beam out where the ${radar} points, once. If it finds someone you get \`on ${ping} robot\`; if it does not, \`on ${ping} wall\` tells you how much room is that way. There is a short wait before you can ${ping} again — check \`me.pingHeat\`.`,
    },
  ];
}

interface PropDoc {
  name: string;
  detail: string;
  /**
   * Canonical word to render this label through, when the two vocabularies
   * spell it differently. Without it a biological player is offered `me.slope`
   * and has to guess that `me.thickness` is the same thing.
   */
  themed?: string;
}

/**
 * What each property is for, keyed by the compiler's list of them.
 *
 * The names live in `compiler.ts`, which is the code that accepts or refuses
 * them; only the prose lives here. Keying the record on that list means a
 * property added to the language and not described here is a type error rather
 * than a property nobody is ever offered.
 */
type PropDocs<K extends string> = Readonly<Record<K, Omit<PropDoc, "name">>>;

const ME_PROP_DOCS: PropDocs<(typeof ME_PROP_NAMES)[number]> = {
  x: { detail: "Where you are across the arena." },
  y: { detail: "Where you are down the arena." },
  heading: { detail: "The direction your body is facing, in degrees." },
  speed: { detail: "How fast you are going right now." },
  health: { detail: "How much {health} you have left, out of 100." },
  turret: { detail: "Where the {turret} points, compared to straight ahead." },
  gunHeat: { detail: "Above 0 means the gun is still cooling and cannot fire." },
  radar: { detail: "Where the {radar} points, compared to straight ahead." },
  pingHeat: { detail: "Ticks left before you can {ping} again. 0 means ready." },
  fuel: {
    detail:
      "How much {fuel} is in your tank, out of 100. Moving, turning, {fire} and {ping} spend it; driving over {fuel} refills it. At empty you are slow, not dead.",
  },
  aiming: {
    detail:
      "1 while a shot is waiting for the {turret} to come round to where you aimed it. Aiming again now only moves the goal and makes it wait longer.",
  },
  slope: {
    themed: "slope",
    detail:
      "How hard the {ground} is right where you are, 0 flat to 100 as bad as it gets. Costs nothing to check \u2014 you can always feel what you are standing on.",
  },
  uphill: {
    themed: "uphill",
    detail:
      "Which way the {ground} gets harder, compared to straight ahead. Going that way is slow and expensive.",
  },
  downhill: {
    themed: "downhill",
    detail:
      "Which way the {ground} gets easier, compared to straight ahead. Going that way is quick and nearly free.",
  },
  ammo: { detail: "1 when you are ready to fire, 0 when you are not." },
  score: { detail: "How many robots you have destroyed." },
};

const ARENA_PROP_DOCS: PropDocs<(typeof ARENA_PROP_NAMES)[number]> = {
  width: { detail: "How wide the arena is." },
  height: { detail: "How tall the arena is." },
  time: { detail: "How many ticks the match has been running." },
  robots: { detail: "How many {robots} are still alive, including you." },
};

const ME_PROPS: readonly PropDoc[] = ME_PROP_NAMES.map((name) => ({ name, ...ME_PROP_DOCS[name] }));
const ARENA_PROPS: readonly PropDoc[] = ARENA_PROP_NAMES.map((name) => ({
  name,
  ...ARENA_PROP_DOCS[name],
}));

const BUILTIN_DOCS: Readonly<Record<string, string>> = {
  abs: "Makes a number positive. abs(-5) is 5.",
  min: "The smaller of two numbers.",
  max: "The larger of two numbers.",
  random: "A random number between 0 and 1.",
  randomint: "A random whole number between two values, both included.",
  sin: "The sine of an angle in degrees.",
  cos: "The cosine of an angle in degrees.",
  sqrt: "The square root of a number.",
  round: "Rounds to the nearest whole number.",
  floor: "Rounds down to a whole number.",
  ceil: "Rounds up to a whole number.",
  distance: "How far apart two points are. distance(x1, y1, x2, y2)",
  bearing: "The direction from one point to another. bearing(x, y)",
};

const LITERALS: readonly Suggestion[] = [
  { label: "true", kind: "value", detail: "yes" },
  { label: "false", kind: "value", detail: "no" },
  {
    label: "none",
    kind: "value",
    detail: "nothing yet",
    info: "Means 'no value'. Handy as a starting point: `var target = none`",
  },
];

/**
 * A small palette, because picking a hex code from nothing is no fun.
 *
 * Exported because the art packs have to stay out of it: a fuel cell painted a
 * colour a robot can wear reads as a distant robot. `tests/render/palette.test.ts`
 * holds that line.
 */
export const PALETTE: readonly { hex: string; name: string }[] = [
  { hex: "#ff8800", name: "orange" },
  { hex: "#ffd166", name: "yellow" },
  { hex: "#7fd1e0", name: "sky blue" },
  { hex: "#6ad98a", name: "green" },
  { hex: "#b085f5", name: "purple" },
  { hex: "#ff6b6b", name: "red" },
  { hex: "#f5f0e6", name: "white" },
  { hex: "#8a8f98", name: "grey" },
];

/** Words after which a value is expected, so we offer expressions. */
const EXPECTS_VALUE = new Set([
  "=",
  "(",
  ",",
  "if",
  "and",
  "or",
  "not",
  "mod",
  "+",
  "-",
  "*",
  "/",
  "<",
  ">",
  "<=",
  ">=",
  "is",
  "isnt",
  "to",
  "by",
  "at",
  "forward",
  "back",
  "sweep",
  "fire",
  "repeat",
  "wait",
  "drive",
]);

// ---------------------------------------------------------------------------
// Where are we?
// ---------------------------------------------------------------------------

interface Context {
  /** True anywhere instructions are legal: a handler or a `can` block. */
  inHandler: boolean;
  event: EventName | null;
}

interface Frame {
  handler: boolean;
  event: EventName | null;
}

/**
 * Words that are never the last thing on their line.
 *
 * Accepting one of these leaves a space behind, because the next thing you type
 * is another word and `givensense robot` is not what anybody meant. Only words
 * the grammar *requires* something after are listed: `fire` and `stop` are
 * whole instructions on their own, and a space after them would be litter.
 *
 * All of them are control words, which are the same in either vocabulary, so
 * this needs no theme.
 */
const NEEDS_A_WORD_AFTER: ReadonlySet<string> = new Set([
  "on",
  "can",
  "do",
  "given",
  "with",
  "set",
  "var",
  "if",
  "for",
  "repeat",
  "wait",
]);

/** Should accepting this suggestion leave a space ready for the next word? */
/**
 * Everything this module knows how to describe, flattened, in one vocabulary.
 *
 * The completion popup asks "what fits here?"; this asks "what is there?" — the
 * same tables read whole rather than filtered by cursor position. It exists so
 * the assistant's language card can be *generated* from the tables the parser
 * and compiler already agree on, instead of being a second, hand-written
 * description of the language that would start drifting the day it was written.
 *
 * Same guarantee as the popup, for the same reason: a word that appears here is
 * a word the compiler accepts.
 */
export function referenceTables(theme: Theme): {
  keywords: Suggestion[];
  statements: Suggestion[];
  actions: Suggestion[];
  turret: Suggestion[];
  radar: Suggestion[];
  me: Suggestion[];
  arena: Suggestion[];
  builtins: Suggestion[];
  literals: Suggestion[];
} {
  return {
    keywords: [...TOP_LEVEL],
    statements: [...STATEMENTS],
    actions: actionSuggestions(theme),
    turret: turretMembers(theme),
    radar: radarMembers(theme),
    me: propSuggestions(ME_PROPS, theme),
    arena: propSuggestions(ARENA_PROPS, theme),
    builtins: Object.entries(BUILTIN_DOCS).map(([label, detail]) => ({
      label,
      kind: "function" as const,
      detail,
    })),
    literals: [...LITERALS],
  };
}

export function completionKeepsGoing(label: string): boolean {
  return NEEDS_A_WORD_AFTER.has(label);
}

/** The canonical words of one line, punctuation included. */
export function wordsOf(line: string): string[] {
  const words: string[] = [];
  for (const tok of scanLine(line)) {
    if (tok.kind === "word") words.push(...tok.canonical);
    else if (tok.kind === "punct") words.push(tok.text);
  }
  return words;
}

/**
 * What one line does to block depth: which blocks it opens, and where it
 * closes one.
 *
 * Two exceptions to "`if` opens a block": `break if` / `continue if` are
 * conditions rather than blocks, and `else if` shares the outer block's `end`.
 *
 * Every reader of block structure goes through here — the cursor context below
 * and the block slicer further down — because two sets of rules that are
 * *nearly* the same is how a slice ends up one `end` short.
 */
export type BlockEdge = "on" | "can" | "plain" | "end";

export function blockEdges(words: readonly string[]): BlockEdge[] {
  const edges: BlockEdge[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const prev = i > 0 ? words[i - 1] : undefined;
    if ((w === "on" || w === "can") && i === 0) edges.push(w);
    else if (w === "if") {
      if (prev !== "break" && prev !== "continue" && prev !== "else") edges.push("plain");
    } else if (w === "loop" || w === "for" || w === "repeat") edges.push("plain");
    else if (w === "end") edges.push("end");
  }
  return edges;
}

/**
 * Work out which handler the cursor sits inside, by tracking block depth
 * through the lines above it.
 */
export function contextAt(source: string, pos: number): Context {
  const upto = source.slice(0, pos);
  const lines = upto.split("\n");
  // Only whole lines above the cursor; the current line is handled by the
  // phrase rules, which run before context ever matters.
  lines.pop();

  const stack: Frame[] = [];

  for (const line of lines) {
    const words = wordsOf(line);
    for (const edge of blockEdges(words)) {
      if (edge === "on") {
        stack.push({ handler: true, event: matchEvent(words.slice(1)) });
      } else if (edge === "can") {
        // A `can` block takes instructions like a handler does, and if it says
        // which event it is for, `event.` means the same thing inside it.
        const at = words.indexOf("given");
        stack.push({ handler: true, event: at >= 0 ? matchEvent(words.slice(at + 1)) : null });
      } else if (edge === "plain") {
        stack.push({ handler: false, event: null });
      } else {
        stack.pop();
      }
    }
  }

  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i]!;
    if (frame.handler) return { inHandler: true, event: frame.event };
  }
  return { inHandler: false, event: null };
}

/** The words that say how often a block runs. */
const COUNT_WORDS: ReadonlySet<string> = new Set(["every", "after", "before", "at"]);

/** Stands in for a literal value in the word stream the phrase rules read. */
const LITERAL = "\0";

/**
 * How often — offered once the event has been named, because that is the point
 * at which the question "how often?" becomes askable.
 *
 * Nobody guesses these exist: a tick handler looks finished the moment you have
 * typed the event, and the popup appearing there is the only hint that running
 * every single tick was a choice.
 */
function countSuggestions(used: readonly string[]): Suggestion[] | null {
  // `at` pins the count exactly, so nothing can be added beside it.
  if (used.includes("at")) return null;
  const out: Suggestion[] = [];
  if (!used.includes("every")) {
    out.push({
      label: "every",
      kind: "keyword",
      detail: "one time in N",
      info: "Runs one time in every N. `on tick every 30` runs once a second — 30 ticks to the second — instead of thirty times.",
    });
  }
  if (!used.includes("after")) {
    out.push({
      label: "after",
      kind: "keyword",
      detail: "not until later",
      info: "Waits until it has happened this many times. `can rally given hit wall after 2` runs from the third bump onward.\nCombines with `every` and `before`.",
    });
  }
  if (!used.includes("before")) {
    out.push({
      label: "before",
      kind: "keyword",
      detail: "only early on",
      info: "Stops once it has happened this many times. `on tick before 90` runs for the first three seconds only.\nCombines with `every` and `after`.",
    });
  }
  if (used.length === 0) {
    out.push({
      label: "at",
      kind: "keyword",
      detail: "exactly once",
      info: "Runs on that time and no other. `can panic given hit by bullet at 3` runs on the third hit, once.\nGoes on its own — `at` already says exactly when.",
    });
  }
  return out.length > 0 ? out : null;
}

/** Longest event phrase that the given words begin with. */
function matchEvent(words: readonly string[]): EventName | null {
  let best: EventName | null = null;
  for (const name of EVENT_NAMES) {
    const parts = name.split(" ");
    if (parts.length > words.length) continue;
    if (parts.every((p, k) => words[k] === p)) {
      if (!best || parts.length > best.split(" ").length) best = name;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

export function completeAt(source: string, pos: number, theme: Theme): CompletionResult | null {
  const lineStart = source.lastIndexOf("\n", pos - 1) + 1;
  const prefix = source.slice(lineStart, pos);
  const tokens = scanLine(prefix);

  const last = tokens[tokens.length - 1];
  // Never interrupt someone writing a comment or a name.
  if (last && last.end === prefix.length) {
    if (last.kind === "comment") return null;
    if (last.kind === "string") return null;
  }

  // The partial word being typed, if any.
  let from = pos;
  if (last && last.kind === "word" && last.end === prefix.length) {
    from = lineStart + last.start;
    tokens.pop();
  }

  const words: string[] = [];
  for (const tok of tokens) {
    if (tok.kind === "word") words.push(...tok.canonical);
    else if (tok.kind === "punct") words.push(tok.text);
    else words.push(LITERAL); // a literal value
  }

  const options = suggest(words, source, pos, theme);
  return options && options.length > 0 ? { from, options } : null;
}

function suggest(
  words: readonly string[],
  source: string,
  pos: number,
  theme: Theme,
): Suggestion[] | null {
  const ctx = contextAt(source, pos);
  const tail = words[words.length - 1];

  // --- property access: me. arena. event. turret. ---
  if (tail === "." && words.length >= 2) {
    const obj = words[words.length - 2]!;
    if (obj === "me") return propSuggestions(ME_PROPS, theme);
    if (obj === "arena") return propSuggestions(ARENA_PROPS, theme);
    if (obj === "event") return eventFieldSuggestions(ctx.event, theme);
    if (obj === "turret") return turretMembers(theme);
    if (obj === "radar") return radarMembers(theme);
    return null;
  }

  // --- how often, once the event has been named ---
  if (words[0] === "on" || words[0] === "can") {
    const at = words[0] === "on" ? 1 : words.indexOf("given") + 1;
    if (at > 0) {
      const event = matchEvent(words.slice(at));
      if (event) {
        const rest = words.slice(at + event.split(" ").length);
        // The numbers arrive as the literal marker rather than as digits, so
        // what is checked here is "nothing but clauses and their numbers".
        if (rest.every((w) => COUNT_WORDS.has(w) || w === LITERAL)) return countSuggestions(rest);
      }
    }
  }

  // --- `on ...`: the event list, narrowing as you type ---
  if (words[0] === "on") return eventSuggestions(words.slice(1), theme);

  // --- `can ...`: the two clauses, then the event list after `given` ---
  const givenAt = words.indexOf("given");
  if (givenAt >= 0) return eventSuggestions(words.slice(givenAt + 1), theme);
  if (words[0] === "can" && words.length >= 2) {
    const clauses: Suggestion[] = [];
    if (!words.includes("with")) {
      clauses.push({
        label: "with",
        kind: "keyword",
        detail: "things to hand it",
        info: "Names what the block is given: `can shove with effort`.\nGive it a starting value — `with effort=2` — and the block can also run on its own.",
      });
    }
    clauses.push({
      label: "given",
      kind: "keyword",
      detail: "which event it is for",
      info: "Says what the block works on, so it can read `event.`: `can dodge given hit by bullet`.\nWith no `on` block for that event, blocks like it become the handler.",
    });
    return clauses;
  }

  // --- exact phrase rules for the action grammar ---
  const phrase = words.join(" ");
  const body = wordFor("chassis", theme);
  switch (phrase) {
    case "chassis":
      return [
        {
          label: wordFor("skid", theme),
          kind: "keyword",
          detail: "turns on the spot",
          info: "Slower, but it can spin where it stands and drive in any direction immediately.",
        },
        {
          label: wordFor("steered", theme),
          kind: "keyword",
          detail: "faster, but has a turning circle",
          info: "Much faster in a straight line, but it steers like a car: it cannot turn at all unless it is moving.",
        },
      ];
    case "color":
      return PALETTE.map((c) => ({
        label: c.hex,
        kind: "color" as const,
        detail: c.name,
      }));
    case "drive":
      return [
        { label: "forward", kind: "keyword", detail: "0 to 100" },
        { label: "back", kind: "keyword", detail: "0 to 100" },
      ];
    case "turn":
      return [
        { label: body, kind: "keyword", detail: "turn the whole robot" },
        { label: "to", kind: "keyword", detail: "to a fixed direction" },
        { label: "by", kind: "keyword", detail: "by this many degrees" },
      ];
    // `body` was canonicalised to `chassis` by the scanner, so this one rule
    // covers both `turn body …` and `turn chassis …`.
    case "turn chassis":
      return byOrTo("Turn to a fixed compass direction", "Turn this far from where you are now");
    case "turret . turn":
      return byOrTo("Point the gun at a fixed direction", "Swing the gun this far");
    case "radar . turn":
      return byOrTo("Point the beam at a fixed direction", "Swing the beam this far");
    case "radar . aim":
      return [
        {
          label: "at",
          kind: "keyword",
          detail: "at a bearing",
          info: `Aims relative to your body, so \`${wordFor("radar", theme)}.aim at event.bearing\` points the beam at whatever an event just told you about.`,
        },
      ];
    case "turret . aim":
      return [
        {
          label: "at",
          kind: "keyword",
          detail: "at a bearing",
          info: "Aims relative to your body, so `turret.aim at event.bearing` points straight at what you just sensed.",
        },
      ];
    case "do": {
      // Only the blocks that would actually work here: one that says
      // `given hit by bullet` has no meaning inside `on tick`.
      const { routines, handled } = routinesIn(source);
      return routines
        .filter((r) => r.given === null || r.given === ctx.event)
        .map((r): Suggestion => ({
          label: r.name,
          kind: "action",
          // "run it with `do`" is not news to someone who has just typed `do`.
          detail: routineNote(r, handled, theme) || (r.params.length > 0 ? "takes something" : ""),
          info: r.params.length
            ? `Give it: ${r.params.join(", ")}\n\ndo ${r.name} with ...`
            : `Runs the \`can ${r.name}\` block here.`,
        }));
    }
    case "set":
      return [
        {
          label: "name",
          kind: "property",
          detail: "your label on screen",
          info: 'Changes the text under your robot, so you can see what it is thinking. `set name = "hunting"`',
        },
        ...variablesIn(source).map((v): Suggestion => ({
          label: v,
          kind: "variable",
          detail: "your variable",
        })),
      ];
    default:
      break;
  }

  // --- a value is expected ---
  if (tail !== undefined && EXPECTS_VALUE.has(tail)) {
    const values = expressionSuggestions(source, ctx.event, theme);
    if (tail === "fire") {
      return [
        { label: "1", kind: "value", detail: "weak, but fast" },
        { label: "2", kind: "value", detail: "middling" },
        { label: "3", kind: "value", detail: "strong, but slow" },
        ...values,
      ];
    }
    return values;
  }

  // --- start of a line ---
  if (words.length === 0) {
    if (!ctx.inHandler) return [...TOP_LEVEL];
    return [...actionSuggestions(theme), ...STATEMENTS];
  }

  return null;
}

function byOrTo(toInfo: string, byInfo: string): Suggestion[] {
  return [
    { label: "to", kind: "keyword", detail: "a fixed direction", info: toInfo },
    { label: "by", kind: "keyword", detail: "this many degrees", info: byInfo },
  ];
}

function turretMembers(theme: Theme): Suggestion[] {
  const turret = wordFor("turret", theme);
  return [
    {
      label: "aim",
      kind: "action",
      detail: "point at a bearing",
      info: `\`${turret}.aim at event.bearing\` points the gun at whatever an event just told you about.`,
    },
    {
      label: "turn",
      kind: "action",
      detail: "to or by an angle",
      info: `\`${turret}.turn to 0\` faces a fixed direction; \`${turret}.turn by 10\` nudges it round.`,
    },
    {
      label: "sweep",
      kind: "action",
      detail: "search back and forth",
      info: `\`${turret}.sweep 45\` swings the gun side to side to look for someone, and keeps doing it while you drive.`,
    },
  ];
}

function radarMembers(theme: Theme): Suggestion[] {
  const radar = wordFor("radar", theme);
  const ping = wordFor("ping", theme);
  return [
    {
      label: "aim",
      kind: "action",
      detail: "point at a bearing",
      info: `\`${radar}.aim at event.bearing\` points the beam at whatever an event just told you about — useful for keeping a distant target while you drive.`,
    },
    {
      label: "turn",
      kind: "action",
      detail: "to or by an angle",
      info: `\`${radar}.turn to 0\` faces a fixed direction; \`${radar}.turn by 10\` nudges it round.`,
    },
    {
      label: "sweep",
      kind: "action",
      detail: "search back and forth",
      info: `\`${radar}.sweep 60\` swings the beam side to side while you drive. ${ping} as it goes and you will find people long before they are in your cone.`,
    },
    {
      label: ping,
      kind: "action",
      detail: "look down the beam now",
      info: `Same as writing \`${ping}\` on its own.`,
    },
  ];
}

function propSuggestions(props: readonly PropDoc[], theme: Theme): Suggestion[] {
  return props.map((p) => ({
    label:
      p.name === "health"
        ? healthPropertyFor(theme)
        : p.themed
          ? wordFor(p.themed, theme)
          : p.name === "turret"
            ? wordFor("turret", theme)
            : p.name,
    kind: "property" as const,
    detail: renderDoc(p.detail, theme),
  }));
}

/**
 * The payoff of the per-event table: inside `on sense wall` you are offered
 * bearing and distance, and nothing else, because that is genuinely all a wall
 * can tell you.
 */
function eventFieldSuggestions(event: EventName | null, theme: Theme): Suggestion[] | null {
  if (!event) return null;
  const fields = eventFields(event);
  if (fields.length === 0) return null;
  return fields.map((f) => ({
    label: f.name,
    kind: "property" as const,
    detail: renderDoc(f.detail, theme),
  }));
}

function eventSuggestions(after: readonly string[], theme: Theme): Suggestion[] | null {
  const candidates = EVENT_NAMES.filter((name) => {
    const parts = name.split(" ");
    return after.every((w, i) => parts[i] === w) && parts.length >= after.length;
  });
  if (candidates.length === 0) return null;

  // Fresh `on`: show every event as a whole phrase, so the full menu of what a
  // robot can react to is visible in one glance.
  if (after.length === 0) {
    return candidates.map((name) => ({
      label: phraseFor(name, theme),
      kind: "event" as const,
      detail: renderDoc(EVENT_DOCS[name].summary, theme),
      info: describeEvent(name, theme),
    }));
  }

  // Part-way through a phrase: offer the distinct next words.
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const name of candidates) {
    const parts = name.split(" ");
    const next = parts[after.length];
    if (next === undefined || seen.has(next)) continue;
    seen.add(next);
    const completed = parts.length === after.length + 1 ? name : null;
    out.push({
      label: wordFor(next, theme),
      kind: "event",
      ...(completed
        ? {
            detail: renderDoc(EVENT_DOCS[completed].summary, theme),
            info: describeEvent(completed, theme),
          }
        : { detail: "carries on the event name" }),
    });
  }
  return out.length > 0 ? out : null;
}

function describeEvent(name: EventName, theme: Theme): string {
  const doc = EVENT_DOCS[name];
  const summary = renderDoc(doc.summary, theme);
  if (doc.fields.length === 0) return summary;
  const fields = doc.fields
    .map((f) => `  event.${f.name} — ${renderDoc(f.detail, theme)}`)
    .join("\n");
  return `${summary}\n\nInside this block you can use:\n${fields}`;
}

function expressionSuggestions(
  source: string,
  event: EventName | null,
  theme: Theme,
): Suggestion[] {
  const out: Suggestion[] = [];

  for (const v of variablesIn(source)) {
    out.push({ label: v, kind: "variable", detail: "your variable" });
  }

  if (event && eventFields(event).length > 0) {
    out.push({
      label: "event",
      kind: "property",
      detail: "what just happened",
      info: describeEvent(event, theme),
    });
  }
  out.push(
    {
      label: "me",
      kind: "property",
      detail: "your own state",
      info: "Type a dot to see what you can look at, like `me.health`.",
    },
    { label: "arena", kind: "property", detail: "the world around you" },
  );

  for (const name of Object.keys(BUILTIN_SIGNATURES)) {
    out.push({
      label: name === "randomint" ? "randomInt" : name,
      kind: "function",
      detail: `${BUILTIN_SIGNATURES[name]} value${BUILTIN_SIGNATURES[name] === 1 ? "" : "s"}`,
      ...(BUILTIN_DOCS[name] ? { info: BUILTIN_DOCS[name] } : {}),
    });
  }

  out.push(...LITERALS);
  return out;
}

/**
 * Variable names declared anywhere in the script. Read with a tolerant scan
 * rather than the parser, because the file being edited usually does not
 * compile yet — which is exactly when you most want the suggestions.
 */
/** What a `can` block declared, read straight off the line that opened it. */
export interface RoutineInfo {
  name: string;
  /** The event named after `given`, if any. */
  given: EventName | null;
  params: string[];
  /** True when every parameter has a starting value, so it can run unasked. */
  runsAlone: boolean;
  /** Line the block was declared on. */
  line: number;
  /** `every 30`, `after 2` … in the order written. */
  counts: Array<{ kind: string; value: number }>;
}

/**
 * Every `can` block in a script, and every event with an `on` block.
 *
 * Read with the tolerant scanner rather than the parser, because this runs on
 * every keystroke against a script that is usually half-written. Anything it
 * cannot make sense of is simply left out.
 */
export function routinesIn(source: string): {
  routines: RoutineInfo[];
  handled: Set<EventName>;
} {
  const routines: RoutineInfo[] = [];
  const handled = new Set<EventName>();

  source.split("\n").forEach((line, index) => {
    const words: string[] = [];
    const raw: string[] = [];
    for (const tok of scanLine(line)) {
      if (tok.kind === "word") {
        words.push(...tok.canonical);
        for (const _ of tok.canonical) raw.push(tok.text);
      } else if (tok.kind === "punct" || tok.kind === "number") {
        words.push(tok.text);
        raw.push(tok.text);
      }
    }
    if (words[0] === "on") {
      const event = matchEvent(words.slice(1));
      if (event) handled.add(event);
      return;
    }
    if (words[0] !== "can" || words.length < 2) return;

    const name = raw[1] ?? words[1]!;
    const givenAt = words.indexOf("given");
    const given = givenAt >= 0 ? matchEvent(words.slice(givenAt + 1)) : null;

    // Parameters run from `with` to `given` (or the end): names, commas, and
    // `= value` for the ones with a starting value.
    const params: string[] = [];
    const defaulted = new Set<string>();
    const withAt = words.indexOf("with");
    if (withAt >= 0) {
      const stop = givenAt >= 0 ? givenAt : words.length;
      let current: string | null = null;
      for (let i = withAt + 1; i < stop; i++) {
        const w = words[i]!;
        if (w === ",") {
          current = null;
        } else if (w === "=") {
          if (current) defaulted.add(current);
        } else if (current === null) {
          current = raw[i] ?? w;
          params.push(current);
        }
      }
    }

    // `every 30 after 2` — a clause word followed by a number.
    const counts: Array<{ kind: string; value: number }> = [];
    for (let i = 0; i < words.length - 1; i++) {
      const w = words[i]!;
      if (!COUNT_WORDS.has(w)) continue;
      const value = Number(words[i + 1]);
      if (Number.isFinite(value)) counts.push({ kind: w, value });
    }

    routines.push({
      name,
      given,
      params,
      runsAlone: params.every((p) => defaulted.has(p)),
      line: index,
      counts,
    });
  });

  return { routines, handled };
}

/** A `can` block together with the text of it, ready to be moved somewhere. */
export interface BlockSource extends RoutineInfo {
  /** Every line from `can` to its `end`, exactly as written. */
  text: string;
  endLine: number;
  /** Blocks this one hands off to with `do`, so they can travel with it. */
  calls: string[];
}

/**
 * Every complete `can` block in a script, with its source text.
 *
 * A block still being typed — one whose `end` has not been written yet — is
 * left out rather than guessed at. Half a block is not something anyone wants
 * dropped into their script.
 */
export function blockSourcesIn(source: string): BlockSource[] {
  const lines = source.split("\n");
  const out: BlockSource[] = [];

  for (const routine of routinesIn(source).routines) {
    let depth = 0;
    let end = -1;
    const calls: string[] = [];

    for (let i = routine.line; i < lines.length; i++) {
      const line = lines[i]!;
      const words = wordsOf(line);
      // `do NAME`, in the words as written rather than canonicalised, since a
      // block's name is a name and not vocabulary.
      const raw = scanLine(line).filter((t) => t.kind === "word");
      for (let k = 0; k < raw.length - 1; k++) {
        if (raw[k]!.canonical[0] === "do") calls.push(raw[k + 1]!.text);
      }
      for (const edge of blockEdges(words)) depth += edge === "end" ? -1 : 1;
      if (depth <= 0) {
        end = i;
        break;
      }
    }

    if (end < 0) continue; // never closed: still being written
    out.push({
      ...routine,
      endLine: end,
      text: lines.slice(routine.line, end + 1).join("\n"),
      calls: [...new Set(calls)],
    });
  }

  return out;
}

/**
 * What will happen to a `can` block, in a few words.
 *
 * Nothing in the source says whether a block runs by itself, so this is the
 * only place a reader can find out — the editor prints it at the end of the
 * line, and the same words label the block in the `do` menu.
 *
 * Empty when there is nothing worth saying, and callers are expected to show
 * nothing at all rather than an empty space.
 */
/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "one in 30, after 25" — the cadence, in words, or "" if it runs every time. */
function cadence(counts: RoutineInfo["counts"]): string {
  const value = (kind: string) => counts.find((c) => c.kind === kind)?.value;
  const every = value("every");
  const after = value("after");
  const before = value("before");
  const at = value("at");

  if (at !== undefined) return `only the ${ordinal(at)}`;

  const parts: string[] = [];
  // `after` first when both are there, and "then", because that is the order
  // the two actually happen in: the wait, and then the cadence counting from
  // the end of it.
  if (after !== undefined) parts.push(`after ${after}`);
  if (every !== undefined) parts.push(`${after !== undefined ? "then " : ""}one in ${every}`);
  if (before !== undefined) parts.push(`before ${before}`);
  return parts.join(", ");
}

export function routineNote(routine: RoutineInfo, handled: Set<EventName>, theme: Theme): string {
  const often = cadence(routine.counts);

  // A block with no `given` was never going to run on its own, so the only
  // thing worth saying about it is a cadence, if it has one.
  if (routine.given === null) return often;

  const event = phraseFor(routine.given, theme);
  if (handled.has(routine.given)) return `your \`on ${event}\` runs instead`;
  if (!routine.runsAlone) {
    const needed = routine.params.join(", ");
    return `needs ${needed} — run it with \`do\``;
  }
  return often ? `runs on ${event}, ${often}` : `runs on ${event}`;
}

export function variablesIn(source: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const line of source.split("\n")) {
    const tokens = scanLine(line).filter((t) => t.kind === "word" || t.kind === "punct");
    for (let i = 0; i < tokens.length - 1; i++) {
      const head = tokens[i]!;
      const next = tokens[i + 1]!;
      if (head.kind !== "word" || next.kind !== "word") continue;
      const keyword = head.canonical[0];
      if (keyword !== "var" && keyword !== "for") continue;
      const name = next.text;
      if (!seen.has(name)) {
        seen.add(name);
        found.push(name);
      }
    }
  }
  return found;
}
