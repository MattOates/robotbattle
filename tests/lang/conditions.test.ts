/**
 * A condition has to be a question.
 *
 * RoboScript's VM will happily treat any value as true-or-false, and that is
 * the problem: `if tick mod 60` is a script that compiles, runs, looks alive,
 * and does the exact opposite of what its author meant — on 59 ticks out of 60.
 * Nobody learning to program should have to find that by staring at it, so the
 * compiler refuses conditions that are not tests.
 *
 * The refusal is only worth having if it says what to write instead, so the
 * messages are pinned here alongside the rule.
 */

import { describe, expect, it } from "vitest";
import { parse } from "../../src/lang/parser.js";
import { compile } from "../../src/lang/compiler.js";
import { RoboScriptError } from "../../src/lang/errors.js";
import { SAMPLE_BOTS } from "../../src/bots/index.js";

const HEAD = 'name "Test"\nchassis tank\ncolor #ff8800\n\n';

/** Compile a condition in a handler, returning the error or null. */
function check(cond: string): RoboScriptError | null {
  const source = `${HEAD}var seen = 0\nvar ready = false\n\non tick\n  if ${cond}\n    stop\n  end\nend\n`;
  try {
    compile(parse(source));
    return null;
  } catch (err) {
    if (err instanceof RoboScriptError) return err;
    throw err;
  }
}

describe("conditions that are questions", () => {
  const allowed = [
    "seen > 3",
    "seen is 0",
    "seen isnt none",
    "arena.time mod 60 is 0",
    "me.health <= 20",
    "seen > 3 and me.health < 50",
    "not seen is 0",
    "ready is true",
    "true",
    // Comparing the results of arithmetic is still comparing.
    "seen + 1 > me.speed * 2",
  ];

  it.each(allowed)("accepts `%s`", (cond) => {
    expect(check(cond)).toBeNull();
  });
});

describe("conditions that are not questions", () => {
  const refused = [
    ["seen", /`seen` on its own is not one/],
    ["arena.time mod 60", /is not one/],
    ["me.health", /`me\.health` on its own/],
    ["1", /`1` is a number/],
    ["seen + 1", /gives back a number/],
    ["abs(seen)", /gives back a number/],
    // Half a question is not a question.
    ["seen and me.health < 50", /is not one/],
    ["not seen", /is not one/],
  ] as const;

  it.each(refused)("refuses `%s`", (cond, expected) => {
    const err = check(cond);
    expect(err, "should have been refused").not.toBeNull();
    expect(err!.message).toMatch(expected);
  });

  it("says which keyword it is complaining about", () => {
    expect(check("seen")!.message).toMatch(/^`if` needs a question/);
    const source = `${HEAD}var n = 0\n\non tick\n  loop\n    break if n\n  end\nend\n`;
    expect(() => compile(parse(source))).toThrow(/`break` needs a question/);
  });

  it("points at the condition, not at the `if`", () => {
    const source = `${HEAD}var seen = 0\n\non tick\n  if seen\n    stop\n  end\nend\n`;
    try {
      compile(parse(source));
      expect.unreachable();
    } catch (err) {
      // Line 8 is the `if`; the column is where `seen` starts, not the `if`.
      expect((err as RoboScriptError).line).toBe(8);
      expect((err as RoboScriptError).col).toBeGreaterThan(5);
    }
  });
});

describe("what the refusal tells you to do", () => {
  it("names the fix for the `mod` case, which is the one that bites", () => {
    expect(check("arena.time mod 60")!.hint).toMatch(/mod 60 is 0/);
    // And says why, because "add `is 0`" without a reason teaches nothing.
    expect(check("arena.time mod 60")!.hint).toMatch(/every remainder except 0 counts as true/);
  });

  it("offers ways to compare a bare name", () => {
    const hint = check("seen")!.hint!;
    expect(hint).toContain("seen is true");
    expect(hint).toContain("seen > 0");
    expect(hint).toContain("seen isnt none");
  });

  it("lists the comparisons when it has nothing better to offer", () => {
    expect(check("seen + 1")!.hint).toMatch(/`is`, `isnt`, `>`, `<`/);
  });
});

describe("scripts that were already right", () => {
  it("still compile, every one of them", () => {
    // Every sample bot and every lesson already compared properly, which is
    // what made this rule affordable to add.
    for (const bot of SAMPLE_BOTS) {
      expect(() => compile(parse(bot.source)), bot.id).not.toThrow();
    }
  });
});
