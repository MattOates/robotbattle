import { describe, expect, it } from "vitest";
import {
  COMMENT_BLOCK,
  COMPARE_BLOCK,
  EXPR_BLOCK,
  RAW_BLOCK,
  WHEN_BLOCK,
  blockTypeFor,
  sketchToWorkspace,
  specIdFor,
  workspaceToSketch,
  type BlockJson,
} from "../../src/ui/blocks/bridge.js";
import { CARDS, fromSource, toSource } from "../../src/workshop/compose.js";
import { SAMPLE_BOTS, TOUR_ROBOT, TOUR_SEED } from "../../src/bots/index.js";
import { compile } from "../../src/lang/compiler.js";
import { parse } from "../../src/lang/parser.js";
import { translate } from "../../src/learn/translate.js";

const ALL = [
  ...SAMPLE_BOTS.map((b) => ({ id: b.id, source: b.source })),
  { id: "tour-seed", source: TOUR_SEED },
  { id: "tour-robot", source: TOUR_ROBOT },
];

const through = (source: string) =>
  toSource(workspaceToSketch(sketchToWorkspace(fromSource(source))));

/**
 * The same promise the card view makes, through Blockly's own serialisation
 * format. A block editor that damaged a script somebody only opened to look at
 * would be exactly as much of a trap here as there — more so, because dragging
 * is the first thing anyone does.
 */
describe("a script through the block workspace and back", () => {
  it("is exact for every robot in the game", () => {
    for (const { id, source } of ALL) {
      expect(through(source), id).toBe(source);
    }
  });

  it("is exact in both vocabularies", () => {
    for (const { id, source } of ALL) {
      for (const theme of ["mechanical", "biological"] as const) {
        const themed = translate(source, theme);
        expect(through(themed), `${id} in ${theme}`).toBe(themed);
      }
    }
  });

  it("produces identical bytecode", () => {
    for (const { id, source } of ALL) {
      const before = compile(parse(source));
      const after = compile(parse(through(source)));
      expect(JSON.stringify(after), id).toBe(JSON.stringify(before));
    }
  });
});

/**
 * The reason comments are a block at all. Blockly regenerates code from the
 * workspace, so anything with no block vanishes the first time somebody drags
 * something — and the thing that vanishes is the author's explanation of what
 * their robot does, which is most of what makes a traded robot worth having.
 */
describe("comments", () => {
  const commented = [
    "-- who I am",
    'name "Commented"',
    "chassis tank",
    "",
    "-- what I do at the start",
    "on start",
    "  -- look around first",
    "  turret.sweep 45",
    "",
    "  -- then go",
    "  drive forward 60",
    "end",
  ].join("\n");

  it("survives the workspace", () => {
    expect(through(commented)).toBe(commented);
  });

  it("becomes real blocks rather than being carried out of band", () => {
    const ws = sketchToWorkspace(fromSource(commented));
    const types: string[] = [];
    const walk = (b: BlockJson | undefined) => {
      if (!b) return;
      types.push(b.type);
      walk(b.inputs?.["DO"]?.block);
      walk(b.next?.block);
    };
    ws.blocks!.blocks.forEach(walk);
    expect(types.filter((t) => t === COMMENT_BLOCK).length).toBe(2);
    expect(types).toContain(WHEN_BLOCK);
  });

  it("keeps a comment attached to the statement it was written above", () => {
    const ws = sketchToWorkspace(fromSource(commented));
    const first = ws.blocks!.blocks[0]!.inputs!["DO"]!.block;
    expect(first.type).toBe(COMMENT_BLOCK);
    // The field is the readable body; the line as written rides in extraState.
    expect(first.fields!["TEXT"]).toBe("look around first");
    expect((first.extraState as { lines: string[] }).lines).toEqual(["  -- look around first"]);
    expect(first.next!.block.type).toBe(blockTypeFor("turret-sweep"));
  });
});

describe("editing a note", () => {
  const src = 'name "N"\nchassis tank\n\non start\n  -- first\n  -- second\n  stop\nend';

  it("comes back as it was written when nobody touches it", () => {
    // Two lines, and they stay two lines rather than being tidied into one.
    expect(through(src)).toBe(src);
  });

  it("becomes one tidy comment when it is edited", () => {
    const ws = sketchToWorkspace(fromSource(src));
    const note = ws.blocks!.blocks[0]!.inputs!["DO"]!.block;
    expect(note.type).toBe(COMMENT_BLOCK);
    note.fields!["TEXT"] = "changed my mind";
    expect(toSource(workspaceToSketch(ws))).toContain("-- changed my mind");
  });

  it("drops a note whose text is cleared", () => {
    const ws = sketchToWorkspace(fromSource(src));
    ws.blocks!.blocks[0]!.inputs!["DO"]!.block.fields!["TEXT"] = "";
    const out = toSource(workspaceToSketch(ws));
    expect(out).not.toContain("--");
    expect(out).toContain("stop");
  });
});

describe("deciding and repeating", () => {
  const nested =
    'name "N"\nchassis tank\n\non sense robot\n  if event.distance < 100 then\n    fire 3\n  end\n  stop\nend';

  it("is a real block with a real statement input", () => {
    const ws = sketchToWorkspace(fromSource(nested));
    const first = ws.blocks!.blocks[0]!.inputs!["DO"]!.block;
    expect(first.type).toBe(blockTypeFor("if"));
    expect(first.fields!["V0"]).toBe("event.distance < 100");
    expect(first.inputs!["THEN"]!.block.type).toBe(blockTypeFor("fire"));
    expect(through(nested)).toBe(nested);
  });

  it("keeps an else branch that has been emptied", () => {
    /*
     * `if ... else ... end` with nothing between `else` and `end` is legal,
     * and an `if` that has silently lost its `else` is a different program.
     * So a slot that existed comes back even with nothing in it.
     */
    const src =
      'name "E"\nchassis tank\n\non start\n  if 1 is 1 then\n    stop\n  else\n    fire 1\n  end\nend';
    const ws = sketchToWorkspace(fromSource(src));
    const iff = ws.blocks!.blocks[0]!.inputs!["DO"]!.block;
    delete iff.inputs!["ELSE"];
    const out = toSource(workspaceToSketch(ws));
    expect(out).toContain("else");
    expect(out).not.toContain("fire 1");
  });

  it("survives nesting to any depth", () => {
    const deep = [
      'name "D"',
      "chassis tank",
      "",
      "on tick",
      "  loop",
      "    if me.health < 30 then",
      "      repeat 2 times",
      "        drive back 40",
      "      end",
      "    end",
      "  end",
      "end",
    ].join("\n");
    expect(through(deep)).toBe(deep);
  });

  it("holds the condition as blocks, not as a text box", () => {
    const ws = sketchToWorkspace(fromSource(nested));
    const iff = ws.blocks!.blocks[0]!.inputs!["DO"]!.block;
    const cond = iff.inputs!["COND"]!.block;
    expect(cond.type).toBe(COMPARE_BLOCK);
    expect(cond.fields!["OP"]).toBe("<");
    expect(cond.inputs!["A"]!.block.fields!["PROP"]).toBe("event.distance");
    expect(cond.inputs!["B"]!.block.fields!["NUM"]).toBe("100");
  });

  it("rewrites the header only when the condition changes", () => {
    const ws = sketchToWorkspace(fromSource(nested));
    const cond = ws.blocks!.blocks[0]!.inputs!["DO"]!.block.inputs!["COND"]!.block;
    expect(toSource(workspaceToSketch(ws))).toContain("if event.distance < 100 then");
    cond.inputs!["A"]!.block.fields!["PROP"] = "me.health";
    cond.inputs!["B"]!.block.fields!["NUM"] = "50";
    expect(toSource(workspaceToSketch(ws))).toContain("if me.health < 50 then");
  });

  it("keeps a condition it cannot take apart, verbatim", () => {
    // Arithmetic, `and`/`or`, anything past a simple comparison: one block
    // holding the text, shown and never rewritten.
    const src =
      'name "X"\nchassis tank\n\non tick\n  if arena.time mod 60 is 0 and me.fuel > 10 then\n    stop\n  end\nend';
    const ws = sketchToWorkspace(fromSource(src));
    const cond = ws.blocks!.blocks[0]!.inputs!["DO"]!.block.inputs!["COND"]!.block;
    expect(cond.type).toBe(EXPR_BLOCK);
    expect(through(src)).toBe(src);
  });

  it("keeps a `can` block, which has no event and is not a handler", () => {
    const src = 'name "C"\nchassis tank\n\ncan dodge given hit by bullet\n  stop\nend';
    expect(through(src)).toBe(src);
  });
});

/**
 * The subtle half of the round trip, and the one that broke first.
 *
 * Blockly regenerates code from the workspace, and the catalogue speaks
 * canonical RoboScript — so regenerating every statement turned a biological
 * script mechanical: `sting 3` went in and `fire 3` came out. It compiled, and
 * it was not the robot anybody wrote. A block carries the line it came from,
 * and only a block whose values actually changed is written afresh.
 */
describe("what happens to a line nobody touched", () => {
  const bio = translate(
    'name "B"\nchassis tank\n\non sense robot\n      fire 3\nend',
    "biological",
  );

  it("comes back in the words it was written in", () => {
    expect(through(bio)).toBe(bio);
    expect(through(bio)).toContain("sting 3");
  });

  it("keeps its own indentation", () => {
    expect(through(bio)).toMatch(/\n {6}sting 3/);
  });

  it("is rewritten only when its value changes", () => {
    const ws = sketchToWorkspace(fromSource(bio));
    const stmt = ws.blocks!.blocks[0]!.inputs!["DO"]!.block;
    // Same value: the original line survives, biological words and all.
    expect(toSource(workspaceToSketch(ws))).toContain("sting 3");

    stmt.fields!["V0"] = "1";
    const edited = toSource(workspaceToSketch(ws));
    expect(edited).not.toContain("sting 3");
    // Rewritten from the catalogue, which is canonical — the same thing the
    // card view does when a hole is edited, and it still compiles in either
    // world because both vocabularies parse anywhere.
    expect(edited).toContain("fire 1");
    // And it still lands where it was, not at the catalogue's default indent.
    expect(edited).toMatch(/\n {6}fire 1/);
  });
});

describe("block types", () => {
  it("round-trip their catalogue ids", () => {
    for (const spec of CARDS) {
      expect(specIdFor(blockTypeFor(spec.id))).toBe(spec.id);
    }
  });

  it("do not collide with the structural blocks", () => {
    const types = CARDS.map((c) => blockTypeFor(c.id));
    expect(new Set(types).size).toBe(types.length);
    for (const structural of [WHEN_BLOCK, COMMENT_BLOCK, RAW_BLOCK]) {
      expect(types).not.toContain(structural);
      expect(specIdFor(structural)).toBeNull();
    }
  });
});

/**
 * Block ids are derived from position, not minted.
 *
 * Two people editing the same robot have to be able to say "I am on *this*
 * block" and mean the same block. Blockly mints ids per workspace, so each
 * peer would name the same block differently and a shared cursor would point
 * at nothing. Derived from the script, they agree wherever the script does —
 * which is what the pair-programming layer needs to show who is where.
 */
describe("block identity", () => {
  it("is the same on two peers reading the same script", () => {
    const a = sketchToWorkspace(fromSource(TOUR_ROBOT));
    const b = sketchToWorkspace(fromSource(TOUR_ROBOT));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("names a block by where it sits", () => {
    const ws = sketchToWorkspace(fromSource(TOUR_ROBOT));
    const hat = ws.blocks!.blocks[0]!;
    expect(hat.id).toBe("h0");
    // First statement of the first handler.
    expect(hat.inputs!["DO"]!.block.id).toMatch(/^h0\.0\./);
  });

  it("gives every block a distinct id", () => {
    const ids: string[] = [];
    const walk = (b: BlockJson | undefined) => {
      if (!b) return;
      if (b.id) ids.push(b.id);
      for (const input of Object.values(b.inputs ?? {})) walk(input.block);
      walk(b.next?.block);
    };
    for (const { source } of ALL) {
      ids.length = 0;
      sketchToWorkspace(fromSource(source)).blocks!.blocks.forEach(walk);
      expect(new Set(ids).size, `${ids.length} ids`).toBe(ids.length);
    }
  });
});
