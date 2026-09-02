import { describe, expect, it } from "vitest";
import * as Blockly from "blockly/core";
import {
  COMPARE_BLOCK,
  NUM_BLOCK,
  PROP_BLOCK,
  VAR_BLOCK,
  blockTypeFor,
} from "../../src/ui/blocks/bridge.js";
import {
  ROUTINE_CATEGORY,
  VARIABLE_CATEGORY,
  routineFlyout,
  setKnownRoutines,
  setKnownVariables,
  toolboxFor,
  variableFlyout,
} from "../../src/ui/blocks/defs.js";
// Registers every block, as the editor does.
import "./helpers/workspace.js";

type Category = { kind: string; name?: string; custom?: string; contents?: { type?: string }[] };

function categories(): Category[] {
  const toolbox = toolboxFor("full") as { contents: Category[] };
  return toolbox.contents;
}

function named(name: string): Category {
  const found = categories().find((c) => c.name === name);
  if (!found) throw new Error(`no ${name} category`);
  return found;
}

/**
 * What is filed where.
 *
 * The palette is the only map of the language a block user gets, so where a
 * block lives is part of what it means. The three round reporters — a
 * property, a variable and a number — sat under Logic, which reads as "things
 * for writing an `if`". They are values, and a value goes in any socket: the
 * speed to drive at, how far to turn, how hard to shoot. Filing them under
 * deciding hid two thirds of what they are for.
 */
describe("where a block is filed", () => {
  it("leaves Logic with deciding and nothing else", () => {
    expect(named("Logic").contents?.map((b) => b.type)).toEqual([
      blockTypeFor("if"),
      COMPARE_BLOCK,
    ]);
  });

  it("puts every value you can pick up under Variables", () => {
    setKnownVariables(["seen", "mood"]);
    const types = variableFlyout().map((b) => (b as { type?: string }).type);
    // Making one and changing one.
    expect(types).toContain(blockTypeFor("var"));
    expect(types).toContain(blockTypeFor("set"));
    // The script's own variables, then the two generic values.
    expect(types.filter((t) => t === VAR_BLOCK)).toHaveLength(2);
    expect(types).toContain(NUM_BLOCK);
    expect(types).toContain(PROP_BLOCK);
  });

  it("offers a variable per declared name, in declaration order", () => {
    setKnownVariables(["first", "second"]);
    const names = variableFlyout()
      .filter((b) => (b as { type?: string }).type === VAR_BLOCK)
      .map((b) => (b as { fields?: { NAME?: string } }).fields?.NAME);
    expect(names).toEqual(["first", "second"]);
  });

  it("offers a call per named behaviour, with its own arity", () => {
    setKnownRoutines([
      { name: "dodge", args: 0 },
      { name: "fold", args: 3 },
    ]);
    const flyout = routineFlyout() as { type?: string; extraState?: { args?: number } }[];
    expect(flyout.find((b) => b.type === blockTypeFor("do"))).toBeDefined();
    const withArgs = flyout.find((b) => b.type === blockTypeFor("do-with"))!;
    expect(withArgs.extraState?.args).toBe(3);
  });

  it("names every block it offers, and Blockly knows all of them", () => {
    // A category listing a type nothing registered is a flyout that throws
    // when opened, which is the sort of thing only opening it would find.
    setKnownVariables(["seen"]);
    setKnownRoutines([{ name: "dodge", args: 1 }]);
    const listed = [
      ...categories().flatMap((c) => c.contents ?? []),
      ...variableFlyout(),
      ...routineFlyout(),
    ].map((b) => (b as { type?: string }).type);
    expect(listed.length).toBeGreaterThan(10);
    for (const type of listed) {
      expect(Blockly.Blocks[type!], type).toBeDefined();
    }
  });

  it("keeps the two computed categories computed", () => {
    // They are worked out when opened, so a variable made a moment ago is
    // there to pick up. A static list could not do that.
    expect(named("Variables").custom).toBe(VARIABLE_CATEGORY);
    expect(named("Behaviours").custom).toBe(ROUTINE_CATEGORY);
  });
});
