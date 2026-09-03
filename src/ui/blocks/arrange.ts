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
 * starts below the tallest block of the one above. The declarations are lifted
 * out into the top-left corner and the rows form a column to their right, with
 * the heading's own line kept for `on start` — occupied or not. Heights come from Blockly
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
  const bands = tidyBands(sketch);
  const layout: Layout = {};

  /*
   * The declarations sit in the corner and everything else forms a column
   * beside them: the heading is a title block, not the first of a list, and a
   * column that started under it would read as one.
   */
  const header = blocks.get("robot");
  const headerSize = header?.getHeightWidth() ?? { width: 0, height: 0 };
  if (header) layout["robot"] = { x: 0, y: 0 };

  const columnX = header ? headerSize.width + GAP_X : 0;

  /**
   * Lay one row out left to right, and say how tall it turned out.
   *
   * Blocks answering the same event go side by side: a handler and the
   * behaviours declared `given` it are one idea, and reading them as a row
   * says so.
   */
  const placeRow = (keys: readonly string[], y: number): number => {
    let x = columnX;
    let tallest = 0;
    for (const key of keys) {
      const block = blocks.get(key);
      if (!block) continue;
      layout[key] = { x, y };
      const size = block.getHeightWidth();
      x += size.width + GAP_X;
      tallest = Math.max(tallest, size.height);
    }
    return tallest;
  };

  /*
   * The line beside the heading belongs to `on start`, and stays its own
   * whether or not there is any.
   *
   * A {robot} with nothing to do at the start is worth noticing, and an empty
   * space where the starting work goes says it at a glance — where sliding the
   * next handler up into the gap would say nothing at all, and would put a
   * `sense robot` block exactly where a reader has learnt to find `start`.
   *
   * Nothing else reserves anything. Every other event is absent from most
   * {robotPlural} and a row held open for each would be a page of gaps.
   */
  const startBand = bands.find((band) => band.event === "start");
  const startHeight = startBand ? placeRow(startBand.keys, 0) : 0;

  let y = header ? Math.max(headerSize.height, startHeight) + GAP_Y : 0;

  for (const band of bands) {
    if (band === startBand) continue;
    const keys = band.keys.filter((key) => key !== "robot");
    if (keys.length === 0) continue;
    const tallest = placeRow(keys, y);
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
