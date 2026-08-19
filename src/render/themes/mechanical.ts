/**
 * Mechanical art pack: machines fighting outdoors, on a surveyed plot of a much
 * bigger place.
 *
 * The reading here is scale and distance. Ground is shaded by elevation and
 * carries contour lines, because a contour map is the one drawing that says
 * "this is real terrain, seen from above, and somebody measured it". The
 * contours are honest gameplay information too: lines packed close together
 * are ground that will cost you.
 */

import type { Graphics } from "pixi.js";
import type { Locomotion } from "../../lang/ast.js";
import { THEMES } from "../../lang/vocab.js";
import { darken, lighten, type ArenaTheme } from "./types.js";

export const MECHANICAL: ArenaTheme = {
  vocab: THEMES.mechanical,

  background: 0x14161c,
  gridColor: 0x2a2f3a,
  gridAlpha: 0.55,
  gridSize: 40,
  wallColor: 0x4a515f,

  labelColor: 0xdfe4ec,
  labelStroke: 0x0b0d11,

  senseConeColor: 0x7fd1e0,
  senseConeAlpha: 0.07,

  bulletColor: 0xffd166,
  impactColor: 0xffa94d,
  explosionColor: 0xff6b3d,
  // Shells read as compact and heavy.
  bulletLength: 1.4,
  bulletWidth: 1.0,

  drawBody(g: Graphics, tint: number, locomotion: Locomotion, radius: number): void {
    const hull = radius * 0.82;
    const shadow = darken(tint, 0.45);

    if (locomotion === "skid") {
      // Tracks down each side, drawn outside the hull so the two locomotion
      // types read differently at a glance even though the hitbox is the same.
      g.rect(-radius * 0.95, -radius, radius * 1.9, radius * 0.42).fill(shadow);
      g.rect(-radius * 0.95, radius * 0.58, radius * 1.9, radius * 0.42).fill(shadow);
      // Track cleats.
      for (let i = -3; i <= 3; i++) {
        const x = i * radius * 0.26;
        g.rect(x, -radius, radius * 0.07, radius * 0.42).fill(darken(tint, 0.7));
        g.rect(x, radius * 0.58, radius * 0.07, radius * 0.42).fill(darken(tint, 0.7));
      }
      g.roundRect(-hull, -radius * 0.6, hull * 2, radius * 1.2, 3).fill(tint);
    } else {
      // Four wheels, with the front pair inset to suggest steering geometry.
      const wheel = (x: number, y: number) =>
        g
          .roundRect(x - radius * 0.2, y - radius * 0.12, radius * 0.4, radius * 0.24, 2)
          .fill(shadow);
      wheel(-radius * 0.55, -radius * 0.78);
      wheel(-radius * 0.55, radius * 0.78);
      wheel(radius * 0.62, -radius * 0.72);
      wheel(radius * 0.62, radius * 0.72);
      // Wedge-shaped hull: the point marks the front, which matters because a
      // car can only go where its nose is pointing.
      g.poly([
        radius * 0.95,
        0,
        radius * 0.35,
        -radius * 0.66,
        -radius * 0.85,
        -radius * 0.52,
        -radius * 0.85,
        radius * 0.52,
        radius * 0.35,
        radius * 0.66,
      ]).fill(tint);
    }

    // A highlight along the front edge so heading is readable at small sizes.
    g.rect(radius * 0.55, -radius * 0.28, radius * 0.16, radius * 0.56).fill(lighten(tint, 0.5));
  },

  drawTurret(g: Graphics, tint: number, radius: number): void {
    g.circle(0, 0, radius * 0.46).fill(darken(tint, 0.25));
    g.circle(0, 0, radius * 0.3).fill(lighten(tint, 0.2));
    // Barrel, pointing along +x.
    g.rect(radius * 0.2, -radius * 0.13, radius * 1.05, radius * 0.26).fill(darken(tint, 0.4));
    g.rect(radius * 1.05, -radius * 0.17, radius * 0.18, radius * 0.34).fill(darken(tint, 0.6));
  },

  /**
   * A dish on a short mast. Deliberately unlike the barrel: thin, open, and
   * pale, so that "which of those two is pointing at me" is answerable at a
   * glance from across the arena.
   */
  drawRadar(g: Graphics, tint: number, radius: number): void {
    const metal = lighten(tint, 0.55);
    // Mast, from the hub out to the dish.
    g.rect(0, -radius * 0.05, radius * 0.72, radius * 0.1).fill(darken(tint, 0.5));
    // Dish: an open arc facing +x, drawn as two struts and a curved face.
    g.moveTo(radius * 0.62, -radius * 0.34)
      .lineTo(radius * 0.9, -radius * 0.18)
      .lineTo(radius * 0.9, radius * 0.18)
      .lineTo(radius * 0.62, radius * 0.34)
      .stroke({ width: 1.6, color: metal, alpha: 0.95 });
    g.circle(radius * 0.86, 0, radius * 0.08).fill(metal);
  },

  pingColor: 0x9fe8ff,

  fuelColor: 0x2fe0c8,

  /**
   * Open ground, and a sense of it continuing past the walls.
   *
   * Only two things: a soft pool of light toward the middle so the arena is
   * not uniformly flat, and survey ticks near the corners. The grid drawn on
   * top does most of the work of suggesting a measured, mapped place.
   */
  drawBackdrop(g: Graphics, width: number, height: number): void {
    const base = 0x14161c;
    for (let i = 6; i >= 1; i--) {
      const k = i / 6;
      g.ellipse(width / 2, height / 2, width * 0.62 * k, height * 0.66 * k).fill({
        color: lighten(base, 0.1),
        alpha: 0.05,
      });
    }
    // Survey ticks: short marks stepping in from each corner. Purely scenic,
    // and deliberately sparse \u2014 the point is a hint of a surveyed plot, not
    // furniture for a robot to be confused by.
    const tick = 9;
    for (const [cx, sx] of [
      [0, 1],
      [width, -1],
    ] as const) {
      for (const [cy, sy] of [
        [0, 1],
        [height, -1],
      ] as const) {
        for (let i = 1; i <= 3; i++) {
          const d = 26 * i;
          g.moveTo(cx + sx * d, cy).lineTo(cx + sx * d, cy + sy * tick);
          g.moveTo(cx, cy + sy * d).lineTo(cx + sx * tick, cy + sy * d);
        }
      }
    }
    g.stroke({ width: 1, color: 0x4a515f, alpha: 0.5 });
  },

  /**
   * Hillside: elevation shading, then contour lines over the top.
   *
   * The shading runs from a cool low ground to a warmer high one, so height is
   * legible even for someone not reading the lines. The lines themselves are
   * found by walking a grid and stroking the cells a level passes through \u2014
   * chunky rather than smooth, which suits a map and costs a fraction of a
   * proper marching-squares trace.
   */
  drawTerrain(
    g: Graphics,
    sample: (x: number, y: number) => number,
    width: number,
    height: number,
  ): void {
    const CELL = 14;
    const low = 0x1b2430;
    const high = 0x6b5b43;

    for (let x = 0; x < width; x += CELL) {
      for (let y = 0; y < height; y += CELL) {
        const h = sample(x + CELL / 2, y + CELL / 2);
        // Bias toward the top of the range so low ground stays near the
        // background and hills are what draws the eye.
        const t = h * h;
        g.rect(x, y, CELL, CELL).fill({
          color: t > 0.5 ? high : low,
          alpha: t > 0.5 ? (t - 0.5) * 0.9 : (0.5 - t) * 0.35,
        });
      }
    }

    // Contours at fixed heights. Every cell whose corner values straddle a
    // level gets a mark, which reads as a line once they join up.
    const LEVELS = [0.35, 0.5, 0.65, 0.8];
    for (let li = 0; li < LEVELS.length; li++) {
      const level = LEVELS[li]!;
      for (let x = 0; x < width; x += CELL) {
        for (let y = 0; y < height; y += CELL) {
          const a = sample(x, y);
          const b = sample(x + CELL, y);
          const c = sample(x, y + CELL);
          if ((a < level) !== (b < level)) {
            g.moveTo(x + CELL / 2, y).lineTo(x + CELL / 2, y + CELL);
          }
          if ((a < level) !== (c < level)) {
            g.moveTo(x, y + CELL / 2).lineTo(x + CELL, y + CELL / 2);
          }
        }
      }
      // Every other line heavier, the way a real map picks out round heights.
      g.stroke({
        width: li % 2 === 1 ? 1.3 : 0.8,
        color: 0x8a7a5c,
        alpha: li % 2 === 1 ? 0.4 : 0.24,
      });
    }
  },

  /**
   * Dust thrown up by a machine dragging itself uphill.
   *
   * Hangs where it was thrown and is left behind, which is what makes a plume
   * read as a plume rather than as a decoration stuck to the robot.
   */
  drawWake(g: Graphics, x: number, y: number, _heading: number, t: number, effort: number): void {
    const fade = (1 - t) * (1 - t);
    g.circle(x, y, 2 + t * 9 * (0.5 + effort)).fill({
      color: 0x9a8b70,
      alpha: fade * 0.3 * effort,
    });
  },

  drawFuel(g: Graphics, radius: number): void {
    // A squat canister: a bright core in a darker casing, with a band across
    // it so it reads as machinery rather than as a stray bullet.
    const core = 0x2fe0c8;
    g.circle(0, 0, radius).fill({ color: darken(core, 0.55), alpha: 0.95 });
    g.circle(0, 0, radius * 0.62).fill(core);
    g.rect(-radius, -radius * 0.16, radius * 2, radius * 0.32).fill({
      color: lighten(core, 0.45),
      alpha: 0.8,
    });
  },
};
