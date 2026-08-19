/**
 * An art pack. Purely presentational — a theme cannot see or touch simulation
 * state, it is only handed the numbers needed to draw.
 */

import type { Graphics } from "pixi.js";
import type { Locomotion } from "../../lang/ast.js";
import type { ThemeVocab } from "../../lang/vocab.js";

export interface ArenaTheme {
  vocab: ThemeVocab;

  /** Arena background and furniture. */
  background: number;
  gridColor: number;
  gridAlpha: number;
  wallColor: number;
  /** Grid spacing in pixels; 0 disables the grid. */
  gridSize: number;

  /** Text colours for the label under each robot. */
  labelColor: number;
  labelStroke: number;

  senseConeColor: number;
  senseConeAlpha: number;

  bulletColor: number;
  impactColor: number;
  explosionColor: number;
  /** Bullet shape: multipliers on its base radius along and across its travel. */
  bulletLength: number;
  bulletWidth: number;

  /** Draw the chassis, centred on (0,0) and facing +x. */
  drawBody(g: Graphics, tint: number, locomotion: Locomotion, radius: number): void;

  /** Draw the turret, centred on (0,0) and facing +x. Identical for both chassis. */
  drawTurret(g: Graphics, tint: number, radius: number): void;

  /**
   * Draw the radar, centred on (0,0) and facing +x.
   *
   * Small and distinct from the turret: a player has to be able to tell at a
   * glance which of the two is pointing at them, because only one of them
   * shoots.
   */
  drawRadar(g: Graphics, tint: number, radius: number): void;

  /** Colour of the ping beam this theme draws. */
  pingColor: number;

  /**
   * Fuel cell colour, also used for the pickup flash and the tank gauge.
   *
   * Must not be a colour a robot can wear — see PALETTE in `lang/complete.ts`.
   * A cell sharing a hue with a chassis reads as a distant robot, which is the
   * one misreading that actually costs a player something.
   */
  fuelColor: number;

  /**
   * Draw one fuel cell, centred on (0,0).
   *
   * Cells do not rotate and are not aimed at anything, so unlike the body and
   * the turret there is no facing to respect — only a radius to fill.
   */
  drawFuel(g: Graphics, radius: number): void;

  /** Optional decorative backdrop drawn once, beneath everything else. */
  drawBackdrop?(g: Graphics, width: number, height: number): void;

  /**
   * Draw the shape of the ground, once per match.
   *
   * `sample` returns the height at a point, 0 (easiest going) to 1 (worst).
   * It is the same number for both art packs and they are expected to disagree
   * about it completely: one reads it as elevation and draws contoured
   * hillside, the other as viscosity and draws pooled fluid. Nothing about the
   * gameplay changes between them, so the drawing is free to.
   *
   * A sampler rather than a baked grid, because the right resolution is a
   * question about the art, not about the field.
   */
  drawTerrain?(
    g: Graphics,
    sample: (x: number, y: number) => number,
    width: number,
    height: number,
  ): void;

  /**
   * Draw what it looks like to fight the ground, in the robot's own frame:
   * +x is forward, (0,0) is the middle of the chassis.
   *
   * `climb` is -1 (straight down the steepest slope) to +1 (straight up it),
   * `speed` is -1..1 of top speed. Called every frame for every live robot, so
   * a theme that has nothing to say should return without drawing.
   */
  drawStrain?(g: Graphics, effort: number, speed: number, radius: number): void;

  /**
   * Draw one shed particle, in WORLD coordinates, left behind by a robot
   * working against the ground. `t` is 0 when new and 1 when it is about to
   * expire; `effort` is how hard the robot was pushing when it shed this.
   *
   * Separate from `drawStrain` because the two behave differently in the world:
   * a bow wave belongs to the thing pushing it and travels with it, while dust
   * hangs where it was thrown and is left behind.
   */
  drawWake?(
    g: Graphics,
    x: number,
    y: number,
    heading: number,
    t: number,
    effort: number,
  ): void;
}

/** `#ff8800` -> 0xff8800. Falls back to a neutral grey. */
export function hexToNumber(hex: string): number {
  const parsed = Number.parseInt(hex.replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : 0x8a8f98;
}

/** Blend toward black by `amount` (0..1). Used for shading. */
export function darken(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const f = 1 - amount;
  return (
    ((Math.round(r * f) & 0xff) << 16) |
    ((Math.round(g * f) & 0xff) << 8) |
    (Math.round(b * f) & 0xff)
  );
}

/** Blend toward white by `amount` (0..1). */
export function lighten(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const mix = (c: number) => Math.round(c + (255 - c) * amount) & 0xff;
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}
