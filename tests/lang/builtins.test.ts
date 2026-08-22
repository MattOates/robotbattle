/**
 * The functions a script can call, and the two things about them that bite.
 *
 * The first is that the order of the table is bytecode. `CALL` carries an index
 * into `BUILTIN_NAMES`, so moving an entry changes what every already-compiled
 * program does — `abs(x)` becomes `min(x)` — and inserting one anywhere but the
 * end shifts everything after it. `tests/determinism/golden.test.ts` would catch
 * it eventually, as a hash mismatch with no explanation attached; this catches
 * it here, with one.
 *
 * The second is that the documentation has to be true. A function's arity is
 * counted from its parameter list rather than written beside it, so those
 * cannot disagree — but the descriptions and examples still can, and an example
 * that does not compile is worse than no example at all.
 */

import { describe, expect, it } from "vitest";
import { BUILTINS, BUILTIN_NAMES, BUILTIN_SIGNATURES, signatureOf } from "../../src/lang/builtins.js";
import { checkScript } from "../../src/sim/world.js";

describe("the order of the table", () => {
  /**
   * Written out rather than derived, deliberately: this is the one test that
   * has to fail when the table changes, so it cannot read from the table.
   */
  it("is the order the bytecode refers to them by", () => {
    expect(BUILTIN_NAMES).toEqual([
      "abs",
      "min",
      "max",
      "random",
      "randomint",
      "sin",
      "cos",
      "sqrt",
      "round",
      "floor",
      "ceil",
      "distance",
      "bearing",
    ]);
  });
});

describe("every function is described", () => {
  const names = Object.keys(BUILTINS);

  it.each(names)("%s says what it does", (name) => {
    expect(BUILTINS[name]!.summary.length).toBeGreaterThan(20);
  });

  it.each(names)("%s names and describes each of its arguments", (name) => {
    for (const param of BUILTINS[name]!.params) {
      expect(param.name, `${name} argument name`).toMatch(/^[a-z][a-z0-9]*$/);
      expect(param.detail.length, `${name}.${param.name}`).toBeGreaterThan(4);
    }
  });

  it("gives no two arguments of one function the same name", () => {
    for (const name of names) {
      const used = BUILTINS[name]!.params.map((p) => p.name);
      expect(new Set(used).size, name).toBe(used.length);
    }
  });

  it("never falls back to `a`, `b`, `c`, which is what this replaced", () => {
    const lazy = names.filter((n) =>
      BUILTINS[n]!.params.some((p) => /^[a-d]$/.test(p.name)),
    );
    expect(lazy).toEqual([]);
  });
});

describe("arity", () => {
  it("is counted from the arguments rather than written down twice", () => {
    for (const name of Object.keys(BUILTINS)) {
      expect(BUILTIN_SIGNATURES[name], name).toBe(BUILTINS[name]!.params.length);
    }
  });
});

describe("the examples", () => {
  const cases = Object.entries(BUILTINS).map(([name, fn]) => [name, fn.example] as const);

  it.each(cases)("`%s` shows something that compiles", (_name, example) => {
    // `on sense robot` rather than `on tick`, because an example is allowed to
    // read `event.` — that is where these functions are most used.
    const script = `name "x"\nchassis tank\nvar out = 0\non sense robot\n  set out = ${example}\nend\n`;
    const result = checkScript(script);
    expect(result.ok, `${example}\n${result.error?.message}`).toBe(true);
  });

  it.each(cases)("`%s` shows an example that calls it", (name, example) => {
    expect(example).toContain(`${name}(`);
  });
});

describe("signatures", () => {
  it("uses the real argument names", () => {
    expect(signatureOf("distance")).toBe("distance(x1, y1, x2, y2)");
    expect(signatureOf("random")).toBe("random()");
  });

  it("does not invent one for a function that does not exist", () => {
    expect(signatureOf("wobble")).toBe("wobble()");
  });
});
