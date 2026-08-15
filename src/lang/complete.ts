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
import { EVENT_DOCS, eventFields, renderDoc } from "./events.js";
import { scanLine } from "./scan.js";
import { healthPropertyFor, phraseFor, wordFor, type Theme } from "./vocab.js";

export type SuggestionKind =
  | "event"
  | "action"
  | "keyword"
  | "property"
  | "function"
  | "variable"
  | "value"
  | "color";

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
];

const STATEMENTS: readonly Suggestion[] = [
  {
    label: "set",
    kind: "keyword",
    detail: "change a variable",
    info: "Changes a variable you already made. `set target = event.bearing`\nYou can also `set name = \"hunting\"` to change your label mid-match.",
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
  ];
}

interface PropDoc {
  name: string;
  detail: string;
}

const ME_PROPS: readonly PropDoc[] = [
  { name: "x", detail: "Where you are across the arena." },
  { name: "y", detail: "Where you are down the arena." },
  { name: "heading", detail: "The direction your body is facing, in degrees." },
  { name: "speed", detail: "How fast you are going right now." },
  { name: "health", detail: "How much {health} you have left, out of 100." },
  { name: "turret", detail: "Where the {turret} points, compared to straight ahead." },
  { name: "gunHeat", detail: "Above 0 means the gun is still cooling and cannot fire." },
  { name: "ammo", detail: "1 when you are ready to fire, 0 when you are not." },
  { name: "score", detail: "How many robots you have destroyed." },
];

const ARENA_PROPS: readonly PropDoc[] = [
  { name: "width", detail: "How wide the arena is." },
  { name: "height", detail: "How tall the arena is." },
  { name: "time", detail: "How many ticks the match has been running." },
  { name: "robots", detail: "How many {robots} are still alive, including you." },
];

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

/** A small palette, because picking a hex code from nothing is no fun. */
const PALETTE: readonly { hex: string; name: string }[] = [
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
  "=", "(", ",", "if", "and", "or", "not", "mod",
  "+", "-", "*", "/", "<", ">", "<=", ">=", "is", "isnt",
  "to", "by", "at", "forward", "back", "sweep", "fire", "repeat", "wait", "drive",
]);

// ---------------------------------------------------------------------------
// Where are we?
// ---------------------------------------------------------------------------

interface Context {
  inHandler: boolean;
  event: EventName | null;
}

interface Frame {
  handler: boolean;
  event: EventName | null;
}

/**
 * Work out which handler the cursor sits inside, by tracking block depth
 * through the lines above it.
 *
 * Two exceptions to "`if` opens a block": `break if` / `continue if` are
 * conditions rather than blocks, and `else if` shares the outer block's `end`.
 */
export function contextAt(source: string, pos: number): Context {
  const upto = source.slice(0, pos);
  const lines = upto.split("\n");
  // Only whole lines above the cursor; the current line is handled by the
  // phrase rules, which run before context ever matters.
  lines.pop();

  const stack: Frame[] = [];

  for (const line of lines) {
    const words: string[] = [];
    for (const tok of scanLine(line)) {
      if (tok.kind === "word") words.push(...tok.canonical);
      else if (tok.kind === "punct") words.push(tok.text);
    }

    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      const prev = i > 0 ? words[i - 1] : undefined;

      if (w === "on" && i === 0) {
        stack.push({ handler: true, event: matchEvent(words.slice(1)) });
      } else if (w === "if") {
        if (prev !== "break" && prev !== "continue" && prev !== "else") {
          stack.push({ handler: false, event: null });
        }
      } else if (w === "loop" || w === "for" || w === "repeat") {
        stack.push({ handler: false, event: null });
      } else if (w === "end") {
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

export function completeAt(
  source: string,
  pos: number,
  theme: Theme,
): CompletionResult | null {
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
    else words.push(" "); // a literal value
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
    return null;
  }

  // --- `on ...`: the event list, narrowing as you type ---
  if (words[0] === "on") return eventSuggestions(words.slice(1), theme);

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
    case "turret . aim":
      return [
        {
          label: "at",
          kind: "keyword",
          detail: "at a bearing",
          info: "Aims relative to your body, so `turret.aim at event.bearing` points straight at what you just sensed.",
        },
      ];
    case "set":
      return [
        {
          label: "name",
          kind: "property",
          detail: "your label on screen",
          info: 'Changes the text under your robot, so you can see what it is thinking. `set name = "hunting"`',
        },
        ...variablesIn(source).map(
          (v): Suggestion => ({ label: v, kind: "variable", detail: "your variable" }),
        ),
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

function propSuggestions(props: readonly PropDoc[], theme: Theme): Suggestion[] {
  return props.map((p) => ({
    label:
      p.name === "health"
        ? healthPropertyFor(theme)
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
function eventFieldSuggestions(
  event: EventName | null,
  theme: Theme,
): Suggestion[] | null {
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
    { label: "me", kind: "property", detail: "your own state", info: "Type a dot to see what you can look at, like `me.health`." },
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
