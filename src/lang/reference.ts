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
import { healthPropertyFor, wordFor, type Theme } from "./vocab.js";
import {
  BULLET,
  FUEL,
  MAX_FUEL,
  MAX_HEALTH,
  OPS_PER_TICK,
  RADAR,
  ROBOT_RADIUS,
  SENSE,
  TICK_RATE,
  TURRET,
} from "../sim/types.js";
import { DEFAULT_FIRE_POWER } from "./compiler.js";
import { ARENA_SIZE } from "../net/matchsetup.js";

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
  /**
   * A short name for the rule where another rule refers to it.
   *
   * The grammar's own names are identifiers — `topLevel`, `nameDecl`,
   * `callOrVar` — and a diagram is read by somebody who has never seen this
   * codebase. They get `declaration`, `name`, `variable` instead. Titles are
   * too long to sit in a box on a track.
   */
  label: string;
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
      "A script is a list of blocks. Nothing happens out at the top level: you say what your {robot} is called and what it is built from, and everything else goes inside a block that waits for something to happen.",
  },
  {
    name: "events",
    title: "Events",
    blurb:
      "An `on` block runs when its event happens, and only then. Your {robot} does not work through the script from top to bottom. It waits, and things that happen wake up the blocks that match them. `on tick` is the closest thing to doing something all the time: it runs once every tick, then stops until the next one.",
  },
  {
    name: "cadence",
    title: "How often a block runs",
    blurb:
      "Sometimes you want a block to run now and again rather than every single time. `every`, `after`, `before` and `at` count how many times the event has happened, and let the block run only on the times you pick.",
  },
  {
    name: "statements",
    title: "Instructions",
    blurb: "What goes inside a block, one instruction to a line.",
  },
  {
    name: "actions",
    title: "Things your {robot} can do",
    blurb:
      "Actions are the instructions that change something in the arena. Most of them cost time or {fuel}. If a block asks for two different things in the same tick, the last one is the one that happens.",
  },
  {
    name: "values",
    title: "Values",
    blurb:
      "Anywhere a number goes, you can put one of these: a plain number, a variable, something your {robot} can sense about itself or the arena, or a sum made out of them.",
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
    label: "script",
    title: "A whole script",
    summary: "Blank lines do not matter. Everything else is either a setting or a block.",
    section: "program",
  },
  topLevel: {
    label: "declaration",
    title: "What goes at the outermost level",
    summary: "Only these six things can go out here, and none of them are instructions. An instruction on its own out here has nothing to run it.",
    section: "program",
  },
  nameDecl: {
    label: "name",
    title: "name",
    summary: "The label shown under your {robot}. You can change it during a match with `set name`.",
    section: "program",
    example: 'name "Sparky"',
  },
  chassisDecl: {
    label: "chassis",
    title: "chassis",
    summary: "There are two to pick from. The first can spin on the spot and set off in any direction, but it is slower. The second is much faster in a straight line, but it steers like a car and cannot turn at all unless it is already moving.",
    section: "program",
    example: "chassis skid",
  },
  colorDecl: {
    label: "colour",
    title: "color",
    summary: "The colour of your {robot}. Six letters and numbers after the `#`, or three as a shortcut. You can spell it `colour` if you prefer.",
    section: "program",
    example: "color #ff8800",
  },
  varDecl: {
    label: "var",
    title: "var",
    summary: "Makes a variable, which is somewhere to remember a number. Out at the top level it lasts the whole match. Inside a block it is forgotten as soon as the block finishes.",
    section: "program",
    example: "var target = 0",
  },
  handler: {
    label: "on block",
    title: "on",
    summary: "Runs the instructions inside it whenever that event happens.",
    section: "events",
    example: "on sense robot\n  fire 2\nend",
  },
  routine: {
    label: "can block",
    title: "can",
    summary: "Gives a set of instructions a name, so you can `do` them from anywhere. Add `given` and the block can read `event.` as well.",
    section: "program",
    example: "can shove with power = 2\n  fire power\nend",
  },
  params: {
    label: "given names",
    title: "What a block is given",
    summary: "The names your block wants to be given, separated by commas. Any with a starting value have to come last.",
    section: "program",
  },
  param: { label: "given name",
    title: "One of them", summary: "A name, and what to use when nobody gives it one.", section: "plumbing" },
  countClauses: {
    label: "how often",
    title: "every, after, before, at",
    summary: "Counts how many times the event has happened and decides whether to run this time. You can use more than one together. `at` picks one exact time, so it goes on its own.",
    section: "cadence",
    example: "on tick every 30 after 60",
  },
  countValue: {
    label: "count",
    title: "The number",
    summary: "A whole number, 1 or more. You have to write it in \u2014 it cannot be worked out while the match is running.",
    section: "cadence",
  },
  eventName: { label: "event",
    title: "The event", summary: "Which event the block is for.", section: "events" },
  eventWord: { label: "event word",
    title: "One word of it", summary: "", section: "plumbing" },
  block: { label: "instructions",
    title: "A block's contents", summary: "The instructions inside a block, one to a line.", section: "plumbing" },
  statement: {
    label: "instruction",
    title: "One instruction",
    summary: "Everything you can put on a line inside a block.",
    section: "statements",
  },
  setStmt: {
    label: "set",
    title: "set",
    summary: "Changes a variable you already made. `set name` changes your label.",
    section: "statements",
    example: "set target = event.bearing",
  },
  ifStmt: {
    label: "if",
    title: "if",
    summary: "Runs the instructions only if the test is true. You can write `then` if it reads better.",
    section: "statements",
    example: "if me.health < 30\n  drive back 60\nend",
  },
  elseIf: { label: "else if",
    title: "else if", summary: "", section: "plumbing" },
  loopStmt: {
    label: "loop",
    title: "loop",
    summary: "Goes round and round until something breaks out of it. It all happens inside one tick, so a loop with no `break` uses up your thinking time.",
    section: "statements",
    example: "loop\n  break if me.gunHeat is 0\nend",
  },
  forStmt: {
    label: "for",
    title: "for",
    summary: "Counts from one number up to another, including both ends.",
    section: "statements",
    example: "for i = 1 to 4\n  turret.sweep 90\nend",
  },
  repeatStmt: {
    label: "repeat",
    title: "repeat",
    summary: "Does the same thing a set number of times. You can write `times` if it reads better.",
    section: "statements",
    example: "repeat 3 times\n  fire 1\nend",
  },
  breakStmt: {
    label: "break",
    title: "break",
    summary: "Leaves the loop. `break if` only leaves when the test is true.",
    section: "statements",
    example: "break if me.speed is 0",
  },
  continueStmt: {
    label: "continue",
    title: "continue",
    summary: "Skips the rest of this time round the loop and starts the next one.",
    section: "statements",
  },
  waitStmt: {
    label: "wait",
    title: "wait",
    summary: "Stops here and carries on in a later tick. It is the only instruction that waits.",
    section: "statements",
    example: "wait 15 ticks",
  },
  doStmt: {
    label: "do",
    title: "do",
    summary: "Runs a `can` block, giving it any values it asks for.",
    section: "statements",
    example: "do shove with 3",
  },
  action: {
    label: "action",
    title: "An action",
    summary: "The instructions that make your {robot} actually do something.",
    section: "actions",
  },
  driveStmt: {
    label: "drive",
    title: "drive",
    summary: "How hard to push, from -100 to 100. `back` is the same as a minus number, and `stop` is the same as 0.",
    section: "actions",
    example: "drive forward 80",
  },
  turnStmt: {
    label: "turn",
    title: "turn",
    summary: "`to` turns to a compass direction. `by` turns that many degrees from wherever you are now. Turning takes time, and rough ground slows it down.",
    section: "actions",
    example: "turn to 90",
  },
  toOrBy: { label: "to or by",
    title: "to or by", summary: "", section: "plumbing" },
  turretStmt: {
    label: "turret",
    title: "turret",
    summary: "Points the {turret}. You can write `at` after `aim` if it reads better.",
    section: "actions",
    example: "turret.aim at event.bearing",
  },
  turretMember: {
    label: "turret action",
    title: "What a {turret} can do",
    summary: "`turn` moves it round from where your body is pointing. `aim` points it at a compass direction whichever way you are facing. `sweep` swings it by an amount.",
    section: "actions",
  },
  radarStmt: {
    label: "radar",
    title: "radar",
    summary: "Points the {radar}, or sends a {ping} with it.",
    section: "actions",
    example: "radar.sweep 45",
  },
  radarMember: {
    label: "radar action",
    title: "What a {radar} can do",
    summary: "The same three as the {turret}, and `ping` as well.",
    section: "actions",
  },
  fireStmt: {
    label: "fire",
    title: "fire",
    summary: "Fires a shot. The power is 1, 2 or 3, and it is 2 if you do not say.",
    section: "actions",
    example: "fire 3",
  },
  pingStmt: {
    label: "ping",
    title: "ping",
    summary: "Sends out a pulse. Whatever it finds comes back to you as `on ping`. Everyone else can hear it too.",
    section: "actions",
    example: "ping",
  },
  expr: { label: "value",
    title: "A value", summary: "Anything that works out to a number.", section: "values" },
  orExpr: { label: "or",
    title: "or", summary: "True if either side is true.", section: "values" },
  andExpr: { label: "and",
    title: "and", summary: "True only if both sides are true.", section: "values" },
  notExpr: { label: "not",
    title: "not", summary: "Swaps true for false, and false for true.", section: "values" },
  compareExpr: {
    label: "comparison",
    title: "Comparisons",
    summary: "`is` and `=` mean the same thing. So do `isnt` and `is not`.",
    section: "values",
    example: "me.fuel < 20",
  },
  compareOp: { label: "compare with",
    title: "The comparison", summary: "", section: "plumbing" },
  addExpr: { label: "sum",
    title: "+ and -", summary: "Worked out from left to right.", section: "values" },
  mulExpr: {
    label: "product",
    title: "*, / and mod",
    summary: "These happen before `+` and `-`. `mod` is the remainder left over after dividing.",
    section: "values",
  },
  unaryExpr: { label: "negation",
    title: "Negation", summary: "A minus sign in front of a value.", section: "values" },
  primary: {
    label: "simple value",
    title: "The smallest values",
    summary: "Numbers, words in quotes, colours, `true` and `false`, brackets, and everything below.",
    section: "values",
  },
  propRef: {
    label: "sensed value",
    title: "me, arena and event",
    summary: "What your {robot} can tell about itself and about the match. `me.` always works. `arena.` is about the match. `event.` only works inside a block that has an event, and carries different things depending on which event it is.",
    section: "values",
    example: "me.heading",
  },
  propName: { label: "part",
    title: "The part", summary: "", section: "plumbing" },
  callOrVar: {
    label: "variable or call",
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

/**
 * Worked out once. The grammar is fixed at startup — `performSelfAnalysis` has
 * already run by the time anything can ask — so rebuilding this per render only
 * re-serialised the same grammar and handed back objects that looked new to
 * every `useMemo` downstream, rebuilding every diagram on the page.
 */
let cached: RuleDoc[] | null = null;

/** Every rule the parser has, with its shape read and its meaning looked up. */
export function ruleDocs(): RuleDoc[] {
  return (cached ??= readRules());
}

function readRules(): RuleDoc[] {
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

/** Which rule, if any, a name belongs to. */
export function ruleDoc(name: string): RuleDoc | undefined {
  return ruleDocs().find((r) => r.name === name);
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
/** A rule's short name, for showing inside another rule. */
export function labelOf(name: string): string {
  return ANNOTATIONS[name]?.label ?? name;
}

export function syntaxLine(syntax: Syntax, theme: Theme): string {
  const go = (s: Syntax): string => {
    switch (s.kind) {
      case "word":
        return wordFor(s.text, theme);
      case "placeholder":
        return `<${s.text}>`;
      case "rule":
        return labelOf(s.name);
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


// --- the world, as against the language -------------------------------------

export interface Fact {
  label: string;
  value: string;
  /** One sentence on why it matters, or what it costs. */
  note: string;
}

export interface FactGroup {
  title: string;
  blurb: string;
  facts: Fact[];
}

/**
 * How the world behaves, read out of the simulation's own constants.
 *
 * Not written down, for the same reason the syntax is not written down: a
 * number typed here would be true until somebody tuned the balance, and then it
 * would be a lie nobody noticed. `TICK_RATE` moving retunes every sentence
 * below it.
 *
 * These are the questions a page about syntax cannot answer — how long a tick
 * is, how far you can see, how much a shot hurts. Without them a player knows
 * every instruction and still has to discover the numbers by dying.
 */
const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

export function simulationFacts(theme: Theme): FactGroup[] {
  const w = (canonical: string) => wordFor(canonical, theme);
  return [
    {
      title: "Time",
      blurb:
        "Everything in the arena happens on a tick. Each tick, your blocks run in the order the events arrived, and whatever they decide takes effect once they have all finished.",
      facts: [
        {
          label: "Ticks per second",
          value: String(TICK_RATE),
          note: `So \`wait ${TICK_RATE / 2} ticks\` waits half a second.`,
        },
        {
          label: "Thinking time",
          value: `${OPS_PER_TICK} steps a tick`,
          note: "Thinking is free, and everybody gets the same amount. It is not unlimited though: a loop that never finishes uses up the whole tick, and your {robot} gets nothing else done before the next one.",
        },
      ],
    },
    {
      title: "The arena",
      blurb: "Every match uses the same arena. The walls hurt if you drive into them.",
      facts: [
        {
          label: "Size",
          value: `${ARENA_SIZE.width} × ${ARENA_SIZE.height}`,
          note: "`arena.width` and `arena.height` tell you, so you never have to type the numbers into your script.",
        },
        {
          label: `Your ${w("chassis")}`,
          value: `${ROBOT_RADIUS * 2} across`,
          note: "Both chassis are exactly the same size, so neither one is harder to hit.",
        },
        {
          label: `Starting ${w("health")}`,
          value: String(MAX_HEALTH),
          note: `\`me.${healthPropertyFor(theme)}\` counts down from here.`,
        },
      ],
    },
    {
      title: "Seeing",
      blurb: `You have two ways of finding other {robots}, and they are good at different things. The cone is always watching. The ${w("radar")} only looks where you point it.`,
      facts: [
        {
          label: "Sense cone",
          value: `${SENSE.halfAngle * 2}° wide, ${SENSE.range} far`,
          note: "It works by itself and costs nothing. When something comes into it, your `on sense` block runs.",
        },
        {
          label: `${w("radar")} beam`,
          value: `${RADAR.halfAngle * 2}° wide, ${RADAR.range} far`,
          note: `Three times as far as the cone and a fifth as wide, so it finds things much further away, but only exactly where you aim it.`,
        },
        {
          label: `${w("ping")} cooldown`,
          value: `${RADAR.cooldown} ticks`,
          note: "`me.pingHeat` counts down to 0, and you can go again when it gets there. Everyone else can hear you do it.",
        },
        {
          label: `${w("radar")} slew`,
          value: `${RADAR.slewRate}°/s`,
          note: "It takes time to swing round, so point it before you need it.",
        },
      ],
    },
    {
      title: "Shooting",
      blurb: "A stronger shot hurts more, but it travels more slowly and the gun takes longer to cool down afterwards.",
      facts: [
        {
          label: "Power",
          value: `${TURRET.minPower} to ${TURRET.maxPower}`,
          note: `A bare \`${w("fire")}\` on its own means ${DEFAULT_FIRE_POWER}.`,
        },
        {
          label: "Damage",
          value: `${BULLET.damagePerPower} per power`,
          note: `A full power shot takes ${BULLET.damagePerPower * TURRET.maxPower} off ${MAX_HEALTH}.`,
        },
        {
          label: "Speed",
          value: `${BULLET.baseSpeed} less ${BULLET.speedPerPower} per power`,
          note: "Stronger shots are slower, which makes them easier to drive out of the way of.",
        },
        {
          label: `${w("turret")} slew`,
          value: `${TURRET.slewRate}°/s`,
          note: "When you fire, the shot waits until the gun has turned to where you aimed it. `me.aiming` is 1 for as long as it is waiting.",
        },
      ],
    },
    {
      // Capitalised here because the word comes from the vocabulary, where it
      // is a word in a sentence rather than a heading.
      title: capitalise(w("fuel")),
      blurb: `Moving, turning, ${w("fire")} and ${w("ping")} all use ${w("fuel")}. Thinking and watching are free.`,
      facts: [
        {
          label: "Tank",
          value: String(MAX_FUEL),
          note: `\`me.${w("fuel")}\` tells you how much is left. Driving over ${w("fuel")} refills it.`,
        },
        {
          label: "At empty",
          value: `${Math.round(FUEL.floorFactor * 100)}% of normal`,
          note: "Running out will not finish you off. You just get very slow until you find some more.",
        },
      ],
    },
  ];
}
