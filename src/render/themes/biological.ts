/**
 * Biological art pack: a pond-water microcosm, membranes, cilia and flagella.
 *
 * Every shape here occupies the same hitbox circle as its mechanical
 * counterpart. A ciliate is a tank; it just looks like something you'd find
 * under a microscope.
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

  fuelColor: 0x9ae66e,

  drawFuel(g: Graphics, radius: number): void {
    // A morsel: a soft blob with a lighter nucleus, deliberately rounder and
    // less regular than the mechanical canister.
    const flesh = 0x9ae66e;
    g.circle(0, 0, radius).fill({ color: darken(flesh, 0.4), alpha: 0.9 });
    g.circle(0, 0, radius * 0.7).fill({ color: flesh, alpha: 0.95 });
    g.circle(-radius * 0.22, -radius * 0.22, radius * 0.24).fill({
      color: lighten(flesh, 0.5),
      alpha: 0.9,
    });
  },
};
