import { describe, expect, it } from "vitest";
import { blockBundle, graftBlocks, libraryBlocks } from "../../src/workshop/blocks.js";
import { parse } from "../../src/lang/parser.js";
import { compile } from "../../src/lang/compiler.js";

const SENDER = `name "Giver"
chassis tank

can dodge given hit by bullet
  turn body by event.bearing + 90
  do scoot
end

can scoot given hit by bullet
  drive forward 90
end

on start
  drive forward 50
end
`;

const shelf = () => libraryBlocks([{ id: "r1", name: "Giver", source: SENDER }]);

describe("packing a block for travel", () => {
  it("brings what it hands off to", () => {
    const dodge = shelf().find((b) => b.name === "dodge")!;
    const bundle = blockBundle(dodge, shelf());
    expect(bundle).toContain("can dodge");
    expect(bundle, "scoot has to travel with it or dodge will not compile").toContain("can scoot");
  });
});

describe("grafting a bundle into a script", () => {
  const TARGET = `name "Taker"\nchassis tank\n\non start\n  drive forward 50\nend\n`;

  it("lands, and the result still compiles", () => {
    const bundle = blockBundle(shelf().find((b) => b.name === "dodge")!, shelf());
    const g = graftBlocks(TARGET, bundle, "Sam");
    expect(g.added).toContain("dodge");
    expect(() => compile(parse(g.source))).not.toThrow();
  });

  it("renames round a name already spent here", () => {
    const busy = `name "Taker"\nchassis tank\n\ncan dodge given hit by bullet\n  stop\nend\n\non start\n  drive forward 50\nend\n`;
    const bundle = blockBundle(shelf().find((b) => b.name === "dodge")!, shelf());
    const g = graftBlocks(busy, bundle, "Sam");
    expect(g.added.some((n) => n !== "dodge")).toBe(true);
    expect(g.source).toContain("can dodge given");
    expect(() => compile(parse(g.source))).not.toThrow();
  });

  it("skips a block this script already has, rather than making a second copy", () => {
    const bundle = blockBundle(shelf().find((b) => b.name === "scoot")!, shelf());
    const once = graftBlocks(TARGET, bundle, "Sam");
    const twice = graftBlocks(once.source, bundle, "Sam");
    expect(twice.added).toEqual([]);
    expect(twice.alreadyHad).toContain("scoot");
    expect(twice.source).toBe(once.source);
  });
});
