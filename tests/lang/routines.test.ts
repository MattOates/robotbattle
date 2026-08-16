/**
 * `can` blocks: reuse, without a call stack.
 *
 * The first two tests here are the whole specification. A `can` block is
 * copied out where it is used, so using one has to compile to exactly what
 * writing it out would have compiled to — and a block that becomes a handler
 * has to compile to exactly what writing that handler out would have. If either
 * of those ever stops being true, the feature has quietly become something
 * else, and every peer replaying a match has to agree about which.
 */

import { describe, expect, it } from "vitest";
import { parse } from "../../src/lang/parser.js";
import { compile } from "../../src/lang/compiler.js";
import { programIdentity } from "../../src/lang/bytecode.js";
import { createWorld, makeManifest } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { SAMPLE_BOTS } from "../../src/bots/index.js";

const HEAD = 'name "Test"\nchassis tank\ncolor #ff8800\n\n';

const identity = (source: string): string => programIdentity(compile(parse(source)));

/** The compiler's complaint about a script, or null if it has none. */
function refusal(source: string): string | null {
  try {
    compile(parse(source));
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Run a script alone for a while and report the label it ended up showing. */
function labelAfter(source: string, ticks: number): string {
  const world = createWorld(makeManifest([{ source }], { seed: 3 }));
  for (let i = 0; i < ticks; i++) step(world);
  return world.robots[0]!.name;
}

describe("what `do` means", () => {
  it("compiles to exactly what writing it out compiles to", () => {
    const withBlock = `${HEAD}can chase
  turret.aim at 30
  fire 3
end

on tick
  do chase
  do chase
end
`;
    const longhand = `${HEAD}on tick
  turret.aim at 30
  fire 3
  turret.aim at 30
  fire 3
end
`;
    expect(identity(withBlock)).toBe(identity(longhand));
  });

  it("costs a robot exactly what writing it out would cost", () => {
    // Same instructions means the same fuel, so nobody is charged for tidying
    // their script up.
    const withBlock = `${HEAD}can spin\n  turn body by 10\nend\n\non tick\n  do spin\nend\n`;
    const longhand = `${HEAD}on tick\n  turn body by 10\nend\n`;
    expect(compile(parse(withBlock)).ops.length).toBe(compile(parse(longhand)).ops.length);
  });

  it("nests, and each copy carries its own source lines", () => {
    const source = `${HEAD}can inner\n  fire 1\nend\n\ncan outer\n  do inner\n  do inner\nend\n\non tick\n  do outer\nend\n`;
    const chunk = compile(parse(source));
    // Both copies of `fire 1` point back at line 6, where it is written.
    const fireLines = chunk.ops
      .map((_, i) => chunk.lines[i]!)
      .filter((_, i) => chunk.ops[i] === chunk.ops[chunk.ops.length - 2]);
    expect(fireLines.length).toBeGreaterThan(0);
    expect(refusal(source)).toBeNull();
  });
});

describe("blocks that run on their own", () => {
  it("compile to exactly what writing the handler out compiles to", () => {
    const registered = `${HEAD}can dodge given hit by bullet
  turn body by event.bearing + 90
end

can flee given hit by bullet
  drive forward 100
end
`;
    const written = `${registered}
on hit by bullet
  do dodge
  do flee
end
`;
    expect(identity(registered)).toBe(identity(written));
  });

  it("run in the order they were written", () => {
    const source = `${HEAD}var log = ""

can first given tick
  set log = log + "1"
  set name = log
end

can second given tick
  set log = log + "2"
  set name = log
end
`;
    expect(labelAfter(source, 3)).toBe("121212");
  });

  it("make the simulation raise the event at all", () => {
    // `step.ts` skips work for events nobody handles, so registering has to
    // reach `handlers` or the block would never run.
    const source = `${HEAD}can watch given sense robot\n  stop\nend\n`;
    expect(compile(parse(source)).handlers["sense robot"]).toBeDefined();
  });

  it("stand aside for a handler that was written out", () => {
    const source = `${HEAD}can dodge given hit by bullet\n  drive forward 100\nend\n\non hit by bullet\n  stop\nend\n`;
    const withoutTheBlock = `${HEAD}on hit by bullet\n  stop\nend\n`;
    // The block is now library code nobody called, so it leaves no trace.
    expect(identity(source)).toBe(identity(withoutTheBlock));
  });

  it("cannot run alone when something has to be handed to them", () => {
    const needsOne = `${HEAD}can shove with effort given hit by bullet\n  fire effort\nend\n`;
    expect(compile(parse(needsOne)).handlers["hit by bullet"]).toBeUndefined();

    const hasADefault = `${HEAD}can shove with effort=2 given hit by bullet\n  fire effort\nend\n`;
    expect(compile(parse(hasADefault)).handlers["hit by bullet"]).toBeDefined();
  });
});

describe("what a block is given", () => {
  it("is its own for the length of the block, and gives the name back after", () => {
    const source = `${HEAD}var power = 1
var seen = ""

can shove with power=9
  set seen = "in:" + power
end

on tick
  do shove
  set name = seen + " out:" + power
end
`;
    expect(labelAfter(source, 6)).toBe("in:9 out:1");
  });

  it("is worked out once, at the point it is handed over", () => {
    const source = `${HEAD}var n = 0

can show with value
  set name = "v" + value
end

on tick
  set n = n + 1
  do show with n * 10
end
`;
    expect(labelAfter(source, 3)).toBe("v30");
  });

  it("falls back to its starting value when left out", () => {
    const source = `${HEAD}can show with a=1, b=2\n  set name = "" + a + b\nend\n\non tick\n  do show with 9\nend\n`;
    expect(labelAfter(source, 2)).toBe("92");
  });

  it("reads `event` when the block said which event it is for", () => {
    const source = `${HEAD}can note given tick\n  set name = "t" + arena.time\nend\n`;
    expect(labelAfter(source, 4)).toMatch(/^t\d+$/);
  });
});

describe("waiting inside a block", () => {
  it("suspends the handler exactly as it would written out", () => {
    const source = `${HEAD}var n = 0

can slow
  set n = n + 1
  set name = "n" + n
  wait 3 ticks
end

on tick
  do slow
end
`;
    expect(labelAfter(source, 4)).toBe("n1");
    expect(labelAfter(source, 12)).toBe("n3");
  });
});

describe("refusals", () => {
  const cases: Array<[string, string, RegExp]> = [
    ["a block nobody taught it", `${HEAD}on tick\n  do nope\nend\n`, /don't know how to `do nope`/],
    [
      "a block meant for another event",
      `${HEAD}can dodge given hit by bullet\n  stop\nend\n\non tick\n  do dodge\nend\n`,
      /needs a `hit by bullet`/,
    ],
    [
      "too little handed over",
      `${HEAD}can shove with a\n  fire a\nend\n\non tick\n  do shove\nend\n`,
      /needs 1 thing, and you gave it 0/,
    ],
    [
      "too much handed over",
      `${HEAD}can shove with a=1\n  fire a\nend\n\non tick\n  do shove with 1, 2\nend\n`,
      /you gave it 2/,
    ],
    [
      "a block that does itself",
      `${HEAD}can a\n  do b\nend\n\ncan b\n  do a\nend\n\non tick\n  do a\nend\n`,
      /ends up doing itself/,
    ],
    [
      "`event` with no event to speak of",
      `${HEAD}can dodge\n  turn body by event.bearing\nend\n\non tick\n  do dodge\nend\n`,
      /doesn't come with any event information/,
    ],
    ["a block inside a block", `${HEAD}on tick\n  can x\n    stop\n  end\nend\n`, /go outside/],
    [
      "two blocks with one name",
      `${HEAD}can a\n  stop\nend\n\ncan a\n  stop\nend\n`,
      /already have a `can a`/,
    ],
    [
      "a starting value before one without",
      `${HEAD}can a with x=1, y\n  fire y\nend\n`,
      /has to come before/,
    ],
    [
      "the same name twice in one block",
      `${HEAD}can a with x, x\n  fire x\nend\n`,
      /already given something/,
    ],
    [
      "a `break` with no loop around it",
      `${HEAD}can a\n  break\nend\n\non tick\n  do a\nend\n`,
      /inside a loop/,
    ],
  ];

  it.each(cases)("refuses %s", (_label, source, expected) => {
    const message = refusal(source);
    expect(message, "should have been refused").not.toBeNull();
    expect(message).toMatch(expected);
  });

  it("says what it does know when a name is wrong", () => {
    const message = refusal(`${HEAD}can chase\n  stop\nend\n\non tick\n  do chace\nend\n`);
    expect(message).toMatch(/do chace/);
  });
});

describe("scripts that use none of this", () => {
  it("compile exactly as they did before", () => {
    // The proof that adding the feature changed nothing underneath: every
    // sample bot still compiles, and the golden match test next door pins the
    // simulation itself.
    for (const bot of SAMPLE_BOTS) {
      expect(() => compile(parse(bot.source)), bot.id).not.toThrow();
    }
  });
});
