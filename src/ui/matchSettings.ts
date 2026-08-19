/**
 * The named match conditions, in one place.
 *
 * Fuel and terrain are each four numbers that only mean anything together —
 * halving the spawn interval and halving the amount is not a change at all —
 * so every screen that offers them offers a few words instead. The words have
 * to mean the same thing everywhere: a robot tuned against "hilly" on the test
 * bench and then entered into a "hilly" arena match should be meeting the same
 * ground, and it can only be relied on to if there is one table.
 */

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

export const FUEL_BLURB: Record<FuelLevel, string> = {
  off: "No fuel in this match. Nothing to collect, and nothing spends it either.",
  scarce: "Thin pickings. Robots that drive everywhere will be crawling by the end.",
  normal: "Enough to keep a robot that looks for it running.",
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

export const TERRAIN_BLURB: Record<TerrainLevel, string> = {
  flat: "Level ground everywhere. Every direction costs the same.",
  rolling: "Gentle ground. Worth noticing, not worth planning around.",
  hilly:
    "Real hills. Going up is slow and expensive, going down is quick and nearly free, and going across is neither.",
};

export const FUEL_LEVELS = Object.keys(FUEL_SETTINGS) as FuelLevel[];
export const TERRAIN_LEVELS = Object.keys(TERRAIN_SETTINGS) as TerrainLevel[];
