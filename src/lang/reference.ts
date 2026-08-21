/**
 * The language, described by reading the language.
 *
 * Every syntax rule on the reference page comes from
 * `parser.getGAstProductions()` — the same object the parser runs — so a rule
 * that changes shape cannot leave a page describing the shape it used to have.
 * The prose cannot be generated and is not: it lives in `ANNOTATIONS` below,
 * and `tests/lang/reference.test.ts` fails if a rule exists without one. That
 * is the whole arrangement. Structure is read, meaning is written, and neither
 * can be quietly forgotten.
 *
 * What this replaces is five hand-written transcriptions of the same grammar
 * that had no way of noticing each other, described at the top of
 * `tests/ui/highlight.test.ts` as the reason a new instruction can ship looking
 * like a typo.
 */

import { serializeGrammar } from "chevrotain";
import { parser } from "./grammar.js";
import { isPlaceholder, wordForType } from "./tokens.js";
import { wordFor, type Theme } from "./vocab.js";

// --- the shape of a rule, as data -----------------------------------------

/**
 * One node of a rule's syntax, flattened out of Chevrotain's GAst.
 *
 * Deliberately smaller than the GAst: the page needs to know that something is
 * optional, repeated or a choice, and does not need Chevrotain's occurrence
 * indices or lookahead bookkeeping.
 */
export type Syntax =
  /** A fixed word or symbol the player types. */
  | { kind: "word"; text: string }
  /** A name, a number, a piece of text — a shape rather than a word. */
  | { kind: "placeholder"; text: string }
  /** Another rule, by name. */
  | { kind: "rule"; name: string }
  /** One after another. */
  | { kind: "sequence"; of: Syntax[] }
  /** Exactly one of these. */
  | { kind: "choice"; of: Syntax[] }
  /** Nothing, or this. */
  | { kind: "optional"; of: Syntax }
  /** This, any number of times — `least` says whether none will do. */
  | { kind: "repeat"; of: Syntax; least: 0 | 1; separator?: Syntax };

interface GastNode {
  type: string;
  name?: string;
  definition?: GastNode[];
  separator?: GastNode;
}

function convert(nodes: GastNode[]): Syntax {
  const parts = nodes.map(one);
  return parts.length === 1 ? parts[0]! : { kind: "sequence", of: parts };
}

function one(node: GastNode): Syntax {
  switch (node.type) {
    case "Terminal": {
      const text = wordForType(node.name!);
      return isPlaceholder(node.name!) ? { kind: "placeholder", text } : { kind: "word", text };
    }
    case "NonTerminal":
      return { kind: "rule", name: node.name! };
    case "Alternation":
      return { kind: "choice", of: (node.definition ?? []).map((alt) => convert(alt.definition ?? [])) };
    case "Alternative":
      return convert(node.definition ?? []);
    case "Option":
      return { kind: "optional", of: convert(node.definition ?? []) };
    case "Repetition":
      return { kind: "repeat", of: convert(node.definition ?? []), least: 0 };
    case "RepetitionMandatory":
      return { kind: "repeat", of: convert(node.definition ?? []), least: 1 };
    case "RepetitionMandatoryWithSeparator":
      return {
        kind: "repeat",
        of: convert(node.definition ?? []),
        least: 1,
        separator: one(node.separator!),
      };
    default:
      // Nothing else can appear: the eight node types above are all Chevrotain
      // produces, and a ninth should be a loud failure rather than a gap.
      throw new Error(`unknown grammar node \`${node.type}\``);
  }
}

// --- what the rules are for -------------------------------------------------

export interface Annotation {
  /** How the page names the rule, in the player's words. */
  title: string;
  /** One or two sentences. Placeholders from `renderDoc` are honoured. */
  summary: string;
  /** Which part of the page it belongs to. */
  section: SectionName;
  /** Written in canonical words; rendered through `translate` for the theme. */
  example?: string;
}

export type SectionName =
  | "program"
  | "events"
  | "cadence"
  | "statements"
  | "actions"
  | "values"
  /** Rules that exist to make the grammar work and mean nothing on their own. */
  | "plumbing";

export const SECTIONS: readonly { name: SectionName; title: string; blurb: string }[] = [
  {
    name: "program",
    title: "The shape of a program",
    blurb:
      "A script is a list of blocks. Nothing runs at the top level — you say what your {robot} is called and what it is made of, and everything else goes inside a block that waits for something to happen.",
  },
  {
    name: "events",
    title: "Events",
    blurb:
      "An `on` block runs when its event happens, and only then. This is the part of RoboScript most unlike other languages: there is no main loop you write, and no way to make one. `on tick` is as close as it gets, and it runs once per tick and then stops.",
  },
  {
    name: "cadence",
    title: "How often a block runs",
    blurb:
      "Scheduling belongs to the block, not to control flow. `every`, `after`, `before` and `at` count how many times the event has happened and decide whether this is one of the times the block should run.",
  },
  {
    name: "statements",
    title: "Instructions",
    blurb: "What goes inside a block, one per line.",
  },
  {
    name: "actions",
    title: "Things your {robot} can do",
    blurb:
      "Actions are the instructions that reach the world. Most cost time or {fuel}, and a block that asks for two contradictory things in one tick gets the last one.",
  },
  {
    name: "values",
    title: "Values",
    blurb:
      "What you can put where a number goes: literals, variables, what your {robot} can sense about itself and the arena, and arithmetic on those.",
  },
];

/**
 * Why each rule exists, in words a person wrote.
 *
 * A rule with no entry here is a rule nobody has explained, and the test says
 * so by name. `plumbing` is a real answer — `elseIf` exists so that `else if`
 * can chain, and describing it would tell a player nothing they want to know —
 * but it has to be given deliberately rather than by omission.
 */
export const ANNOTATIONS: Readonly<Record<string, Annotation>> = {
  program: {
    title: "A whole script",
    summary: "Blank lines are free. Everything else is a declaration or a block.",
    section: "program",
  },
  topLevel: {
    title: "What goes at the outermost level",
    summary:
      "Six things, and no instructions among them. An action written out here has nothing to run it.",
    section: "program",
  },
  nameDecl: {
    title: "name",
    summary: "The label shown under your {robot}. You can change it mid-match with `set name`.",
    section: "program",
    example: 'name "Sparky"',
  },
  chassisDecl: {
    title: "chassis",
    summary:
      "`skid` turns on the spot and can drive in any direction at once, but is slower. `steered` is much faster in a straight line and cannot turn at all unless it is already moving.",
    section: "program",
    example: "chassis skid",
  },
  colorDecl: {
    title: "color",
    summary:
      "Six hex characters after the `#`, or three as a shorthand. `colour` is accepted too.",
    section: "program",
    example: "color #ff8800",
  },
  varDecl: {
    title: "var",
    summary:
      "Makes a variable. Written at the top level it is remembered between blocks and between ticks; written inside a block it lasts until that block finishes.",
    section: "program",
    example: "var target = 0",
  },
  handler: {
    title: "on",
    summary: "Runs the block when the event happens.",
    section: "events",
    example: "on sense robot\n  fire 2\nend",
  },
  routine: {
    title: "can",
    summary:
      "Teaches your {robot} something it can be told to `do`. With `given`, it can also read `event.` — and if no `on` block claims that event, blocks like it become the handler.",
    section: "program",
    example: "can shove with power = 2\n  fire power\nend",
  },
  params: {
    title: "What a block is given",
    summary:
      "Names, separated by commas. Ones with a starting value have to come last, so leaving them out at a `do` is never ambiguous.",
    section: "program",
  },
  param: { title: "One of them", summary: "A name, and optionally what it is when not supplied.", section: "plumbing" },
  countClauses: {
    title: "every, after, before, at",
    summary:
      "Filters on the count of how many times the event has happened. Order carries no meaning. `at` pins the count exactly and goes on its own.",
    section: "cadence",
    example: "on tick every 30 after 60",
  },
  countValue: {
    title: "The number",
    summary: "A plain whole number, 1 or more. It cannot be worked out as you go.",
    section: "cadence",
  },
  eventName: { title: "The event", summary: "One to three words naming what happened.", section: "events" },
  eventWord: { title: "One word of it", summary: "", section: "plumbing" },
  block: { title: "A block's contents", summary: "Instructions, one per line.", section: "plumbing" },
  statement: {
    title: "One instruction",
    summary: "Everything that can go on a line inside a block.",
    section: "statements",
  },
  setStmt: {
    title: "set",
    summary: "Changes a variable that already exists. `set name` changes your label.",
    section: "statements",
    example: "set target = event.bearing",
  },
  ifStmt: {
    title: "if",
    summary: "Runs the block only when the condition is true. `then` is optional decoration.",
    section: "statements",
    example: "if me.health < 30\n  drive back 60\nend",
  },
  elseIf: { title: "else if", summary: "", section: "plumbing" },
  loopStmt: {
    title: "loop",
    summary:
      "Repeats until something breaks out. It does not span ticks — a loop with no `break` costs your {robot} the rest of its thinking time.",
    section: "statements",
    example: "loop\n  break if me.gunHeat is 0\nend",
  },
  forStmt: {
    title: "for",
    summary: "Counts from one number up to another, inclusive.",
    section: "statements",
    example: "for i = 1 to 4\n  turret.sweep 90\nend",
  },
  repeatStmt: {
    title: "repeat",
    summary: "Runs the block a fixed number of times. `times` is optional decoration.",
    section: "statements",
    example: "repeat 3 times\n  fire 1\nend",
  },
  breakStmt: {
    title: "break",
    summary: "Leaves the loop. `break if` leaves it only when the condition holds.",
    section: "statements",
    example: "break if me.speed is 0",
  },
  continueStmt: {
    title: "continue",
    summary: "Skips the rest of this time round the loop and starts the next.",
    section: "statements",
  },
  waitStmt: {
    title: "wait",
    summary:
      "Stops here and carries on in the next tick. The only instruction that spans ticks, and the reason a block can be written as a sequence at all.",
    section: "statements",
    example: "wait 15 ticks",
  },
  doStmt: {
    title: "do",
    summary: "Runs a `can` block, optionally giving it values.",
    section: "statements",
    example: "do shove with 3",
  },
  action: {
    title: "An action",
    summary: "The instructions that reach the world rather than the script.",
    section: "actions",
  },
  driveStmt: {
    title: "drive",
    summary:
      "Sets how hard to push, from -100 to 100. `back` is the same as a negative amount. `stop` is `drive 0`.",
    section: "actions",
    example: "drive forward 80",
  },
  turnStmt: {
    title: "turn",
    summary:
      "`to` is a compass heading; `by` is a number of degrees from where you are now. Both are requests — how fast you actually turn depends on the chassis and the ground.",
    section: "actions",
    example: "turn to 90",
  },
  toOrBy: { title: "to or by", summary: "", section: "plumbing" },
  turretStmt: {
    title: "turret",
    summary: "Points the {turret}. `at` is optional decoration on `aim`.",
    section: "actions",
    example: "turret.aim at event.bearing",
  },
  turretMember: {
    title: "What a {turret} can do",
    summary:
      "`turn` moves it relative to the body, `aim` points it at a heading regardless of which way you are facing, `sweep` swings it by an amount.",
    section: "actions",
  },
  radarStmt: {
    title: "radar",
    summary: "Points the {radar}, or {ping}s with it.",
    section: "actions",
    example: "radar.sweep 45",
  },
  radarMember: {
    title: "What a {radar} can do",
    summary: "The same three as the {turret}, plus `ping`.",
    section: "actions",
  },
  fireStmt: {
    title: "fire",
    summary:
      "Power from 1 to 3, defaulting to 2. More power does more damage, travels slower and heats the gun for longer.",
    section: "actions",
    example: "fire 3",
  },
  pingStmt: {
    title: "ping",
    summary:
      "Sends a pulse and reports what it hits as `on ping`. Everyone else can hear that you did it.",
    section: "actions",
    example: "ping",
  },
  expr: { title: "A value", summary: "Anything that works out to a number.", section: "values" },
  orExpr: { title: "or", summary: "True when either side is.", section: "values" },
  andExpr: { title: "and", summary: "True when both sides are.", section: "values" },
  notExpr: { title: "not", summary: "Turns true into false and back.", section: "values" },
  compareExpr: {
    title: "Comparisons",
    summary: "`is` and `=` mean the same thing. `isnt` and `is not` are both the opposite.",
    section: "values",
    example: "me.fuel < 20",
  },
  compareOp: { title: "The comparison", summary: "", section: "plumbing" },
  addExpr: { title: "+ and -", summary: "Added left to right.", section: "values" },
  mulExpr: {
    title: "*, / and mod",
    summary: "Bound tighter than `+` and `-`. `mod` is the remainder after dividing.",
    section: "values",
  },
  unaryExpr: { title: "Negation", summary: "A minus sign in front of a value.", section: "values" },
  primary: {
    title: "The smallest values",
    summary: "Numbers, text, colours, true and false, brackets, and everything below.",
    section: "values",
  },
  propRef: {
    title: "me, arena and event",
    summary:
      "What your {robot} can sense. `me.` is always available, `arena.` is the match, and `event.` only exists inside a block that has an event and carries different fields depending on which.",
    section: "values",
    example: "me.heading",
  },
  propName: { title: "The part", summary: "", section: "plumbing" },
  callOrVar: {
    title: "Variables and functions",
    summary: "A name on its own is a variable. A name with brackets after it is a function.",
    section: "values",
    example: "distance(me.x, me.y, 0, 0)",
  },
};

// --- putting the two together ----------------------------------------------

export interface RuleDoc extends Annotation {
  name: string;
  syntax: Syntax;
}

/** Every rule the parser has, with its shape read and its meaning looked up. */
export function ruleDocs(): RuleDoc[] {
  // `serializeGrammar` rather than the live objects: the GAst classes carry
  // their kind in their constructor, and only the serialised form states it as
  // a `type` field that can be switched on.
  const rules = serializeGrammar(Object.values(parser.getGAstProductions())) as unknown as GastNode[];
  return rules.map((rule) => {
    const name = rule.name!;
    const annotation = ANNOTATIONS[name];
    if (!annotation) {
      throw new Error(`the grammar rule \`${name}\` has no entry in ANNOTATIONS`);
    }
    return {
      name,
      syntax: convert(rule.definition ?? []),
      ...annotation,
    };
  });
}

/** The rules of one section, in the order the grammar declares them. */
export function rulesIn(section: SectionName): RuleDoc[] {
  return ruleDocs().filter((r) => r.section === section);
}

/**
 * A rule's syntax as one line of text, in the player's own words.
 *
 * The themed spelling is applied to fixed words only. A placeholder is already
 * a description rather than a word, and a rule name is a link.
 */
export function syntaxLine(syntax: Syntax, theme: Theme): string {
  const go = (s: Syntax): string => {
    switch (s.kind) {
      case "word":
        return wordFor(s.text, theme);
      case "placeholder":
        return `<${s.text}>`;
      case "rule":
        return ANNOTATIONS[s.name]?.section === "plumbing" ? s.name : s.name;
      case "sequence":
        return s.of.map(go).join(" ");
      case "choice":
        return `( ${s.of.map(go).join(" | ")} )`;
      case "optional":
        return `[ ${go(s.of)} ]`;
      case "repeat": {
        const inner = s.separator ? `${go(s.of)} ${go(s.separator)} ...` : `${go(s.of)} ...`;
        return s.least === 0 ? `[ ${inner} ]` : `( ${inner} )`;
      }
    }
  };
  return go(syntax);
}
