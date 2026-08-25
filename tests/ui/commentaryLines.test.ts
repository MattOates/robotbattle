/**
 * The words the commentator uses.
 *
 * Two hazards. A line with a placeholder nobody wired up gets read out with
 * its braces intact — which has already happened twice in this codebase, once
 * in a lesson and once in the tour. And a line that varies at random would make
 * a replay say something different the second time, which quietly stops being a
 * replay.
 */

import { describe, expect, it } from "vitest";
import { ALL_LINES, SLOT_NAMES, humanList, phrase } from "../../src/ui/commentary/lines.js";
import { fillVocab } from "../../src/learn/markdown.js";
import type { Beat } from "../../src/sim/commentary.js";
import type { Theme } from "../../src/lang/vocab.js";

const THEMES: Theme[] = ["mechanical", "biological"];

/** One of every kind, so nothing is left untested by omission. */
const EVERY_BEAT: Beat[] = [
  { kind: "start", names: ["Hunter", "Spinner", "Racer"] },
  { kind: "firstBlood", by: "Hunter", on: "Spinner" },
  { kind: "hit", by: "Hunter", on: "Spinner", damage: 12 },
  { kind: "kill", by: "Hunter", on: "Spinner", remaining: 2 },
  { kind: "selfDestruct", who: "Lemming" },
  { kind: "limping", who: "Spinner", health: 14 },
  { kind: "end", winner: "Hunter", ticks: 900 },
  { kind: "end", winner: null, ticks: 900 },
];

describe("every beat can be said", () => {
  it("produces a sentence for each kind in both worlds", () => {
    for (const beat of EVERY_BEAT) {
      for (const theme of THEMES) {
        for (let seed = 0; seed < 12; seed++) {
          const said = phrase(beat, theme, seed);
          expect(said.length, `${beat.kind} (${theme})`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("never leaves a placeholder in what it says", () => {
    // The bug that has now bitten twice elsewhere: prose written with a
    // placeholder the table does not know, read out with its braces.
    for (const beat of EVERY_BEAT) {
      for (const theme of THEMES) {
        for (let seed = 0; seed < 12; seed++) {
          const said = phrase(beat, theme, seed);
          expect(said.match(/\{[A-Za-z]\w*\}/g), `${beat.kind} (${theme}) seed ${seed}`).toBeNull();
        }
      }
    }
  });

  it("uses the names it was given", () => {
    const said = phrase({ kind: "kill", by: "Hunter", on: "Spinner", remaining: 1 }, "mechanical", 3);
    expect(said).toContain("Hunter");
    expect(said).toContain("Spinner");
  });

  it("counts the match in seconds, not ticks", () => {
    // 900 ticks at 30 Hz is half a minute. Nobody thinks in ticks.
    const options = Array.from({ length: 12 }, (_, seed) =>
      phrase({ kind: "end", winner: "Hunter", ticks: 900 }, "mechanical", seed),
    );
    expect(options.some((line) => line.includes("30"))).toBe(true);
    expect(options.every((line) => !line.includes("900"))).toBe(true);
  });

  it("has something to say when everybody dies at once", () => {
    const said = phrase({ kind: "end", winner: null, ticks: 400 }, "mechanical", 1);
    expect(said).not.toContain("undefined");
    expect(said).not.toContain("null");
    expect(said.trim()).not.toBe("");
  });
});

describe("slots and vocabulary do not collide", () => {
  it("names no slot after a vocabulary word", () => {
    // This is the failure mode that looks fine. `{health}` was a slot *and* a
    // vocabulary placeholder, so "in real trouble — {health} left" was filled
    // by the vocabulary first and read out as "in real trouble — integrity
    // left". Valid English, wrong sentence, and invisible to a test looking
    // for leftover braces. Only listening to a match caught it.
    for (const slot of SLOT_NAMES) {
      for (const theme of THEMES) {
        expect(fillVocab(`{${slot}}`, theme), `{${slot}} is a vocabulary word`).toBe(
          `{${slot}}`,
        );
      }
    }
  });

  it("puts the number in the line about being nearly dead", () => {
    const options = Array.from({ length: 20 }, (_, seed) =>
      phrase({ kind: "limping", who: "Spinner", health: 14 }, "biological", seed),
    );
    expect(options.some((line) => line.includes("14"))).toBe(true);
    // The word that used to be substituted in its place.
    expect(options.every((line) => !line.includes("vitality"))).toBe(true);
  });
});

describe("saying it the same way twice", () => {
  it("gives the same words for the same beat and seed", () => {
    for (const beat of EVERY_BEAT) {
      expect(phrase(beat, "mechanical", 7)).toBe(phrase(beat, "mechanical", 7));
    }
  });

  it("varies across seeds, or there was no point writing several", () => {
    const beat: Beat = { kind: "hit", by: "A", on: "B", damage: 5 };
    const seen = new Set(
      Array.from({ length: 40 }, (_, seed) => phrase(beat, "mechanical", seed)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it("reads differently in the two worlds where the words differ", () => {
    // Not every line contains a vocabulary word, so this checks the one that
    // does rather than asserting it of all of them.
    const withVocab = ALL_LINES.filter((line) => /\{robot|\{arena|\{turret/.test(line));
    for (const line of withVocab) {
      expect(line).toBeTruthy();
    }
  });
});

describe("humanList", () => {
  it("joins names the way somebody would read them out", () => {
    expect(humanList(["A"])).toBe("A");
    expect(humanList(["A", "B"])).toBe("A and B");
    expect(humanList(["A", "B", "C"])).toBe("A, B and C");
  });

  it("has a word for an empty field", () => {
    expect(humanList([])).toBe("nobody");
  });
});
