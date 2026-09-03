/**
 * A real Blockly workspace, for tests that mean to check the integration.
 *
 * The block suites used to run `sketchToWorkspace` straight into
 * `workspaceToSketch` — my JSON in, my JSON out — and pass while the editor
 * lost work on every save. Blockly discards `extraState` unless a block says
 * how to keep it, and no test that never constructs a workspace can notice.
 * A test like that checks my arithmetic, not my integration.
 *
 * So everything here goes through the library: blocks are registered with
 * Blockly, loaded by `Blockly.serialization`, read back through the block API,
 * and saved by Blockly rather than by us. If Blockly changes what it keeps,
 * these fail — which is the entire reason to write them.
 */

import * as Blockly from "blockly/core";
import { fromSource, toSource, type Sketch } from "../../../src/workshop/compose.js";
import {
  sketchToWorkspace,
  workspaceToSketch,
  type WorkspaceJson,
} from "../../../src/ui/blocks/bridge.js";
import { defineBlocks } from "../../../src/ui/blocks/defs.js";

/** Registered once, as the editor does. Blockly throws on a duplicate. */
defineBlocks("mechanical", "full");

/** Load a script into a workspace Blockly built. */
export function loadWorkspace(source: string): {
  ws: Blockly.Workspace;
  sketch: Sketch;
} {
  const ws = new Blockly.Workspace();
  const sketch = fromSource(source);
  Blockly.serialization.workspaces.load(sketchToWorkspace(sketch) as object, ws);
  return { ws, sketch };
}

/**
 * What Blockly saved, plus the declarations' own lines.
 *
 * `BlockEditor` carries the head alongside for the same reason: it is not
 * blocks, so Blockly has nothing to say about it.
 */
export function saveWorkspace(ws: Blockly.Workspace, sketch: Sketch): WorkspaceJson {
  const saved = Blockly.serialization.workspaces.save(ws) as WorkspaceJson;
  saved.rb = { head: sketch.head, tail: sketch.tail };
  return saved;
}

/** Script in, script out, through everything the editor uses. */
export function roundTrip(source: string): string {
  const { ws, sketch } = loadWorkspace(source);
  try {
    return toSource(workspaceToSketch(saveWorkspace(ws, sketch)));
  } finally {
    ws.dispose();
  }
}

/**
 * Run something against a live workspace and then read the script back.
 *
 * The edit is made through Blockly's own block API — `setFieldValue`,
 * `getInputTargetBlock`, `dispose` — which is what the editor does when
 * somebody drags or types. Reaching into the JSON instead would be back to
 * testing my own serialisation against itself.
 */
export function edit(source: string, change: (ws: Blockly.Workspace) => void): string {
  const { ws, sketch } = loadWorkspace(source);
  try {
    change(ws);
    return toSource(workspaceToSketch(saveWorkspace(ws, sketch)));
  } finally {
    ws.dispose();
  }
}

/** Every block of a type, in the order Blockly holds them. */
export function blocksOfType(ws: Blockly.Workspace, type: string): Blockly.Block[] {
  return ws.getBlocksByType(type, true);
}

/** The one block of a type, when there should be exactly one. */
export function onlyBlock(ws: Blockly.Workspace, type: string): Blockly.Block {
  const found = blocksOfType(ws, type);
  if (found.length !== 1) {
    throw new Error(`expected one ${type}, found ${found.length}`);
  }
  return found[0]!;
}

/** The statements inside a statement input, as Blockly chains them. */
export function statementsIn(block: Blockly.Block, input: string): Blockly.Block[] {
  const out: Blockly.Block[] = [];
  let at = block.getInputTargetBlock(input);
  while (at) {
    out.push(at);
    at = at.getNextBlock();
  }
  return out;
}
