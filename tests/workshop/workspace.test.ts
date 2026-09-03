import { describe, expect, it } from "vitest";
import * as Blockly from "blockly/core";
import { fromSource, toSource } from "../../src/workshop/compose.js";
import { sketchToWorkspace, workspaceToSketch, type WorkspaceJson } from "../../src/ui/blocks/bridge.js";
import { defineBlocks } from "../../src/ui/blocks/defs.js";
import { SAMPLE_BOTS, TOUR_ROBOT } from "../../src/bots/index.js";
import { compile } from "../../src/lang/compiler.js";
import { parse } from "../../src/lang/parser.js";

/**
 * The round trip through a *real* Blockly workspace.
 *
 * Everything else tests `sketchToWorkspace` against `workspaceToSketch`
 * directly — JSON in, JSON out — and every one of those passed while the
 * editor was quietly losing work. Blockly discards a block's `extraState`
 * unless the block defines `saveExtraState`, and `extraState` is where all the
 * verbatim carrying lives: the line as it was written, the values it went in
 * with, the `else` and `end` as they were spelt, a comment's own lines. So the
 * guarantee held between two functions of mine and nowhere near the thing
 * people use.
 *
 * This is the test that would have caught it, and it is the one that matters:
 * it loads into a workspace Blockly built and reads back what Blockly saved.
 */

defineBlocks("mechanical", "full");

function throughWorkspace(source: string): string {
  const ws = new Blockly.Workspace();
  try {
    const before = fromSource(source);
    Blockly.serialization.workspaces.load(sketchToWorkspace(before) as object, ws);
    const saved = Blockly.serialization.workspaces.save(ws) as WorkspaceJson;
    // The declarations' own lines are not blocks; they ride alongside, exactly
    // as `BlockEditor` carries them.
    saved.rb = { head: before.head, tail: before.tail };
    return toSource(workspaceToSketch(saved));
  } finally {
    ws.dispose();
  }
}

const HOUSE = [
  ...SAMPLE_BOTS.map((b) => ({ id: b.id, source: b.source })),
  { id: "tour-robot", source: TOUR_ROBOT },
];

describe("through a real workspace", () => {
  it("keeps every robot in the game character for character", () => {
    for (const { id, source } of HOUSE) {
      expect(throughWorkspace(source), id).toBe(source);
    }
  });

  it("compiles to identical bytecode", () => {
    for (const { id, source } of HOUSE) {
      const before = compile(parse(source));
      const after = compile(parse(throughWorkspace(source)));
      expect(JSON.stringify(after), id).toBe(JSON.stringify(before));
    }
  });

  it("keeps the declarations at the left margin", () => {
    // The first thing that broke: `extraState` was dropped, so every line was
    // regenerated at the default indent and `name "X"` came back as
    // `  name "X"`. Legal, and not what anybody wrote.
    const src = 'name "X"\nchassis tank\ncolor #ff8800\nvar seen = 0\n\non start\n  stop\nend';
    expect(throughWorkspace(src)).toBe(src);
  });

  it("keeps comments, blank lines and odd indentation", () => {
    const src = [
      "-- about this robot",
      'name "Odd"',
      "chassis tank",
      "",
      "on start",
      "      drive forward 60",
      "",
      "  -- a note in the middle",
      "  stop",
      "end",
    ].join("\n");
    expect(throughWorkspace(src)).toBe(src);
  });

  it("keeps an `else` and an `end` as they were written", () => {
    const src =
      'name "N"\nchassis tank\n\non sense robot\n  if event.distance < 100 then\n    fire 3\n  else\n    fire 1\n  end\nend';
    expect(throughWorkspace(src)).toBe(src);
  });

  it("keeps a `can` header's parameters and cadence", () => {
    const src = 'name "R"\nchassis tank\n\ncan scan given tick every 30\n  ping\nend';
    expect(throughWorkspace(src)).toBe(src);
  });

  it("keeps a call's arguments", () => {
    const src =
      'name "R"\nchassis tank\n\ncan fold with a, b, c\n  stop\nend\n\non start\n  do fold with mx, my, number(field(event.data, 5))\nend';
    expect(throughWorkspace(src)).toBe(src);
  });
});
