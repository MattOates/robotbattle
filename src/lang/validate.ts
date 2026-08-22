/**
 * The rules that are about a whole program rather than about one line.
 *
 * You cannot tell that `on tick` appears twice by looking at either `on tick`,
 * and you cannot tell that a `break` has no loop around it by looking at the
 * `break`. The hand-written parser knew these things because it was walking the
 * source and could keep a set of seen events and a loop depth as it went; a
 * grammar cannot, and should not have to.
 *
 * So they happen here instead, once, over the finished tree — which is also
 * where they always belonged. The messages are unchanged, and
 * `tests/lang/errors.test.ts` holds them to that.
 *
 * One consequence of the move is worth naming: a program with both a syntax
 * error and one of these now reports the syntax error, because parsing has to
 * finish before this can run. The old parser would report whichever came first
 * in the file. Both are defensible and only one error is shown either way.
 */

import type { Param, Program, Stmt } from "./ast.js";
import { RoboScriptError } from "./errors.js";

export function validate(program: Program): Program {
  const events = new Set<string>();
  for (const handler of program.handlers) {
    if (events.has(handler.event)) {
      throw new RoboScriptError(
        `you already have an \`on ${handler.event}\` block`,
        handler.pos,
        "put all the instructions for one event in a single block",
      );
    }
    events.add(handler.event);
    checkLoops(handler.body, 0);
  }

  const names = new Set<string>();
  for (const routine of program.routines) {
    const lower = routine.name.toLowerCase();
    if (names.has(lower)) {
      throw new RoboScriptError(
        `you already have a \`can ${routine.name}\` block`,
        routine.pos,
        "two blocks with the same name would be impossible to tell apart in a `do`",
      );
    }
    names.add(lower);
    checkParams(routine.name, routine.params);
    checkLoops(routine.body, 0);
  }

  return program;
}

function checkParams(owner: string, params: readonly Param[]): void {
  const seen = new Set<string>();
  let optionalSoFar = false;
  for (const param of params) {
    const lower = param.name.toLowerCase();
    if (seen.has(lower)) {
      throw new RoboScriptError(
        `\`${owner}\` is already given something called \`${param.name}\``,
        param.pos,
        "each thing a block is given needs its own name",
      );
    }
    seen.add(lower);
    // Defaults have to come last, or leaving one out at a `do` would be
    // ambiguous: `do shove with 2` could mean either of two things.
    if (param.default === null && optionalSoFar) {
      throw new RoboScriptError(
        `\`${param.name}\` has to come before the ones with a starting value`,
        param.pos,
        "put the ones you always have to supply first, so leaving the rest out is never ambiguous",
      );
    }
    if (param.default !== null) optionalSoFar = true;
  }
}

function checkLoops(body: readonly Stmt[], depth: number): void {
  for (const stmt of body) {
    switch (stmt.type) {
      case "break":
      case "continue":
        if (depth === 0) {
          throw new RoboScriptError(
            `\`${stmt.type}\` only works inside a loop`,
            stmt.pos,
            "put it inside a `loop`, `for` or `repeat` block",
          );
        }
        break;
      case "loop":
      case "for":
      case "repeat":
        checkLoops(stmt.body, depth + 1);
        break;
      case "if":
        // An `if` is not a loop, so it neither creates nor hides one.
        checkLoops(stmt.then, depth);
        checkLoops(stmt.otherwise, depth);
        break;
    }
  }
}
