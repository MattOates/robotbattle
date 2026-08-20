/**
 * Labyrinths, as walls.
 *
 * The point of this file is to prove that `Wall[]` is enough. A maze is not a
 * new mechanic and gets no new type: it is an ordinary list of segments that
 * happens to have been generated rather than drawn, and the simulation cannot
 * tell the difference. That is what makes maze-solving something a player can
 * compete at using the language exactly as it already is — `on sense wall` and
 * `on hit wall` were always the right two events for it.
 *
 * Everything here is seeded from `Rng`, so a maze is reproducible from four
 * numbers and a saved arena stays a few hundred bytes.
 *
 * This lives in `src/sim` so the determinism scanner in
 * `tests/determinism/determinism.test.ts` walks it. Generation happens once,
 * outside a match, so it is not on the hot path — but the walls it emits are,
 * and being under `src/sim` is what stops somebody later reaching for
 * `Math.random` in here and quietly making every generated arena unshareable.
 */

import { Rng } from "./rng.js";
import { ROBOT_RADIUS, WALL, type Wall } from "./types.js";

/** Which side of a cell an edge is on. Index order is fixed; see `carve`. */
const NORTH = 0;
const EAST = 1;
const SOUTH = 2;
const WEST = 3;

/** Neighbour offsets, in the same order as the constants above. */
const STEPS: readonly (readonly [number, number, number, number])[] = [
  [0, -1, NORTH, SOUTH],
  [1, 0, EAST, WEST],
  [0, 1, SOUTH, NORTH],
  [-1, 0, WEST, EAST],
];

/**
 * The finest maze grid a robot can actually drive through, for a given arena.
 *
 * This is the constraint that matters, and it is not the wall count. A 40x30
 * maze fits inside `WALL.maxCount` comfortably and is completely useless: its
 * corridors are 22px wide and a robot is 36px across, so every passage is a
 * wall. `maxCount` bounds what the *simulation* will carry; this bounds what is
 * worth carrying.
 *
 * A corridor's clear width is the cell size less the half-thickness of the wall
 * on each side. `MAZE_CLEARANCE` is how much room a robot gets on top of its own
 * diameter — enough to steer down a passage rather than grind along it, since a
 * wheeled chassis cannot pivot on the spot and a corridor it can only just fit
 * in is a corridor it can only reverse out of.
 *
 * This was 14 to begin with, which was too mean by half: it gave 52px corridors
 * for a 36px robot, eight pixels of room on either side. That is inside the
 * error of any robot navigating by ninety-degree turns, so corners were clipped
 * and passages missed. Measured against Mouse, widening the corridors to 74px
 * took the share of a labyrinth covered in one match from 33% to 51%, and the
 * worst case from 25% to 39%. The cost is a coarser maze — around 77 squares
 * rather than 150 — which is the right trade: a labyrinth nothing can drive
 * down is not a harder labyrinth.
 */
const MAZE_CLEARANCE = 36;

export function drivableMazeGrid(
  width: number,
  height: number,
): { cols: number; rows: number } {
  const minCell = 2 * ROBOT_RADIUS + 2 * WALL.halfThickness + MAZE_CLEARANCE;
  return {
    cols: Math.max(2, Math.floor(width / minCell)),
    rows: Math.max(2, Math.floor(height / minCell)),
  };
}

/**
 * A maze that fills the arena, as merged wall segments.
 *
 * Randomised depth-first carving — the "recursive backtracker". Chosen over
 * Prim or Kruskal because it produces long winding corridors and few short
 * dead ends, which is the maze that is interesting to *drive*: a robot commits
 * to a passage and finds out later whether it was right. A Prim maze is a mass
 * of three-way junctions, which mostly tests how fast you can turn around.
 *
 * The grid is carved with an explicit stack rather than recursion. A 40x30 maze
 * is 1200 cells deep in the worst case, which is a stack overflow waiting for
 * whoever first tries a big one.
 *
 * `cols`/`rows` are cells, not pixels. The caller picks them; `maxCount` is the
 * real constraint and `mazeFits` below is how to check before committing.
 */
export function generateMaze(
  seed: number,
  cols: number,
  rows: number,
  width: number,
  height: number,
): Wall[] {
  const nx = Math.max(2, Math.floor(cols));
  const ny = Math.max(2, Math.floor(rows));
  const rng = new Rng(seed);

  // `walls[cell * 4 + side]` — true means the edge is still solid. Everything
  // starts solid and carving knocks edges out, so a cell nobody reached stays
  // boxed in rather than opening onto nothing.
  const solid = new Uint8Array(nx * ny * 4).fill(1);
  const seen = new Uint8Array(nx * ny);

  const stack: number[] = [0];
  seen[0] = 1;

  while (stack.length > 0) {
    const cell = stack[stack.length - 1]!;
    const cx = cell % nx;
    const cy = (cell - cx) / nx;

    // Gather the unvisited neighbours, then pick one. Gathering first and
    // drawing once is what keeps the RNG stream a function of the maze's shape
    // rather than of how many times we happened to look.
    const options: number[] = [];
    for (let i = 0; i < 4; i++) {
      const [dx, dy] = STEPS[i]!;
      const ax = cx + dx;
      const ay = cy + dy;
      if (ax < 0 || ay < 0 || ax >= nx || ay >= ny) continue;
      if (seen[ay * nx + ax]) continue;
      options.push(i);
    }

    if (options.length === 0) {
      stack.pop();
      continue;
    }

    const choice = options[rng.int(0, options.length - 1)]!;
    const [dx, dy, near, far] = STEPS[choice]!;
    const next = (cy + dy) * nx + (cx + dx);
    solid[cell * 4 + near] = 0;
    solid[next * 4 + far] = 0;
    seen[next] = 1;
    stack.push(next);
  }

  return toWalls(solid, nx, ny, width, height);
}

/**
 * Turn the carved grid into segments, merging collinear runs as it goes.
 *
 * Merging is not tidiness, it is the whole reason a maze fits. A 20x14 grid has
 * roughly 1100 individual cell edges; merged into runs it is a few hundred
 * segments, which is inside `WALL.maxCount` and cheap enough to test against
 * every robot every tick. Emitting them one cell edge at a time would blow the
 * cap on anything but a toy.
 *
 * Horizontal runs first, then vertical, each swept in a fixed order so the same
 * grid always yields the identical list — the manifest is hashed, so the *order*
 * of the walls is part of what peers have to agree on.
 */
function toWalls(
  solid: Uint8Array,
  nx: number,
  ny: number,
  width: number,
  height: number,
): Wall[] {
  const cw = width / nx;
  const ch = height / ny;
  const out: Wall[] = [];

  // --- horizontal: every gridline y, swept left to right ---
  for (let gy = 0; gy <= ny; gy++) {
    let runStart = -1;
    for (let gx = 0; gx <= nx; gx++) {
      // The edge above cell (gx, gy), which is the same edge as below
      // (gx, gy-1). Reading the south side of the cell above keeps the outer
      // border solid without a special case.
      const present =
        gx < nx &&
        (gy === 0
          ? solid[gx * 4 + NORTH] === 1
          : solid[((gy - 1) * nx + gx) * 4 + SOUTH] === 1);
      if (present && runStart < 0) runStart = gx;
      if (!present && runStart >= 0) {
        out.push({
          x1: Math.round(runStart * cw),
          y1: Math.round(gy * ch),
          x2: Math.round(gx * cw),
          y2: Math.round(gy * ch),
        });
        runStart = -1;
      }
    }
  }

  // --- vertical: every gridline x, swept top to bottom ---
  for (let gx = 0; gx <= nx; gx++) {
    let runStart = -1;
    for (let gy = 0; gy <= ny; gy++) {
      const present =
        gy < ny &&
        (gx === 0
          ? solid[(gy * nx) * 4 + WEST] === 1
          : solid[(gy * nx + (gx - 1)) * 4 + EAST] === 1);
      if (present && runStart < 0) runStart = gy;
      if (!present && runStart >= 0) {
        out.push({
          x1: Math.round(gx * cw),
          y1: Math.round(runStart * ch),
          x2: Math.round(gx * cw),
          y2: Math.round(gy * ch),
        });
        runStart = -1;
      }
    }
  }

  return out;
}

/**
 * The biggest maze that fits in `WALL.maxCount`, for a given arena.
 *
 * Generation is cheap and the segment count is not predictable from the grid
 * size alone — it depends on how the carve happened to run — so this measures
 * rather than estimates, shrinking the grid until the result fits. The editor
 * uses it so "Generate labyrinth" cannot produce a maze that `clampWalls` would
 * then silently cut in half, which is the one failure that would be genuinely
 * confusing: a labyrinth with a wall missing is not a labyrinth.
 *
 * The requested grid is capped at `drivableMazeGrid` first, so asking for
 * something finer gives the finest drivable maze rather than a solid block.
 */
export function generateFittingMaze(
  seed: number,
  cols: number,
  rows: number,
  width: number,
  height: number,
): Wall[] {
  const limit = drivableMazeGrid(width, height);
  let nx = Math.max(2, Math.min(Math.floor(cols), limit.cols));
  let ny = Math.max(2, Math.min(Math.floor(rows), limit.rows));
  for (;;) {
    const walls = generateMaze(seed, nx, ny, width, height);
    if (walls.length <= WALL.maxCount || (nx <= 2 && ny <= 2)) return walls;
    // Shrink the longer side, so the maze keeps the arena's proportions.
    if (nx >= ny) nx = Math.max(2, nx - 1);
    else ny = Math.max(2, ny - 1);
  }
}
