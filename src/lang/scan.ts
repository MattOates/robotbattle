/**
 * A tolerant scanner for editor tooling.
 *
 * The real lexer throws on the first bad character, which is right for
 * compiling and wrong for an editor: half-typed code is the normal state of a
 * file being written, and syntax highlighting must never fail. So this scanner
 * never throws, and marks the broken part rather than giving up.
 *
 * It shares the real lexer's character classes and the same alias table, so a
 * word highlights as a keyword exactly when the compiler would treat it as one
 * — including themed synonyms.
 *
 * RoboScript has no multi-line constructs (comments run to end of line, strings
 * may not span lines), so scanning one line at a time is complete and needs no
 * carried state.
 */

import { DIGIT, HEX, WORD_PART, WORD_START } from "./lexer.js";
import { canonicalizeWord } from "./vocab.js";

export type LooseKind = "comment" | "string" | "number" | "color" | "word" | "punct" | "error";

export interface LooseToken {
  kind: LooseKind;
  /** Exactly as typed. */
  text: string;
  /** For words: the canonical word(s) the lexer would produce. */
  canonical: readonly string[];
  /** Offsets within the line. */
  start: number;
  end: number;
  /** True for a string that never got its closing quote. */
  unterminated?: boolean;
}

/** Split one line. Never throws. */
export function scanLine(line: string): LooseToken[] {
  const out: LooseToken[] = [];
  let i = 0;

  const push = (
    kind: LooseKind,
    start: number,
    end: number,
    canonical: readonly string[] = [],
    unterminated?: boolean,
  ) => {
    const tok: LooseToken = { kind, text: line.slice(start, end), canonical, start, end };
    if (unterminated) tok.unterminated = true;
    out.push(tok);
  };

  while (i < line.length) {
    const ch = line[i]!;

    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }

    // Comment runs to end of line.
    if (ch === "-" && line[i + 1] === "-") {
      push("comment", i, line.length);
      return out;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') {
        if (line[j] === "\\" && j + 1 < line.length) j += 2;
        else j++;
      }
      const closed = j < line.length;
      push("string", i, closed ? j + 1 : line.length, [], !closed);
      i = closed ? j + 1 : line.length;
      continue;
    }

    if (ch === "#") {
      let j = i + 1;
      while (j < line.length && HEX.test(line[j]!)) j++;
      const len = j - i - 1;
      push(len === 3 || len === 6 ? "color" : "error", i, j);
      i = j;
      continue;
    }

    if (DIGIT.test(ch) || (ch === "." && DIGIT.test(line[i + 1] ?? ""))) {
      let j = i;
      while (j < line.length && DIGIT.test(line[j]!)) j++;
      if (line[j] === "." && DIGIT.test(line[j + 1] ?? "")) {
        j++;
        while (j < line.length && DIGIT.test(line[j]!)) j++;
      }
      push("number", i, j);
      i = j;
      continue;
    }

    if (WORD_START.test(ch)) {
      let j = i;
      while (j < line.length && WORD_PART.test(line[j]!)) j++;
      push("word", i, j, canonicalizeWord(line.slice(i, j).toLowerCase()));
      i = j;
      continue;
    }

    if ("().,=<>+-*/".includes(ch)) {
      // Two-character comparisons first, so `<=` beats `<`.
      const two = line.slice(i, i + 2);
      const len = ["<=", ">=", "<>", "!=", "=="].includes(two) ? 2 : 1;
      push("punct", i, i + len);
      i += len;
      continue;
    }

    push("error", i, i + 1);
    i++;
  }

  return out;
}
