/**
 * Where you are in the grammar, and what may come next.
 *
 * Given the words typed so far on a line, this walks the grammar and reports
 * three things: which parts of the rule have been matched, which parts could
 * come next, and whether the next thing is a value rather than a fixed word.
 *
 * It exists because two features want the same answer and used to work it out
 * separately. The completion popup had an eleven-case
 * `switch (words.join(" "))` transcribing the action grammar by hand, and the
 * editor had nothing at all — so the one moment a beginner most needs telling
 * what to type was the moment the screen said least. Both now ask here, which
 * means they cannot contradict each other, and neither can drift from the
 * parser: the shapes come from `reference.ts`, which reads them off the parser
 * itself.
 *
 * The walk is a simulation rather than a parse. Several branches of the grammar
 * can be alive at once — after `turn` you might be heading for `turn to`,
 * `turn by` or `turn chassis to` — so it carries a set of possible positions
 * and keeps whichever survive each word. That is also what makes the answer
 * useful: the surviving positions *are* the list of things you could type.
 */

import { ruleDocs, type RuleDoc, type Syntax } from "./reference.js";
import { RESERVED } from "./tokens.js";

export interface Path {
  /** The rule the cursor is inside, for the heading and the diagram. */
  rule: RuleDoc;
  /** Parts already matched, lit on the diagram. */
  done: ReadonlySet<Syntax>;
  /** Parts that could come next, glowing on the diagram. */
  next: ReadonlySet<Syntax>;
  /** The fixed words among `next`, in grammar order and without duplicates. */
  words: string[];
  /** True when a value goes here rather than any particular word. */
  wantsValue: boolean;
  /** True when the line is finished and pressing return is what comes next. */
  complete: boolean;
}

/**
 * Stands in for a value in the word stream, the same marker `complete.ts` uses.
 * A number, a piece of text or a colour all arrive as this.
 */
export const LITERAL = "\0";

// --- positions in the grammar ----------------------------------------------

/**
 * One thing still to be matched.
 *
 * Mostly a grammar node, but a repetition needs a second kind of frame for
 * "you have been round once, you may go round again" — which is not a node
 * anybody wrote and so is not one we can point at.
 */
type Frame =
  | { at: "node"; node: Syntax }
  | { at: "again"; node: Extract<Syntax, { kind: "repeat" }> };

interface State {
  /** What is left to match, outermost last. */
  frames: readonly Frame[];
  /** Terminals matched to get here. */
  done: readonly Syntax[];
}

/** A state sitting on a terminal, ready to accept or refuse the next word. */
interface AtTerminal {
  terminal: Extract<Syntax, { kind: "word" | "placeholder" }>;
  rest: readonly Frame[];
  done: readonly Syntax[];
}

const byName = (): Map<string, RuleDoc> => {
  const map = new Map<string, RuleDoc>();
  for (const doc of ruleDocs()) map.set(doc.name, doc);
  return map;
};

/**
 * Rules that are the expression ladder. Reaching one means "a value goes here";
 * unfolding it would produce a diagram nobody could read, and the popup answers
 * far better there anyway because it knows the script's own variables.
 */
const VALUE_RULES = new Set([
  "expr",
  "orExpr",
  "andExpr",
  "notExpr",
  "compareExpr",
  "addExpr",
  "mulExpr",
  "unaryExpr",
  "primary",
  "propRef",
  "callOrVar",
]);

/**
 * Push a state forward until every branch is sitting on a terminal.
 *
 * `seen` stops a rule being entered twice without anything being matched in
 * between, which is what the expression ladder would otherwise do for ever.
 */
function toTerminals(
  state: State,
  rules: Map<string, RuleDoc>,
  out: { terminals: AtTerminal[]; value: boolean; done: boolean },
  seen: ReadonlySet<string> = new Set(),
): void {
  const [head, ...rest] = state.frames;

  if (head === undefined) {
    // Nothing left to match: the rule is satisfied as it stands.
    out.done = true;
    return;
  }

  const go = (frames: Frame[], nowSeen: ReadonlySet<string> = seen) =>
    toTerminals({ frames, done: state.done }, rules, out, nowSeen);

  if (head.at === "again") {
    const repeat = head.node;
    // Round again, through the separator if there is one.
    const more: Frame[] = repeat.separator
      ? [{ at: "node", node: repeat.separator }, { at: "node", node: repeat.of }, head, ...rest]
      : [{ at: "node", node: repeat.of }, head, ...rest];
    go(more);
    go([...rest]);
    return;
  }

  const node = head.node;
  switch (node.kind) {
    case "word":
    case "placeholder":
      out.terminals.push({ terminal: node, rest, done: state.done });
      return;

    case "rule": {
      if (VALUE_RULES.has(node.name)) {
        out.value = true;
        return;
      }
      if (seen.has(node.name)) return;
      const doc = rules.get(node.name);
      if (!doc) return;
      go([{ at: "node", node: doc.syntax }, ...rest], new Set([...seen, node.name]));
      return;
    }

    case "sequence":
      go([...node.of.map((n): Frame => ({ at: "node", node: n })), ...rest]);
      return;

    case "choice":
      for (const alt of node.of) go([{ at: "node", node: alt }, ...rest]);
      return;

    case "optional":
      go([{ at: "node", node: node.of }, ...rest]);
      go([...rest]);
      return;

    case "repeat":
      if (node.least === 0) go([...rest]);
      go([{ at: "node", node: node.of }, { at: "again", node }, ...rest]);
      return;
  }
}

// --- values in the word stream ---------------------------------------------

const VALUE_WORDS = new Set([
  "me",
  "arena",
  "event",
  "true",
  "false",
  "none",
  "not",
  "and",
  "or",
  "mod",
  "is",
  "isnt",
]);

const VALUE_PUNCT = new Set([".", "(", ")", "+", "-", "*", "/", "<", ">", "<=", ">=", "<>", "!=", "==", "="]);

/**
 * Whether a word could be part of a value.
 *
 * A comma ends one — `do shove with 2, 3` is two values, not one — unless it is
 * inside brackets, where it separates a function's arguments instead.
 */
function isValueWord(word: string, depth: number): boolean {
  if (word === LITERAL) return true;
  if (word === ",") return depth > 0;
  if (VALUE_PUNCT.has(word)) return true;
  if (VALUE_WORDS.has(word)) return true;
  // Anything the language has not reserved is a name, and a name is a value.
  return !RESERVED.has(word);
}

// --- the walk ---------------------------------------------------------------

/**
 * Walk `words` through the grammar from `startRule`.
 *
 * Returns null when nothing matches, which is the honest answer for a line the
 * language cannot read — the guide shows nothing rather than guessing.
 */
export function pathFrom(startRule: string, words: readonly string[]): Path | null {
  const rules = byName();
  const rule = rules.get(startRule);
  if (!rule) return null;

  let states: State[] = [{ frames: [{ at: "node", node: rule.syntax }], done: [] }];
  const done = new Set<Syntax>();

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const reached: State[] = [];
    let sawValue = false;

    for (const state of states) {
      const out = { terminals: [] as AtTerminal[], value: false, done: false };
      toTerminals(state, rules, out);
      if (out.value) sawValue = true;

      for (const spot of out.terminals) {
        if (!accepts(spot.terminal, word)) continue;
        reached.push({ frames: spot.rest, done: [...spot.done, spot.terminal] });
      }
    }

    if (reached.length === 0) {
      // Nothing in the grammar wanted that word. If a value was expected, eat
      // the whole value and carry on from the other side of it.
      if (!sawValue) return null;
      const after = skipValue(words, i);
      if (after === i) return null;
      states = states.flatMap((state) => afterValue(state, rules));
      i = after - 1;
      continue;
    }

    states = reached;
  }

  // Where the surviving branches have got to.
  const next = new Set<Syntax>();
  const wordList: string[] = [];
  let wantsValue = false;
  let complete = false;

  for (const state of states) {
    for (const node of state.done) done.add(node);
    const out = { terminals: [] as AtTerminal[], value: false, done: false };
    toTerminals(state, rules, out);
    if (out.value) wantsValue = true;
    if (out.done) complete = true;
    for (const spot of out.terminals) {
      next.add(spot.terminal);
      if (spot.terminal.kind === "word" && !wordList.includes(spot.terminal.text)) {
        wordList.push(spot.terminal.text);
      }
    }
  }

  return { rule, done, next, words: wordList, wantsValue, complete };
}

/** Does this terminal accept that word? */
function accepts(
  terminal: Extract<Syntax, { kind: "word" | "placeholder" }>,
  word: string,
): boolean {
  if (terminal.kind === "word") return terminal.text === word;
  switch (terminal.text) {
    case "number":
    case "text":
    case "colour":
      return word === LITERAL;
    case "name":
      // A name is any word the language has not claimed for itself.
      return word !== LITERAL && !RESERVED.has(word);
    default:
      // A new line never appears part-way along a line.
      return false;
  }
}

/** How far a value runs from `i`. */
function skipValue(words: readonly string[], i: number): number {
  let depth = 0;
  let at = i;
  while (at < words.length && isValueWord(words[at]!, depth)) {
    if (words[at] === "(") depth++;
    if (words[at] === ")") depth--;
    at++;
  }
  return at;
}

/** Continue past a value rule, which the walk does not go inside. */
function afterValue(state: State, rules: Map<string, RuleDoc>): State[] {
  const out: State[] = [];
  const walk = (frames: readonly Frame[], seen: ReadonlySet<string>): void => {
    const [head, ...rest] = frames;
    if (head === undefined) return;
    if (head.at === "again") {
      out.push({ frames, done: state.done });
      return;
    }
    const node = head.node;
    switch (node.kind) {
      case "rule":
        if (VALUE_RULES.has(node.name)) {
          out.push({ frames: rest, done: state.done });
          return;
        }
        if (seen.has(node.name)) return;
        {
          const doc = rules.get(node.name);
          if (doc) walk([{ at: "node", node: doc.syntax }, ...rest], new Set([...seen, node.name]));
        }
        return;
      case "sequence":
        walk([...node.of.map((n): Frame => ({ at: "node", node: n })), ...rest], seen);
        return;
      case "choice":
        for (const alt of node.of) walk([{ at: "node", node: alt }, ...rest], seen);
        return;
      case "optional":
        walk([{ at: "node", node: node.of }, ...rest], seen);
        walk(rest, seen);
        return;
      case "repeat":
        if (node.least === 0) walk(rest, seen);
        walk([{ at: "node", node: node.of }, { at: "again", node }, ...rest], seen);
        return;
      default:
        return;
    }
  };
  walk(state.frames, new Set());
  return out;
}
