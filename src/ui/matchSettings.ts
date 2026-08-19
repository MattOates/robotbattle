/**
 * The named match conditions, in one place, in both vocabularies.
 *
 * Fuel and terrain are each four numbers that only mean anything together —
 * halving the spawn interval and halving the amount is not a change at all —
 * so every screen that offers them offers a few words instead. The words have
 * to mean the same thing everywhere: a robot tuned against "hilly" on the test
 * bench and then entered into a "hilly" arena match should be meeting the same
 * ground, and it can only be relied on to if there is one table.
 *
 * Every piece of prose here is a template, rendered through `renderDoc` with
 * the same placeholders the language help uses. Nothing in the two worlds plays
 * differently — but a player in the microcosm is told about food and goop, not
 * fuel and hills, and these controls were the last place still saying the
 * mechanical words to everybody.
 */

import { renderDoc } from "../lang/events.js";
import { THEMES, type Theme } from "../lang/vocab.js";
import {
  FUEL_PRESETS,
  TERRAIN_PRESETS,
  type FuelConfig,
  type TerrainConfig,
} from "../sim/types.js";

export const FUEL_SETTINGS = {
  off: FUEL_PRESETS.off,
  scarce: { enabled: true, spawnEveryTicks: 150, maxOnField: 3, amount: 20, radius: 10 },
  normal: FUEL_PRESETS.arena,
  plentiful: { enabled: true, spawnEveryTicks: 45, maxOnField: 10, amount: 30, radius: 12 },
} satisfies Record<string, FuelConfig>;

export type FuelLevel = keyof typeof FUEL_SETTINGS;

/** How much there is of it. The same four words work in either world. */
const FUEL_BLURB: Record<FuelLevel, string> = {
  off: "No {fuel} in this match. Nothing to collect, and nothing spends it either.",
  // "Thin pickings" would be a nice line, but thin is the biological word for
  // easy going, and the arena copy should not borrow it.
  scarce: "Lean pickings. Anything that {drive}s everywhere will be crawling by the end.",
  // No "a {robot}": the article would be wrong half the time ("a organism"),
  // and the vocabulary carries nouns, not the grammar around them.
  normal: "Enough to keep anything that goes looking for it running.",
  plentiful: "Plenty about. Almost nobody will run low.",
};

/**
 * The seed is deliberately the same across all three levels. A different map
 * every match would make the setting impossible to judge — and on the test
 * bench in particular, a robot has to be able to fight the same ground fifty
 * times before you can say whether a change to it helped.
 */
export const TERRAIN_SETTINGS = {
  flat: TERRAIN_PRESETS.off,
  rolling: { enabled: true, seed: 1, featureSize: 340, amplitude: 0.6 },
  hilly: TERRAIN_PRESETS.arena,
} satisfies Record<string, TerrainConfig>;

export type TerrainLevel = keyof typeof TERRAIN_SETTINGS;

/**
 * Here the two worlds genuinely need different words rather than a substitution:
 * hills are not thicker or thinner, and goop is not higher or lower. One field,
 * two honest readings of it.
 */
const TERRAIN_LEVEL_WORDS: Record<TerrainLevel, Record<Theme, string>> = {
  flat: { mechanical: "flat", biological: "even" },
  rolling: { mechanical: "rolling", biological: "patchy" },
  hilly: { mechanical: "hilly", biological: "gloopy" },
};

const TERRAIN_BLURB: Record<TerrainLevel, string> = {
  flat: "The same {ground} everywhere. Every direction costs the same.",
  rolling: "Gentle {ground}. Worth noticing, not worth planning around.",
  // The opener describes the going rather than naming the thing: "Real {slope}"
  // reads as "Real thickness" in the microcosm, and "steep" is a hill's word.
  hilly:
    "Hard going. Heading {uphill} is slow and expensive, heading {downhill} is quick and nearly free, and going across is neither.",
};

/** The one-line explanation above each set of buttons. */
// Phrased as "to move, to turn, to {fire}" rather than a list of gerunds,
// because the vocabulary carries plain verbs: "{fire}" renders as "fire" or
// "sting", and "Moving, turning, fire and ping" is not a sentence.
const FUEL_INTRO =
  "It costs {fuel} to move, to turn, to {fire} and to {ping}. Thinking is free. An empty {robot} is slow, not dead.";

const TERRAIN_INTRO =
  "Some of the {arena} is harder going than the rest. Heading {uphill} is slower and costs more; heading {downhill} is quicker and costs less; going across is exactly as cheap as the easy {ground}.";

export const FUEL_LEVELS = Object.keys(FUEL_SETTINGS) as FuelLevel[];
export const TERRAIN_LEVELS = Object.keys(TERRAIN_SETTINGS) as TerrainLevel[];

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Heading for the fuel control: "Fuel" or "Food". */
export function fuelHeading(theme: Theme): string {
  return capitalise(THEMES[theme].fuel);
}

/** Heading for the terrain control: "Ground" or "Goop". */
export function terrainHeading(theme: Theme): string {
  return capitalise(THEMES[theme].ground);
}

export function fuelIntro(theme: Theme): string {
  return renderDoc(FUEL_INTRO, theme);
}

export function terrainIntro(theme: Theme): string {
  return renderDoc(TERRAIN_INTRO, theme);
}

export function fuelBlurb(level: FuelLevel, theme: Theme): string {
  return renderDoc(FUEL_BLURB[level], theme);
}

export function terrainBlurb(level: TerrainLevel, theme: Theme): string {
  return renderDoc(TERRAIN_BLURB[level], theme);
}

/** Button label for one fuel level. The amounts read the same in both worlds. */
export function fuelLevelWord(level: FuelLevel): string {
  return level;
}

export function terrainLevelWord(level: TerrainLevel, theme: Theme): string {
  return TERRAIN_LEVEL_WORDS[level][theme];
}

/**
 * Name a set of conditions in one phrase, for a results table.
 *
 * Falls back to "custom" rather than guessing, because a report can arrive from
 * a peer on a build whose presets differ from ours, and a wrong name on a
 * number is worse than an honest shrug.
 */
export function describeConditions(
  conditions: { fuel: FuelConfig; terrain: TerrainConfig },
  theme: Theme,
): string {
  const words = THEMES[theme];
  const fuel = FUEL_LEVELS.find((l) => sameFuel(FUEL_SETTINGS[l], conditions.fuel));
  const ground = TERRAIN_LEVELS.find((l) => sameTerrain(TERRAIN_SETTINGS[l], conditions.terrain));
  const fuelPart = conditions.fuel.enabled
    ? `${fuel ?? "custom"} ${words.fuel}`
    : `no ${words.fuel}`;
  const groundPart = conditions.terrain.enabled
    ? `${ground ? terrainLevelWord(ground, theme) : "custom"} ${words.ground}`
    : `${terrainLevelWord("flat", theme)} ${words.ground}`;
  return `${fuelPart} and ${groundPart}`;
}

function sameFuel(a: FuelConfig, b: FuelConfig): boolean {
  return (
    a.enabled === b.enabled &&
    a.spawnEveryTicks === b.spawnEveryTicks &&
    a.maxOnField === b.maxOnField &&
    a.amount === b.amount &&
    a.radius === b.radius
  );
}

function sameTerrain(a: TerrainConfig, b: TerrainConfig): boolean {
  return (
    a.enabled === b.enabled &&
    a.seed === b.seed &&
    a.featureSize === b.featureSize &&
    a.amplitude === b.amplitude
  );
}
