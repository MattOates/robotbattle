/**
 * Art packs must not borrow a robot's colour.
 *
 * A fuel cell is a small bright circle. Painted a hue a chassis can wear, it
 * reads at a glance as a distant robot — and a player who drives at what they
 * think is a target, or ignores what they think is an opponent, has been
 * misled by the renderer rather than by the game.
 */

import { describe, expect, it } from "vitest";
import { PALETTE } from "../../src/lang/complete.js";
import { ART, hexToNumber } from "../../src/render/themes/index.js";
import { FUEL_BAR_COLOR } from "../../src/render/arena.js";

const THEMES = ["mechanical", "biological"] as const;

/** Rough perceptual distance; good enough to catch "these are the same blue". */
function distance(a: number, b: number): number {
  const ch = (c: number, shift: number) => (c >> shift) & 0xff;
  return Math.sqrt(
    (ch(a, 16) - ch(b, 16)) ** 2 + (ch(a, 8) - ch(b, 8)) ** 2 + (ch(a, 0) - ch(b, 0)) ** 2,
  );
}

/** The health bar's three states, from `drawRobots` in arena.ts. */
const HEALTH_STATES = [0x6ad98a, 0xffd166, 0xff6b6b];

describe("the tank gauge", () => {
  it("cannot be mistaken for any state of the health bar above it", () => {
    for (const state of HEALTH_STATES) {
      expect(distance(FUEL_BAR_COLOR, state)).toBeGreaterThan(80);
    }
  });
});

describe("fuel colour", () => {
  it("is never exactly a colour a robot can wear", () => {
    const robotColors = PALETTE.map((c) => hexToNumber(c.hex));
    for (const theme of THEMES) {
      expect(robotColors).not.toContain(ART[theme].fuelColor);
    }
  });

  it("is not merely close to one either", () => {
    for (const theme of THEMES) {
      for (const entry of PALETTE) {
        const gap = distance(ART[theme].fuelColor, hexToNumber(entry.hex));
        expect(gap, `${theme} fuel vs ${entry.name}`).toBeGreaterThan(60);
      }
    }
  });
});
