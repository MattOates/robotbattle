/**
 * Putting the blocks where they go.
 *
 * The banding — which block belongs in which row, and in what order — is
 * decided in `workshop/layout.ts`, which is pure and knows nothing about
 * Blockly. What is left here is the half that needs a real workspace: how tall
 * a row actually is, which only the rendered blocks can say.
 *
 * That split is deliberate. The part worth testing is the arrangement, because
 * that is what makes two people's changes comparable; the part that needs
 * measuring is arithmetic over numbers Blockly hands us.
 */

import * as Blockly from "blockly/core";
import type { Sketch } from "../../workshop/compose.js";
import { layoutKey, tidyBands, type Layout } from "../../workshop/layout.js";
import { CAN_BLOCK, ROBOT_BLOCK, WHEN_BLOCK } from "./bridge.js";

/** Room between blocks in a row, and between rows. */
const GAP_X = 40;
const GAP_Y = 48;

/** Every top-level block, by the stable key its script gives it. */
export function topBlocks(ws: Blockly.Workspace, sketch: Sketch): Map<string, Blockly.Block> {
  const hats = ws
    .getTopBlocks(false)
    .filter((b) => b.type === ROBOT_BLOCK || b.type === WHEN_BLOCK || b.type === CAN_BLOCK);

  /*
   * Matched by position, which is safe here and nowhere else: the workspace
   * was just built from this sketch by `sketchToWorkspace`, in order, so the
   * nth hat is the nth block. Anything read off the *blocks* — an event
   * dropdown, a name field — would be the same information one step further
   * from its source and one more chance to disagree with it.
   */
  const keyed = new Map<string, Blockly.Block>();
  const blocks = sketch.blocks;
  hats.forEach((hat, i) => {
    const key = blocks[i] ? layoutKey(blocks[i]!) : null;
    if (key) keyed.set(key, hat);
  });
  return keyed;
}

/** Where each block currently sits, for remembering. */
export function readLayout(ws: Blockly.Workspace, sketch: Sketch): Layout {
  const out: Layout = {};
  for (const [key, block] of topBlocks(ws, sketch)) {
    const at = block.getRelativeToSurfaceXY();
    out[key] = { x: Math.round(at.x), y: Math.round(at.y) };
  }
  return out;
}

/** Put the blocks back where they were left. */
export function applyLayout(ws: Blockly.Workspace, sketch: Sketch, layout: Layout): void {
  for (const [key, block] of topBlocks(ws, sketch)) {
    const spot = layout[key];
    if (!spot) continue;
    const at = block.getRelativeToSurfaceXY();
    block.moveBy(spot.x - at.x, spot.y - at.y);
  }
}

/**
 * The canonical arrangement, measured.
 *
 * Rows from `tidyBands`; within a row, blocks laid left to right; each row
 * starts below the tallest block of the one above. Heights come from Blockly
 * because a hat with nine statements in it is not the same height as an empty
 * one, and a layout computed from guesses would overlap exactly where a robot
 * is most worth reading.
 *
 * This is the one function here that needs a *rendered* workspace: only a
 * `BlockSvg` has been measured. Reading and applying positions do not, which
 * is why they can be tested headlessly and this cannot.
 */
export function tidy(ws: Blockly.WorkspaceSvg, sketch: Sketch): Layout {
  const blocks = topBlocks(ws, sketch) as Map<string, Blockly.BlockSvg>;
  const layout: Layout = {};
  let y = 0;

  for (const band of tidyBands(sketch)) {
    let x = 0;
    let tallest = 0;
    for (const key of band.keys) {
      const block = blocks.get(key);
      if (!block) continue;
      layout[key] = { x, y };
      const size = block.getHeightWidth();
      x += size.width + GAP_X;
      tallest = Math.max(tallest, size.height);
    }
    // A row that placed nothing must not push the next one down.
    if (tallest > 0) y += tallest + GAP_Y;
  }

  applyLayout(ws, sketch, layout);
  return layout;
}

/** A little air between the title bar and the corner. */
const MARGIN = 16;

/**
 * Put the {robot}'s own block at the top left of what can be seen.
 *
 * Not `scrollCenter`, which centres the *bounding box of everything* — with a
 * tall script that puts the middle of the canvas on screen and the heading
 * somewhere above it, so the first thing you look at is a handler and the
 * thing that says what this {robot} is has to be hunted for. A page starts at
 * its title.
 *
 * It follows the block rather than the origin, so it still works for somebody
 * who has dragged their heading somewhere else: what is anchored is the
 * heading, not the coordinate it usually has.
 */
export function focusHeader(ws: Blockly.WorkspaceSvg, sketch: Sketch): void {
  const header = topBlocks(ws, sketch).get("robot");
  if (!header) return;
  const at = header.getRelativeToSurfaceXY();
  const scale = ws.getScale();
  ws.scroll(MARGIN - at.x * scale, MARGIN - at.y * scale);
}
