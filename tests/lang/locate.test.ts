/**
 * Asking the parser what is under the cursor.
 *
 * The interesting cases are the words that mean different things in different
 * places — `turret` is an instruction and a property, `name` is a declaration
 * and a property — because those are exactly the ones a highlighter working
 * from a word list gets wrong, and the reason this is worth having at all.
 */

import { describe, expect, it } from "vitest";
import { locate, offsetOf } from "../../src/lang/locate.js";

const H = 'name "x"\nchassis tank\n';

/** The offset of the first occurrence of `needle`, which is how a click arrives. */
const at = (source: string, needle: string): number => source.indexOf(needle);

describe("what is under the cursor", () => {
  it("finds a word and where it is", () => {
    const src = `${H}on tick\n  fire 2\nend\n`;
    const found = locate(src, at(src, "fire"))!;
    expect(found.word).toBe("fire");
    expect(src.slice(found.from, found.to)).toBe("fire");
  });

  it("names the rule the word belongs to", () => {
    const src = `${H}on tick\n  turret.sweep 45\nend\n`;
    expect(locate(src, at(src, "sweep"))!.rules).toContain("turretMember");
  });

  it("tells the same word apart in two places", () => {
    const action = `${H}on tick\n  turret.aim at 0\nend\n`;
    const property = `${H}var x = 0\non tick\n  set x = me.turret\nend\n`;

    expect(locate(action, at(action, "turret"))!.rules).toContain("turretStmt");
    expect(locate(property, property.indexOf("me.turret") + 3)!.rules).toContain("propName");
  });

  it("does the same for `name`, which is a declaration and a property", () => {
    const decl = `${H}on tick\n  stop\nend\n`;
    const prop = `${H}var x = 0\non tick\n  set name = "hunting"\nend\n`;

    expect(locate(decl, 0)!.rules).toContain("nameDecl");
    expect(locate(prop, prop.indexOf("set name") + 4)!.rules).toContain("setStmt");
  });

  it("reports the innermost rule last, so a caller can take the most specific", () => {
    const src = `${H}on tick\n  drive forward 60\nend\n`;
    const found = locate(src, at(src, "forward"))!;
    expect(found.rules[0]).toBe("program");
    expect(found.rules[found.rules.length - 1]).toBe("driveStmt");
  });

  it("gives the canonical word as well as the one that was typed", () => {
    const src = 'name "x"\nbody ciliate\non tick\n  stop\nend\n';
    const found = locate(src, at(src, "ciliate"))!;
    expect(found.word).toBe("ciliate");
    expect(found.canonical).toBe("skid");
  });

  it("finds nothing in the whitespace between words", () => {
    const src = `${H}on tick\n  fire 2\nend\n`;
    expect(locate(src, at(src, "  fire"))).toBeNull();
  });

  it("finds nothing in a script that does not parse", () => {
    expect(locate(`${H}on tick\n  wibble\nend\n`, 25)).toBeNull();
  });
});

describe("line and column to offset", () => {
  it("agrees with where the text actually is", () => {
    const src = `${H}on tick\n  fire 2\nend\n`;
    expect(offsetOf(src, 4, 3)).toBe(at(src, "fire"));
  });

  it("does not run off the end", () => {
    expect(offsetOf("a\n", 99, 99)).toBe(2);
  });
});
