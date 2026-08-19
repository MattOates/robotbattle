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

  /** Fuel cell colour, also used for the pickup flash and the tank gauge. */
  fuelColor: number;

  /**
   * Draw one fuel cell, centred on (0,0).
   *
   * Cells do not rotate and are not aimed at anything, so unlike the body and
   * the turret there is no facing to respect — only a radius to fill.
   */
  drawFuel(g: Graphics, radius: number): void;

  /** Optional decorative backdrop drawn once behind the grid. */
  drawBackdrop?(g: Graphics, width: number, height: number): void;
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
