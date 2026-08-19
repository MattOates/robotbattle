/**
 * The match settings, in both vocabularies.
 *
 * These controls shipped saying "Fuel" and "Ground" to everybody, including
 * players in the microcosm, where there is no fuel and no ground. The words are
 * the whole promise of the two worlds — nothing plays differently, so the
 * wording is the only thing there is — and every screen that grew a settings
 * panel quietly broke it the same way.
 *
 * So this checks the strings themselves rather than any screen: a fourth screen
 * with the same controls cannot get it wrong without failing here first.
 */

import { describe, expect, it } from "vitest";
import {
  FUEL_LEVELS,
  TERRAIN_LEVELS,
  describeConditions,
  fuelBlurb,
  fuelHeading,
  fuelIntro,
  terrainBlurb,
  terrainHeading,
  terrainIntro,
  terrainLevelWord,
  FUEL_SETTINGS,
  TERRAIN_SETTINGS,
} from "../../src/ui/matchSettings.js";
import type { Theme } from "../../src/lang/vocab.js";

const THEME_LIST: Theme[] = ["mechanical", "biological"];

/**
 * Words that belong to one world and must never reach the other.
 *
 * Matched on word boundaries, not as substrings: "thin" is a biological word
 * and "thinking" is not, and a substring check fails the mechanical copy for
 * containing the latter.
 */
const MECHANICAL_ONLY = ["fuel", "ground", "hill", "hills", "hilly", "uphill", "downhill", "robot"];
const BIOLOGICAL_ONLY = ["food", "goop", "gloopy", "thick", "thickest", "thin", "thinnest"];

function saysWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(text);
}

function everyBiologicalString(): string[] {
  return [
    fuelHeading("biological"),
    terrainHeading("biological"),
    fuelIntro("biological"),
    terrainIntro("biological"),
    ...FUEL_LEVELS.map((l) => fuelBlurb(l, "biological")),
    ...TERRAIN_LEVELS.map((l) => terrainBlurb(l, "biological")),
    ...TERRAIN_LEVELS.map((l) => terrainLevelWord(l, "biological")),
  ];
}

function everyMechanicalString(): string[] {
  return [
    fuelHeading("mechanical"),
    terrainHeading("mechanical"),
    fuelIntro("mechanical"),
    terrainIntro("mechanical"),
    ...FUEL_LEVELS.map((l) => fuelBlurb(l, "mechanical")),
    ...TERRAIN_LEVELS.map((l) => terrainBlurb(l, "mechanical")),
    ...TERRAIN_LEVELS.map((l) => terrainLevelWord(l, "mechanical")),
  ];
}

describe("the settings speak both languages", () => {
  it("names the two controls differently", () => {
    expect(fuelHeading("mechanical")).toBe("Fuel");
    expect(fuelHeading("biological")).toBe("Food");
    expect(terrainHeading("mechanical")).toBe("Ground");
    expect(terrainHeading("biological")).toBe("Goop");
  });

  it("uses different words for how bad the going is", () => {
    for (const level of TERRAIN_LEVELS) {
      expect(terrainLevelWord(level, "biological")).not.toBe(
        terrainLevelWord(level, "mechanical"),
      );
    }
  });

  it("never says a mechanical word in the microcosm", () => {
    for (const text of everyBiologicalString()) {
      for (const word of MECHANICAL_ONLY) {
        expect(saysWord(text, word), `"${text}" says "${word}"`).toBe(false);
      }
    }
  });

  it("never says a biological word in the arena", () => {
    for (const text of everyMechanicalString()) {
      for (const word of BIOLOGICAL_ONLY) {
        expect(saysWord(text, word), `"${text}" says "${word}"`).toBe(false);
      }
    }
  });

  it("leaves no placeholder unrendered", () => {
    // A `{fuel}` that reached the screen would be the failure mode where a
    // template was written but never passed through renderDoc.
    for (const text of [...everyBiologicalString(), ...everyMechanicalString()]) {
      expect(text).not.toMatch(/[{}]/);
    }
  });
});

describe("naming a set of conditions", () => {
  it("uses each world's words", () => {
    const conditions = { fuel: FUEL_SETTINGS.scarce, terrain: TERRAIN_SETTINGS.hilly };
    expect(describeConditions(conditions, "mechanical")).toBe("scarce fuel and hilly ground");
    expect(describeConditions(conditions, "biological")).toBe("scarce food and gloopy goop");
  });

  it("says what off means rather than naming a level nobody picked", () => {
    const conditions = { fuel: FUEL_SETTINGS.off, terrain: TERRAIN_SETTINGS.flat };
    expect(describeConditions(conditions, "mechanical")).toBe("no fuel and flat ground");
    expect(describeConditions(conditions, "biological")).toBe("no food and even goop");
  });

  it("admits it does not recognise settings from somewhere else", () => {
    // A report can arrive from a peer whose build has different presets. A
    // wrong name on a number is worse than an honest shrug.
    const conditions = {
      fuel: { ...FUEL_SETTINGS.normal, amount: 99 },
      terrain: { ...TERRAIN_SETTINGS.hilly, seed: 12345 },
    };
    for (const theme of THEME_LIST) {
      expect(describeConditions(conditions, theme)).toContain("custom");
    }
  });
});
