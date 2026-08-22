/**
 * The front door to the language: source in, `Program` out.
 *
 * The parsing itself lives in three files that each do one thing —
 * `tokens.ts` adapts the lexer's output to Chevrotain's shape, `grammar.ts`
 * states the grammar, `build-ast.ts` walks the result — with `diagnostics.ts`
 * holding what the parser says when something is wrong and `validate.ts` the
 * rules that are about a whole program rather than about one line.
 *
 * This file used to be nine hundred lines of hand-written recursive descent,
 * written that way "so that error messages can be genuinely helpful". They are,
 * and they still are: `tests/lang/errors.test.ts` holds all fifty-one of them
 * word for word, and the grammar had to reproduce every one before this swap
 * was allowed to happen. What the language gained by moving is that the grammar
 * is now readable as a grammar, and answerable as data — which is what the
 * completion popup, the highlighter and the reference page can be built from
 * instead of each keeping its own transcription of a language they cannot see.
 *
 * The name stays because fifteen files import `parse` from it, and because
 * "the parser" is still what this is.
 */

import type { Program } from "./ast.js";
import { parseWithChevrotain } from "./build-ast.js";

export { RESERVED } from "./tokens.js";

export function parse(source: string): Program {
  return parseWithChevrotain(source);
}
