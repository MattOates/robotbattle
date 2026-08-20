/**
 * Drawing an arena.
 *
 * A plain 2D canvas rather than the Pixi renderer next door, and deliberately
 * so. `ArenaRenderer` exists to show a match at sixty frames a second through
 * an art pack; this is a drafting table. It wants crisp handles, hit-testing
 * and a cursor that snaps, and it wants them at the arena's real coordinates so
 * that what you draw is exactly what the simulation gets. Sharing the match
 * renderer would mean fighting it for both.
 *
 * The ground is drawn from the same `makeTerrain` field a match will use, so
 * the hills you route your walls around are the hills that will be there. It is
 * drawn coarsely — this is a map, not the match.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { makeTerrain } from "../sim/terrain.js";
import { WALL, type ArenaSpec, type Wall } from "../sim/types.js";
import { ART } from "../render/themes/index.js";
import type { Theme } from "../lang/vocab.js";

/** How close a click has to be to a wall to select it, in arena pixels. */
const PICK_RADIUS = 10;

/** Grid the cursor snaps to while Shift is held. */
const SNAP = 20;

export interface MapEditorProps {
  spec: ArenaSpec;
  width: number;
  height: number;
  theme: Theme;
  onChange: (spec: ArenaSpec) => void;
}

/** Snap a point to the grid. */
function snapPoint(x: number, y: number): [number, number] {
  return [Math.round(x / SNAP) * SNAP, Math.round(y / SNAP) * SNAP];
}

/**
 * Snap the far end of a drag to the nearest 45 degrees from its start.
 *
 * This is what makes drawing a maze by hand bearable. Freehand segments are
 * fine for a chicane and miserable for a grid, and a labyrinth is overwhelmingly
 * right angles.
 */
function snapAngle(x0: number, y0: number, x: number, y: number): [number, number] {
  const dx = x - x0;
  const dy = y - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [x, y];
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return [x0 + Math.cos(angle) * len, y0 + Math.sin(angle) * len];
}

/** Squared distance from a point to a segment. Only used for picking. */
function distToWallSq(px: number, py: number, w: Wall): number {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - w.x1) * dx + (py - w.y1) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = px - (w.x1 + dx * t);
  const ey = py - (w.y1 + dy * t);
  return ex * ex + ey * ey;
}

export function MapEditor({ spec, width, height, theme, onChange }: MapEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [snap, setSnap] = useState(false);

  // Shift is read from the keyboard rather than from the mouse event alone, so
  // the preview updates the moment it is pressed rather than on the next move.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") setSnap(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") setSnap(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  /** Pointer position in ARENA coordinates, whatever the canvas is scaled to. */
  const pointAt = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
      const canvas = canvasRef.current;
      if (!canvas) return [0, 0];
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * width;
      const y = ((e.clientY - rect.top) / rect.height) * height;
      return [Math.max(0, Math.min(width, x)), Math.max(0, Math.min(height, y))];
    },
    [width, height],
  );

  // --- drawing ------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const art = ART[theme];

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = `#${art.background.toString(16).padStart(6, "0")}`;
    ctx.fillRect(0, 0, width, height);

    // Ground, at a coarse resolution. This is a map of the terrain, not the
    // terrain: the point is to see where the hills are while placing walls.
    if (spec.terrain.enabled) {
      const field = makeTerrain(spec.terrain, width, height);
      const cell = 12;
      for (let y = 0; y < height; y += cell) {
        for (let x = 0; x < width; x += cell) {
          const h = field.heightAt(x + cell / 2, y + cell / 2);
          // One channel, so high ground reads as lighter in either art pack
          // without pretending to be the match's palette.
          const shade = Math.round(40 + h * 90);
          ctx.fillStyle = `rgb(${shade}, ${shade + 6}, ${shade + 12})`;
          ctx.fillRect(x, y, cell, cell);
        }
      }
    }

    // The snap grid, so a maze can be lined up by eye.
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    for (let x = SNAP; x < width; x += SNAP) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = SNAP; y < height; y += SNAP) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // The boundary, drawn the same weight as a placed wall — because it is one,
    // as far as a robot is concerned.
    ctx.strokeStyle = `#${art.wallColor.toString(16).padStart(6, "0")}`;
    ctx.lineWidth = WALL.halfThickness * 2;
    ctx.strokeRect(0, 0, width, height);

    // Placed walls, at their true thickness so what you draw is what a robot
    // will actually run into.
    ctx.lineCap = "round";
    spec.walls.forEach((w, i) => {
      ctx.strokeStyle = i === selected ? "#ffd166" : `#${art.wallColor.toString(16).padStart(6, "0")}`;
      ctx.lineWidth = WALL.halfThickness * 2;
      ctx.beginPath();
      ctx.moveTo(w.x1, w.y1);
      ctx.lineTo(w.x2, w.y2);
      ctx.stroke();
    });

    // The wall being dragged out right now.
    if (drag) {
      ctx.strokeStyle = "#7fd1e0";
      ctx.lineWidth = WALL.halfThickness * 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(drag.x0, drag.y0);
      ctx.lineTo(drag.x, drag.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [spec, width, height, theme, drag, selected]);

  // --- editing ------------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [rawX, rawY] = pointAt(e);
    // A click near an existing wall selects it; anywhere else starts a new one.
    // Selecting takes priority so a wall can always be got rid of, even in a
    // crowded map where there is no clear space left to click.
    let nearest: number | null = null;
    let nearestSq = PICK_RADIUS * PICK_RADIUS;
    spec.walls.forEach((w, i) => {
      const d = distToWallSq(rawX, rawY, w);
      if (d < nearestSq) {
        nearestSq = d;
        nearest = i;
      }
    });
    if (nearest !== null) {
      setSelected(nearest);
      return;
    }

    setSelected(null);
    const [x, y] = snap ? snapPoint(rawX, rawY) : [rawX, rawY];
    setDrag({ x0: x, y0: y, x, y });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag) return;
    const [rawX, rawY] = pointAt(e);
    let [x, y] = snap ? snapPoint(rawX, rawY) : [rawX, rawY];
    if (snap) [x, y] = snapAngle(drag.x0, drag.y0, x, y);
    setDrag({ ...drag, x, y });
  };

  const onPointerUp = () => {
    if (!drag) return;
    const wall: Wall = { x1: drag.x0, y1: drag.y0, x2: drag.x, y2: drag.y };
    setDrag(null);
    // Below minLength this was a click, not a drag. `clampWalls` would drop it
    // anyway; checking here means the wall count never flickers.
    const dx = wall.x2 - wall.x1;
    const dy = wall.y2 - wall.y1;
    if (dx * dx + dy * dy < WALL.minLength * WALL.minLength) return;
    if (spec.walls.length >= WALL.maxCount) return;
    onChange({ ...spec, walls: [...spec.walls, wall] });
  };

  // Delete removes the selected wall. Kept on the canvas rather than the window
  // so it cannot eat a keystroke meant for the name field beside it.
  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (selected === null) return;
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    e.preventDefault();
    onChange({ ...spec, walls: spec.walls.filter((_, i) => i !== selected) });
    setSelected(null);
  };

  return (
    <canvas
      ref={canvasRef}
      className="map-editor"
      width={width}
      height={height}
      tabIndex={0}
      role="application"
      aria-label="Arena map. Drag to draw a wall, click a wall to select it, Delete to remove it."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}
