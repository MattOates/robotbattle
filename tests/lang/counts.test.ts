/**
 * `every`, `after`, `before`, `at` — how often a block runs.
 *
 * A tick is not a unit of time anyone thinks in, and nearly nobody who writes a
 * tick handler wants it to run on every tick. Written by hand that wants a
 * counter, an increment and a `mod` test whose polarity is easy to get
 * backwards, so the count moved into the header.
 *
 * The tests that matter are the counting ones: not "does it compile" but "over
 * 300 ticks, exactly how many times did it run, and which times were they".
 */

import { describe, expect, it } from "vitest";
import { parse } from "../../src/lang/parser.js";
import { compile } from "../../src/lang/compiler.js";
import { programIdentity } from "../../src/lang/bytecode.js";
import { createWorld, makeManifest } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { SAMPLE_BOTS } from "../../src/bots/index.js";

const HEAD = 'name "T"\nchassis tank\ncolor #ff8800\n\n';

/** Which ticks a block ran on, by watching the label it sets. */
function ranOn(body: string, ticks = 200): number[] {
  const source = `${HEAD}var n = 0\n\n${body}\n`;
  const world = createWorld(makeManifest([{ source }], { seed: 3 }));
  const bot = world.robots[0]!;
  const runs: number[] = [];
  for (let t = 1; t <= ticks; t++) {
    const before = bot.name;
    step(world);
    if (bot.name !== before) runs.push(t);
  }
  return runs;
}

/** A tick block that stamps the tick number every time it runs. */
const stamping = (clauses: string) =>
  `can mark given tick ${clauses}\n  set n = n + 1\n  set name = "" + n\nend`;

const refusal = (source: string): string | null => {
  try {
    compile(parse(source));
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};

describe("how often", () => {
  it("`every 30` runs on every thirtieth, and counting starts at one", () => {
    expect(ranOn(stamping("every 30"), 100)).toEqual([30, 60, 90]);
  });

  it("`at 2` runs once, on the second, and never again", () => {
    expect(ranOn(stamping("at 2"), 100)).toEqual([2]);
  });

  it("`after 3` runs from the fourth onward", () => {
    expect(ranOn(stamping("after 3"), 6)).toEqual([4, 5, 6]);
  });

  it("`before 4` runs until the fourth, which it does not include", () => {
    expect(ranOn(stamping("before 4"), 10)).toEqual([1, 2, 3]);
  });
});

describe("clauses together", () => {
  it("`after` starts the cadence counting, so `every 10 after 25` runs at 35", () => {
    // The reading that matters: "wait 25, then every 10 from there" — not
    // "every 10 on the match clock, once we are past 25", which would run at
    // 30 for a reason nobody reading the line could work out.
    expect(ranOn(stamping("every 10 after 25"), 60)).toEqual([35, 45, 55]);
  });

  it("counts the same way for something that happens rarely", () => {
    // Where the reading really shows. Two bumps, then every third bump after
    // that — so the fifth, the eighth, the eleventh. Ticks are forgiving about
    // this because they are so frequent; hits are not.
    const source = `${HEAD}var bumps = 0

can tally given hit wall
  set bumps = bumps + 1
end

can rally given hit wall after 2 every 3
  set name = "bump" + bumps
end

can go given start
  drive forward 100
end
`;
    const world = createWorld(makeManifest([{ source }], { seed: 3 }));
    const bot = world.robots[0]!;
    const ranAt: string[] = [];
    for (let t = 0; t < 3000; t++) {
      step(world);
      if (bot.name.startsWith("bump") && !ranAt.includes(bot.name)) ranAt.push(bot.name);
    }
    expect(ranAt.slice(0, 3)).toEqual(["bump5", "bump8", "bump11"]);
  });

  it("`every 10 before 35` stops when the window closes", () => {
    expect(ranOn(stamping("every 10 before 35"), 60)).toEqual([10, 20, 30]);
  });

  it("`every 10 after 25 before 55` is a window with a cadence inside it", () => {
    expect(ranOn(stamping("every 10 after 25 before 55"), 100)).toEqual([35, 45]);
  });

  it("counts from the start again when there is no `after`", () => {
    expect(ranOn(stamping("every 10"), 35)).toEqual([10, 20, 30]);
  });

  it("does not care what order they are written in", () => {
    const a = compile(parse(`${HEAD}var n = 0\n\n${stamping("every 10 after 25")}\n`));
    const b = compile(parse(`${HEAD}var n = 0\n\n${stamping("after 25 every 10")}\n`));
    expect(programIdentity(b)).toBe(programIdentity(a));
  });
});

describe("each block counts for itself", () => {
  it("two blocks on one event keep their own tallies", () => {
    // Both blocks run on tick 30 — one because 30 divides by 30, the other
    // because it divides by 10 — and a third block reports at the end of every
    // tick, since anything happening mid-tick is invisible from out here.
    const source = `${HEAD}var slow = 0
var fast = 0

can rare given tick every 30
  set slow = slow + 1
end

can often given tick every 10
  set fast = fast + 1
end

can report given tick
  set name = "" + slow + "/" + fast
end
`;
    const world = createWorld(makeManifest([{ source }], { seed: 3 }));
    const bot = world.robots[0]!;
    const at: Record<number, string> = {};
    for (let t = 1; t <= 60; t++) {
      step(world);
      at[t] = bot.name;
    }
    expect(at[9]).toBe("0/0");
    expect(at[10]).toBe("0/1");
    expect(at[29]).toBe("0/2");
    expect(at[30]).toBe("1/3");
    expect(at[60]).toBe("2/6");
  });

  it("counts a block used by hand, not the event", () => {
    // `do` past the gate is still an arrival, so a block asked for 10 times
    // runs once — the same rule wherever it is used from.
    const source = `${HEAD}var n = 0

can rare every 10
  set n = n + 1
  set name = "" + n
end

on tick
  do rare
  do rare
end
`;
    // Two arrivals per tick, so it runs on every fifth tick.
    expect(ranOn(source.slice(HEAD.length + "var n = 0\n\n".length), 20)).toEqual([5, 10, 15, 20]);
  });
});

describe("what it compiles to", () => {
  it("costs nothing to a script that does not use it", () => {
    const plain = `${HEAD}on tick\n  drive forward 50\nend\n`;
    expect(programIdentity(compile(parse(plain)))).toBe(programIdentity(compile(parse(plain))));
    for (const bot of SAMPLE_BOTS) {
      expect(() => compile(parse(bot.source)), bot.id).not.toThrow();
    }
  });

  it("is exactly the counter you would have written by hand", () => {
    const label = (source: string) => {
      const world = createWorld(makeManifest([{ source }], { seed: 3 }));
      for (let i = 0; i < 100; i++) step(world);
      return world.robots[0]!.name;
    };
    const withClause = `${HEAD}var n = 0\n\non tick every 30\n  set n = n + 1\n  set name = "" + n\nend\n`;
    // The same thing written out: a counter, an increment, and the test that
    // has to have `is 0` on the end of it.
    const byHand = `${HEAD}var n = 0\nvar c = 0\n\non tick\n  set c = c + 1\n  if c mod 30 is 0 then\n    set n = n + 1\n    set name = "" + n\n  end\nend\n`;
    expect(label(withClause)).toBe("3");
    expect(label(byHand)).toBe("3");
  });

  it("works on a handler written out, too", () => {
    expect(ranOn(`on tick every 25\n  set n = n + 1\n  set name = "" + n\nend`, 100)).toEqual([
      25, 50, 75, 100,
    ]);
  });
});

describe("refusals", () => {
  const cases: Array<[string, string, RegExp]> = [
    [
      "a cadence that has to be worked out",
      `${HEAD}var g = 3\n\ncan a given tick every g\n  stop\nend\n`,
      /`every` needs a plain number/,
    ],
    [
      "a zero",
      `${HEAD}can a given tick every 0\n  stop\nend\n`,
      /whole number of times, 1 or more/,
    ],
    [
      "a fraction",
      `${HEAD}can a given tick every 2.5\n  stop\nend\n`,
      /whole number of times, 1 or more/,
    ],
    [
      "saying it twice",
      `${HEAD}can a given tick every 10 every 20\n  stop\nend\n`,
      /already says `every 10`/,
    ],
    [
      "`at` with anything else",
      `${HEAD}can a given tick at 5 every 2\n  stop\nend\n`,
      /cannot both be true/,
    ],
    [
      "a window with nothing in it",
      `${HEAD}can a given tick after 10 before 11\n  stop\nend\n`,
      /leaves no times in between/,
    ],
    [
      "a cadence that never comes round in time",
      `${HEAD}can a given tick every 40 before 30\n  stop\nend\n`,
      /never comes round before 30/,
    ],
  ];

  it.each(cases)("refuses %s", (_label, source, expected) => {
    const message = refusal(source);
    expect(message, "should have been refused").not.toBeNull();
    expect(message).toMatch(expected);
  });
});
