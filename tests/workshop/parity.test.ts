import { describe, expect, it } from "vitest";
import { CARDS, fromSource, toSource, type Card } from "../../src/workshop/compose.js";
import { fillVocab } from "../../src/learn/markdown.js";
import {
  CAN_BLOCK,
  WHEN_BLOCK,
  sketchToWorkspace,
  workspaceToSketch,
  type BlockJson,
} from "../../src/ui/blocks/bridge.js";
import { SAMPLE_BOTS, TOUR_ROBOT, TOUR_SEED } from "../../src/bots/index.js";
import { compile } from "../../src/lang/compiler.js";
import { parse } from "../../src/lang/parser.js";
import { translate } from "../../src/learn/translate.js";


/**
 * The first *handler* in a workspace.
 *
 * Not `blocks[0]`, which is the robot's declarations now — name, chassis,
 * colour and the globals became a block of their own so they could be seen and
 * changed rather than merely carried.
 */
function hatOf(ws: { blocks?: { blocks: BlockJson[] } }): BlockJson | undefined {
  return ws.blocks?.blocks.find((b) => b.type === WHEN_BLOCK || b.type === CAN_BLOCK);
}

const HOUSE = [
  ...SAMPLE_BOTS.map((b) => ({ id: b.id, source: b.source })),
  { id: "tour-seed", source: TOUR_SEED },
  { id: "tour-robot", source: TOUR_ROBOT },
];

/**
 * Every statement in a script, flattened through the nesting.
 *
 * Including the declarations. This used to walk only the handlers, which meant
 * the test claimed full parity while `name`, `chassis`, `color` and every
 * global `var` were outside it entirely — carried through the workspace as
 * untouched text, round-tripping perfectly, and invisible in the block view. A
 * hole in the measurement is worse than a hole in the thing measured, because
 * it is the reason nobody looks.
 */
function statements(source: string): Card[] {
  const out: Card[] = [];
  const walk = (cards: readonly Card[]) => {
    for (const card of cards) {
      // The empty placeholder carries trailing comments and is not a statement.
      if (card.text.trim() !== "") out.push(card);
      for (const held of Object.values(card.slots ?? {})) walk(held);
    }
  };
  for (const block of fromSource(source).blocks) walk(block.cards);
  return out;
}

/**
 * The bar this has to clear, and it is deliberately a high one.
 *
 * The oldest players move between blocks and code, so the blocks have to be
 * able to say everything the code can — otherwise moving one way loses work
 * and moving the other way is a lie. "Round-trips exactly" is not enough on
 * its own, because anything unrecognised round-trips exactly *as a lump of
 * text*: the guarantee holds and the block editor is still useless for that
 * statement. So this asserts the stronger thing — that every statement in
 * every robot the game ships is a block somebody could have built.
 */
describe("the house robots, as blocks", () => {
  it("has no statement that cannot be a block", () => {
    const orphans: string[] = [];
    for (const { id, source } of HOUSE) {
      for (const card of statements(source)) {
        if (card.spec === "raw") orphans.push(`${id}: ${card.text.trim().split("\n")[0]}`);
      }
    }
    expect(orphans).toEqual([]);
  });

  it("shows the declarations rather than merely carrying them", () => {
    /*
     * `name`, `chassis`, `color` and the globals. Every robot has them, they
     * are a third of a short script, and they were invisible in the block
     * view — so this asserts both halves: that they are a block at all, and
     * that nothing in `head` is left over except a leading comment.
     */
    for (const { id, source } of HOUSE) {
      const sketch = fromSource(source);
      const declarations = sketch.blocks.find((b) => b.kind === "robot");
      expect(declarations, id).toBeDefined();
      expect(declarations!.cards.some((c) => c.spec === "robot-name"), id).toBe(true);
      expect(declarations!.cards.some((c) => c.spec === "robot-chassis"), id).toBe(true);
      for (const line of sketch.head) {
        expect(line.trim() === "" || line.trim().startsWith("--"), `${id}: ${line}`).toBe(true);
      }
    }
  });

  it("keeps a global where a global has to be", () => {
    // Inside the declarations, not in a handler: a global is the only kind
    // that survives between events, and where it is declared is the whole
    // difference.
    const src = 'name "G"\nchassis tank\nvar seen = 0\n\non start\n  var local = 1\nend';
    const sketch = fromSource(src);
    const declarations = sketch.blocks.find((b) => b.kind === "robot")!;
    expect(declarations.cards.map((c) => c.spec)).toContain("var");
    expect(declarations.cards.find((c) => c.spec === "var")!.holes[0]!.value).toBe("seen");
    expect(toSource(workspaceToSketch(sketchToWorkspace(sketch)))).toBe(src);
  });

  it("has no block header that cannot be a hat", () => {
    // `on` handlers and `can` routines both. A `can` whose `given` we cannot
    // read would come back without it, which changes where it may be used.
    const orphans: string[] = [];
    for (const { id, source } of HOUSE) {
      for (const block of fromSource(source).blocks) {
        if (block.kind === "can" && !block.name) orphans.push(`${id}: ${block.header}`);
        if (block.kind === "on" && block.event === null) orphans.push(`${id}: ${block.header}`);
      }
    }
    expect(orphans).toEqual([]);
  });

  it("round-trips character for character through the workspace", () => {
    for (const { id, source } of HOUSE) {
      const out = toSource(workspaceToSketch(sketchToWorkspace(fromSource(source))));
      expect(out, id).toBe(source);
    }
  });

  it("round-trips in both vocabularies", () => {
    for (const { id, source } of HOUSE) {
      for (const theme of ["mechanical", "biological"] as const) {
        const themed = translate(source, theme);
        const out = toSource(workspaceToSketch(sketchToWorkspace(fromSource(themed))));
        expect(out, `${id} in ${theme}`).toBe(themed);
      }
    }
  });

  it("compiles to identical bytecode after the trip", () => {
    for (const { id, source } of HOUSE) {
      const before = compile(parse(source));
      const after = compile(parse(toSource(workspaceToSketch(sketchToWorkspace(fromSource(source))))));
      expect(JSON.stringify(after), id).toBe(JSON.stringify(before));
    }
  });
});

describe("named behaviours", () => {
  it("keeps a `can` block's parameters and contract", () => {
    const src =
      'name "R"\nchassis tank\n\ncan engage with power=3 given sense robot\n  fire power\nend';
    const block = fromSource(src).blocks.find((b) => b.kind === "can")!;
    expect(block.kind).toBe("can");
    expect(block.name).toBe("engage");
    expect(block.params).toEqual(["power=3"]);
    expect(block.event).toBe("sense robot");
  });

  it("keeps a cadence clause it does not model", () => {
    // `can scan given tick every 30` — nothing here edits `every`, so the
    // header has to come back whole rather than be rebuilt without it.
    const src = 'name "R"\nchassis tank\n\ncan scan given tick every 30\n  ping\nend';
    const out = toSource(workspaceToSketch(sketchToWorkspace(fromSource(src))));
    expect(out).toBe(src);
  });
});

describe("calling a behaviour", () => {
  it("splits arguments on top-level commas only", () => {
    // Three arguments, not five. A naive split would change what the routine
    // is called with, and it would still compile.
    const src =
      'name "R"\nchassis tank\n\ncan fold with a, b, c\n  stop\nend\n\non start\n  do fold with mx, my, number(field(event.data, 5))\nend';
    const call = statements(src).find((c) => c.spec === "do-with")!;
    expect(call.holes[1]!.value).toBe("mx, my, number(field(event.data, 5))");
    expect(toSource(workspaceToSketch(sketchToWorkspace(fromSource(src))))).toBe(src);
  });

  it("reads a call with no arguments", () => {
    const src = 'name "R"\nchassis tank\n\ncan fold\n  stop\nend\n\non start\n  do fold\nend';
    expect(statements(src).some((c) => c.spec === "do")).toBe(true);
    expect(toSource(workspaceToSketch(sketchToWorkspace(fromSource(src))))).toBe(src);
  });
});

/**
 * A control that cannot hold its value is worse than no control: it draws
 * something that is not true, and the only thing standing between that and
 * writing it back is a rule elsewhere. Each of these was a real one.
 */
describe("controls that must not lie", () => {
  it("keeps an event the palette does not offer", () => {
    // The palette offers six events because six is what a first robot is
    // built from. `on ping robot` is not one of them and was drawn as "start".
    const src = 'name "R"\nchassis tank\n\non ping robot\n  ping\nend';
    const ws = sketchToWorkspace(fromSource(src));
    expect(hatOf(ws)!.fields!["EVENT"]).toBe("ping robot");
    expect(toSource(workspaceToSketch(ws))).toBe(src);
  });

  it("follows the event dropdown when it is changed", () => {
    // And the other half: the header used to be kept verbatim whatever the
    // field said, so the control did nothing at all.
    const src = 'name "R"\nchassis tank\n\non start\n  ping\nend';
    const ws = sketchToWorkspace(fromSource(src));
    hatOf(ws)!.fields!["EVENT"] = "hit wall";
    expect(toSource(workspaceToSketch(ws))).toContain("on hit wall");
  });

  it("leaves a cadence clause alone when the event has not changed", () => {
    const src = 'name "R"\nchassis tank\n\non tick every 30\n  ping\nend';
    expect(toSource(workspaceToSketch(sketchToWorkspace(fromSource(src))))).toBe(src);
  });

  it("reads an event written in the other vocabulary", () => {
    const src = 'name "R"\nbody ciliate\n\non stung\n  stop\nend';
    const ws = sketchToWorkspace(fromSource(src));
    expect(hatOf(ws)!.fields!["EVENT"]).toBe("hit by bullet");
    expect(toSource(workspaceToSketch(ws))).toBe(src);
  });
});

describe("the words on the blocks", () => {
  it("has no unfilled placeholder in any phrase", () => {
    // These reached the screen reading "Point the {turret} at" — the phrases
    // were being used raw, so the braces showed and the biological words never
    // arrived at all.
    for (const spec of CARDS) {
      for (const theme of ["mechanical", "biological"] as const) {
        for (const register of ["full", "simple"] as const) {
          const filled = fillVocab(spec.say[register], theme).replace(/\{\d\}/g, "");
          expect(filled, `${spec.id} (${register}, ${theme})`).not.toMatch(/[{}]/);
        }
      }
    }
  });
});
