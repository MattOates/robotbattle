/**
 * VM behaviour, especially the properties that make it safe to run a script
 * that arrived from a stranger over the network.
 */

import { describe, expect, it } from "vitest";
import { createWorld, makeManifest } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { OPS_PER_TICK } from "../../src/sim/types.js";

function world(sources: string[]) {
  return createWorld(makeManifest(sources.map((source) => ({ source })), { seed: 11 }));
}

describe("time slicing", () => {
  it("survives an infinite loop without hanging", () => {
    // The robot becomes unresponsive, but the match keeps running — this is
    // the property that lets us run untrusted scripts at all.
    const w = world([`chassis tank\non start\n  loop\n  end\nend\n`, `chassis tank\n`]);
    const started = Date.now();
    for (let i = 0; i < 200; i++) step(w);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(w.tick).toBe(200);
  });

  it("resumes a long handler across ticks instead of failing it", () => {
    // Far more iterations than one tick's quantum allows, so it must survive
    // being suspended and resumed to reach the end.
    const iterations = OPS_PER_TICK * 3;
    const w = world([
      `chassis tank\nvar total = 0\non start\n  for i = 1 to ${iterations}\n    set total = total + 1\n  end\n  set name = "done " + total\nend\n`,
    ]);
    const r = w.robots[0]!;
    for (let i = 0; i < 200 && !r.name.startsWith("done"); i++) step(w);
    expect(r.name).toBe(`done ${iterations}`);
  });

  it("waits the requested number of ticks", () => {
    const w = world([`chassis tank\non start\n  wait 10 ticks\n  set name = "awake"\nend\n`]);
    const r = w.robots[0]!;
    for (let i = 0; i < 5; i++) step(w);
    expect(r.name).not.toBe("awake");
    for (let i = 0; i < 12; i++) step(w);
    expect(r.name).toBe("awake");
  });
});

describe("control flow", () => {
  it("runs loop with break", () => {
    const w = world([
      `chassis tank\nvar n = 0\non start\n  loop\n    set n = n + 1\n    break if n >= 5\n  end\n  set name = "n=" + n\nend\n`,
    ]);
    step(w);
    expect(w.robots[0]!.name).toBe("n=5");
  });

  it("runs a for loop over an inclusive range", () => {
    const w = world([
      `chassis tank\nvar total = 0\non start\n  for i = 1 to 4\n    set total = total + i\n  end\n  set name = "" + total\nend\n`,
    ]);
    step(w);
    expect(w.robots[0]!.name).toBe("10");
  });

  it("runs repeat a fixed number of times", () => {
    const w = world([
      `chassis tank\nvar n = 0\non start\n  repeat 7 times\n    set n = n + 1\n  end\n  set name = "" + n\nend\n`,
    ]);
    step(w);
    expect(w.robots[0]!.name).toBe("7");
  });

  it("skips the rest of an iteration on continue", () => {
    const w = world([
      `chassis tank\nvar odd = 0\non start\n  for i = 1 to 6\n    continue if i mod 2 is 0\n    set odd = odd + 1\n  end\n  set name = "" + odd\nend\n`,
    ]);
    step(w);
    expect(w.robots[0]!.name).toBe("3");
  });

  it("short-circuits and / or", () => {
    const w = world([
      `chassis tank\nvar reached = 0\non start\n  if false and 1/0 > 0\n    set reached = 1\n  end\n  set name = "" + reached\nend\n`,
    ]);
    step(w);
    expect(w.robots[0]!.name).toBe("0");
  });
});

describe("forgiving value semantics", () => {
  it("joins text with +", () => {
    const w = world([`chassis tank\non start\n  set name = "hp " + me.health\nend\n`]);
    step(w);
    expect(w.robots[0]!.name).toBe("hp 100");
  });

  it("treats divide by zero as zero rather than infinity", () => {
    // An Infinity leaking into a position would desync every peer downstream.
    const w = world([`chassis tank\non start\n  set name = "" + (5 / 0)\nend\n`]);
    step(w);
    expect(w.robots[0]!.name).toBe("0");
  });

  it("caps a runaway label", () => {
    const w = world([
      `chassis tank\nvar s = "x"\non start\n  repeat 8\n    set s = s + s\n  end\n  set name = s\nend\n`,
    ]);
    for (let i = 0; i < 5; i++) step(w);
    expect(w.robots[0]!.name.length).toBeLessThanOrEqual(24);
  });
});

describe("event queue", () => {
  it("does not stack up ticks behind a slow handler", () => {
    const w = world([
      `chassis tank\nvar n = 0\non tick\n  for i = 1 to 5000\n    set n = n + 0\n  end\n  set n = n + 1\nend\n`,
    ]);
    const r = w.robots[0]!;
    for (let i = 0; i < 50; i++) step(w);
    // With a handler far slower than one tick, the robot must fall behind
    // gracefully rather than build an unbounded backlog.
    expect(r.vm.busy || !r.vm.hasQueued("tick")).toBe(true);
  });
});
