/**
 * Catching prose that only reads correctly in one world.
 *
 * A lesson's shared paragraphs must use `{robot}` rather than the word
 * "robot", or a biological reader is told about robots and bullets. That is
 * easy to get right the first time and easy to forget on the tenth paragraph,
 * so it is checked rather than trusted.
 *
 * Only *shared* prose is checked. Inside a `:::bot` or `:::bio` block the
 * whole point is to write for one world, so plain words are correct there.
 * Code, inline code, headings written for one world, and frontmatter are all
 * left alone.
 */

const WORLD_OPEN = /^:::(bot|bio)\s*$/;
const WORLD_CLOSE = /^:::\s*$/;
const FENCE = /^```/;

/** Words that read wrongly in the other world if written bare. */
const LOADED_WORDS = [
  "robot",
  "robots",
  "organism",
  "organisms",
  "bullet",
  "bullets",
  "dart",
  "darts",
  "turret",
  "stinger",
  "radar",
  "eyespot",
  "cilia",
  "flagellum",
  "ciliate",
  "flagellate",
];

export interface ProseWarning {
  line: number;
  word: string;
  text: string;
}

/**
 * Strip the parts of a line where a bare vocabulary word is legitimate:
 * inline code (translated at render time) and link targets.
 */
function strippable(line: string): string {
  return line.replace(/`[^`]*`/g, "").replace(/\]\([^)]*\)/g, "");
}

/** Bare vocabulary words in shared prose, which should be placeholders. */
export function findBareVocab(body: string): ProseWarning[] {
  const warnings: ProseWarning[] = [];
  let insideWorld = false;
  let insideFence = false;

  body.split("\n").forEach((line, index) => {
    if (FENCE.test(line)) {
      insideFence = !insideFence;
      return;
    }
    if (insideFence) return;

    if (WORLD_OPEN.test(line)) {
      insideWorld = true;
      return;
    }
    if (insideWorld && WORLD_CLOSE.test(line)) {
      insideWorld = false;
      return;
    }
    // Inside a world block, writing for that world is the whole point.
    if (insideWorld) return;

    const text = strippable(line);
    for (const word of LOADED_WORDS) {
      // Not preceded by `{`, so a placeholder is not flagged as its own word.
      const pattern = new RegExp(`(?<![{\\w])${word}\\b`, "i");
      if (pattern.test(text)) {
        warnings.push({ line: index + 1, word, text: line.trim() });
        break;
      }
    }
  });

  return warnings;
}
