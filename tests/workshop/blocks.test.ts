import { describe, expect, it } from "vitest";
import * as Blockly from "blockly/core";
import {
  CAN_BLOCK,
  COMMENT_BLOCK,
  COMPARE_BLOCK,
  EXPR_BLOCK,
  NUM_BLOCK,
  PROP_BLOCK,
  ROBOT_BLOCK,
  VAR_BLOCK,
  WHEN_BLOCK,
  blockToCondition,
  blockTypeFor,
  specIdFor,
  valueBlock,
} from "../../src/ui/blocks/bridge.js";
import { CARDS } from "../../src/workshop/compose.js";
import { SAMPLE_BOTS, TOUR_ROBOT, TOUR_SEED } from "../../src/bots/index.js";
import { compile } from "../../src/lang/compiler.js";
import { parse } from "../../src/lang/parser.js";
import { translate } from "../../src/learn/translate.js";
import {
  blocksOfType,
  edit,
  loadWorkspace,
  onlyBlock,
  roundTrip,
  statementsIn,
} from "./helpers/workspace.js";

const ALL = [
  ...SAMPLE_BOTS.map((b) => ({ id: b.id, source: b.source })),
  { id: "tour-seed", source: TOUR_SEED },
  { id: "tour-robot", source: TOUR_ROBOT },
];

/**
 * The property everything else rests on, checked where it matters.
 *
 * These assertions used to run my serialiser straight into my deserialiser and
 * never build a workspace at all, so they passed while Blockly was throwing
 * away every block's `extraState` — which is where the verbatim carrying
 * lives — and the editor silently reformatted anything it touched. Everything
 * below now loads into a workspace Blockly built and reads back what Blockly
 * saved.
 */
describe("a script through a real workspace", () => {
  it("comes back exactly, for every robot in the game", () => {
    for (const { id, source } of ALL) {
      expect(roundTrip(source), id).toBe(source);
    }
  });

  it("comes back exactly in both vocabularies", () => {
    for (const { id, source } of ALL) {
      for (const theme of ["mechanical", "biological"] as const) {
        const themed = translate(source, theme);
        expect(roundTrip(themed), `${id} in ${theme}`).toBe(themed);
      }
    }
  });

  it("compiles to identical bytecode", () => {
    for (const { id, source } of ALL) {
      const before = compile(parse(source));
      const after = compile(parse(roundTrip(source)));
      expect(JSON.stringify(after), id).toBe(JSON.stringify(before));
    }
  });

  it("survives a half-typed script", () => {
    const half = 'name "Half"\nchassis tank\n\non start\n  drive forward 60';
    expect(roundTrip(half)).toBe(half);
  });
});

describe("what Blockly is actually given", () => {
  it("builds a hat per handler and one for the declarations", () => {
    const { ws } = loadWorkspace(TOUR_ROBOT);
    expect(blocksOfType(ws, ROBOT_BLOCK)).toHaveLength(1);
    expect(blocksOfType(ws, WHEN_BLOCK).length).toBeGreaterThan(0);
    ws.dispose();
  });

  it("puts the statements inside the hat, in order", () => {
    const { ws } = loadWorkspace(
      'name "S"\nchassis tank\n\non start\n  turret.sweep 45\n  drive forward 60\nend',
    );
    const hat = onlyBlock(ws, WHEN_BLOCK);
    expect(hat.getFieldValue("EVENT")).toBe("start");
    expect(statementsIn(hat, "DO").map((b) => b.type)).toEqual([
      blockTypeFor("turret-sweep"),
      blockTypeFor("drive-forward"),
    ]);
    ws.dispose();
  });

  it("nests a branch as a statement input, not as text", () => {
    const { ws } = loadWorkspace(
      'name "N"\nchassis tank\n\non sense robot\n  if event.distance < 100 then\n    fire 3\n  else\n    fire 1\n  end\nend',
    );
    const iff = onlyBlock(ws, blockTypeFor("if"));
    expect(statementsIn(iff, "THEN").map((b) => b.type)).toEqual([blockTypeFor("fire")]);
    expect(statementsIn(iff, "ELSE").map((b) => b.type)).toEqual([blockTypeFor("fire")]);
    const cond = iff.getInputTargetBlock("COND")!;
    expect(cond.type).toBe(COMPARE_BLOCK);
    expect(cond.getFieldValue("OP")).toBe("<");
    expect(cond.getInputTargetBlock("A")!.getFieldValue("PROP")).toBe("event.distance");
    /*
     * A number, not the string "100" — `FieldNumber` coerces, which my
     * JSON-to-JSON tests had quietly assumed away because they never asked
     * Blockly. It matters because the value is written back into source text,
     * so the round trip below is the assertion that counts.
     */
    expect(cond.getInputTargetBlock("B")!.getFieldValue("NUM")).toBe(100);
    expect(roundTrip(
      'name "N"\nchassis tank\n\non sense robot\n  if event.distance < 100 then\n    fire 3\n  else\n    fire 1\n  end\nend',
    )).toContain("event.distance < 100");
    ws.dispose();
  });

  it("gives a call one socket per argument", () => {
    const { ws } = loadWorkspace(
      'name "R"\nchassis tank\n\ncan fold with a, b, c\n  stop\nend\n\non start\n  do fold with mx, my, number(field(event.data, 5))\nend',
    );
    const call = onlyBlock(ws, blockTypeFor("do-with"));
    expect(call.getFieldValue("V0")).toBe("fold");
    expect(call.getInputTargetBlock("A0")).toBeTruthy();
    expect(call.getInputTargetBlock("A1")).toBeTruthy();
    // Three, not five: the last argument is one expression with commas in it.
    expect(call.getInputTargetBlock("A2")!.getFieldValue("TEXT")).toBe(
      "number(field(event.data, 5))",
    );
    expect(call.getInputTargetBlock("A3")).toBeNull();
    ws.dispose();
  });

  it("carries a `can` block's contract onto its hat", () => {
    const { ws } = loadWorkspace(
      'name "R"\nchassis tank\n\ncan engage with power=3 given sense robot\n  fire power\nend',
    );
    const can = onlyBlock(ws, CAN_BLOCK);
    expect(can.getFieldValue("NAME")).toBe("engage");
    expect(can.getFieldValue("PARAMS")).toBe("power=3");
    expect(can.getFieldValue("GIVEN")).toBe("sense robot");
    ws.dispose();
  });

  it("puts the globals inside the declarations, not in a handler", () => {
    const { ws } = loadWorkspace(
      'name "G"\nchassis tank\nvar seen = 0\n\non start\n  stop\nend',
    );
    const declarations = onlyBlock(ws, ROBOT_BLOCK);
    const inside = statementsIn(declarations, "SETUP").map((b) => b.type);
    expect(inside).toContain(blockTypeFor("robot-name"));
    expect(inside).toContain(blockTypeFor("var"));
    ws.dispose();
  });
});

/**
 * Editing, done the way the editor does it — through Blockly's block API,
 * because that is the path a drag or a keystroke actually takes.
 */
describe("editing in the workspace", () => {
  it("rewrites only the line that changed", () => {
    const src = 'name "E"\nchassis tank\n\non start\n  drive forward 70\n  stop\nend';
    const out = edit(src, (ws) => {
      onlyBlock(ws, blockTypeFor("drive-forward")).setFieldValue("40", "V0");
    });
    expect(out).toBe('name "E"\nchassis tank\n\non start\n  drive forward 40\n  stop\nend');
  });

  it("keeps a line's own indentation when it rewrites it", () => {
    const src = 'name "E"\nchassis tank\n\non start\n      drive forward 70\nend';
    const out = edit(src, (ws) => {
      onlyBlock(ws, blockTypeFor("drive-forward")).setFieldValue("40", "V0");
    });
    expect(out).toContain("      drive forward 40");
  });

  it("follows the event dropdown", () => {
    const src = 'name "E"\nchassis tank\n\non start\n  stop\nend';
    const out = edit(src, (ws) => {
      onlyBlock(ws, WHEN_BLOCK).setFieldValue("hit wall", "EVENT");
    });
    expect(out).toContain("on hit wall");
  });

  it("removes a statement when its block is deleted", () => {
    const src = 'name "E"\nchassis tank\n\non start\n  drive forward 70\n  stop\nend';
    const out = edit(src, (ws) => {
      onlyBlock(ws, blockTypeFor("drive-forward")).dispose(true);
    });
    expect(out).not.toContain("drive forward");
    expect(out).toContain("stop");
  });

  it("keeps the other language's words on a line nobody touched", () => {
    // The catalogue speaks canonical RoboScript, so a regenerated line comes
    // back mechanical. Only the edited line may be regenerated.
    const bio = translate(
      'name "B"\nchassis tank\n\non sense robot\n  fire 3\n  drive forward 70\nend',
      "biological",
    );
    const out = edit(bio, (ws) => {
      onlyBlock(ws, blockTypeFor("drive-forward")).setFieldValue("40", "V0");
    });
    expect(out).toContain("sting 3");
  });
});

/**
 * Comments are a block for one reason: Blockly regenerates code from the
 * workspace, so anything with no block is gone the first time somebody drags
 * something — and what would go is the author's explanation of what their
 * robot does.
 */
describe("comments, through the workspace", () => {
  const commented = [
    "-- who I am",
    'name "Commented"',
    "chassis tank",
    "",
    "on start",
    "  -- look around first",
    "  turret.sweep 45",
    "",
    "  -- then go",
    "  drive forward 60",
    "end",
  ].join("\n");

  it("survives a real save and load", () => {
    expect(roundTrip(commented)).toBe(commented);
  });

  it("is a block, attached above the statement it was written over", () => {
    const { ws } = loadWorkspace(commented);
    const hat = onlyBlock(ws, WHEN_BLOCK);
    const [first, second] = statementsIn(hat, "DO");
    expect(first!.type).toBe(COMMENT_BLOCK);
    expect(first!.getFieldValue("TEXT")).toBe("look around first");
    expect(second!.type).toBe(blockTypeFor("turret-sweep"));
    ws.dispose();
  });

  it("becomes one tidy note when it is edited", () => {
    const src = 'name "N"\nchassis tank\n\non start\n  -- first\n  -- second\n  stop\nend';
    const out = edit(src, (ws) => {
      onlyBlock(ws, COMMENT_BLOCK).setFieldValue("changed my mind", "TEXT");
    });
    expect(out).toContain("-- changed my mind");
    expect(out).not.toContain("-- first");
  });

  it("keeps a two-line note whole when nobody touches it", () => {
    const src = 'name "N"\nchassis tank\n\non start\n  -- first\n  -- second\n  stop\nend';
    expect(roundTrip(src)).toBe(src);
  });
});

/**
 * A number, a property and a variable are the same round shape because they
 * are the same kind of thing. They are not the same block, and they were being
 * confused: anything not a number became a property, so `seen` was offered as
 * though the world reported it like `me.health`.
 */
describe("values", () => {
  it("tells a number, a property and a variable apart", () => {
    expect(valueBlock("30").type).toBe(NUM_BLOCK);
    expect(valueBlock("me.health").type).toBe(PROP_BLOCK);
    expect(valueBlock("seen").type).toBe(VAR_BLOCK);
    expect(valueBlock("seen + 1").type).toBe(EXPR_BLOCK);
  });

  it("round-trips each of them", () => {
    for (const text of ["30", "me.health", "seen", "seen + 1"]) {
      expect(blockToCondition(valueBlock(text))).toBe(text);
    }
  });

  it("puts a variable in a socket Blockly accepts", () => {
    const { ws } = loadWorkspace(
      'name "M"\nchassis tank\nvar seen = 0\n\non sense robot\n  set seen = seen\nend',
    );
    const set = onlyBlock(ws, blockTypeFor("set"));
    expect(set.getFieldValue("V0")).toBe("seen");
    expect(set.getInputTargetBlock("V1")!.type).toBe(VAR_BLOCK);
    ws.dispose();
  });
});

describe("block types", () => {
  it("round-trip their catalogue ids", () => {
    for (const spec of CARDS) {
      expect(specIdFor(blockTypeFor(spec.id))).toBe(spec.id);
    }
  });

  it("are all registered with Blockly", () => {
    // A spec with no block is a statement the editor cannot draw, and the
    // failure is a load that throws rather than anything visible.
    for (const spec of CARDS) {
      expect(Blockly.Blocks[blockTypeFor(spec.id)], spec.id).toBeDefined();
    }
    for (const structural of [WHEN_BLOCK, CAN_BLOCK, ROBOT_BLOCK, COMMENT_BLOCK, COMPARE_BLOCK]) {
      expect(Blockly.Blocks[structural], structural).toBeDefined();
    }
  });
});
