/**
 * The News entries, in both vocabularies and against the history they describe.
 *
 * Two ways this goes wrong quietly. The copy can drift into one world's words,
 * the way every settings panel did before it was caught; and an entry can claim
 * a date that is not in the git history, which turns a changelog into fiction.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { NEWS, formatNewsDate, newsBody, newsTitle } from "../../src/ui/news.js";
import type { Theme } from "../../src/lang/vocab.js";

const MECHANICAL_ONLY = ["fuel", "ground", "hill", "hills", "uphill", "downhill", "robot", "robots", "turret", "radar", "ridge"];
const BIOLOGICAL_ONLY = ["food", "goop", "thickest", "thinnest", "organism", "organisms", "stinger", "eyespot", "murk"];

function saysWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(text);
}

function allText(theme: Theme): string[] {
  return NEWS.flatMap((e) => [newsTitle(e, theme), newsBody(e, theme)]);
}

describe("the news reads in both worlds", () => {
  it("never says a mechanical word in the microcosm", () => {
    for (const text of allText("biological")) {
      for (const word of MECHANICAL_ONLY) {
        expect(saysWord(text, word), `"${text}" says "${word}"`).toBe(false);
      }
    }
  });

  it("never says a biological word in the arena", () => {
    for (const text of allText("mechanical")) {
      for (const word of BIOLOGICAL_ONLY) {
        expect(saysWord(text, word), `"${text}" says "${word}"`).toBe(false);
      }
    }
  });

  it("leaves no placeholder unrendered", () => {
    for (const theme of ["mechanical", "biological"] as Theme[]) {
      for (const text of allText(theme)) {
        expect(text, text).not.toMatch(/[{}]/);
      }
    }
  });

  it("starts every entry with a capital, whichever word opens it", () => {
    // Titles are templates, and the vocabulary carries lower-case nouns, so an
    // entry beginning with a placeholder would otherwise read "fuel, and ...".
    for (const theme of ["mechanical", "biological"] as Theme[]) {
      for (const entry of NEWS) {
        expect(newsTitle(entry, theme)[0]).toBe(newsTitle(entry, theme)[0]?.toUpperCase());
      }
    }
  });
});

describe("the news matches the history", () => {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

  /**
   * Whether this checkout can actually see the past.
   *
   * A shallow clone has one commit in it, which makes every entry older than
   * that commit look invented — so the check below would fail loudly while
   * proving nothing. It is skipped rather than fudged, because a test that
   * cannot answer its question should say so instead of guessing.
   *
   * CI asks for the full history (`fetch-depth: 0`), so there it always runs.
   * This guard is for whoever clones with `--depth`.
   */
  const shallow = git("rev-parse", "--is-shallow-repository") === "true";

  const days = new Set(
    git("log", "--date=short", "--pretty=format:%ad").split("\n").filter(Boolean),
  );

  it.skipIf(shallow)("only claims days that something actually landed on", () => {
    // A changelog whose dates are invented is worse than no changelog.
    for (const entry of NEWS) {
      expect(days.has(entry.date), `${entry.date} — ${entry.title}`).toBe(true);
    }
  });

  it("is ordered newest first", () => {
    const dates = NEWS.map((e) => e.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("formats a date the same way wherever it is read", () => {
    // Not toLocaleDateString: these are facts about the project, not about the
    // reader's machine.
    expect(formatNewsDate("2026-08-19")).toBe("19 August 2026");
    expect(formatNewsDate("2026-08-05")).toBe("5 August 2026");
  });
});
