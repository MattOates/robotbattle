/**
 * What is under the cursor, according to the parser.
 *
 * A grammar keeps the shape of what it read. The hand-written parser threw that
 * away — it produced an AST with a line and column on each node and no way to
 * ask the reverse question, so anything wanting to know "what is at character
 * 412" had to re-scan the text and guess from the words around it, which is how
 * the editor ended up with its own idea of the language.
 *
 * The CST answers it directly. Every token is in it, at its real offset, inside
 * the stack of rules that accepted it — so `turret` in `turret.sweep 45` comes
 * back as a turret action rather than as a word that happens to be spelt
 * `turret`, and the same word in `me.turret` comes back as a property.
 */

import type { CstNode, IToken } from "chevrotain";
import { parser } from "./grammar.js";
import { toTokens, type RoboToken } from "./tokens.js";

export interface Located {
  /** The token under the offset, as the author spelt it. */
  word: string;
  /** Canonical spelling, with themed synonyms folded away. */
  canonical: string;
  /** Where it starts and ends, for highlighting it. */
  from: number;
  to: number;
  /**
   * The rules that were open, outermost first.
   *
   * The last entry is the most specific thing this token is part of, which is
   * what a reference lookup or a status line wants. The whole stack is kept
   * because the useful answer is sometimes one level up: the `end` of a handler
   * belongs to `handler`, not to any rule of its own.
   */
  rules: string[];
}

interface Children {
  [key: string]: (CstNode | IToken)[];
}

const isNode = (x: CstNode | IToken): x is CstNode => "children" in x;

/**
 * The token at an offset, and the rules around it.
 *
 * Returns null when the offset is not on a token — whitespace, a comment, past
 * the end — and when the script does not parse. A half-written script is the
 * normal state of an editor, so callers have to expect null rather than treat
 * it as an error.
 */
export function locate(source: string, offset: number): Located | null {
  const tokens = toTokens(source);
  parser.input = tokens;
  const cst = parser.program();
  if (parser.errors.length > 0) return null;

  const rules: string[] = [];
  const found = search(cst, offset, rules);
  if (!found) return null;

  return {
    word: (found as RoboToken).raw ?? found.image,
    canonical: found.image,
    from: found.startOffset,
    to: found.endOffset ?? found.startOffset,
    rules,
  };
}

/**
 * Depth-first, recording the rules entered on the way down.
 *
 * The stack is trimmed on the way back out of a branch that did not contain the
 * offset, so what survives is the path to the token and nothing else.
 */
function search(node: CstNode, offset: number, rules: string[]): IToken | null {
  rules.push(node.name);
  const children = node.children as Children;

  for (const key of Object.keys(children)) {
    for (const child of children[key]!) {
      if (isNode(child)) {
        const hit = search(child, offset, rules);
        if (hit) return hit;
        // Half-open, because `endOffset` here is one past the last character.
        // Treating it as inclusive made a click on `sweep` land on the `.` in
        // front of it.
      } else if (child.startOffset <= offset && offset < (child.endOffset ?? child.startOffset)) {
        return child;
      }
    }
  }

  rules.pop();
  return null;
}

/**
 * The offset of a line and column, counting from 1 as errors do.
 *
 * Editors speak in one and the parser speaks in the other, and the conversion
 * is nobody's idea of interesting.
 */
export function offsetOf(source: string, line: number, col: number): number {
  let at = 0;
  for (let n = 1; n < line; n++) {
    const next = source.indexOf("\n", at);
    if (next === -1) return source.length;
    at = next + 1;
  }
  return Math.min(at + col - 1, source.length);
}
