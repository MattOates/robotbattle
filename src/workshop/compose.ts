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
  | "text";

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
  group: "move" | "look" | "shoot" | "wait" | "remember" | "repeat";
}

/**
 * The catalogue.
 *
 * Deliberately small. This is not every statement RoboScript has — it is the
 * dozen that a first {robot} is made of, which is the same dozen the first six
 * lessons cover. Anything outside it is still reachable through the text view,
 * and shows here as a `raw` card rather than being hidden.
 */
export const CARDS: readonly CardSpec[] = [
  {
    id: "drive-forward",
    icon: "▶",
    say: { full: "Drive forward at {0}", simple: "Go forwards" },
    template: "drive forward {0}",
    holes: [{ kind: "speed", default: "70" }],
    group: "move",
  },
  {
    id: "drive-back",
    icon: "◀",
    say: { full: "Drive backwards at {0}", simple: "Go backwards" },
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
    icon: "↻",
    say: { full: "Turn by {0}", simple: "Turn" },
    template: "turn body by {0}",
    holes: [{ kind: "angle", default: "90" }],
    group: "move",
  },
  {
    id: "turret-aim",
    icon: "🎯",
    say: { full: "Point the {turret} at {0}", simple: "Point at them" },
    template: "turret.aim at {0}",
    holes: [{ kind: "angle", default: "event.bearing" }],
    group: "look",
  },
  {
    id: "turret-sweep",
    icon: "🌀",
    say: { full: "Sweep the {turret} {0}", simple: "Look around" },
    template: "turret.sweep {0}",
    holes: [{ kind: "angle", default: "45" }],
    group: "look",
  },
  {
    id: "radar-sweep",
    icon: "📡",
    say: { full: "Sweep the {radar} {0}", simple: "Search around" },
    template: "radar.sweep {0}",
    holes: [{ kind: "angle", default: "90" }],
    group: "look",
  },
  {
    id: "ping",
    icon: "🔎",
    say: { full: "{Ping} at power {0}", simple: "Look a long way" },
    template: "ping {0}",
    holes: [{ kind: "power", default: "1" }],
    group: "look",
  },
  {
    id: "fire",
    icon: "💥",
    say: { full: "{Fire} at power {0}", simple: "Shoot" },
    template: "fire {0}",
    holes: [{ kind: "power", default: "2" }],
    group: "shoot",
  },
  {
    id: "turn-body-to",
    icon: "🧭",
    say: { full: "Turn to face {0}", simple: "Face this way" },
    template: "turn body to {0}",
    holes: [{ kind: "angle", default: "90" }],
    group: "move",
  },
  {
    id: "turret-turn-by",
    icon: "↺",
    say: { full: "Swing the {turret} by {0}", simple: "Swing the {turret}" },
    template: "turret.turn by {0}",
    holes: [{ kind: "angle", default: "45" }],
    group: "look",
  },
  {
    id: "radar-aim",
    icon: "📶",
    say: { full: "Point the {radar} at {0}", simple: "Point the {radar}" },
    template: "radar.aim at {0}",
    holes: [{ kind: "angle", default: "event.bearing" }],
    group: "look",
  },
  {
    id: "broadcast",
    icon: "📣",
    say: { full: "{Broadcast} {0}", simple: "Shout to everyone" },
    template: "broadcast {0}",
    holes: [{ kind: "text", default: '"hello"' }],
    group: "look",
  },
  {
    id: "set",
    icon: "📥",
    say: { full: "Set {0}", simple: "Remember {0}" },
    template: "set {0}",
    holes: [{ kind: "expr", default: "seen = seen + 1" }],
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
    icon: "⏱",
    say: { full: "Wait {0} ticks", simple: "Wait a moment" },
    template: "wait {0} ticks",
    holes: [{ kind: "ticks", default: "10" }],
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
  /** The event, when this is an `on` block the card table understands. */
  event: EventName | null;
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
  /** Everything before the first block: name, chassis, color, globals, comments. */
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

/** `on sense robot` -> "sense robot", if it names an event we know. */
function eventOf(header: string): EventName | null {
  const words = canonicalWords(header);
  if (words[0] !== "on") return null;
  const rest = words.slice(1).join(" ");
  return (EVENT_NAMES as readonly string[]).includes(rest) ? (rest as EventName) : null;
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

  for (const spec of CARDS) {
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

  // Everything up to the first block header belongs to the head.
  while (i < lines.length) {
    const line = lines[i]!;
    const words = canonicalWords(line);
    if (words[0] === "on" || words[0] === "can") break;
    head.push(line);
    i++;
  }

  // Comments immediately above the first block belong to it, not to the head.
  while (head.length > 0 && (isComment(head[head.length - 1]!) || isBlank(head[head.length - 1]!))) {
    const popped = head.pop()!;
    if (isBlank(popped) && lead.length === 0) {
      head.push(popped);
      break;
    }
    lead.unshift(popped);
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
      event: eventOf(header),
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
    out.push(block.header);
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
