/**
 * The labyrinth lesson's example, checked against what the lesson claims.
 *
 * The chapter promises two specific things about Explorer: that keeping a left
 * hand on the wall gets it round the whole maze given time, and that `stride`
 * is the number which breaks it when it stops matching the maze. Prose that
 * says so is worth nothing if the example does something else, and neither
 * claim is visible to the compile check next door — so both are measured here,
 * in the same arena and against the same maze the playground builds.
 */

import { describe, expect, it } from "vitest";
import { loadLessons, extractCode } from "../../src/learn/markdown.js";
import { drivableMazeGrid, generateFittingMaze } from "../../src/sim/maze.js";
import { createWorld, makeManifest } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { FUEL_PRESETS } from "../../src/sim/types.js";

/** Must match `ARENA` and the seed in `learn/Playground.tsx`. */
const W = 460;
const H = 320;
const MAZE_SEED = 20260820;

const lesson = loadLessons().find((l) => l.id === "labyrinth");

/** The lesson's runnable example. */
function example(): string {
  const block = extractCode(lesson!.body).find((b) => b.info.lang === "try");
  return block!.code;
}

/** Share of the maze's squares the robot reaches, alone, in `ticks`. */
function explore(source: string, ticks: number): number {
  const grid = drivableMazeGrid(W, H);
  const walls = generateFittingMaze(MAZE_SEED, grid.cols, grid.rows, W, H);
  const world = createWorld(
    makeManifest([{ source }], {
      seed: 1,
      width: W,
      height: H,
      walls,
      maxTicks: ticks + 10,
      fuel: FUEL_PRESETS.off,
    }),
  );
  const r = world.robots[0]!;
  const seen = new Set<number>();
  const cw = W / grid.cols;
  const ch = H / grid.rows;
  for (let i = 0; i < ticks; i++) {
    step(world);
    const cx = Math.min(grid.cols - 1, Math.max(0, Math.floor(r.x / cw)));
    const cy = Math.min(grid.rows - 1, Math.max(0, Math.floor(r.y / ch)));
    seen.add(cy * grid.cols + cx);
  }
  return (seen.size / (grid.cols * grid.rows)) * 100;
}

describe("the labyrinth lesson", () => {
  it("is there, and its example runs in a maze", () => {
    expect(lesson, "no labyrinth lesson").toBeDefined();
    const block = extractCode(lesson!.body).find((b) => b.info.lang === "try");
    expect(block, "the lesson has no runnable example").toBeDefined();
    // Without this the reader gets an empty arena and a chapter about mazes.
    expect(block!.info.params["maze"]).toBe("true");
  });

  it("gets a good part of the way round in one run of the playground", () => {
    // 45 seconds is what `Playground` allows. Measured at 85%.
    expect(explore(example(), 30 * 45)).toBeGreaterThan(60);
  });

  it("gets round the whole maze given longer, as the lesson says it will", () => {
    // The claim that makes wall-following a method rather than a wander.
    expect(explore(example(), 30 * 90)).toBe(100);
  });

  it("is broken by the wrong stride, which is the point the lesson makes", () => {
    // The chapter tells the reader to try 14 and 50 and watch it fail. If
    // either quietly started working, the exercise would teach nothing.
    const withStride = (n: number) => example().replace("var stride = 30", `var stride = ${n}`);
    expect(withStride(14)).not.toBe(example());
    expect(explore(withStride(14), 30 * 90)).toBeLessThan(60);
    expect(explore(withStride(50), 30 * 90)).toBeLessThan(60);
  });
});
