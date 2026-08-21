/**
 * The token vocabulary the grammar matches against.
 *
 * Chevrotain parses tokens rather than characters, which is the whole reason it
 * suits this language: `lexer.ts` already turns source into tokens, already
 * rewrites themed synonyms to canonical words so everything downstream is
 * theme-blind, already keeps `raw` beside the canonical text so an error can
 * quote what was actually typed, and already treats newlines as tokens because
 * they end statements. None of that has to move.
 *
 * So this file is an adapter and nothing else: our `Token` in, Chevrotain's
 * `IToken` out, with one `TokenType` per word the grammar needs to name.
 */

import { createToken, Lexer, type IToken, type TokenType } from "chevrotain";
import { tokenize, type Token } from "./lexer.js";
import { WORD_ALIASES } from "./vocab.js";

/**
 * `Lexer.NA` on every pattern, because Chevrotain never lexes here.
 *
 * These types exist to be matched against by the grammar, not to match with.
 * Handing Chevrotain a pattern it will never run would only invite somebody to
 * believe there are two lexers.
 */
const word = (name: string): TokenType => createToken({ name, pattern: Lexer.NA });

/**
 * Every reserved word, as a token type.
 *
 * Keyed by the canonical spelling so the table can be built from one list and
 * looked up by what the lexer produces. The names are capitalised because a
 * Chevrotain token type reads as a type at the call site — `T.End`, not
 * `T.end` — and `end`, `if` and `at` would otherwise shadow language keywords
 * in the grammar file.
 */
const KEYWORDS = [
  "on", "end", "var", "set", "if", "else", "then", "loop", "for", "to",
  "repeat", "times", "break", "continue", "wait", "ticks", "tick", "drive",
  "forward", "back", "backward", "stop", "turn", "chassis", "by", "fire",
  "turret", "aim", "at", "sweep", "is", "isnt", "not", "and", "or", "mod",
  "true", "false", "none", "me", "arena", "event", "name", "color", "skid",
  "steered", "start", "sense", "hit", "bullet", "robot", "wall", "missed",
  "destroyed", "radar", "ping", "can", "do", "with", "given", "every",
  "after", "before",
] as const;

type Keyword = (typeof KEYWORDS)[number];

/** `on` becomes `On`, `hit by bullet` needs `By` — one type per word. */
function typeName(kw: string): string {
  return kw.charAt(0).toUpperCase() + kw.slice(1);
}

const KEYWORD_TYPES = new Map<string, TokenType>(
  KEYWORDS.map((kw) => [kw, word(typeName(kw))]),
);

/** Everything that is not a reserved word. */
export const Ident = word("Ident");
export const NumLit = word("NumLit");
export const StrLit = word("StrLit");
export const ColorLit = word("ColorLit");
export const Newline = word("Newline");

/** Operators, by the text the lexer produces. */
const OPERATOR_NAMES: Record<string, string> = {
  ".": "Dot",
  ",": "Comma",
  "=": "Eq",
  "(": "LParen",
  ")": "RParen",
  "+": "Plus",
  "-": "Minus",
  "*": "Star",
  "/": "Slash",
  "<": "Lt",
  ">": "Gt",
  "<=": "Le",
  ">=": "Ge",
  "<>": "Ne",
  "!=": "NeBang",
  "==": "EqEq",
};

const OPERATOR_TYPES = new Map<string, TokenType>(
  Object.entries(OPERATOR_NAMES).map(([op, name]) => [op, word(name)]),
);

/**
 * Look a token type up by the canonical word.
 *
 * Exported so the grammar can say `kw("turret")` rather than importing sixty
 * named constants, and so a typo is a runtime error at module load rather than
 * a rule that silently never matches.
 */
export function kw(name: Keyword): TokenType {
  const type = KEYWORD_TYPES.get(name);
  if (!type) throw new Error(`no token type for keyword \`${name}\``);
  return type;
}

export function op(symbol: string): TokenType {
  const type = OPERATOR_TYPES.get(symbol);
  if (!type) throw new Error(`no token type for operator \`${symbol}\``);
  return type;
}

/**
 * A token type's name back to the word it stands for.
 *
 * `getGAstProductions()` describes the grammar in terms of token type names —
 * `Drive`, `Dot`, `NumLit` — and anything reading the grammar as documentation
 * needs the word a player would actually type. The placeholders answer with a
 * shape rather than a word, because that is what they are.
 */
const WORD_FOR_TYPE = new Map<string, string>([
  ...[...KEYWORD_TYPES].map(([word, type]) => [type.name, word] as const),
  ...[...OPERATOR_TYPES].map(([symbol, type]) => [type.name, symbol] as const),
  [Ident.name, "name"],
  [NumLit.name, "number"],
  [StrLit.name, "text"],
  [ColorLit.name, "colour"],
  [Newline.name, "new line"],
]);

export function wordForType(typeName: string): string {
  return WORD_FOR_TYPE.get(typeName) ?? typeName;
}

/** True when the type stands for a shape of thing rather than a fixed word. */
export function isPlaceholder(typeName: string): boolean {
  return [Ident, NumLit, StrLit, ColorLit, Newline].some((t) => t.name === typeName);
}

/**
 * Order matters to Chevrotain only for lexing, which we do not do here — but
 * the parser still wants the full vocabulary up front.
 */
export const ALL_TOKENS: TokenType[] = [
  ...KEYWORD_TYPES.values(),
  ...OPERATOR_TYPES.values(),
  Ident,
  NumLit,
  StrLit,
  ColorLit,
  Newline,
];

/**
 * Words that may never be used as a variable name.
 *
 * Every reserved word is a token type, so this is that list and not a second
 * copy of it. The editor's highlighter has its own tables, and a word the
 * language reserves but the highlighter has never heard of renders as an
 * ordinary variable — which is how a new instruction ships looking like a typo.
 * `tests/ui/highlight.test.ts` compares the two.
 *
 * The alternate spellings the lexer folds away belong here too: `colour` never
 * reaches the parser, but somebody typing it as a variable name still gets a
 * `color` and still needs telling why.
 */
export const RESERVED: ReadonlySet<string> = new Set([
  ...KEYWORDS,
  ...Object.keys(WORD_ALIASES).filter((spelling) =>
    WORD_ALIASES[spelling]!.every((canonical) => KEYWORD_TYPES.has(canonical)),
  ),
]);

/** Our token wearing Chevrotain's shape, with the original spelling kept. */
export interface RoboToken extends IToken {
  /** As the author typed it, before synonyms were canonicalised. */
  raw: string;
  /** Numeric value for number tokens, carried through from the lexer. */
  value?: number;
}

function typeOf(tok: Token): TokenType | null {
  switch (tok.kind) {
    case "word":
      return KEYWORD_TYPES.get(tok.text) ?? Ident;
    case "number":
      return NumLit;
    case "string":
      return StrLit;
    case "color":
      return ColorLit;
    case "newline":
      return Newline;
    case "op":
      return OPERATOR_TYPES.get(tok.text) ?? null;
    case "eof":
      // Chevrotain marks the end itself; passing one along would only be a
      // token no rule expects.
      return null;
  }
}

export function toTokens(source: string): RoboToken[] {
  const out: RoboToken[] = [];
  let offset = 0;
  for (const tok of tokenize(source)) {
    const type = typeOf(tok);
    const length = tok.raw.length || 1;
    if (type) {
      out.push({
        image: tok.text,
        raw: tok.raw,
        ...(tok.value === undefined ? {} : { value: tok.value }),
        startOffset: offset,
        endOffset: offset + length,
        startLine: tok.line,
        endLine: tok.line,
        startColumn: tok.col,
        endColumn: tok.col + length,
        tokenTypeIdx: type.tokenTypeIdx!,
        tokenType: type,
      });
    }
    offset += length;
  }
  return out;
}
