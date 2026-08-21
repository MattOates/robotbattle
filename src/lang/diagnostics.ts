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
import type { SourcePos } from "./errors.js";
import { ColorLit, Ident, Newline, NumLit, StrLit, type RoboToken } from "./tokens.js";

export interface Diagnostic {
  message: string;
  hint?: string;
  /**
   * Where to point, when that is not where the parser stopped.
   *
   * "The `on tick` block never finishes" is noticed at the end of the script
   * and is about line one, and an error that highlights the wrong line is worse
   * than one that highlights none.
   */
  pos?: SourcePos | undefined;
}

/**
 * What the parser could see when it gave up.
 *
 * `word` is what it stopped at and `previous` is the token before, both in the
 * spelling the author used rather than the canonical one — so somebody who
 * typed `stinger` is told about `stinger`, and `var x` can be quoted back as
 * `var x` rather than as the `=` that was missing.
 */
export interface Failure {
  /** What the parser stopped at, as the author spelt it. */
  word: string;
  /** The same, but "the end of the line" / "the end of the script". */
  described: string;
  /** The token before it, as the author spelt it. */
  previous: string;
  /** True when the parser stopped at a word the language reserves. */
  reserved: boolean;
  /**
   * The whole line of tokens, and where in it the parser stopped.
   *
   * A few messages cannot be written from the failure alone: "the `on tick`
   * block never finishes" names a block that opened many lines earlier, and
   * "`min(` never closes" names a function that was consumed before its
   * arguments. Those look backwards from here.
   */
  tokens: readonly RoboToken[];
  index: number;
}

/** Either a fixed diagnostic or one that needs to look at what was found. */
export type Rendered = Diagnostic | ((f: Failure) => Diagnostic);

/**
 * `{word}` and `{previous}` in a message are filled from the `Failure`.
 */
export interface RuleDiagnostics {
  /** A required token was missing, whichever one it was. */
  mismatch?: Rendered;
  /**
   * A required token was missing, keyed by the token that was expected.
   *
   * A rule can fail in more than one place and mean quite different things:
   * `for` without a starting number and `for i = 1 5` are both `forStmt`, and
   * telling a child the same thing about each would waste the one sentence
   * they get.
   */
  expecting?: Record<string, Rendered>;
  /** The rule started, and none of its alternatives matched. */
  notViable?: Rendered;
  /** A repetition needed at least one more of something. */
  earlyExit?: Rendered;
}

/**
 * What a block wanting its `end` really means.
 *
 * Only at the end of the script is it genuinely a missing `end`. Anywhere else
 * the parser is sitting on a line it could not read as an instruction, and
 * saying "this block never finishes" would send a child looking for the wrong
 * mistake several lines away from the one they made.
 */
const UNFINISHED: Rendered = (f) => {
  if (f.described === "the end of the script") {
    const opener = openedBlock(f);
    return {
      message: `${opener.phrase} never finishes`,
      hint: "every block needs a matching `end` on its own line",
      pos: opener.token
        ? { line: opener.token.startLine ?? 0, col: opener.token.startColumn ?? 0 }
        : undefined,
    };
  }
  if (f.word === "can") {
    return {
      message: "`can` blocks go outside everything else",
      hint: "move it out to the left margin, then use `do` in here to run it",
    };
  }
  return {
    message: "I don't know how to `{word}`",
    hint: "instructions start with words like `drive`, `turn`, `fire`, `set`, `if` or `wait`",
  };
};

/** Shared wording for something that cannot be a variable name. */
const NOT_A_NAME: Rendered = (f) =>
  f.reserved
    ? {
        message: "`{word}` is a word RoboScript already uses, so it can't be a variable name",
        hint: "try something like `my_{word}`",
      }
    : {
        message: `\`${f.described}\` can't be used as a name`,
        hint: "names start with a letter, like `target` or `spin_speed`",
      };

/**
 * The block still open at the point of failure, quoted the way it was written.
 *
 * Walks backwards keeping a depth count, so a `loop` nested inside `on tick`
 * names the `loop` and the handler names the handler.
 */
function openedBlock(f: Failure): { phrase: string; token?: RoboToken | undefined } {
  const OPENERS = new Set(["on", "can", "loop", "for", "repeat", "if"]);
  let depth = 0;
  for (let i = f.index - 1; i >= 0; i--) {
    const word = f.tokens[i]!.image;
    if (word === "end") depth++;
    else if (OPENERS.has(word)) {
      if (depth > 0) {
        depth--;
        continue;
      }
      // Everything up to the end of that line is the phrase to quote back.
      const words: string[] = [];
      for (let j = i; j < f.tokens.length && f.tokens[j]!.tokenType !== Newline; j++) {
        words.push(f.tokens[j]!.raw);
      }
      return { phrase: `the \`${words.join(" ")}\` block`, token: f.tokens[i] };
    }
  }
  return { phrase: "the block" };
}

/** The name in front of the `(` that never closed. */
function openedCall(f: Failure): string {
  let depth = 0;
  for (let i = f.index - 1; i >= 0; i--) {
    const word = f.tokens[i]!.image;
    if (word === ")") depth++;
    else if (word === "(") {
      if (depth > 0) {
        depth--;
        continue;
      }
      return f.tokens[i - 1]?.raw ?? "";
    }
  }
  return "";
}

export const DIAGNOSTICS: Readonly<Record<string, RuleDiagnostics>> = {
  /**
   * The block that opened, found by looking back for the `on` or `can` that
   * has not been closed. The old parser knew this because it carried the
   * phrase down with it; here it is read back off the tokens.
   */
  handler: { expecting: { End: UNFINISHED } },
  routine: { expecting: { End: UNFINISHED } },
  loopStmt: { expecting: { End: UNFINISHED } },
  forStmt: {
    expecting: {
      End: UNFINISHED,
      To: {
        message: "I expected `to` here, but found `{word}`",
        hint: "try `for i = 1 to 10`",
      },
    },
    mismatch: {
      message: "a `for` needs a starting number",
      hint: "try `for i = 1 to 10`",
    },
  },
  repeatStmt: { expecting: { End: UNFINISHED } },
  varDecl: {
    expecting: {
      Eq: {
        message: "`var {previous}` needs a starting value",
        hint: "try `var {previous} = 0`",
      },
      Ident: NOT_A_NAME,
    },
  },
  param: { expecting: { Ident: NOT_A_NAME } },
  setStmt: {
    expecting: {
      Eq: {
        message: "`set {previous}` needs an `=` and a value",
        hint: "try `set {previous} = 0`",
      },
    },
  },
  primary: {
    expecting: {
      RParen: {
        message: "this bracket never closes",
        hint: "every `(` needs a matching `)`",
      },
    },
  },
  /**
   * The outermost rung of the expression ladder is where a value that is not
   * there at all reports from — every rung below it is still waiting to be
   * entered, so this is the only one that has seen enough to speak.
   */
  notExpr: {
    notViable: (f) =>
      f.reserved
        ? { message: "I didn't expect `{word}` in the middle of a value" }
        : {
            message: `I expected a value here, but found \`${f.described}\``,
            hint: "values are numbers, text in quotes, variables, or things like `me.heading`",
          },
  },
  propRef: {
    expecting: {
      Dot: (f) => ({
        message: "`{previous}` on its own isn't a value",
        hint: `try \`${f.previous}.${
          f.previous === "event" ? "bearing" : f.previous === "arena" ? "width" : "heading"
        }\``,
      }),
    },
  },
  propName: {
    // The object is two tokens back: it, then the `.`, then nothing.
    notViable: (f) => ({
      message: `\`${f.tokens[f.index - 2]?.raw ?? ""}.\` needs the name of something to look at`,
    }),
  },
  block: {
    earlyExit: {
      message: "I found `{word}` after that instruction, and I don't know what it means",
      hint: "each instruction goes on its own line",
    },
  },
  callOrVar: {
    expecting: {
      RParen: (f) => ({
        message: `\`${openedCall(f)}(\` never closes`,
        hint: "every `(` needs a matching `)`",
      }),
    },
  },
  turnStmt: {
    mismatch: {
      message: "`turn` needs `to` (an exact heading) or `by` (an amount)",
      hint: "try `turn body to 90` or `turn body by 45`",
    },
  },
  toOrBy: {
    // `turn`, `radar.turn` and `turret.turn` share this rule, and the part
    // being turned is two tokens back when there is a `.` in front of it.
    notViable: (f) => {
      const owner = f.tokens[f.index - 2]?.image === "." ? f.tokens[f.index - 3]?.image : undefined;
      if (owner === "radar" || owner === "turret") {
        return {
          message: `\`${owner}.turn\` needs \`to\` or \`by\``,
          hint: `try \`${owner}.turn to 90\` or \`${owner}.turn by 10\``,
        };
      }
      return {
        message: "`turn` needs `to` (an exact heading) or `by` (an amount)",
        hint: "try `turn body to 90` or `turn body by 45`",
      };
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
  // A statement that will not start is usually an instruction nobody knows,
  // but at the end of the script it is a block that never closed.
  statement: { notViable: UNFINISHED },
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

/**
 * `describe()` from the parser this replaced: end of line, end of script.
 *
 * The end of the script is recognised by token type rather than by position,
 * because Chevrotain pads the input array it is given with EOF tokens in place
 * — so "is it in the array we lexed" stopped being the same question.
 */
function describe(token: IToken | undefined): string {
  if (token === undefined || token.tokenType.name === "EOF") return "the end of the script";
  if (token.tokenType === Newline) return "the end of the line";
  return wordOf(token);
}

function failure(
  actual: IToken | IToken[] | undefined,
  previous: IToken | undefined,
  tokens: readonly RoboToken[],
): Failure {
  const token = Array.isArray(actual) ? actual[0] : actual;
  const index = token ? tokens.indexOf(token as RoboToken) : -1;
  return {
    word: wordOf(actual),
    described: describe(token),
    previous: wordOf(previous),
    tokens,
    index: index === -1 ? tokens.length : index,
    // Every reserved word has its own token type; anything else lexes as a
    // name. That is the same question `RESERVED` used to be asked.
    reserved: token !== undefined && token.tokenType !== Ident && token.tokenType !== NumLit
      && token.tokenType !== StrLit && token.tokenType !== ColorLit && token.tokenType !== Newline
      && !OPERATOR_LIKE.test(token.image),
  };
}

const OPERATOR_LIKE = /^[^a-z]/i;

function resolve(d: Rendered, f: Failure): Diagnostic {
  return typeof d === "function" ? d(f) : d;
}

function render(d: Rendered, f: Failure): string {
  const resolved = resolve(d, f);
  const message = resolved.message.replace("{word}", f.word).replace("{previous}", f.previous);
  return remember(message, resolved, f);
}

/**
 * Chevrotain asks us to describe each failure; we answer from the table.
 *
 * Where there is no entry the wording is deliberately plain rather than
 * technical — a child reading "MismatchedTokenException" has learnt nothing.
 */
export function messagesFor(tokens: readonly RoboToken[]): IParserErrorMessageProvider {
  return {
  buildMismatchTokenMessage(options) {
    const f = failure(options.actual, options.previous, tokens);
    const entry = DIAGNOSTICS[options.ruleName];
    const d = entry?.expecting?.[options.expected.name] ?? entry?.mismatch;
    if (d) return render(d, f);
    return `I expected something else here, not \`${f.word}\``;
  },

  buildNoViableAltMessage(options) {
    const f = failure(options.actual, options.previous, tokens);
    const d = DIAGNOSTICS[options.ruleName]?.notViable;
    if (d) return render(d, f);
    return `I don't know what \`${f.word}\` means here`;
  },

  buildEarlyExitMessage(options) {
    const f = failure(options.actual, options.previous, tokens);
    const d = DIAGNOSTICS[options.ruleName]?.earlyExit;
    if (d) return render(d, f);
    return `I expected more after \`${f.previous}\``;
  },

  /**
   * Input left over after the program rule finished, which can only mean a
   * line at the outermost level that is not something the language starts a
   * declaration or a block with.
   */
  buildNotAllInputParsedMessage(options) {
    const f = failure(options.firstRedundant, undefined, tokens);
    return render(DIAGNOSTICS.topLevel!.notViable!, f);
  },
  };
}

/**
 * The hint that went with a message, looked up by the message itself.
 *
 * Chevrotain builds the message and the exception separately, and the exception
 * does not carry which token was expected — so by the time we have the error in
 * hand there is no way to re-run the choice that produced its wording. Pairing
 * them by message is safe because the mapping is a pure function of the
 * diagnostic: the same message always came from the same entry, whatever else
 * is being parsed at the time. An earlier draft stashed the pending hint in a
 * module-level variable, which worked and would have stopped working the moment
 * two parses overlapped.
 */
const EXTRAS = new Map<string, { hint?: string | undefined; pos?: SourcePos | undefined }>();

function remember(message: string, d: Diagnostic, f: Failure): string {
  if (d.hint || d.pos) {
    EXTRAS.set(message, {
      hint: d.hint?.replace("{word}", f.word).replace("{previous}", f.previous),
      pos: d.pos,
    });
  }
  return message;
}

export function hintFor(error: IRecognitionException): string | undefined {
  // Absent means the entry offered no hint, which several deliberately do not.
  return EXTRAS.get(error.message)?.hint;
}

/** Where the error should point, when the entry moved it. */
export function positionFor(error: IRecognitionException): SourcePos | undefined {
  return EXTRAS.get(error.message)?.pos;
}
