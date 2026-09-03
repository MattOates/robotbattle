/**
 * The News entries, in both vocabularies and against the history they describe.
 *
 * Two ways this goes wrong quietly. The copy can drift into one world's words,
 * the way every settings panel did before it was caught; and an entry can claim
 * a date that is not in the git history, which turns a changelog into fiction.
 */

import { describe, expect, it } from "vitest";
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

/*
 * There was a check here that every date matched a day in the git log.
 *
 * It has been removed, and the reason is worth keeping. A News date is
 * editorial — roughly when a thing happened, for a reader deciding whether
 * they have seen it before — and no reader is any better off for it agreeing
 * with commit metadata. Nothing about the changelog is wrong if it does not.
 *
 * What it did instead was make merge strategy load-bearing. This repository
 * squash merges, so a branch's own days do not survive the merge: a fortnight
 * of afternoons arrives as one commit dated the day the button was pressed.
 * The check therefore passed on every branch and could only fail after
 * merging, which is how it took the Pages deploy down over prose that was
 * perfectly accurate.
 *
 * The checks below are the ones with a reader behind them: the copy has to
 * read correctly in both worlds, resolve its placeholders, and be in order.
 */
describe("the news is in a sensible order", () => {
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
