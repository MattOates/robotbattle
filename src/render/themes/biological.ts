/**
 * Biological art pack: pond water on a slide, seen down a microscope.
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
  // Low: a hard square grid is the one thing back here that says "diagram", so
  // it stays as a faint sense of scale and no more.
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
   * Pond water on a slide, seen down a microscope.
   *
   * Not a drawing of a petri dish \u2014 no rim, no glassware, nothing with an edge.
   * You are looking THROUGH the instrument, so the frame is the field of view
   * and the field of view fills the screen. An earlier version drew the dish as
   * an actual oval and it read as a big ellipse sitting in a rectangle, which
   * is a picture of a dish rather than a look through a lens.
   *
   * What sells it instead is what is in the water and what the optics do to it:
   * murk that is thicker in some places than others, suspended detritus, and a
   * scatter of things drifting well outside the focal plane, which are the
   * softest and dimmest marks on the screen because that is exactly what being
   * out of focus looks like.
   */
  drawBackdrop(g: Graphics, width: number, height: number): void {
    // Murk. Broad, soft, irregular \u2014 pond water is never evenly lit.
    // Kept deliberately faint. Everything in this method is scenery, and the
    // goop drawn on top of it is not \u2014 thick goop is what slows you down and
    // empties your tank, so it has to be the most legible thing back here. A
    // livelier backdrop looked better on its own and made the ground harder to
    // read, which is the wrong trade.
    for (let i = 0; i < 10; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const r = 90 + Math.random() * 190;
      for (let k = 4; k >= 1; k--) {
        g.circle(x, y, (r * k) / 4).fill({
          color: lighten(0x0b1a1c, 0.2),
          alpha: 0.014,
        });
      }
    }

    // Out of the focal plane: bigger, dimmer and blurrier than anything sharp.
    // Drawn as rings ramping inward so they have no findable edge, which is the
    // whole cue that they are at a different depth from the fight.
    for (let i = 0; i < 22; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const r = 10 + Math.random() * 26;
      for (let k = 5; k >= 1; k--) {
        g.circle(x, y, (r * k) / 5).fill({ color: 0x2f7a5e, alpha: 0.022 });
      }
    }

    // Suspended detritus, in focus and tiny: the specks that tell you the water
    // is full of things too small to be anybody in this fight.
    for (let i = 0; i < 190; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const r = 0.6 + Math.random() * 1.8;
      g.circle(x, y, r).fill({
        color: Math.random() < 0.25 ? 0x9be7c4 : 0x2f6b6b,
        alpha: 0.12 + Math.random() * 0.3,
      });
    }
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
      { cell: 34, radius: 46, alpha: 0.26 },
      { cell: 21, radius: 26, alpha: 0.18 },
    ];

    for (const pass of PASSES) {
      let row = 0;
      for (let y = -pass.cell; y < height + pass.cell; y += pass.cell, row++) {
        const stagger = (row % 2) * (pass.cell / 2);
        for (let x = -pass.cell; x < width + pass.cell; x += pass.cell) {
          const px = x + stagger + (sample(x + 91, y) - 0.5) * pass.cell * 1.2;
          const py = y + (sample(x, y + 57) - 0.5) * pass.cell * 1.2;
          const h = sample(px, py);
          // Only the thick half pools. Thin goop is clear water, which is what
          // makes the thick patches worth avoiding.
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
