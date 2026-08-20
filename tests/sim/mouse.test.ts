/**
 * Mouse, and the left-hand rule.
 *
 * The claim being checked is the one the robot is for: given a labyrinth and
 * long enough, keeping your left hand on the wall gets you round nearly all of
 * it. That is a claim about behaviour over thousands of ticks rather than about
 * any one call, so it is measured rather than asserted — the robot is put in
 * several different mazes and the cells it reaches are counted.
 *
 * The thresholds are set well below what it actually manages, because this is
 * here to catch the mechanic breaking, not to pin a tuning number. If a change
 * to walls, to the radar or to the sense cone quietly stops wall-following from
 * working, this is what says so.
 */

import { describe, expect, it } from "vitest";
import { drivableMazeGrid, generateFittingMaze } from "../../src/sim/maze.js";
import { createWorld, makeManifest } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { FUEL_PRESETS, MAX_HEALTH } from "../../src/sim/types.js";
import { MOUSE, SPINNER } from "../../src/bots/index.js";

const W = 900;
const H = 620;

/** Run one robot alone in a labyrinth; report the share of cells it reached. */
function explore(source: string, seed: number, ticks = 9000) {
  const grid = drivableMazeGrid(W, H);
  const walls = generateFittingMaze(seed, grid.cols, grid.rows, W, H);
  const world = createWorld(
    makeManifest([{ source }], {
      seed: 7,
      walls,
      // Alone, so what is measured is navigation and nothing else — and with a
      // tick limit above the run, or the match would end and quietly freeze the
      // measurement at whatever it had reached by then.
      maxTicks: ticks + 10,
      fuel: { ...FUEL_PRESETS.arena, enabled: false, maxOnField: 0 },
    }),
  );
  const r = world.robots[0]!;
  const seen = new Set<number>();
  const cw = W / grid.cols;
  const ch = H / grid.rows;
  let longestStall = 0;
  let stall = 0;
  let px = r.x;
  let py = r.y;
  for (let i = 0; i < ticks; i++) {
    step(world);
    // Throttle open but going nowhere: wedged, rather than deliberately stopped
    // to take a reading.
    if (r.throttle !== 0 && Math.hypot(r.x - px, r.y - py) < 0.3) {
      stall++;
      longestStall = Math.max(longestStall, stall);
    } else {
      stall = 0;
    }
    px = r.x;
    py = r.y;
    const cx = Math.min(grid.cols - 1, Math.max(0, Math.floor(r.x / cw)));
    const cy = Math.min(grid.rows - 1, Math.max(0, Math.floor(r.y / ch)));
    seen.add(cy * grid.cols + cx);
  }
  return {
    pct: (seen.size / (grid.cols * grid.rows)) * 100,
    longestStall,
    health: r.health,
    error: r.scriptError,
  };
}

describe("Mouse", () => {
  it("gets round a good share of a labyrinth in the time a match lasts", () => {
    // The number that matters, because it is the one anybody watches: 3600
    // ticks is a match. Measured at 44% on average across ten mazes, several of
    // them solved outright. The floor is set well under that — this is here to
    // catch wall-following breaking, not to pin a tuning number.
    let total = 0;
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const seed of seeds) {
      const run = explore(MOUSE, seed, 3600);
      expect(run.error).toBeNull();
      total += run.pct;
    }
    expect(total / seeds.length).toBeGreaterThan(30);
  });

  it("solves some labyrinths outright, given longer than a match", () => {
    // Wall-following is a complete method on a maze with no loops, which is
    // what `generateMaze` builds — so given time it should finish some of them
    // rather than merely wander widely.
    const solved = [2, 3, 6].map((seed) => explore(MOUSE, seed, 12000).pct);
    expect(Math.max(...solved)).toBeGreaterThan(95);
  });

  it("does not sit grinding against a corner", () => {
    // The visible complaint, as a number. Before the wedge detector it could
    // stall for 160 ticks at a time; anything over about a second reads as a
    // robot that has given up.
    for (const seed of [1, 5, 9]) {
      expect(explore(MOUSE, seed, 3600).longestStall).toBeLessThan(40);
    }
  });

  it("beats a robot that only bounces off things", () => {
    // Spinner turns on the spot and has no idea where it is. The comparison is
    // the point: following a wall is a method, and a method should be visibly
    // better than not having one.
    const mouse = explore(MOUSE, 2, 3600).pct;
    const spinner = explore(SPINNER, 2, 3600).pct;
    expect(mouse).toBeGreaterThan(spinner * 1.5);
  });

  it("comes through a labyrinth unharmed", () => {
    // Walls cost no health, so a robot that navigates rather than grinds should
    // finish on a full tank of it. This is what caught the scrape damage making
    // mazes unsurvivable.
    expect(explore(MOUSE, 3, 3600).health).toBe(MAX_HEALTH);
  });

  it("walks the perimeter when there are no walls to follow", () => {
    // The left-hand rule taken literally in an open arena says "turn left" for
    // ever, which walks a robot round a box one stride wide. Mouse has to find
    // a wall before it will follow one, so instead it drives out to the edge
    // and goes round the outside.
    const world = createWorld(
      makeManifest([{ source: MOUSE }], {
        seed: 3,
        maxTicks: 3000,
        fuel: { ...FUEL_PRESETS.arena, enabled: false, maxOnField: 0 },
      }),
    );
    const r = world.robots[0]!;
    let minX = r.x;
    let maxX = r.x;
    let minY = r.y;
    let maxY = r.y;
    for (let i = 0; i < 2400; i++) {
      step(world);
      minX = Math.min(minX, r.x);
      maxX = Math.max(maxX, r.x);
      minY = Math.min(minY, r.y);
      maxY = Math.max(maxY, r.y);
    }
    // A circuit of the arena, not a small circle in the middle of it.
    expect(maxX - minX).toBeGreaterThan(W * 0.7);
    expect(maxY - minY).toBeGreaterThan(H * 0.7);
  });
});
