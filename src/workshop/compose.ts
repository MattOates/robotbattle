/**
 * A robot as cards, over the same RoboScript text.
 *
 * The only way to author a robot has been to type RoboScript into CodeMirror.
 * That is a fine way for somebody who can already type and spell `turret`, and
 * it is a locked door for a seven-year-old — not because the ideas are hard
 * ("when you see something, shoot it" is not hard) but because every route in
 * goes through a keyboard.
 *
 * So: cards. The important decision, and the one everything else follows from,
 * is that **the stored form does not change**. `StoredRobot.source` is still
 * RoboScript text. A card is a *view* over that text, not a replacement for it.
 * That keeps trading, the version history, the shared Yjs editing, the
 * assistant, the compiler and every existing test working untouched — and it
 * means a child's robot opens perfectly in an adult's editor, which is the
 * whole escalation story. There is no export step and no second format to
 * migrate.
 *
 * ## Verbatim by default
 *
 * The obvious implementation is to parse to the AST and print it back. That
 * loses comments and formatting, and the comments are not decoration here: the
 * starter {robot} teaches through them, and so do the snippets the quest
 * helper pastes in.
 *
 * So a card keeps the exact source text it came from, and only regenerates it
 * when one of its own values is changed. Everything a child has not touched
 * comes back out character for character — which is the property
 * `tests/workshop/compose.test.ts` pins over every sample {robot} in the game:
 *
 *     toSource(fromSource(s)) === s
 *
 * ## Never refuses
 *
 * Anything the card table does not recognise — a loop, an expression, a `can`
 * block, a construct added after this file was written — becomes a `raw` card
 * that shows the lines and cannot be edited. It is never dropped and never
 * rewritten. A composer that lost code it did not understand would be a trap,
 * and the first thing it would eat is somebody else's traded {robot}.
 *
 * Pure text in, pure text out: no React, no DOM, no storage.
 */

import { EVENT_NAMES, type EventName } from "../lang/ast.js";
import { scanLine } from "../lang/scan.js";

/** What a card's hole holds, and therefore what control edits it. */
export type HoleKind =
  /** 0-100, a dial. */
  | "speed"
  /** Degrees, or a bearing from the event — a compass. */
  | "angle"
  /** 1-3, how hard. */
  | "power"
  /** A count of ticks. */
  | "ticks"
  /**
   * A condition, as written — `me.health < 30`, `event.distance > 120`.
   *
   * Held as text rather than as a tree. A structured builder covers the shape
   * almost every condition actually has (a property, a comparison, a number)
   * and anything hand-written keeps its own words, which is the same bargain
   * the statements make: recognise what you can, carry the rest verbatim.
   */
  | "expr"
  /** How many times, as written — a number or an expression. */
  | "count"
  /** A variable name. */
  | "name"
  /** A quoted string, for the one action that carries a message. */
  | "text"
  /**
   * Anything that produces a value — a number, a property, a variable, or an
   * expression. Drawn as a socket, so what goes in it is a block rather than
   * something to be typed.
   */
  | "value"
  /**
   * A comma-separated argument list, as written.
   *
   * Held as one string because the count varies with the routine being called
   * and a spec has a fixed shape. The block layer splits it into one socket
   * per argument — see `splitArgs`, which has to respect nesting.
   */
  | "args"
  /** One of the two locomotion kinds. */
  | "chassis"
  /** A `#rrggbb`. */
  | "colour";

export interface Hole {
  kind: HoleKind;
  /** Canonical RoboScript for the value: "60", "event.bearing", "event.bearing + 90". */
  value: string;
}

export interface CardSpec {
  id: string;
  /** Icon and phrase, in both registers, with `{0}` for the first hole. */
  icon: string;
  say: { full: string; simple: string };
  /** Canonical RoboScript, with `{0}` where the hole goes. */
  template: string;
  holes: readonly { kind: HoleKind; default: string }[];
  /**
   * The only values this spec will read back.
   *
   * A spec whose control is a dropdown or a stepped slider can only *hold* the
   * values that control offers, so it must only claim the lines it can hold.
   * `turn body by 150` is not one of the named angles and `drive forward 55`
   * is not a step of ten — matched by the friendly spec, both would be
   * silently rounded or replaced. Each of those statements has a twin below
   * with a plain value socket, which takes anything: a number nobody named, a
   * variable, or an expression.
   *
   * Absent means "anything", which is what the twins are.
   */
  choices?: readonly string[];
  /**
   * A matcher for statements the generic one cannot read.
   *
   * The generic matcher handles one hole surrounded by fixed words, which is
   * every action. `set` and `var` have two — a name and a value — so they say
   * how to read themselves, with one capture group per hole.
   */
  match?: RegExp;
  /** Which events this makes sense in. Empty means anywhere. */
  needs?: readonly EventName[];
  /**
   * Only legal inside a loop.
   *
   * `break` and `continue` are refused by the compiler anywhere else, and a
   * beginner handed a red squiggle they did not write and cannot read is worse
   * off than one who was never offered the block. The block editor uses this
   * to restrict where they may be dropped.
   */
  needsLoop?: boolean;
  /** How the palette is grouped. */
  group: "move" | "look" | "shoot" | "wait" | "remember" | "repeat" | "do" | "robot";
}

/**
 * The catalogue.
 *
 * Deliberately small. This is not every statement RoboScript has — it is the
 * dozen that a first {robot} is made of, which is the same dozen the first six
 * lessons cover. Anything outside it is still reachable through the text view,
 * and shows here as a `raw` card rather than being hidden.
 */
/** The speeds the slider can land on. Anything else needs the value twin. */
const SPEEDS = Array.from({ length: 11 }, (_, i) => String(i * 10));
/** Likewise for a wait. */
const TICKS = Array.from({ length: 13 }, (_, i) => String(i * 5));
const POWERS = ["1", "2", "3"];
const ANGLES = [
  "event.bearing",
  "event.bearing + 90",
  "event.bearing + 180",
  "45",
  "90",
  "180",
];

export const CARDS: readonly CardSpec[] = [
  {
    id: "drive-forward",
    choices: SPEEDS,
    icon: "▶",
    say: { full: "Drive forward at {0}", simple: "Go forwards at {0}" },
    template: "drive forward {0}",
    holes: [{ kind: "speed", default: "70" }],
    group: "move",
  },
  {
    id: "drive-back",
    choices: SPEEDS,
    icon: "◀",
    say: { full: "Drive backwards at {0}", simple: "Go backwards at {0}" },
    template: "drive back {0}",
    holes: [{ kind: "speed", default: "60" }],
    group: "move",
  },
  {
    id: "stop",
    icon: "■",
    say: { full: "Stop", simple: "Stop" },
    template: "stop",
    holes: [],
    group: "move",
  },
  {
    id: "turn-body-by",
    choices: ANGLES,
    icon: "↻",
    say: { full: "Turn by {0}", simple: "Turn {0}" },
    template: "turn body by {0}",
    holes: [{ kind: "angle", default: "90" }],
    group: "move",
  },
  {
    id: "turret-aim",
    choices: ANGLES,
    icon: "🎯",
    say: { full: "Point the {turret} at {0}", simple: "Point {0}" },
    template: "turret.aim at {0}",
    holes: [{ kind: "angle", default: "event.bearing" }],
    group: "look",
  },
  {
    id: "turret-sweep",
    choices: ANGLES,
    icon: "🌀",
    say: { full: "Sweep the {turret} {0}", simple: "Look around {0}" },
    template: "turret.sweep {0}",
    holes: [{ kind: "angle", default: "45" }],
    group: "look",
  },
  {
    id: "radar-sweep",
    choices: ANGLES,
    icon: "📡",
    say: { full: "Sweep the {radar} {0}", simple: "Search around {0}" },
    template: "radar.sweep {0}",
    holes: [{ kind: "angle", default: "90" }],
    group: "look",
  },
  {
    id: "ping",
    choices: POWERS,
    icon: "🔎",
    say: { full: "{Ping} at power {0}", simple: "Look a long way, power {0}" },
    template: "ping {0}",
    holes: [{ kind: "power", default: "1" }],
    group: "look",
  },
  {
    id: "fire",
    choices: POWERS,
    icon: "💥",
    say: { full: "{Fire} at power {0}", simple: "Shoot {0}" },
    template: "fire {0}",
    holes: [{ kind: "power", default: "2" }],
    group: "shoot",
  },
  {
    id: "turn-body-to",
    choices: ANGLES,
    icon: "🧭",
    say: { full: "Turn to face {0}", simple: "Face {0}" },
    template: "turn body to {0}",
    holes: [{ kind: "angle", default: "90" }],
    group: "move",
  },
  {
    id: "turret-turn-by",
    choices: ANGLES,
    icon: "↺",
    say: { full: "Swing the {turret} by {0}", simple: "Swing the {turret} {0}" },
    template: "turret.turn by {0}",
    holes: [{ kind: "angle", default: "45" }],
    group: "look",
  },
  {
    id: "radar-aim",
    choices: ANGLES,
    icon: "📶",
    say: { full: "Point the {radar} at {0}", simple: "Point the {radar} {0}" },
    template: "radar.aim at {0}",
    holes: [{ kind: "angle", default: "event.bearing" }],
    group: "look",
  },
  {
    id: "broadcast",
    icon: "📣",
    say: { full: "{Broadcast} {0}", simple: "Shout {0} to everyone" },
    template: "broadcast {0}",
    holes: [{ kind: "text", default: '"hello"' }],
    group: "look",
  },
  {
    id: "var",
    icon: "🆕",
    say: { full: "New {0}, starting at {1}", simple: "Make a new {0}, starting at {1}" },
    template: "var {0} = {1}",
    holes: [
      { kind: "name", default: "seen" },
      { kind: "value", default: "0" },
    ],
    match: /^var\s+([A-Za-z_]\w*)\s*=\s*(.+)$/,
    group: "remember",
  },
  {
    id: "set",
    icon: "📥",
    say: { full: "Set {0} to {1}", simple: "Remember {0} is {1}" },
    template: "set {0} = {1}",
    holes: [
      { kind: "name", default: "seen" },
      { kind: "value", default: "0" },
    ],
    match: /^set\s+([A-Za-z_]\w*)\s*=\s*(.+)$/,
    group: "remember",
  },
  {
    id: "break",
    icon: "⏭",
    say: { full: "Break out of the loop", simple: "Stop repeating" },
    template: "break",
    holes: [],
    needsLoop: true,
    group: "repeat",
  },
  {
    id: "continue",
    icon: "⏩",
    say: { full: "Skip to the next time round", simple: "Skip this one" },
    template: "continue",
    holes: [],
    needsLoop: true,
    group: "repeat",
  },
  {
    id: "wait",
    choices: TICKS,
    icon: "⏱",
    say: { full: "Wait {0} ticks", simple: "Wait {0}" },
    template: "wait {0} ticks",
    holes: [{ kind: "ticks", default: "10" }],
    group: "wait",
  },

  /*
   * The plain-value twins.
   *
   * One statement, two blocks: the one above with a name for the value ("at
   * them", three shells, a speed dial) and the one here with a socket that
   * takes anything — a number nobody named, a variable, an expression. That is
   * how the language keeps its whole range while a beginner still gets a
   * control they cannot be wrong with, and it is what makes a round trip
   * possible for scripts like `drive cruise * 0.5` or `turn body by 150`.
   *
   * Ordered after their named siblings, and the matcher prefers the first spec
   * that will actually hold the value, so a named angle stays a named angle.
   */
  {
    id: "drive-forward-value",
    icon: "▶",
    say: { full: "Drive forward at {0}", simple: "Go forwards at {0}" },
    template: "drive forward {0}",
    holes: [{ kind: "value", default: "70" }],
    group: "move",
  },
  {
    id: "drive-back-value",
    icon: "◀",
    say: { full: "Drive backwards at {0}", simple: "Go backwards at {0}" },
    template: "drive back {0}",
    holes: [{ kind: "value", default: "60" }],
    group: "move",
  },
  {
    /*
     * `drive <speed>` with no direction word: a signed speed, where a negative
     * one reverses. Three of the sample {robotPlural} are written this way and
     * none of them could be a block before.
     */
    id: "drive-value",
    icon: "⏩",
    say: { full: "Drive at {0}", simple: "Go at {0}" },
    template: "drive {0}",
    holes: [{ kind: "value", default: "70" }],
    group: "move",
  },
  {
    id: "turn-body-by-value",
    icon: "↻",
    say: { full: "Turn by {0}", simple: "Turn by {0}" },
    template: "turn body by {0}",
    holes: [{ kind: "value", default: "90" }],
    group: "move",
  },
  {
    id: "turn-body-to-value",
    icon: "🧭",
    say: { full: "Turn to face {0}", simple: "Face {0}" },
    template: "turn body to {0}",
    holes: [{ kind: "value", default: "90" }],
    group: "move",
  },
  {
    /* `turn to X` — the shorthand for `turn body to X`. */
    id: "turn-to-value",
    icon: "🧭",
    say: { full: "Turn to face {0}", simple: "Face {0}" },
    template: "turn to {0}",
    holes: [{ kind: "value", default: "90" }],
    group: "move",
  },
  {
    id: "turret-aim-value",
    icon: "🎯",
    say: { full: "Point the {turret} at {0}", simple: "Point at {0}" },
    template: "turret.aim at {0}",
    holes: [{ kind: "value", default: "event.bearing" }],
    group: "look",
  },
  {
    id: "turret-sweep-value",
    icon: "🌀",
    say: { full: "Sweep the {turret} {0}", simple: "Look around {0}" },
    template: "turret.sweep {0}",
    holes: [{ kind: "value", default: "45" }],
    group: "look",
  },
  {
    id: "turret-turn-by-value",
    icon: "↺",
    say: { full: "Swing the {turret} by {0}", simple: "Swing the {turret} by {0}" },
    template: "turret.turn by {0}",
    holes: [{ kind: "value", default: "45" }],
    group: "look",
  },
  {
    id: "turret-turn-to-value",
    icon: "↺",
    say: { full: "Swing the {turret} to {0}", simple: "Swing the {turret} to {0}" },
    template: "turret.turn to {0}",
    holes: [{ kind: "value", default: "90" }],
    group: "look",
  },
  {
    id: "radar-aim-value",
    icon: "📶",
    say: { full: "Point the {radar} at {0}", simple: "Point the {radar} at {0}" },
    template: "radar.aim at {0}",
    holes: [{ kind: "value", default: "event.bearing" }],
    group: "look",
  },
  {
    id: "radar-sweep-value",
    icon: "📡",
    say: { full: "Sweep the {radar} {0}", simple: "Search around {0}" },
    template: "radar.sweep {0}",
    holes: [{ kind: "value", default: "90" }],
    group: "look",
  },
  {
    id: "radar-turn-by-value",
    icon: "📡",
    say: { full: "Swing the {radar} by {0}", simple: "Swing the {radar} by {0}" },
    template: "radar.turn by {0}",
    holes: [{ kind: "value", default: "45" }],
    group: "look",
  },
  {
    id: "radar-turn-to-value",
    icon: "📡",
    say: { full: "Swing the {radar} to {0}", simple: "Swing the {radar} to {0}" },
    template: "radar.turn to {0}",
    holes: [{ kind: "value", default: "90" }],
    group: "look",
  },
  {
    id: "fire-value",
    icon: "💥",
    say: { full: "{Fire} at power {0}", simple: "Shoot at power {0}" },
    template: "fire {0}",
    holes: [{ kind: "value", default: "2" }],
    group: "shoot",
  },
  {
    id: "ping-value",
    icon: "🔎",
    say: { full: "{Ping} at power {0}", simple: "Look a long way, power {0}" },
    template: "ping {0}",
    holes: [{ kind: "value", default: "1" }],
    group: "look",
  },
  {
    /* Bare `ping`, which takes the default power. Eight of the sample
       {robotPlural} use it and none of them could be a block before. */
    id: "ping-plain",
    icon: "🔎",
    say: { full: "{Ping}", simple: "Look a long way" },
    template: "ping",
    holes: [],
    group: "look",
  },
  {
    /*
     * The declarations. Not instructions — they are what the {robot} *is*, and
     * they may only appear at the top of the file, which is why they live in
     * the `robot` block and nowhere else.
     */
    id: "robot-name",
    icon: "🏷",
    say: { full: "Called {0}", simple: "Called {0}" },
    template: "name {0}",
    holes: [{ kind: "text", default: '"My Robot"' }],
    group: "robot",
  },
  {
    id: "robot-chassis",
    icon: "⚙️",
    say: { full: "Built as a {0}", simple: "Built as a {0}" },
    template: "chassis {0}",
    holes: [{ kind: "chassis", default: "tank" }],
    // The canonical names, because the comparison is canonical: `tank` and
    // `ciliate` are both `skid`, which is the whole point of the two worlds
    // compiling to the same bytecode.
    choices: ["skid", "steered"],
    group: "robot",
  },
  {
    id: "robot-color",
    icon: "🎨",
    say: { full: "Coloured {0}", simple: "Coloured {0}" },
    template: "color {0}",
    holes: [{ kind: "colour", default: "#7fd1e0" }],
    group: "robot",
  },
  {
    /*
     * `do NAME` and `do NAME with a, b, c` — running a named behaviour.
     *
     * The arguments are kept as one string here and split into sockets by the
     * block layer, because the count varies per routine and a `CardSpec` has a
     * fixed shape. Splitting has to respect nesting: one of the sample
     * {robotPlural} calls `do fold with mx, my, number(field(event.data, 5))`,
     * and a naive split on commas would tear that last argument into three.
     */
    id: "do-with",
    icon: "▶️",
    say: { full: "Do {0} with {1}", simple: "Do {0} with {1}" },
    template: "do {0} with {1}",
    holes: [
      { kind: "name", default: "dodge" },
      { kind: "args", default: "0" },
    ],
    match: /^do\s+([A-Za-z_]\w*)\s+with\s+(.+)$/,
    group: "do",
  },
  {
    id: "do",
    icon: "▶️",
    say: { full: "Do {0}", simple: "Do {0}" },
    template: "do {0}",
    holes: [{ kind: "name", default: "dodge" }],
    match: /^do\s+([A-Za-z_]\w*)\s*$/,
    group: "do",
  },
  {
    id: "wait-value",
    icon: "⏱",
    say: { full: "Wait {0} ticks", simple: "Wait {0}" },
    template: "wait {0} ticks",
    holes: [{ kind: "value", default: "10" }],
    group: "wait",
  },
];


/**
 * The id of the pseudo-card that carries a run of comments.
 *
 * Comments are the reason the card view keeps every line verbatim, and they
 * are also what a block editor normally destroys: Blockly regenerates code
 * from blocks, so anything not represented as a block is gone the first time
 * somebody moves one. Making a comment *a block* is the fix — it is carried,
 * shown, dragged and re-emitted like any other, so a robot handed to you with
 * its author's notes still has them after you change it.
 */
export const COMMENT = "comment";

export function cardSpec(id: string): CardSpec | undefined {
  return CARDS.find((c) => c.id === id);
}

/**
 * What an angle hole may hold.
 *
 * `event.bearing` is the one that matters and the one nobody guesses. It is
 * offered as a *word* rather than a number because that is what it is: "which
 * way the thing I just saw is". The arithmetic forms are the two that come up
 * in the lessons — turning away from what hit you, and turning across it.
 */
export const ANGLE_CHOICES: readonly { value: string; say: string; needsEvent: boolean }[] = [
  { value: "event.bearing", say: "at them", needsEvent: true },
  { value: "event.bearing + 90", say: "across them", needsEvent: true },
  { value: "event.bearing + 180", say: "away from them", needsEvent: true },
  { value: "45", say: "45°", needsEvent: false },
  { value: "90", say: "90°", needsEvent: false },
  { value: "180", say: "right round", needsEvent: false },
];

// ---------------------------------------------------------------------------

export interface Card {
  /** Stable within one `fromSource`, for React keys and for editing in place. */
  id: string;
  /** A catalogue id, or "raw" for anything not in it. */
  spec: string;
  holes: Hole[];
  /** The exact source line, indentation and all. Regenerated only when edited. */
  text: string;
  /** Comment and blank lines that came immediately above it, kept with it. */
  lead: string[];
  /**
   * The statements inside, for the constructs that hold statements.
   *
   * `if` has `then` and `else`; `loop`, `for` and `repeat` have `body`. Plain
   * statements have none. Nesting is modelled rather than treated as an opaque
   * run because deciding and repeating *are* the language — a block editor
   * that could not express `if` would not be the language as blocks, it would
   * be a list of actions.
   */
  slots?: Record<string, Card[]>;
  /**
   * The lines that separate and close the slots, verbatim — the `else` and the
   * `end`. Kept rather than regenerated so a construct nobody has touched
   * comes back with its own indentation and spelling.
   */
  seps?: Record<string, string>;
}

/** The constructs that hold other statements, and the slots each one has. */
export const NESTS: Readonly<Record<string, readonly string[]>> = {
  if: ["then", "else"],
  loop: ["body"],
  repeat: ["body"],
  for: ["body"],
};

export function isNest(spec: string): boolean {
  return Object.prototype.hasOwnProperty.call(NESTS, spec);
}

export interface Block {
  id: string;
  /** The verbatim header line: `on sense robot`, `can dodge given hit by bullet`. */
  header: string;
  /**
   * Which kind of top-level block this is.
   *
   * `on` is a handler for an event. `can` is a named behaviour, which is the
   * thing worth passing to somebody else — it says which event it works on
   * through `given`, may take parameters, and becomes the handler itself when
   * no `on` block claims that event.
   *
   * `robot` is the declarations at the top of the file: the name, the chassis,
   * the colour and the globals. It was carried as a list of untouched lines,
   * which round-tripped perfectly and was invisible in the block view — so
   * `name`, `chassis` and every global `var` could be read in code and not
   * seen, let alone changed, in blocks. Making it a block means it inherits
   * everything the others have: verbatim text, comments kept with their
   * statement, a raw fallback for anything unrecognised.
   */
  kind: "on" | "can" | "robot";
  /** The event handled, or the `given` of a `can`. Null when there is none. */
  event: EventName | null;
  /** A `can` block's name. */
  name?: string;
  /**
   * A `can` block's parameters, as written — `power`, `power=2`.
   *
   * Kept verbatim including any default, because a default is part of the
   * contract and rewriting `power=2` as `power` would change what a call with
   * no arguments does.
   */
  params?: string[];
  cards: Card[];
  lead: string[];
  /**
   * The verbatim closing line, so its indentation survives — or null when the
   * script simply stops, which is the normal state of a half-typed editor. A
   * missing `end` must come back missing: inventing one would silently change
   * a script somebody was in the middle of writing.
   */
  close: string | null;
}

export interface Sketch {
  /**
   * Kept only for anything before the declarations that is not a statement —
   * in practice a leading comment block. The declarations themselves are the
   * first entry in `blocks`, with `kind: "robot"`.
   */
  head: string[];
  blocks: Block[];
  /** Anything after the last block's `end`. Usually nothing. */
  tail: string[];
}

let counter = 0;
function nextId(prefix: string): string {
  return `${prefix}${++counter}`;
}

/** The canonical words of a line, lowercased, with numbers and strings kept. */
function canonicalWords(line: string): string[] {
  const out: string[] = [];
  for (const token of scanLine(line)) {
    if (token.kind === "comment") break;
    if (token.kind === "word") out.push(...(token.canonical.length ? token.canonical : [token.text]));
    else if (token.kind !== "error") out.push(token.text);
  }
  return out.map((w) => w.toLowerCase());
}

/**
 * Read a block header.
 *
 * `on sense robot every 30`, `can dodge given hit by bullet`,
 * `can chase with power=2 given sense robot`. The cadence clauses (`every`,
 * `after`, `before`, `at`) are left in the verbatim header rather than pulled
 * out: nothing edits them yet, and carrying them as fields would mean writing
 * them back, which is a chance to get them wrong for no gain.
 */
function readHeader(header: string): {
  kind: "on" | "can";
  event: EventName | null;
  name?: string;
  params?: string[];
} {
  const words = canonicalWords(header);

  if (words[0] === "on") return { kind: "on", event: eventOfHeader(header) };

  if (words[0] === "can") {
    const parsed = parseCanHeader(header);
    return {
      kind: "can",
      event: parsed.given,
      ...(parsed.name ? { name: parsed.name } : {}),
      ...(parsed.params.length > 0 ? { params: parsed.params } : {}),
    };
  }

  return { kind: "on", event: null };
}

/**
 * Take apart a `can` header. The one place that knows its grammar.
 *
 * It was written twice — here and in the block bridge, to decide whether a
 * header had changed — and the two disagreed the moment a biological script
 * appeared: the bridge compared the author's `given sense organism` against the
 * canonical `sense robot`, concluded the header had been edited, and rewrote
 * it in mechanical words. A grammar with two readers has two grammars.
 *
 * `name` and `params` come off the raw text rather than the canonical words,
 * because a parameter is the author's own identifier and must never go through
 * the synonym table; `given` is canonicalised, because it names an event and
 * events have canonical names.
 */
export function parseCanHeader(header: string): {
  name: string;
  params: string[];
  given: EventName | null;
} {
  const text = header.trim();
  const name = /^can\s+([A-Za-z_]\w*)/.exec(text)?.[1] ?? "";
  const withPart =
    /\bwith\s+([^]*?)(?=\s+given\b|\s+every\b|\s+after\b|\s+before\b|\s+at\b|$)/.exec(text)?.[1];
  const givenRaw =
    /\bgiven\s+(.+?)(?=\s+every\b|\s+after\b|\s+before\b|\s+at\b|$)/.exec(text)?.[1]?.trim();
  const given = givenRaw ? canonicalWords(givenRaw).join(" ") : null;
  return {
    name,
    params: withPart ? splitArgs(withPart) : [],
    given: given && (EVENT_NAMES as readonly string[]).includes(given) ? (given as EventName) : null,
  };
}

/** The words that start a cadence clause on a block header. */
const CADENCE = ["every", "after", "before", "at"];

/**
 * The event an `on` header handles. The one place that reads one.
 *
 * Stops at the first cadence word, so `on tick every 30` handles `tick`, and
 * canonicalises, so `on stung` handles `hit by bullet`.
 */
export function eventOfHeader(header: string): EventName | null {
  const words = canonicalWords(header);
  if (words[0] !== "on") return null;
  const rest: string[] = [];
  for (const word of words.slice(1)) {
    if (CADENCE.includes(word)) break;
    rest.push(word);
  }
  const phrase = rest.join(" ");
  return (EVENT_NAMES as readonly string[]).includes(phrase) ? (phrase as EventName) : null;
}

/** The words a template reduces to, with the hole removed. */
function templateShape(spec: CardSpec): string[] {
  return canonicalWords(spec.template.replace(/\{0\}/g, "")).filter((w) => w !== "");
}

/**
 * Recognise one statement line.
 *
 * Matched on canonical words rather than on the raw text, so a line written in
 * either vocabulary — `swim forward 60` as much as `drive forward 60` — lands
 * on the same card. What is *stored* is still the player's own words: only the
 * matching is canonical.
 */
function matchCard(line: string): { spec: CardSpec; holes: Hole[] } | null {
  const words = canonicalWords(line);
  if (words.length === 0) return null;

  const trimmed = line.trim();
  for (const spec of CARDS) {
    // A spec that says how to read itself is tried first and exactly: the
    // generic shape match below assumes one hole and would misread two.
    if (spec.match) {
      const m = spec.match.exec(trimmed);
      if (!m) continue;
      return {
        spec,
        holes: spec.holes.map((h, i) => ({ kind: h.kind, value: (m[i + 1] ?? h.default).trim() })),
      };
    }

    const shape = templateShape(spec);
    if (spec.holes.length === 0) {
      if (words.length === shape.length && shape.every((w, i) => words[i] === w)) {
        return { spec, holes: [] };
      }
      continue;
    }

    // One hole, and the template puts it after the fixed words except for
    // `wait N ticks`, where a word follows it. Compare the head and the tail.
    const before = canonicalWords(spec.template.slice(0, spec.template.indexOf("{0}")));
    const after = canonicalWords(spec.template.slice(spec.template.indexOf("{0}") + 3));
    if (words.length <= before.length + after.length) continue;
    if (!before.every((w, i) => words[i] === w)) continue;
    if (!after.every((w, i) => words[words.length - after.length + i] === w)) continue;

    // Whatever sits between them is the value, read back off the raw line so
    // that `event.bearing + 90` survives as written.
    const value = valueBetween(line, before.length, after.length);
    if (value === null) continue;
    /*
     * A spec whose control cannot hold this value does not get to claim the
     * line — its plain-value twin further down the list will.
     *
     * Compared canonically, because the value is read back raw so the player
     * keeps their own words: `body ciliate` reads as `ciliate`, and the
     * chassis choices are the canonical `tank` and `car`. Compared literally
     * it matched nothing, and every biological {robot} lost its chassis line
     * to a raw block.
     */
    if (
      spec.choices &&
      !spec.choices.includes(value) &&
      // Canonically as well as literally: `body ciliate` reads back as
      // `ciliate` and the chassis choices are the canonical `skid` and
      // `steered`. Both forms are tried because the canonical pass splits a
      // dotted value — `event.bearing` scans as three tokens — and would
      // otherwise reject the very angles it is meant to accept.
      !spec.choices.includes(canonicalWords(value).join(" "))
    ) {
      continue;
    }
    return { spec, holes: [{ kind: spec.holes[0]!.kind, value }] };
  }
  return null;
}

/** The raw text between the Nth token and the last M tokens of a line. */
function valueBetween(line: string, skip: number, trailing: number): string | null {
  const tokens = scanLine(line).filter((t) => t.kind !== "comment" && t.kind !== "error");
  // A word token may stand for several canonical words (`stung`), which would
  // put the indices out. None of the card templates use one, so a mismatch
  // here means this line is not the card we thought.
  if (tokens.some((t) => t.kind === "word" && t.canonical.length > 1)) return null;
  const from = tokens[skip];
  const to = tokens[tokens.length - trailing - 1];
  if (!from || !to || to.end < from.start) return null;
  return line.slice(from.start, to.end).trim();
}

/** Render a card back to a line, at the given indentation. */
export function cardText(spec: CardSpec, holes: readonly Hole[], indent = "  "): string {
  let out = spec.template;
  holes.forEach((hole, i) => {
    out = out.replace(`{${i}}`, hole.value);
  });
  return indent + out;
}

/** A fresh card from the catalogue, with its default values. */
export function newCard(spec: CardSpec, indent = "  "): Card {
  const holes = spec.holes.map((h) => ({ kind: h.kind, value: h.default }));
  return { id: nextId("c"), spec: spec.id, holes, text: cardText(spec, holes, indent), lead: [] };
}

/** Replace a card's value, regenerating only that card's line. */
export function setHole(card: Card, index: number, value: string): Card {
  const spec = cardSpec(card.spec);
  if (!spec) return card;
  const holes = card.holes.map((h, i) => (i === index ? { ...h, value } : h));
  const indent = /^\s*/.exec(card.text)?.[0] ?? "  ";
  return { ...card, holes, text: cardText(spec, holes, indent) };
}

// ---------------------------------------------------------------------------

/** Lines that open a nested region. Each is modelled; none is opaque. */
const OPENERS: readonly { spec: string; re: RegExp }[] = [
  { spec: "if", re: /^if\b/ },
  { spec: "loop", re: /^loop\b/ },
  { spec: "repeat", re: /^repeat\b/ },
  { spec: "for", re: /^for\b/ },
];

function openerFor(trimmed: string): string | null {
  return OPENERS.find((o) => o.re.test(trimmed))?.spec ?? null;
}

/** The condition or count a nesting header carries, as written. */
function nestHole(spec: string, line: string): Hole[] {
  const t = line.trim();
  if (spec === "if") {
    const m = /^if\s+(.*?)\s+then$/.exec(t);
    return m ? [{ kind: "expr", value: m[1]! }] : [];
  }
  if (spec === "repeat") {
    const m = /^repeat\s+(.*?)\s+times$/.exec(t);
    return m ? [{ kind: "count", value: m[1]! }] : [];
  }
  if (spec === "for") {
    const m = /^for\s+(\w+)\s*=\s*(.*?)\s+to\s+(.*)$/.exec(t);
    return m
      ? [
          { kind: "name", value: m[1]! },
          { kind: "count", value: m[2]! },
          { kind: "count", value: m[3]! },
        ]
      : [];
  }
  return [];
}

const isBlank = (l: string) => l.trim() === "";
const isComment = (l: string) => l.trim().startsWith("--");

/**
 * Read statements until one of `stops` is reached at this level.
 *
 * Recursive, so `if` inside `loop` inside `if` is a tree rather than a run of
 * text. Returns where it stopped and on which word, because an `if` has to
 * know whether it ended at `else` or at `end`.
 */
function readStatements(
  lines: string[],
  from: number,
  stops: readonly string[],
): { cards: Card[]; at: number; stoppedOn: string | null } {
  const cards: Card[] = [];
  let lead: string[] = [];
  let i = from;

  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (stops.includes(trimmed)) {
      // Comments sitting just before the closer belong to the block, not to
      // whatever follows it.
      if (lead.length > 0) {
        cards.push({ id: nextId("c"), spec: "raw", holes: [], text: "", lead });
        lead = [];
      }
      return { cards, at: i, stoppedOn: trimmed };
    }

    if (isBlank(line) || isComment(line)) {
      lead.push(line);
      continue;
    }

    const opener = openerFor(trimmed);
    if (opener) {
      const slots: Record<string, Card[]> = {};
      const seps: Record<string, string> = {};
      if (opener === "if") {
        const thenPart = readStatements(lines, i + 1, ["else", "end"]);
        slots["then"] = thenPart.cards;
        i = thenPart.at;
        if (thenPart.stoppedOn === "else") {
          seps["else"] = lines[i]!;
          const elsePart = readStatements(lines, i + 1, ["end"]);
          slots["else"] = elsePart.cards;
          i = elsePart.at;
        }
      } else {
        const body = readStatements(lines, i + 1, ["end"]);
        slots["body"] = body.cards;
        i = body.at;
      }
      // `i` is the closing line, or past the end of an unterminated script.
      if (i < lines.length) seps["end"] = lines[i]!;
      cards.push({
        id: nextId("c"),
        spec: opener,
        holes: nestHole(opener, line),
        text: line,
        lead,
        slots,
        seps,
      });
      lead = [];
      continue;
    }

    const matched = matchCard(line);
    cards.push({
      id: nextId("c"),
      spec: matched ? matched.spec.id : "raw",
      holes: matched ? matched.holes : [],
      text: line,
      lead,
    });
    lead = [];
  }

  if (lead.length > 0) {
    cards.push({ id: nextId("c"), spec: "raw", holes: [], text: "", lead });
  }
  return { cards, at: i, stoppedOn: null };
}

/**
 * Read a script into cards.
 *
 * Line-based on purpose rather than over the AST: the AST has no comments and
 * no formatting, and printing it back would quietly rewrite a script somebody
 * only opened to look at. Here every line is carried verbatim unless it is
 * changed.
 */
export function fromSource(source: string): Sketch {
  const lines = source.split("\n");
  const head: string[] = [];
  const blocks: Block[] = [];
  const tail: string[] = [];

  let lead: string[] = [];
  let i = 0;

  // Everything up to the first block header is the declarations.
  const headLines: string[] = [];
  while (i < lines.length) {
    const line = lines[i]!;
    const words = canonicalWords(line);
    if (words[0] === "on" || words[0] === "can") break;
    headLines.push(line);
    i++;
  }

  // Comments immediately above the first block belong to it, not to the head.
  while (
    headLines.length > 0 &&
    (isComment(headLines[headLines.length - 1]!) || isBlank(headLines[headLines.length - 1]!))
  ) {
    const popped = headLines.pop()!;
    if (isBlank(popped) && lead.length === 0) {
      headLines.push(popped);
      break;
    }
    lead.unshift(popped);
  }

  /*
   * The declarations, read as statements rather than kept as lines.
   *
   * They become the first block, so `name`, `chassis` and the globals are
   * things you can see and change in the block view — which they were not
   * while the head was an opaque run of text that merely round-tripped.
   * Everything before the first *statement* (a file-leading comment) stays in
   * `head`, because it belongs to the file rather than to the robot.
   */
  const firstStatement = headLines.findIndex((l) => !isBlank(l) && !isComment(l));
  if (firstStatement === -1) {
    head.push(...headLines);
  } else {
    head.push(...headLines.slice(0, firstStatement));
    const read = readStatements(headLines.slice(firstStatement), 0, []);
    blocks.push({
      id: nextId("b"),
      header: "",
      kind: "robot",
      event: null,
      cards: read.cards,
      lead: [],
      close: null,
    });
  }

  while (i < lines.length) {
    const header = lines[i]!;
    const words = canonicalWords(header);
    if (words[0] !== "on" && words[0] !== "can") {
      // Between blocks: blanks and comments belong to whatever comes next.
      lead.push(header);
      i++;
      continue;
    }

    const read = readStatements(lines, i + 1, ["end"]);
    i = read.at;
    const close = read.stoppedOn === "end" ? lines[i]! : null;
    if (close !== null) i++;

    blocks.push({
      id: nextId("b"),
      header,
      ...readHeader(header),
      cards: read.cards,
      lead,
      close,
    });
    lead = [];
  }

  tail.push(...lead);
  return { head, blocks, tail };
}

/**
 * Write cards back out.
 *
 * The inverse of `fromSource` for any script it has not been asked to change:
 * `toSource(fromSource(s)) === s`, which the tests assert over every sample
 * {robot} in the game. That equality is the whole safety argument — it is what
 * says opening somebody's {robot} in the card view and closing it again cannot
 * have damaged it.
 */
export function toSource(sketch: Sketch): string {
  const out: string[] = [...sketch.head];

  /**
   * One statement and everything under it.
   *
   * Recursive, mirroring `readStatements`: the header, then each slot's
   * statements, with the separators that were written between them. A
   * construct nobody has touched comes back out with its own `else` and `end`
   * exactly as they were indented and spelled.
   */
  const emit = (card: Card, into: string[]): void => {
    into.push(...card.lead);
    // An empty text is the placeholder for trailing comments inside a block,
    // which have already been emitted as `lead`.
    if (card.text === "") return;
    into.push(...card.text.split("\n"));

    if (!card.slots) return;
    for (const slot of NESTS[card.spec] ?? []) {
      const held = card.slots[slot];
      // The separator comes before the slot it introduces — `else` before the
      // else-branch — and only when there is a branch to introduce.
      if (slot !== (NESTS[card.spec] ?? [])[0]) {
        const sep = card.seps?.[slot];
        if (held === undefined) continue;
        if (sep !== undefined) into.push(sep);
        else into.push(`${indentOfText(card.text)}${slot}`);
      }
      for (const child of held ?? []) emit(child, into);
    }
    const end = card.seps?.["end"];
    into.push(end === undefined ? `${indentOfText(card.text)}end` : end);
  };

  for (const block of sketch.blocks) {
    out.push(...block.lead);
    // The declarations have no header and no `end` — they are the top of the
    // file, not a thing that opens and closes.
    if (block.kind !== "robot") out.push(block.header);
    for (const card of block.cards) emit(card, out);
    if (block.close !== null) out.push(block.close);
  }

  out.push(...sketch.tail);
  return out.join("\n");
}

/** Add a card to the end of a block. */
export function addCard(sketch: Sketch, blockId: string, spec: CardSpec): Sketch {
  return mapBlock(sketch, blockId, (block) => ({
    ...block,
    cards: [...block.cards, newCard(spec, indentOf(block))],
  }));
}

export function removeCard(sketch: Sketch, blockId: string, cardId: string): Sketch {
  return mapBlock(sketch, blockId, (block) => ({
    ...block,
    cards: block.cards.filter((c) => c.id !== cardId),
  }));
}

export function moveCard(sketch: Sketch, blockId: string, cardId: string, by: number): Sketch {
  return mapBlock(sketch, blockId, (block) => {
    const at = block.cards.findIndex((c) => c.id === cardId);
    const to = at + by;
    if (at === -1 || to < 0 || to >= block.cards.length) return block;
    const cards = [...block.cards];
    const [moved] = cards.splice(at, 1);
    cards.splice(to, 0, moved!);
    return { ...block, cards };
  });
}

export function editCard(
  sketch: Sketch,
  blockId: string,
  cardId: string,
  index: number,
  value: string,
): Sketch {
  return mapBlock(sketch, blockId, (block) => ({
    ...block,
    cards: block.cards.map((c) => (c.id === cardId ? setHole(c, index, value) : c)),
  }));
}

/** Add a `when this happens` block for an event the script does not handle yet. */
export function addBlock(sketch: Sketch, event: EventName): Sketch {
  const block: Block = {
    id: nextId("b"),
    header: `on ${event}`,
    kind: "on",
    event,
    cards: [],
    // A blank line before it, so the script reads the way a person would write it.
    lead: sketch.blocks.length > 0 || sketch.head.length > 0 ? [""] : [],
    close: "end",
  };
  return { ...sketch, blocks: [...sketch.blocks, block] };
}

export function removeBlock(sketch: Sketch, blockId: string): Sketch {
  return { ...sketch, blocks: sketch.blocks.filter((b) => b.id !== blockId) };
}

/** Events the script does not already handle, so a second one cannot be added. */
export function availableEvents(sketch: Sketch): EventName[] {
  const taken = new Set(sketch.blocks.map((b) => b.event).filter(Boolean));
  return EVENT_NAMES.filter((e) => !taken.has(e));
}

/** The leading whitespace of a line, for generating a matching closer. */
function indentOfText(text: string): string {
  return /^\s*/.exec(text)?.[0] ?? "  ";
}

function indentOf(block: Block): string {
  const first = block.cards.find((c) => c.spec !== "raw");
  return first ? (/^\s*/.exec(first.text)?.[0] ?? "  ") : "  ";
}

function mapBlock(sketch: Sketch, blockId: string, f: (block: Block) => Block): Sketch {
  return { ...sketch, blocks: sketch.blocks.map((b) => (b.id === blockId ? f(b) : b)) };
}

/**
 * Every variable the script declares, in the order they first appear.
 *
 * Both kinds count: the globals at the top of the file, which is where a
 * variable that has to survive between events must live, and any `var` inside
 * a handler. Used to fill the palette — a variable you have made should be
 * something you can pick up, and one you have not made should not be
 * offerable, because referring to it is a compile error the child did not
 * write and cannot read.
 */
export function declaredVariables(sketch: Sketch): string[] {
  const names: string[] = [];
  const add = (name: string) => {
    if (name !== "" && !names.includes(name)) names.push(name);
  };

  for (const line of sketch.head) {
    const m = /^\s*var\s+([A-Za-z_]\w*)\s*=/.exec(line);
    if (m) add(m[1]!);
  }

  const walk = (cards: readonly Card[]): void => {
    for (const card of cards) {
      if (card.spec === "var") add(card.holes[0]?.value ?? "");
      for (const held of Object.values(card.slots ?? {})) walk(held);
    }
  };
  for (const block of sketch.blocks) walk(block.cards);

  return names;
}

/**
 * Split an argument list on its top-level commas.
 *
 * `mx, my, number(field(event.data, 5))` is three arguments, not five. A naive
 * split tears the last one into pieces and a round trip would put it back as
 * three separate arguments to a routine that takes one — which compiles, and
 * is a different program.
 */
export function splitArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last !== "") out.push(last);
  return out;
}

/** Put them back the way they are written, one comma and a space apart. */
export function joinArgs(args: readonly string[]): string {
  return args.join(", ");
}

/**
 * Every behaviour the script names, and how many things each takes.
 *
 * Fills the Do palette: a call block per routine, already carrying the right
 * number of argument sockets, because how many one takes is something the
 * script knows and the person calling it should not have to.
 */
export function declaredRoutines(sketch: Sketch): { name: string; args: number }[] {
  return sketch.blocks
    .filter((b) => b.kind === "can" && b.name)
    .map((b) => ({ name: b.name!, args: b.params?.length ?? 0 }));
}
