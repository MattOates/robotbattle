/**
 * RoboScript lexer.
 *
 * Newlines are significant (they end statements) so the language needs no
 * semicolons. Comments start with `--`. Synonyms from the themed vocabulary are
 * rewritten to canonical words here, so every stage downstream is theme-blind.
 */

import { RoboScriptError, type SourcePos } from "./errors.js";
import { canonicalizeWord } from "./vocab.js";

export type TokenKind =
  | "word" // identifier or keyword — the parser decides which
  | "number"
  | "string"
  | "color"
  | "op"
  | "newline"
  | "eof";

export interface Token {
  kind: TokenKind;
  /** Canonical text. For words this is post-alias-expansion. */
  text: string;
  /** Original text as the author typed it, for error messages. */
  raw: string;
  line: number;
  col: number;
  /** Numeric value, for `number` tokens. */
  value?: number;
}

/** Multi-character operators, longest first so `<=` beats `<`. */
const OPERATORS = ["<=", ">=", "<>", "!=", "==", "+", "-", "*", "/", "<", ">", "=", "(", ")", ","];

/**
 * Character classes, exported so the editor's tolerant scanner in `scan.ts`
 * splits words exactly the way the real lexer does.
 */
export const WORD_START = /[A-Za-z_]/;
export const WORD_PART = /[A-Za-z0-9_]/;
export const DIGIT = /[0-9]/;
export const HEX = /[0-9A-Fa-f]/;

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const pos = (): SourcePos => ({ line, col: i - lineStart + 1 });

  const push = (kind: TokenKind, text: string, raw: string, at: SourcePos, value?: number) => {
    const tok: Token = { kind, text, raw, line: at.line, col: at.col };
    if (value !== undefined) tok.value = value;
    tokens.push(tok);
  };

  while (i < source.length) {
    const ch = source[i]!;

    // --- whitespace (not newline) ---
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }

    // --- comments: `--` to end of line ---
    if (ch === "-" && source[i + 1] === "-") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }

    // --- newline ---
    if (ch === "\n") {
      const at = pos();
      // Collapse runs of blank lines into a single terminator; the parser
      // skips stray newlines anyway, but this keeps token dumps readable.
      if (tokens.length > 0 && tokens[tokens.length - 1]!.kind !== "newline") {
        push("newline", "\n", "\n", at);
      }
      i++;
      line++;
      lineStart = i;
      continue;
    }

    // --- color literal: #rrggbb or #rgb ---
    if (ch === "#") {
      const at = pos();
      let j = i + 1;
      while (j < source.length && HEX.test(source[j]!)) j++;
      const hex = source.slice(i + 1, j);
      if (hex.length !== 3 && hex.length !== 6) {
        throw new RoboScriptError(
          `\`#${hex}\` is not a colour I understand`,
          at,
          "colours look like #ff8800 (red, green, blue) or the short form #f80",
        );
      }
      push("color", "#" + hex.toLowerCase(), "#" + hex, at);
      i = j;
      continue;
    }

    // --- string literal ---
    if (ch === '"') {
      const at = pos();
      let j = i + 1;
      let out = "";
      while (j < source.length && source[j] !== '"') {
        if (source[j] === "\n") {
          throw new RoboScriptError(
            "this text is missing its closing quote",
            at,
            'text must start and end with " on the same line, like "Sparky"',
          );
        }
        // A backslash escape keeps quotes usable inside names.
        if (source[j] === "\\" && j + 1 < source.length) {
          const esc = source[j + 1]!;
          out += esc === "n" ? "\n" : esc;
          j += 2;
          continue;
        }
        out += source[j];
        j++;
      }
      if (j >= source.length) {
        throw new RoboScriptError(
          "this text is missing its closing quote",
          at,
          'text must start and end with ", like "Sparky"',
        );
      }
      push("string", out, source.slice(i, j + 1), at);
      i = j + 1;
      continue;
    }

    // --- number ---
    if (DIGIT.test(ch) || (ch === "." && DIGIT.test(source[i + 1] ?? ""))) {
      const at = pos();
      let j = i;
      while (j < source.length && DIGIT.test(source[j]!)) j++;
      if (source[j] === "." && DIGIT.test(source[j + 1] ?? "")) {
        j++;
        while (j < source.length && DIGIT.test(source[j]!)) j++;
      }
      const raw = source.slice(i, j);
      push("number", raw, raw, at, Number(raw));
      i = j;
      continue;
    }

    // --- word (identifier or keyword) ---
    if (WORD_START.test(ch)) {
      const at = pos();
      let j = i;
      while (j < source.length && WORD_PART.test(source[j]!)) j++;
      const raw = source.slice(i, j);
      // Keywords are case-insensitive; identifiers keep their case so that
      // `myTarget` and `mytarget` stay distinct only if neither is a keyword.
      const lower = raw.toLowerCase();
      // Expand themed synonyms into canonical words. One source word may
      // become several tokens (`stung` -> `hit by bullet`).
      for (const canonical of canonicalizeWord(lower)) {
        push("word", canonical, raw, at);
      }
      i = j;
      continue;
    }

    // --- dot: property access ---
    if (ch === ".") {
      push("op", ".", ".", pos());
      i++;
      continue;
    }

    // --- operators ---
    const at = pos();
    const op = OPERATORS.find((o) => source.startsWith(o, i));
    if (op) {
      // Normalise the several ways people write "not equal" and "equal".
      const text = op === "<>" || op === "!=" ? "isnt" : op === "==" ? "=" : op;
      push("op", text, op, at);
      i += op.length;
      continue;
    }

    throw new RoboScriptError(
      `I don't know what to do with the character \`${ch}\``,
      at,
      "RoboScript uses words rather than symbols for most things — try `is` instead of `==`",
    );
  }

  // Always terminate the final statement, then EOF.
  if (tokens.length > 0 && tokens[tokens.length - 1]!.kind !== "newline") {
    tokens.push({ kind: "newline", text: "\n", raw: "\n", line, col: i - lineStart + 1 });
  }
  tokens.push({ kind: "eof", text: "", raw: "", line, col: i - lineStart + 1 });
  return tokens;
}
