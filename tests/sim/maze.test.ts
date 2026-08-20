/**
 * Labyrinths.
 *
 * The claim this file is checking is that a maze needs nothing the simulation
 * does not already have: it is an ordinary `Wall[]`, it is reproducible from a
 * seed, and it is small enough to carry. The connectivity test is the one that
 * matters most — a maze with an unreachable region is not a harder maze, it is
 * a broken one, and it would only be found by a player whose robot spent a
 * whole match looking for a way through.
 */

import { describe, expect, it } from "vitest";
import { drivableMazeGrid, generateFittingMaze, generateMaze } from "../../src/sim/maze.js";
import { ROBOT_RADIUS, WALL, clampWalls } from "../../src/sim/types.js";
import { closestPointOnSegment } from "../../src/sim/math.js";

const W = 900;
const H = 620;

describe("generateMaze", () => {
  it("is a pure function of its seed", () => {
    expect(generateMaze(42, 12, 8, W, H)).toEqual(generateMaze(42, 12, 8, W, H));
  });

  it("gives a different maze for a different seed", () => {
    expect(generateMaze(1, 12, 8, W, H)).not.toEqual(generateMaze(2, 12, 8, W, H));
  });

  it("merges collinear runs, which is what makes it fit at all", () => {
    // Unmerged, a 12x8 grid is roughly 400 individual cell edges. Merged it is
    // well under a hundred, and that ratio is the whole reason a labyrinth can
    // live in a manifest.
    const walls = generateMaze(3, 12, 8, W, H);
    expect(walls.length).toBeLessThan(120);
    // Every segment is axis-aligned, which is what a merged grid should give.
    for (const w of walls) {
      expect(w.x1 === w.x2 || w.y1 === w.y2).toBe(true);
    }
  });

  it("survives clampWalls unchanged, so nothing is silently dropped", () => {
    const walls = generateMaze(9, 14, 10, W, H);
    expect(clampWalls(walls)).toEqual(walls);
  });

  it("boxes the arena in", () => {
    const walls = generateMaze(5, 10, 7, W, H);
    // The outer border is never carved, so all four sides are present.
    expect(walls.some((w) => w.y1 === 0 && w.y2 === 0)).toBe(true);
    expect(walls.some((w) => w.y1 === H && w.y2 === H)).toBe(true);
    expect(walls.some((w) => w.x1 === 0 && w.x2 === 0)).toBe(true);
    expect(walls.some((w) => w.x1 === W && w.x2 === W)).toBe(true);
  });
});

describe("every cell is reachable", () => {
  /**
   * Flood fill the grid through the gaps the walls leave.
   *
   * Done against the emitted segments rather than against the carve, because
   * the carve is obviously connected — it is a spanning tree by construction.
   * What is worth testing is the round trip: that merging runs into segments
   * and rounding them to whole pixels did not accidentally seal a passage.
   */
  function reachable(cols: number, rows: number, seed: number): number {
    const walls = generateMaze(seed, cols, rows, W, H);
    const cw = W / cols;
    const ch = H / rows;
    const centre = (cx: number, cy: number) => [(cx + 0.5) * cw, (cy + 0.5) * ch] as const;

    /** Is the straight line between two cell centres clear of every wall? */
    const open = (ax: number, ay: number, bx: number, by: number): boolean => {
      const [x1, y1] = centre(ax, ay);
      const [x2, y2] = centre(bx, by);
      // Sample along the line: any wall between them lies across it.
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const px = x1 + (x2 - x1) * t;
        const py = y1 + (y2 - y1) * t;
        for (const w of walls) {
          const [, , distSq] = closestPointOnSegment(px, py, w.x1, w.y1, w.x2, w.y2);
          if (distSq < 4) return false;
        }
      }
      return true;
    };

    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length > 0) {
      const cell = stack.pop()!;
      const cx = cell % cols;
      const cy = (cell - cx) / cols;
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const) {
        const ax = cx + dx;
        const ay = cy + dy;
        if (ax < 0 || ay < 0 || ax >= cols || ay >= rows) continue;
        const id = ay * cols + ax;
        if (seen.has(id)) continue;
        if (!open(cx, cy, ax, ay)) continue;
        seen.add(id);
        stack.push(id);
      }
    }
    return seen.size;
  }

  it("reaches every cell of the maze it emitted", () => {
    for (const seed of [1, 2, 3, 7, 99]) {
      expect(reachable(10, 7, seed)).toBe(70);
    }
  });
});

describe("what actually fits", () => {
  it("caps the grid at something a robot can drive down", () => {
    const grid = drivableMazeGrid(W, H);
    const cellW = W / grid.cols;
    const cellH = H / grid.rows;
    const needed = 2 * ROBOT_RADIUS + 2 * WALL.halfThickness;
    // A corridor has to be wider than the robot is across, or the maze is a
    // solid block with a decorative pattern on it.
    expect(cellW).toBeGreaterThan(needed);
    expect(cellH).toBeGreaterThan(needed);
  });

  it("refuses to emit more walls than the simulation will carry", () => {
    // Asking for something absurd gives the finest DRIVABLE maze, not a maze
    // with half its walls quietly cut off by clampWalls.
    const walls = generateFittingMaze(1, 200, 200, W, H);
    expect(walls.length).toBeLessThanOrEqual(WALL.maxCount);
    expect(clampWalls(walls)).toEqual(walls);
  });
});
