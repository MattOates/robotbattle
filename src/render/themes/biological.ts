/**
 * Biological art pack: a round glass dish of liquid, under a lens.
 *
 * Every shape here occupies the same hitbox circle as its mechanical
 * counterpart. A ciliate is a tank; it just looks like something you'd find
 * under a microscope.
 *
 * Where the mechanical pack reads the ground as measured elevation, this one
 * reads exactly the same numbers as fluid: thick and thin patches of goop with
 * no edges, no levels and no straight lines. Nothing suspended in a liquid has
 * a contour, so there are none \u2014 the two packs are meant to be different
 * places, not the same picture in two palettes.
 */

import type { Graphics } from "pixi.js";
import type { Locomotion } from "../../lang/ast.js";
import { THEMES } from "../../lang/vocab.js";
import { darken, lighten, type ArenaTheme } from "./types.js";

export const BIOLOGICAL: ArenaTheme = {
  vocab: THEMES.biological,

  background: 0x0b1a1c,
  gridColor: 0x16333a,
  gridAlpha: 0.4,
  gridSize: 60,
  wallColor: 0x2f6b6b,

  labelColor: 0xd8f3ea,
  labelStroke: 0x061012,

  senseConeColor: 0x9be7c4,
  senseConeAlpha: 0.07,

  bulletColor: 0xb8f26a,
  impactColor: 0xd9ff8a,
  explosionColor: 0x7fe3b0,
  // Nematocyst darts are long and needle-thin.
  bulletLength: 2.4,
  bulletWidth: 0.6,

  drawBody(g: Graphics, tint: number, locomotion: Locomotion, radius: number): void {
    const membrane = lighten(tint, 0.35);
    const cytoplasm = darken(tint, 0.25);

    if (locomotion === "skid") {
      // Ciliate: a rounded cell fringed with beating cilia. Rows of tiny hairs
      // are what let it pivot in place, the same as a tank's tracks.
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        g.moveTo(cx * radius * 0.9, cy * radius * 0.9)
          .lineTo(cx * radius * 1.25, cy * radius * 1.25)
          .stroke({ width: 1.4, color: membrane, alpha: 0.85 });
      }
      g.ellipse(0, 0, radius * 0.92, radius * 0.78).fill(tint);
      g.ellipse(0, 0, radius * 0.92, radius * 0.78).stroke({ width: 2, color: membrane });
      // Nucleus, offset forward so the cell has a readable front.
      g.ellipse(radius * 0.2, 0, radius * 0.3, radius * 0.26).fill(cytoplasm);
    } else {
      // Flagellate: a teardrop cell with one long whipping tail. It can only
      // steer while swimming, exactly like a car.
      g.moveTo(-radius * 0.8, 0);
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        g.lineTo(-radius * (0.8 + t * 1.1), Math.sin(t * Math.PI * 2.2) * radius * 0.34);
      }
      g.stroke({ width: 2, color: membrane, alpha: 0.9 });

      g.ellipse(radius * 0.05, 0, radius * 0.95, radius * 0.62).fill(tint);
      g.ellipse(radius * 0.05, 0, radius * 0.95, radius * 0.62).stroke({
        width: 2,
        color: membrane,
      });
      g.ellipse(radius * 0.35, 0, radius * 0.26, radius * 0.22).fill(cytoplasm);
    }

    // Leading-edge sheen, so heading stays readable.
    g.ellipse(radius * 0.66, 0, radius * 0.14, radius * 0.3).fill(lighten(tint, 0.55));
  },

  drawTurret(g: Graphics, tint: number, radius: number): void {
    // A nematocyst: a real stinging organelle that fires a harpoon, which is a
    // pleasingly honest biological equivalent of a gun barrel.
    g.circle(0, 0, radius * 0.44).fill(darken(tint, 0.2));
    g.circle(0, 0, radius * 0.3).fill(lighten(tint, 0.45));
    g.poly([
      radius * 0.2,
      -radius * 0.14,
      radius * 1.2,
      -radius * 0.05,
      radius * 1.2,
      radius * 0.05,
      radius * 0.2,
      radius * 0.14,
    ]).fill(lighten(tint, 0.15));
    // Barbed tip.
    g.poly([radius * 1.15, -radius * 0.16, radius * 1.35, 0, radius * 1.15, radius * 0.16]).fill(
      darken(tint, 0.35),
    );
  },

  /**
   * A pigment spot on a short stalk: the eyespot really is a patch of
   * light-sensitive pigment with a shading cup behind it, and it points the
   * same way this one does — which is the whole reason the biological wording
   * for a radar is not a stretch.
   */
  drawRadar(g: Graphics, tint: number, radius: number): void {
    const sheen = lighten(tint, 0.6);
    g.moveTo(0, 0)
      .lineTo(radius * 0.78, 0)
      .stroke({ width: 1.4, color: sheen, alpha: 0.85 });
    // The cup, open toward +x, and the pigment spot inside it.
    g.arc(radius * 0.82, 0, radius * 0.24, Math.PI * 0.55, Math.PI * 1.45).stroke({
      width: 2,
      color: darken(tint, 0.45),
    });
    g.circle(radius * 0.84, 0, radius * 0.13).fill(sheen);
  },

  pingColor: 0xd9ff8a,

  fuelColor: 0xc3e83a,

  /**
   * The dish itself: round glass with liquid in it, sitting on a dark stage.
   *
   * The arena stays rectangular \u2014 walls are walls and the simulation has not
   * changed \u2014 but the glass rim inset inside them, and the vignette outside
   * it, do the work of saying you are looking into a dish rather than across a
   * field.
   */
  drawBackdrop(g: Graphics, width: number, height: number): void {
    const cx = width / 2;
    const cy = height / 2;
    const rx = width * 0.52;
    const ry = height * 0.56;

    // Liquid, pooling toward the middle.
    for (let i = 7; i >= 1; i--) {
      const k = i / 7;
      g.ellipse(cx, cy, rx * k, ry * k).fill({
        color: lighten(0x0b1a1c, 0.14),
        alpha: 0.06,
      });
    }

    // The glass rim, and a meniscus catching the light along its upper left.
    g.ellipse(cx, cy, rx, ry).stroke({ width: 3, color: 0x2f6b6b, alpha: 0.55 });
    g.ellipse(cx, cy, rx * 0.985, ry * 0.985).stroke({
      width: 1.2,
      color: 0x8fd8cf,
      alpha: 0.28,
    });
    g.arc(cx, cy, Math.min(rx, ry) * 0.99, Math.PI * 1.06, Math.PI * 1.42).stroke({
      width: 2.5,
      color: 0xd8f3ea,
      alpha: 0.16,
    });
  },

  /**
   * Goop: the same field as the hills next door, read as viscosity.
   *
   * Three passes at different offsets and scales rather than one grid of
   * squares. Overlapping soft blobs have no edge you can point at, which is
   * the entire difference between "thick fluid" and "a shaded map".
   */
  drawTerrain(
    g: Graphics,
    sample: (x: number, y: number) => number,
    width: number,
    height: number,
  ): void {
    const goop = 0x2f7a5e;
    const PASSES = [
      { cell: 34, radius: 30, alpha: 0.3, ox: 0, oy: 0 },
      { cell: 26, radius: 20, alpha: 0.24, ox: 13, oy: 9 },
      { cell: 20, radius: 12, alpha: 0.2, ox: 7, oy: 15 },
    ];

    for (const pass of PASSES) {
      for (let x = -pass.cell; x < width + pass.cell; x += pass.cell) {
        for (let y = -pass.cell; y < height + pass.cell; y += pass.cell) {
          const px = x + pass.ox;
          const py = y + pass.oy;
          const h = sample(px, py);
          // Only the thick half pools. Thin goop is simply the dish showing
          // through, which is what makes the thick patches worth avoiding.
          if (h <= 0.5) continue;
          const t = (h - 0.5) * 2;
          g.circle(px, py, pass.radius * (0.45 + t * 0.55)).fill({
            color: goop,
            alpha: pass.alpha * t * t,
          });
        }
      }
    }

    // A faint bright caustic on the steepest gradients, where a lens would
    // pick up the change in thickness.
    for (let x = 0; x < width; x += 16) {
      for (let y = 0; y < height; y += 16) {
        const d = Math.abs(sample(x + 16, y) - sample(x, y)) + Math.abs(sample(x, y + 16) - sample(x, y));
        if (d < 0.035) continue;
        g.circle(x, y, 3).fill({ color: 0x9be7c4, alpha: Math.min(0.22, d * 2.2) });
      }
    }
  },

  /**
   * A bow wave: goop piled up in front of something shoving through it.
   *
   * Attached to the organism and travelling with it, unlike the mechanical
   * pack's dust, because displaced fluid stays in front of whatever is
   * displacing it. Drawn in the body's frame, so +x is the nose.
   */
  drawStrain(g: Graphics, effort: number, speed: number, radius: number): void {
    const dir = speed < 0 ? -1 : 1;
    const push = radius * (0.15 + effort * 0.5) * dir;
    // The crest, bulging ahead of the nose and thinning along the flanks.
    g.ellipse(push, 0, radius * (0.95 + effort * 0.3), radius * (1.05 + effort * 0.15)).fill({
      color: 0x9be7c4,
      alpha: 0.1 + effort * 0.16,
    });
    g.ellipse(push * 1.35, 0, radius * 0.72, radius * 0.82).fill({
      color: 0xd8f3ea,
      alpha: 0.06 + effort * 0.12,
    });
    // The slack water closing in behind.
    g.ellipse(-push * 0.9, 0, radius * 0.8, radius * 0.6).fill({
      color: 0x0b1a1c,
      alpha: 0.12 + effort * 0.1,
    });
  },

  drawFuel(g: Graphics, radius: number): void {
    // A morsel: a soft blob with a lighter nucleus, deliberately rounder and
    // less regular than the mechanical canister.
    const flesh = 0xc3e83a;
    g.circle(0, 0, radius).fill({ color: darken(flesh, 0.4), alpha: 0.9 });
    g.circle(0, 0, radius * 0.7).fill({ color: flesh, alpha: 0.95 });
    g.circle(-radius * 0.22, -radius * 0.22, radius * 0.24).fill({
      color: lighten(flesh, 0.5),
      alpha: 0.9,
    });
  },
};
