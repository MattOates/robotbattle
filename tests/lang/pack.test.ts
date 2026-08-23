/**
 * Putting several things into one message and getting them back out.
 *
 * `broadcast` carries a single value, and anything worth saying is usually
 * three or four things at once — a tag, a kind of news, a place. These five
 * functions are what make that expressible without inventing a record type.
 *
 * `pack` is also the language's first variable-arity function, so the arity
 * range is tested at both ends: the compiler used to demand an exact count and
 * now has to accept one of several.
 */

import { describe, expect, it } from "vitest";
import { createWorld, makeManifest, checkScript } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { PACK_SEPARATOR } from "../../src/lang/builtins.js";

/** Runs an expression once and hands back what it came to, as the label. */
function evaluate(expression: string): string {
  const w = createWorld(
    makeManifest([{ source: `name "-"\nchassis tank\non start\n  set name = ${expression}\nend\n` }], {
      seed: 1,
    }),
  );
  step(w);
  return w.robots[0]!.name;
}

describe("pack", () => {
  it("joins its arguments with the separator", () => {
    expect(evaluate('pack("red", 7)')).toBe(`red${PACK_SEPARATOR}7`);
  });

  it("takes as few as two and as many as eight", () => {
    expect(evaluate('pack("a", "b")')).toBe("a|b");
    expect(evaluate('pack(1, 2, 3, 4, 5, 6, 7, 8)')).toBe("1|2|3|4|5|6|7|8");
  });

  it("flattens numbers the way every other message does", () => {
    // `toText`, so two peers cannot format the same number differently.
    expect(evaluate("pack(1 / 3, 2)")).toBe("0.33|2");
  });

  it("is rejected with nine", () => {
    const result = checkScript(
      `name "x"\nchassis tank\non start\n  set name = pack(1,2,3,4,5,6,7,8,9)\nend\n`,
    );
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("1 to 8 values");
  });

  it("is rejected with none", () => {
    const result = checkScript(`name "x"\nchassis tank\non start\n  set name = pack()\nend\n`);
    expect(result.ok).toBe(false);
  });
});

describe("field", () => {
  it("counts from one, the way everybody else counts", () => {
    expect(evaluate('field(pack("red", "help"), 1)')).toBe("red");
    expect(evaluate('field(pack("red", "help"), 2)')).toBe("help");
  });

  it("gives empty text for a slot that is not there", () => {
    // A message from somebody else is not something a script can be sure of
    // the shape of, so asking past the end is an answer, not an error.
    expect(evaluate('field(pack("red", "help"), 9)')).toBe("");
    expect(evaluate('field("", 1)')).toBe("");
  });

  it("round-trips through a whole message", () => {
    expect(evaluate('field(pack("a", "b", "c"), 3)')).toBe("c");
  });
});

describe("fieldcount", () => {
  it("counts what was packed", () => {
    expect(evaluate('fieldcount(pack("a", "b", "c"))')).toBe("3");
  });

  it("says none for an empty message", () => {
    expect(evaluate('fieldcount("")')).toBe("0");
  });
});

describe("number and text", () => {
  it("turns a packed number back into one you can add to", () => {
    expect(evaluate('number(field(pack("tag", 41), 2)) + 1')).toBe("42");
  });

  it("gives zero for something that is not a number", () => {
    expect(evaluate('number("banana")')).toBe("0");
  });

  it("turns a number into text", () => {
    expect(evaluate("text(7) + text(7)")).toBe("77");
  });
});

describe("a separator inside a value", () => {
  it("splits there too, which is why it is a character nobody sends", () => {
    // Documented rather than defended against: escaping would make `field`
    // markedly harder to explain to somebody who has not programmed before,
    // and `|` is not a character that turns up in a tag or a number.
    expect(evaluate('fieldcount(pack("a|b", "c"))')).toBe("3");
  });
});

describe("what the fixed-arity functions still do", () => {
  it("keeps rejecting the wrong count", () => {
    const result = checkScript(`name "x"\nchassis tank\non start\n  fire abs(1, 2)\nend\n`);
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("1 value");
  });
});
