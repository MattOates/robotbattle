/**
 * The block shelf: reading `can` blocks out of a library, and dropping one
 * into a script.
 *
 * The property that matters throughout is that a drop leaves a script that
 * still compiles. Everything else here — where the text lands, what happens to
 * a name already in use, which blocks travel with the one you dragged — is in
 * service of that, so most of these tests end by compiling the result.
 */

import { describe, expect, it } from "vitest";
import { blockInsertion, groupBlocks, libraryBlocks } from "../../src/workshop/blocks.js";
import { blockSourcesIn } from "../../src/lang/complete.js";
import { compile } from "../../src/lang/compiler.js";
import { parse } from "../../src/lang/parser.js";

const HEAD = 'name "Test"\nchassis tank\ncolor #ff8800\n';

/** A robot record of the shape the shelf reads. */
const robot = (id: string, name: string, source: string) => ({ id, name, source });

const DODGE = `can dodge given hit by bullet
  turn body by event.bearing + 90
  drive forward 100
end`;

const compiles = (source: string) => {
  compile(parse(source));
  return true;
};

describe("reading blocks out of a script", () => {
  it("takes the whole block, comments and nesting and all", () => {
    const source = `${HEAD}
can hunt given sense robot
  -- line up first
  turret.aim at event.bearing
  if event.distance > 100 then
    fire 3
  else
    fire 1
  end
end

on tick
  do hunt
end
`;
    const blocks = blockSourcesIn(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toContain("-- line up first");
    // The `end` it stops at is the block's own, not the `if`'s.
    expect(blocks[0]!.text.trimEnd().endsWith("end")).toBe(true);
    expect(blocks[0]!.text.split("\n")).toHaveLength(9);
  });

  it("leaves out a block that has not been finished", () => {
    expect(blockSourcesIn(`${HEAD}\ncan half given tick\n  stop\n`)).toHaveLength(0);
  });

  it("notices which blocks a block hands off to", () => {
    const source = `${HEAD}\ncan a\n  do b\n  do c\n  do b\nend\n`;
    expect(blockSourcesIn(source)[0]!.calls).toEqual(["b", "c"]);
  });
});

describe("the shelf", () => {
  it("gathers blocks from every robot", () => {
    const shelf = libraryBlocks([
      robot("1", "Scout", `${HEAD}\n${DODGE}\n`),
      robot("2", "Hunter", `${HEAD}\ncan chase given sense robot\n  drive forward 90\nend\n`),
    ]);
    expect(shelf.map((b) => b.name).sort()).toEqual(["chase", "dodge"]);
    expect(shelf.find((b) => b.name === "chase")!.robotName).toBe("Hunter");
  });

  it("shows a block copied into two robots once, and says where it lives", () => {
    const shelf = libraryBlocks([
      robot("1", "Scout", `${HEAD}\n${DODGE}\n`),
      robot("2", "Hunter", `${HEAD}\n${DODGE}\n`),
    ]);
    expect(shelf).toHaveLength(1);
    expect(shelf[0]!.robotName).toBe("Scout");
    expect(shelf[0]!.alsoIn).toEqual(["Hunter"]);
  });

  it("keeps two different blocks that happen to share a name", () => {
    const other = DODGE.replace("100", "40");
    const shelf = libraryBlocks([
      robot("1", "Scout", `${HEAD}\n${DODGE}\n`),
      robot("2", "Hunter", `${HEAD}\n${other}\n`),
    ]);
    expect(shelf).toHaveLength(2);
  });

  it("groups by the event a block is given", () => {
    const shelf = libraryBlocks([
      robot("1", "Scout", `${HEAD}\n${DODGE}\n\ncan look given sense robot\n  stop\nend\n`),
    ]);
    expect(groupBlocks(shelf).map((g) => g.event)).toEqual(["hit by bullet", "sense robot"]);
  });

  it("keeps a plain `can` off the shelf, because it composes with nothing", () => {
    // A block with no `given` has not said what it works on, so there is no
    // question it is the answer to and no promise it will fit anywhere else.
    const shelf = libraryBlocks([
      robot("1", "Scout", `${HEAD}\ncan regroup\n  stop\nend\n\n${DODGE}\n`),
    ]);
    const offered = groupBlocks(shelf).flatMap((g) => g.blocks.map((b) => b.name));
    expect(offered).toEqual(["dodge"]);
    // It is still in the library, because blocks that hand off to it need it.
    expect(shelf.map((b) => b.name).sort()).toEqual(["dodge", "regroup"]);
  });
});

describe("dropping a block into a script", () => {
  const shelf = libraryBlocks([robot("1", "Scout", `${HEAD}\n${DODGE}\n`)]);
  const dodge = shelf[0]!;

  /** Apply an insertion, the way the editor applies it. */
  const drop = (doc: string, at: number | null, block = dodge, from = shelf) => {
    const edit = blockInsertion(doc, block, from, at);
    expect(edit, "expected an insertion").not.toBeNull();
    return { text: doc.slice(0, edit!.from) + edit!.text + doc.slice(edit!.from), edit: edit! };
  };

  it("lands at the end when nowhere in particular was asked for", () => {
    const doc = `${HEAD}\non tick\n  drive forward 50\nend\n`;
    const { text } = drop(doc, null);
    expect(text).toBe(`${doc}\n${DODGE}\n`);
    expect(compiles(text)).toBe(true);
  });

  it("goes after the handler it was dropped into, never inside it", () => {
    const doc = `${HEAD}\non tick\n  drive forward 50\nend\n\non start\n  stop\nend\n`;
    // Offset of "drive forward 50", i.e. the middle of the first handler.
    const { text } = drop(doc, doc.indexOf("drive"));
    const lines = text.split("\n");
    expect(lines.indexOf("can dodge given hit by bullet")).toBeGreaterThan(
      lines.indexOf("on tick"),
    );
    expect(lines.indexOf("can dodge given hit by bullet")).toBeLessThan(lines.indexOf("on start"));
    expect(compiles(text)).toBe(true);
  });

  it("lands where it was dropped when that is already the outside edge", () => {
    const doc = `${HEAD}\non tick\n  stop\nend\n`;
    const { text } = drop(doc, doc.indexOf("on tick"));
    expect(text.split("\n").indexOf("can dodge given hit by bullet")).toBeLessThan(
      text.split("\n").indexOf("on tick"),
    );
    expect(compiles(text)).toBe(true);
  });

  it("leaves a blank line either side and no more", () => {
    const doc = `${HEAD}\non tick\n  stop\nend\n`;
    const { text } = drop(doc, null);
    expect(text).not.toMatch(/\n\n\n/);
    expect(text).toMatch(/end\n\ncan dodge/);
  });

  it("refuses to add a second copy of a block already there", () => {
    const doc = `${HEAD}\n${DODGE}\n`;
    expect(blockInsertion(doc, dodge, shelf, null)).toBeNull();
  });

  it("renames when the script already has that name for something else", () => {
    const doc = `${HEAD}\ncan dodge given hit wall\n  turn body by 90\nend\n`;
    const { text, edit } = drop(doc, null);
    expect(edit.name).toBe("dodge2");
    expect(text).toContain("can dodge2 given hit by bullet");
    // Both survive, which is the point of renaming rather than refusing.
    expect(blockSourcesIn(text).map((b) => b.name)).toEqual(["dodge", "dodge2"]);
    expect(compiles(text)).toBe(true);
  });

  it("brings the blocks it hands off to along with it", () => {
    const source = `${HEAD}
can close given sense robot
  do steady
  drive forward 80
end

can steady
  turn body by 5
end
`;
    const from = libraryBlocks([robot("1", "Scout", source)]);
    const close = from.find((b) => b.name === "close")!;
    const { text, edit } = drop(`${HEAD}\non tick\n  stop\nend\n`, null, close, from);
    expect(edit.brought).toEqual(["steady"]);
    expect(text).toContain("can steady");
    expect(compiles(text)).toBe(true);
  });

  it("leaves a name the script has already spent to the script's own block", () => {
    const source = `${HEAD}\ncan close given sense robot\n  do steady\nend\n\ncan steady\n  turn body by 5\nend\n`;
    const from = libraryBlocks([robot("1", "Scout", source)]);
    const close = from.find((b) => b.name === "close")!;
    const doc = `${HEAD}\ncan steady\n  turn body by 40\nend\n`;
    const { text, edit } = drop(doc, null, close, from);
    expect(edit.brought).toEqual([]);
    // The newcomer calls the one that was already here, unchanged.
    expect(text).toContain("turn body by 40");
    expect(text).not.toContain("turn body by 5");
    expect(compiles(text)).toBe(true);
  });

  it("drops into an empty script without leaving stray blank lines", () => {
    const edit = blockInsertion("", dodge, shelf, null)!;
    expect(edit.text).toBe(`${DODGE}\n`);
  });
});
