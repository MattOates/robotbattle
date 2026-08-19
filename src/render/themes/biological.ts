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
  // Low: a square grid across a round dish is the one thing that says
  // "rectangle" here, so it stays as a faint sense of scale and no more.
  gridAlpha: 0.16,
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
   * changed \u2014 but the glass rim inset inside them, and the darkness banked up
   * outside it, do the work of saying you are looking into a dish rather than
   * across a field.
   */
  drawBackdrop(g: Graphics, width: number, height: number): void {
    const cx = width / 2;
    const cy = height / 2;
    // Inside the walls, not across them. An ellipse wider than the arena reads
    // as a stray curve rather than as the edge of anything.
    const rx = width * 0.47;
    const ry = height * 0.47;

    // Outside the glass, banked up as widening rings rather than as one shape,
    // because the corners of a rectangle cannot be subtracted from an ellipse
    // with a Graphics path and this reads as the same thing.
    for (let i = 1; i <= 14; i++) {
      g.ellipse(cx, cy, rx + i * 7, ry + i * 7).stroke({
        width: 9,
        color: 0x000000,
        alpha: 0.1,
      });
    }

    // Liquid, pooling toward the middle.
    for (let i = 8; i >= 1; i--) {
      const k = i / 8;
      g.ellipse(cx, cy, rx * k, ry * k).fill({
        color: lighten(0x0b1a1c, 0.16),
        alpha: 0.05,
      });
    }

    // The glass rim, and a meniscus inside it. Full ellipses, not arcs: an arc
    // has to be swept on the ellipse itself to follow the rim, and one swept on
    // a circle just cuts a chord across the dish.
    g.ellipse(cx, cy, rx, ry).stroke({ width: 4, color: 0x2f6b6b, alpha: 0.5 });
    g.ellipse(cx, cy, rx - 5, ry - 5).stroke({ width: 1.5, color: 0x8fd8cf, alpha: 0.22 });
    g.ellipse(cx, cy, rx - 12, ry - 12).stroke({ width: 8, color: 0x8fd8cf, alpha: 0.045 });
  },

  /**
   * Goop: the same field as the hills next door, read as viscosity.
   *
   * Two traps here, and both had to be seen on screen to be believed. The first
   * is the lattice \u2014 sample a regular grid, draw one mark per cell, and the eye
   * finds rows of dots, which is the one thing a fluid must not look like. So
   * blobs are nudged off the grid by the shape of the ground nearby (which is
   * smooth, so neighbours drift together rather than scattering) and alternate
   * rows are offset by half a cell.
   *
   * The second is the hard edge. A flat-filled circle stays a findable circle
   * however low its alpha, and a field of them reads as bubbles. So each blob
   * is drawn as concentric rings with the alpha ramping toward the middle,
   * which is a radial falloff by hand \u2014 the cheapest soft edge available to a
   * Graphics that only knows flat fills.
   */
  drawTerrain(
    g: Graphics,
    sample: (x: number, y: number) => number,
    width: number,
    height: number,
  ): void {
    const goop = 0x2f7a5e;
    const RINGS = 5;
    const PASSES = [
      { cell: 34, radius: 46, alpha: 0.2 },
      { cell: 21, radius: 26, alpha: 0.14 },
    ];

    for (const pass of PASSES) {
      let row = 0;
      for (let y = -pass.cell; y < height + pass.cell; y += pass.cell, row++) {
        const stagger = (row % 2) * (pass.cell / 2);
        for (let x = -pass.cell; x < width + pass.cell; x += pass.cell) {
          const px = x + stagger + (sample(x + 91, y) - 0.5) * pass.cell * 1.2;
          const py = y + (sample(x, y + 57) - 0.5) * pass.cell * 1.2;
          const h = sample(px, py);
          // Only the thick half pools. Thin goop is the dish showing through,
          // which is what makes the thick patches worth avoiding.
          if (h <= 0.45) continue;
          const t = (h - 0.45) / 0.55;
          const r = pass.radius * (0.5 + t * 0.5);
          for (let i = RINGS; i >= 1; i--) {
            g.circle(px, py, (r * i) / RINGS).fill({
              color: goop,
              alpha: pass.alpha * t * t,
            });
          }
        }
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
