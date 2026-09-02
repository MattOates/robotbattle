import { describe, expect, it } from "vitest";
import {
  ANGLE_CHOICES,
  CARDS,
  addBlock,
  addCard,
  availableEvents,
  cardSpec,
  declaredVariables,
  editCard,
  fromSource,
  moveCard,
  newCard,
  removeCard,
  setHole,
  toSource,
  type Sketch,
} from "../../src/workshop/compose.js";
import { SAMPLE_BOTS, TOUR_ROBOT, TOUR_SEED } from "../../src/bots/index.js";
import { checkScript } from "../../src/sim/world.js";
import { compile } from "../../src/lang/compiler.js";
import { parse } from "../../src/lang/parser.js";
import { translate } from "../../src/learn/translate.js";
import { EVENT_NAMES } from "../../src/lang/ast.js";
import { fillVocab } from "../../src/learn/markdown.js";
import { WHEN_PROMPT } from "../../src/ui/compose/CardComposer.js";

/**
 * The first handler in a sketch.
 *
 * Not `blocks[0]`, which is the declarations now — `name`, `chassis`, `color`
 * and the globals became a block of their own so they could be seen and
 * changed in the block view rather than merely carried through it.
 */
const handlerOf = (sk: Sketch) => sk.blocks.find((b) => b.kind === "on")!;

const ALL = [
  ...SAMPLE_BOTS.map((b) => ({ id: b.id, source: b.source })),
  { id: "tour-seed", source: TOUR_SEED },
  { id: "tour-robot", source: TOUR_ROBOT },
];

/**
 * The property everything else rests on.
 *
 * A card view that could not put a script back exactly as it found it would be
 * a trap: the first thing it would quietly damage is somebody else's traded
 * robot, opened out of curiosity and closed again. Character-for-character, or
 * the feature is not safe to ship.
 */
describe("reading a script and writing it back", () => {
  it("is exact for every robot in the game", () => {
    for (const { id, source } of ALL) {
      expect(toSource(fromSource(source)), id).toBe(source);
    }
  });

  it("is exact in both vocabularies", () => {
    // Matching is canonical, but nothing is *rewritten* to canonical: a
    // biological script must come back biological, word for word.
    for (const { id, source } of ALL) {
      for (const theme of ["mechanical", "biological"] as const) {
        const themed = translate(source, theme);
        expect(toSource(fromSource(themed)), `${id} in ${theme}`).toBe(themed);
      }
    }
  });

  it("keeps comments, blank lines and odd indentation", () => {
    const odd = [
      '-- leading comment',
      'name "Odd"',
      "chassis tank",
      "",
      "",
      "-- about the handler",
      "on start",
      "      drive forward 60   -- trailing comment",
      "",
      "  -- a note in the middle",
      "  stop",
      "end",
      "",
    ].join("\n");
    expect(toSource(fromSource(odd))).toBe(odd);
  });

  it("survives a script it understands nothing in", () => {
    const alien = [
      'name "Alien"',
      "chassis car",
      "var mode = 0",
      "",
      "can dodge given hit by bullet",
      "  turn body by event.bearing + 90",
      "end",
      "",
      "on tick every 30",
      "  for i = 1 to 3",
      "    turret.turn by 10",
      "  end",
      "  set mode = mode + 1",
      "end",
    ].join("\n");
    expect(toSource(fromSource(alien))).toBe(alien);
  });

  it("keeps an unterminated block rather than swallowing it", () => {
    // Half-typed scripts are the normal state of an editor, and the card view
    // may be opened on one.
    const half = 'name "Half"\nchassis tank\n\non start\n  drive forward 60';
    expect(toSource(fromSource(half))).toBe(half);
  });
});

describe("what it recognises", () => {
  it("turns the seed robot's statements into real cards, not raw ones", () => {
    const sketch = fromSource(TOUR_SEED);
    const specs = sketch.blocks.flatMap((b) => b.cards.map((c) => c.spec));
    expect(specs).toContain("turret-sweep");
    expect(specs).toContain("drive-forward");
  });

  it("recognises a statement written in the other vocabulary", () => {
    const bio = fromSource('name "B"\nbody ciliate\n\non start\n  swim forward 60\nend');
    const handler = handlerOf(bio);
    expect(handler.cards[0]!.spec).toBe("drive-forward");
    expect(handler.cards[0]!.holes[0]!.value).toBe("60");
  });

  it("reads an expression argument back as written", () => {
    const s = fromSource(
      'name "E"\nchassis tank\n\non hit by bullet\n  turn body by event.bearing + 90\nend',
    );
    // `event.bearing + 90` is one of the named angles ("across them"), so it
    // keeps the friendly block — and the expression is still exact.
    expect(handlerOf(s).cards[0]!.spec).toBe("turn-body-by");
    expect(handlerOf(s).cards[0]!.holes[0]!.value).toBe("event.bearing + 90");
  });

  it("reads a nested construct as a tree, not a slab of text", () => {
    const s = fromSource(
      'name "N"\nchassis tank\n\non sense robot\n  if event.distance < 100 then\n    fire 3\n  else\n    fire 1\n  end\n  stop\nend',
    );
    const cards = handlerOf(s).cards;
    expect(cards[0]!.spec).toBe("if");
    expect(cards[0]!.holes[0]!.value).toBe("event.distance < 100");
    expect(cards[0]!.slots!["then"]!.map((c) => c.spec)).toEqual(["fire"]);
    expect(cards[0]!.slots!["else"]!.map((c) => c.spec)).toEqual(["fire"]);
    // The `else` and `end` are kept as written rather than regenerated.
    expect(cards[0]!.seps!["else"]).toBe("  else");
    expect(cards[0]!.seps!["end"]).toBe("  end");
    // And the statement after it is still recognised.
    expect(cards[1]!.spec).toBe("stop");
  });

  it("nests to any depth", () => {
    const src = [
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
    const s = fromSource(src);
    const outer = handlerOf(s).cards[0]!;
    expect(outer.spec).toBe("loop");
    const inner = outer.slots!["body"]![0]!;
    expect(inner.spec).toBe("if");
    expect(inner.slots!["then"]![0]!.spec).toBe("repeat");
    expect(inner.slots!["then"]![0]!.slots!["body"]![0]!.spec).toBe("drive-back");
    expect(toSource(s)).toBe(src);
  });

  it("reads the count off a repeat and the parts off a for", () => {
    const s = fromSource(
      'name "F"\nchassis tank\n\non start\n  repeat 3 times\n    stop\n  end\n  for i = 1 to 4\n    stop\n  end\nend',
    );
    const [rep, forl] = handlerOf(s).cards;
    expect(rep!.spec).toBe("repeat");
    expect(rep!.holes[0]!.value).toBe("3");
    expect(forl!.spec).toBe("for");
    expect(forl!.holes.map((h) => h.value)).toEqual(["i", "1", "4"]);
  });

  it("names the event of a block it understands", () => {
    const s = fromSource(TOUR_ROBOT);
    expect(s.blocks.map((b) => b.event)).toContain("sense robot");
    expect(s.blocks.every((b) => b.event === null || EVENT_NAMES.includes(b.event))).toBe(true);
  });

  it("reads a `can` block's name, parameters and `given`", () => {
    const s = fromSource(
      'name "C"\nchassis tank\n\ncan dodge with power=2, hard given hit by bullet\n  stop\nend',
    );
    const block = s.blocks.find((b) => b.kind === "can")!;
    expect(block.kind).toBe("can");
    expect(block.name).toBe("dodge");
    // Kept verbatim, default and all: a default is part of the contract, and
    // rewriting `power=2` as `power` changes what a call with no arguments does.
    expect(block.params).toEqual(["power=2", "hard"]);
    expect(block.event).toBe("hit by bullet");
  });

  it("reads a `given` written in the other vocabulary", () => {
    const s = fromSource('name "C"\nbody ciliate\n\ncan dodge given stung\n  stop\nend');
    expect(s.blocks.find((b) => b.kind === "can")!.event).toBe("hit by bullet");
  });

  it("does not mistake a cadence clause for the event", () => {
    const s = fromSource('name "C"\nchassis tank\n\non tick every 30\n  stop\nend');
    expect(handlerOf(s).event).toBe("tick");
  });
});

describe("editing", () => {
  const base = 'name "E"\nchassis tank\n\non start\n  drive forward 60\nend';

  it("rewrites only the card that changed", () => {
    const s = fromSource(base);
    const block = handlerOf(s);
    const next = editCard(s, block.id, block.cards[0]!.id, 0, "100");
    expect(toSource(next)).toBe('name "E"\nchassis tank\n\non start\n  drive forward 100\nend');
  });

  it("keeps the card's own indentation when it rewrites it", () => {
    const s = fromSource('name "E"\nchassis tank\n\non start\n      drive forward 60\nend');
    const block = handlerOf(s);
    const next = editCard(s, block.id, block.cards[0]!.id, 0, "10");
    expect(toSource(next)).toContain("      drive forward 10");
  });

  it("adds, moves and removes cards", () => {
    const s = fromSource(base);
    const block = handlerOf(s);
    const added = addCard(s, block.id, cardSpec("fire")!);
    expect(toSource(added)).toContain("  fire 2");

    const moved = moveCard(added, block.id, handlerOf(added).cards[1]!.id, -1);
    const lines = toSource(moved).split("\n");
    expect(lines.indexOf("  fire 2")).toBeLessThan(lines.indexOf("  drive forward 60"));

    const removed = removeCard(added, block.id, handlerOf(added).cards[0]!.id);
    expect(toSource(removed)).not.toContain("drive forward");
  });

  it("refuses to move a card off either end", () => {
    const s = fromSource(base);
    const block = handlerOf(s);
    expect(toSource(moveCard(s, block.id, block.cards[0]!.id, -1))).toBe(base);
    expect(toSource(moveCard(s, block.id, block.cards[0]!.id, 1))).toBe(base);
  });

  it("adds a block for an event, and will not offer it twice", () => {
    const s = addBlock(fromSource(base), "sense robot");
    expect(toSource(s)).toContain("on sense robot");
    expect(availableEvents(s)).not.toContain("sense robot");
    expect(availableEvents(s)).not.toContain("start");
  });

  it("leaves a raw card alone when asked to edit it", () => {
    // A conditional break: real RoboScript, deliberately outside the
    // catalogue, and it must be shown rather than rewritten.
    const s = fromSource('name "R"\nchassis tank\n\non start\n  loop\n    break if me.fuel < 5\n  end\nend');
    const block = handlerOf(s);
    const inner = block.cards[0]!.slots!["body"]![0]!;
    expect(inner.spec).toBe("raw");
    expect(toSource(editCard(s, block.id, inner.id, 0, "99"))).toContain("break if me.fuel < 5");
  });
});

/**
 * The output has to be a program, not merely text. A composer that could
 * assemble something the compiler rejects would hand a child a red squiggle
 * they did not write and cannot read.
 */
describe("what the cards produce", () => {
  it("compiles every card on its own, in both worlds", () => {
    for (const spec of CARDS) {
      const needsEvent = spec.holes.some((h) => h.default.startsWith("event."));
      const header = needsEvent ? "on sense robot" : "on start";
      // `var seen = 0` in the preamble because one card in the catalogue —
      // `set` — necessarily refers to a variable, and a statement that assigns
      // to nothing is not a fair test of the statement. `break` and
      // `continue` are wrapped in a loop for the same reason: the compiler
      // refuses them anywhere else, which is what `needsLoop` records.
      const body = spec.needsLoop
        ? `  loop\n  ${newCard(spec).text}\n  end`
        : newCard(spec).text;
      // A `do` needs something to do, so the routine it names is declared.
      const routine = spec.group === "do" ? "can dodge with power=1\n  stop\nend\n\n" : "";
      /*
       * The declarations are not instructions and may only appear at the top
       * of the file, so they are compiled where they belong rather than
       * wrapped in a handler like the rest.
       */
      const script =
        spec.group === "robot"
          ? `name "T"\nchassis tank\n${newCard(spec).text.trim()}\n\non start\n  stop\nend\n`
          : `name "T"\nchassis tank\nvar seen = 0\n\n${routine}${header}\n${body}\nend\n`;
      for (const theme of ["mechanical", "biological"] as const) {
        const result = checkScript(translate(script, theme));
        expect(result.ok ? null : `${spec.id} in ${theme}: ${result.error?.message}`).toBe(null);
      }
    }
  });

  it("compiles every angle choice", () => {
    const spec = cardSpec("turn-body-by")!;
    for (const choice of ANGLE_CHOICES) {
      const card = setHole(newCard(spec), 0, choice.value);
      const header = choice.needsEvent ? "on sense robot" : "on start";
      const script = `name "T"\nchassis tank\n\n${header}\n${card.text}\nend\n`;
      const result = checkScript(script);
      expect(result.ok ? null : `${choice.value}: ${result.error?.message}`).toBe(null);
    }
  });

  it("compiles a robot built entirely out of cards", () => {
    // The thing a child actually does: an empty robot, two blocks, a handful
    // of taps.
    let s = fromSource('name "Tapped"\nchassis tank\ncolor #ff8800\n');
    s = addBlock(s, "start");
    s = addCard(s, handlerOf(s).id, cardSpec("turret-sweep")!);
    s = addCard(s, handlerOf(s).id, cardSpec("drive-forward")!);
    s = addBlock(s, "sense robot");
    // The sensing handler, by its event — indices shift now that the
    // declarations are a block of their own.
    const sensing = s.blocks.find((b) => b.event === "sense robot")!.id;
    s = addCard(s, sensing, cardSpec("turret-aim")!);
    s = addCard(s, sensing, cardSpec("fire")!);

    const result = checkScript(toSource(s));
    expect(result.ok ? null : result.error?.message).toBe(null);
  });

  it("produces identical bytecode to the script it read", () => {
    // Stronger than "it compiles": reading a robot in and writing it out again
    // must not change what it does.
    for (const { id, source } of ALL) {
      const before = compile(parse(source));
      const after = compile(parse(toSource(fromSource(source))));
      expect(JSON.stringify(after), id).toBe(JSON.stringify(before));
    }
  });
});

describe("the catalogue", () => {
  it("has unique ids and resolvable placeholders", () => {
    const ids = CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const spec of CARDS) {
      for (const theme of ["mechanical", "biological"] as const) {
        // `{0}` is the hole, filled by the UI; everything else must be a
        // vocabulary placeholder that resolves.
        const strip = (t: string) => fillVocab(t, theme).replace(/\{\d\}/g, "");
        expect(strip(spec.say.full), spec.id).not.toMatch(/[{}]/);
        expect(strip(spec.say.simple), spec.id).not.toMatch(/[{}]/);
      }
    }
  });

  it("resolves the composer's own prompts too", () => {
    for (const theme of ["mechanical", "biological"] as const) {
      expect(fillVocab(WHEN_PROMPT.full, theme)).not.toMatch(/[{}]/);
      expect(fillVocab(WHEN_PROMPT.simple, theme)).not.toMatch(/[{}]/);
    }
  });

  /**
   * Every phrase has to place every hole it carries, in both registers.
   *
   * The block editor builds a block by walking the phrase and putting a
   * control wherever `{n}` appears. The simple phrases were written before
   * that existed — "Point at them" rather than "Point {0}" — so the control
   * and its field both vanished, and a block with no field for a value loses
   * that value the moment it is read back. The builder has a belt-and-braces
   * fallback for this; this test is the braces.
   */
  it("places every hole in both registers", () => {
    for (const spec of CARDS) {
      for (const register of ["full", "simple"] as const) {
        const phrase = spec.say[register];
        for (let at = 0; at < spec.holes.length; at++) {
          expect(phrase, `${spec.id} (${register})`).toContain(`{${at}}`);
        }
      }
    }
  });

  it("gives every template exactly as many holes as it declares", () => {
    for (const spec of CARDS) {
      const placeholders = (spec.template.match(/\{\d\}/g) ?? []).length;
      expect(placeholders, spec.id).toBe(spec.holes.length);
    }
  });

  /**
   * Every card must be readable back as itself. Without this a child could add
   * a card, reopen the robot, and find their own tap had become a raw card
   * they were no longer allowed to edit.
   */
  it("recognises its own output", () => {
    for (const spec of CARDS) {
      const card = newCard(spec);
      const script = `name "T"\nchassis tank\n\non sense robot\n${card.text}\nend`;
      const read = handlerOf(fromSource(script)).cards[0]!;
      /*
       * A plain-value twin whose default happens to be a value its named
       * sibling can hold reads back as the sibling, and that is right: the
       * friendly block is the better way to say `drive forward 70`, and the
       * twin exists for the values the sibling cannot hold. What must never
       * happen is a statement reading back as `raw`, or with a different value.
       */
      expect(read.spec, spec.id).not.toBe("raw");
      expect(read.holes.map((h) => h.value), spec.id).toEqual(card.holes.map((h) => h.value));
    }
  });

  /**
   * The value-eaters, all in one place.
   *
   * A spec whose control is a dropdown or a stepped slider can only hold what
   * that control offers. Claiming a line it cannot hold means silently
   * rounding or replacing somebody's value — `turn body by 150` became "at
   * them", and `drive forward 55` would have been rounded to 60 by a slider
   * with a step of ten. Each of these must land on the plain-value twin.
   */
  it("hands a value its control cannot hold to the plain twin", () => {
    const cases: [string, string, string][] = [
      ["turn body by 150", "turn-body-by-value", "150"],
      ["drive forward 55", "drive-forward-value", "55"],
      ["fire power", "fire-value", "power"],
      ["wait 7 ticks", "wait-value", "7"],
      ["turret.aim at target", "turret-aim-value", "target"],
      ["drive cruise * 0.5", "drive-value", "cruise * 0.5"],
    ];
    for (const [line, expected, value] of cases) {
      const s = fromSource(`name "T"\nchassis tank\n\non sense robot\n  ${line}\nend`);
      expect(handlerOf(s).cards[0]!.spec, line).toBe(expected);
      expect(handlerOf(s).cards[0]!.holes[0]?.value, line).toBe(value);
    }
  });

  it("keeps the friendly block for a value it can hold", () => {
    for (const [line, expected] of [
      ["turn body by 90", "turn-body-by"],
      ["drive forward 70", "drive-forward"],
      ["fire 3", "fire"],
      ["turret.aim at event.bearing", "turret-aim"],
    ] as [string, string][]) {
      const s = fromSource(`name "T"\nchassis tank\n\non sense robot\n  ${line}\nend`);
      expect(handlerOf(s).cards[0]!.spec, line).toBe(expected);
    }
  });
});

/**
 * A variable you have made should be something you can pick up. The palette
 * offers one draggable value block per declared name, and the name field on a
 * variable block only offers names that exist — referring to one that does not
 * is a compile error the child did not write and cannot read.
 */
describe("which variables a script has", () => {
  it("finds the globals at the top", () => {
    const s = fromSource('name "V"\nchassis tank\nvar seen = 0\nvar mood = 1\n\non start\n  stop\nend');
    expect(declaredVariables(s)).toEqual(["seen", "mood"]);
  });

  it("finds one declared inside a handler", () => {
    const s = fromSource('name "V"\nchassis tank\n\non start\n  var local = 2\n  stop\nend');
    expect(declaredVariables(s)).toEqual(["local"]);
  });

  it("finds one declared inside a branch", () => {
    const s = fromSource(
      'name "V"\nchassis tank\n\non tick\n  if 1 is 1 then\n    var deep = 3\n  end\nend',
    );
    expect(declaredVariables(s)).toEqual(["deep"]);
  });

  it("lists each name once, in the order they appear", () => {
    const s = fromSource(
      'name "V"\nchassis tank\nvar a = 0\n\non start\n  var b = 1\n  set a = 2\nend',
    );
    expect(declaredVariables(s)).toEqual(["a", "b"]);
  });

  it("does not mistake setting one for making one", () => {
    // `set` changes a variable; only `var` brings one into being.
    const s = fromSource('name "V"\nchassis tank\n\non start\n  set nothere = 1\nend');
    expect(declaredVariables(s)).toEqual([]);
  });

  it("finds none in a robot that has none", () => {
    expect(declaredVariables(fromSource(TOUR_SEED))).toEqual([]);
  });
});
