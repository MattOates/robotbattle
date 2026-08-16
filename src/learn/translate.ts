/**
 * Rendering a lesson's code in the reader's world.
 *
 * Every example is written once, in mechanical words, and translated on the way
 * to the page. Writing each one twice would guarantee the two drift, and a
 * tutorial that teaches the language slightly wrong is worse than no tutorial.
 *
 * This reuses the tolerant scanner built for the editor, so it already knows
 * the difference between a keyword, a string and a comment. That matters: a
 * robot called "Hunter" must not become "Hunter" with half its name swapped,
 * and a comment about shooting a robot should read as stinging an organism.
 */

import { scanLine, type LooseToken } from "../lang/scan.js";
import { phraseFor, wordFor, type Theme } from "../lang/vocab.js";

/**
 * Words that appear in prose inside comments, and their counterpart in the
 * other world. Kept separate from the language's own synonym table because
 * these are English words in sentences, not tokens.
 */
const COMMENT_WORDS: ReadonlyArray<readonly [string, string]> = [
  ["robots", "organisms"],
  ["robot", "organism"],
  ["bullets", "darts"],
  ["bullet", "dart"],
  ["turret", "stinger"],
  ["radar", "eyespot"],
  ["ping", "peek"],
  ["pings", "peeks"],
  ["pinging", "peeking"],
  ["pinged", "peeked"],
  ["tracks", "cilia"],
  ["wheels", "flagellum"],
  ["tank", "ciliate"],
  ["car", "flagellate"],
  ["arena", "microcosm"],
  ["health", "vitality"],
  ["shoot", "sting"],
  ["shooting", "stinging"],
  ["shot", "stung"],
  ["fire", "sting"],
  ["drive", "swim"],
  ["driving", "swimming"],
];

/** Replace whole words, keeping the original capitalisation. */
function swapWords(text: string, pairs: ReadonlyArray<readonly [string, string]>): string {
  let out = text;
  for (const [from, to] of pairs) {
    out = out.replace(new RegExp(`\\b${from}\\b`, "gi"), (match) => {
      if (match === match.toUpperCase() && match.length > 1) return to.toUpperCase();
      if (match[0] === match[0]?.toUpperCase()) return to[0]!.toUpperCase() + to.slice(1);
      return to;
    });
  }
  return out;
}

function translateComment(text: string, theme: Theme): string {
  return theme === "biological"
    ? swapWords(text, COMMENT_WORDS)
    : swapWords(
        text,
        COMMENT_WORDS.map(([a, b]) => [b, a] as const),
      );
}

/**
 * Is this token the start of a canonical phrase spanning several tokens?
 *
 * `hit by bullet` is the only one, and it exists because `stung` is far too
 * good a word to give up. Written mechanically it is three tokens; in the
 * biological world it collapses to one.
 */
const PHRASES: ReadonlyArray<readonly string[]> = [["hit", "by", "bullet"]];

function phraseAt(tokens: LooseToken[], index: number): readonly string[] | null {
  for (const phrase of PHRASES) {
    let ok = true;
    for (let k = 0; k < phrase.length; k++) {
      const token = tokens[index + k];
      if (!token || token.kind !== "word" || token.canonical[0] !== phrase[k]) {
        ok = false;
        break;
      }
      // A phrase must be exactly one canonical word per token, or it is
      // already collapsed and there is nothing to join.
      if (token.canonical.length !== 1) {
        ok = false;
        break;
      }
    }
    if (ok) return phrase;
  }
  return null;
}

function previousWord(tokens: LooseToken[], index: number): string | null {
  for (let i = index - 1; i >= 0; i--) {
    const token = tokens[i]!;
    if (token.kind === "word") return token.canonical[0] ?? token.text;
  }
  return null;
}

/**
 * One canonical word, in the words of a world.
 *
 * `chassis` is the awkward case: it is both the declaration keyword and the
 * thing you turn, and English wants a different word for each. `chassis tank`
 * declares what you are; `turn body by 90` turns your body — and it is "body"
 * in both worlds, because a tank does not have a chassis you rotate separately
 * from itself.
 */
function renderWord(canonical: string, theme: Theme, previous: string | null): string {
  if (canonical === "chassis" && previous === "turn") return "body";
  return wordFor(canonical, theme);
}

/** Render one line of RoboScript in the given world. */
export function translateLine(line: string, theme: Theme): string {
  const tokens = scanLine(line);
  let out = "";
  let cursor = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    // Whitespace between tokens is copied verbatim, so indentation survives.
    out += line.slice(cursor, token.start);

    if (token.kind === "comment") {
      out += translateComment(token.text, theme);
      cursor = token.end;
      continue;
    }

    if (token.kind !== "word") {
      out += token.text;
      cursor = token.end;
      continue;
    }

    const phrase = phraseAt(tokens, i);
    if (phrase) {
      out += phraseFor(phrase.join(" "), theme);
      const last = tokens[i + phrase.length - 1]!;
      cursor = last.end;
      i += phrase.length - 1;
      continue;
    }

    // A single source word may already stand for several canonical ones
    // (`stung`), in which case it expands or stays collapsed as the world
    // requires.
    const canonical = token.canonical[0] ?? token.text;
    out +=
      token.canonical.length > 1
        ? phraseFor(token.canonical.join(" "), theme)
        : renderWord(canonical, theme, previousWord(tokens, i));
    cursor = token.end;
  }

  return out + line.slice(cursor);
}

/** Render a whole script in the given world. */
export function translate(source: string, theme: Theme): string {
  return source
    .split("\n")
    .map((line) => translateLine(line, theme))
    .join("\n");
}
