/**
 * What the parser says when something is wrong.
 *
 * A table, keyed by the rule that failed, read by Chevrotain's own
 * `IParserErrorMessageProvider`. Two things follow from it being a table rather
 * than a `throw` buried in a branch: the reference page can print the language's
 * error vocabulary, and `tests/lang/errors.test.ts` can hold every string in it
 * to the letter.
 *
 * That test is the reason this file reads oddly precisely. The messages are not
 * new — they are the ones the hand-written parser has always given, copied
 * across unchanged, down to the backticks. `parser.ts` earned them by being
 * hand-written; the point of this table is to keep them while the grammar stops
 * being hand-written.
 */

import type { IParserErrorMessageProvider, IRecognitionException, IToken } from "chevrotain";

export interface Diagnostic {
  message: string;
  hint?: string;
}

/**
 * `{word}` is filled from the token the parser stopped at — and from its `raw`
 * spelling, so somebody who typed `stinger` is told about `stinger`.
 */
export interface RuleDiagnostics {
  /** A required token was missing. */
  mismatch?: Diagnostic;
  /** The rule started, and none of its alternatives matched. */
  notViable?: Diagnostic;
}

export const DIAGNOSTICS: Readonly<Record<string, RuleDiagnostics>> = {
  turnStmt: {
    mismatch: {
      message: "`turn` needs `to` (an exact heading) or `by` (an amount)",
      hint: "try `turn body to 90` or `turn body by 45`",
    },
  },
  toOrBy: {
    notViable: {
      message: "`turn` needs `to` (an exact heading) or `by` (an amount)",
      hint: "try `turn body to 90` or `turn body by 45`",
    },
  },
  turretStmt: {
    mismatch: {
      message: "`turret` needs a `.` and then what to do with it",
      hint: "try `turret.aim at 0`, `turret.turn to 90` or `turret.sweep 45`",
    },
  },
  turretMember: {
    notViable: {
      message: "I don't know how to `{word}` a turret",
      hint: "the turret can `turn`, `aim` or `sweep`",
    },
  },
  radarStmt: {
    mismatch: {
      message: "`radar` needs a `.` and then what to do with it",
      hint: "try `radar.aim at 0`, `radar.turn to 90` or `radar.sweep 45`",
    },
  },
  radarMember: {
    notViable: {
      message: "I don't know how to `{word}` a radar",
      hint: "the radar can `turn`, `aim`, `sweep` or `ping`",
    },
  },
  forStmt: {
    mismatch: {
      message: "a `for` needs a starting number",
      hint: "try `for i = 1 to 10`",
    },
  },
  nameDecl: {
    mismatch: {
      message: "a robot's name has to be text in quotes",
      hint: 'try `name "Sparky"`',
    },
  },
  chassisDecl: {
    notViable: {
      message: "`{word}` isn't a body I know about",
      hint: "pick `tank` or `car` (or `ciliate` / `flagellate` if you're playing biology)",
    },
  },
  colorDecl: {
    mismatch: {
      message: "a colour has to look like #ff8800",
      hint: "the six characters after # are how much red, green and blue to mix",
    },
  },
  action: {
    notViable: {
      message: "I don't know how to `{word}`",
      hint: "instructions start with words like `drive`, `turn`, `fire`, `set`, `if` or `wait`",
    },
  },
  statement: {
    notViable: {
      message: "I don't know how to `{word}`",
      hint: "instructions start with words like `drive`, `turn`, `fire`, `set`, `if` or `wait`",
    },
  },
  topLevel: {
    notViable: {
      message: "I don't know what `{word}` means out here",
      hint: "outside a block you can set `name`, `chassis`, `color`, declare a `var`, start an `on ...` block, or teach yourself something new with `can ...`",
    },
  },
};

/** The word the author typed, preferred over the canonical one. */
function wordOf(actual: IToken | IToken[] | undefined): string {
  const token = Array.isArray(actual) ? actual[0] : actual;
  return (token as { raw?: string } | undefined)?.raw ?? token?.image ?? "";
}

function render(d: Diagnostic, actual: IToken | IToken[] | undefined): string {
  return d.message.replace("{word}", wordOf(actual));
}

/**
 * Chevrotain asks us to describe each failure; we answer from the table.
 *
 * Where there is no entry the wording is deliberately plain rather than
 * technical — a child reading "MismatchedTokenException" has learnt nothing.
 */
export const errorMessageProvider: IParserErrorMessageProvider = {
  buildMismatchTokenMessage(options) {
    const d = DIAGNOSTICS[options.ruleName]?.mismatch;
    if (d) return render(d, options.actual);
    return `I expected something else here, not \`${wordOf(options.actual)}\``;
  },

  buildNoViableAltMessage(options) {
    const d = DIAGNOSTICS[options.ruleName]?.notViable;
    if (d) return render(d, options.actual);
    return `I don't know what \`${wordOf(options.actual)}\` means here`;
  },

  buildEarlyExitMessage(options) {
    return `I expected more after \`${wordOf(options.previous)}\``;
  },

  buildNotAllInputParsedMessage(options) {
    return `I found \`${wordOf(options.firstRedundant)}\` after that instruction, and I don't know what it means`;
  },
};

/**
 * The hint for a failure, found through Chevrotain rather than around it.
 *
 * The exception carries the stack of rules it was inside, so the innermost one
 * with something to say wins. An earlier draft had the message provider stash
 * the hint in a module-level variable for the caller to collect, which worked
 * and would have stopped working the moment two parses overlapped.
 */
export function hintFor(error: IRecognitionException): string | undefined {
  const stack = error.context?.ruleStack ?? [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = DIAGNOSTICS[stack[i]!];
    const hint = entry?.mismatch?.hint ?? entry?.notViable?.hint;
    if (hint) return hint;
  }
  return undefined;
}
