/**
 * Mechanical art pack: a workshop floor, armoured hulls, tracks and wheels.
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
