/**
 * Where the coach mark lands.
 *
 * The bug these exist for: a step that says "watch what it does" put its card
 * squarely over the arena, and a step that says "tick Sitting Duck" put it over
 * the list of ticks. Being told to look at something and then having it hidden
 * is worse than no coach mark at all.
 */

import { describe, expect, it } from "vitest";
import { overlapArea, placeCard, type Box, type Size } from "../../src/ui/tour/placement.js";

const VIEWPORT: Size = { width: 1400, height: 800 };
const CARD: Size = { width: 340, height: 260 };

const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  width,
  height,
});

/** The placed card, as a box, so overlaps can be measured. */
const placed = (
  anchor: Box | null,
  keepClear: Box[],
  prefer: Parameters<typeof placeCard>[4] = "right",
): Box => ({ ...placeCard(anchor, keepClear, CARD, VIEWPORT, prefer), ...CARD });

describe("overlapArea", () => {
  it("is zero for boxes that do not meet", () => {
    expect(overlapArea(box(0, 0, 10, 10), box(20, 20, 10, 10))).toBe(0);
  });

  it("is zero for boxes that only touch", () => {
    expect(overlapArea(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBe(0);
  });

  it("measures the shared region", () => {
    expect(overlapArea(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(25);
  });

  it("is the smaller box when one contains the other", () => {
    expect(overlapArea(box(0, 0, 100, 100), box(10, 10, 20, 30))).toBe(600);
  });
});

describe("placeCard", () => {
  it("centres itself when there is nothing to point at", () => {
    const at = placeCard(null, [], CARD, VIEWPORT, "right");
    expect(at.left).toBe((VIEWPORT.width - CARD.width) / 2);
    expect(at.top).toBe((VIEWPORT.height - CARD.height) / 2);
  });

  it("uses the side the step asked for when nothing is in the way", () => {
    const anchor = box(500, 300, 200, 100);
    expect(placed(anchor, [], "right").left).toBe(anchor.left + anchor.width + 14);
    expect(placed(anchor, [], "bottom").top).toBe(anchor.top + anchor.height + 14);
  });

  it("stays inside the viewport whatever it is asked for", () => {
    for (const anchor of [
      box(0, 0, 50, 50),
      box(1350, 0, 50, 50),
      box(0, 760, 50, 50),
      box(1350, 760, 50, 50),
      box(600, 400, 200, 100),
    ]) {
      for (const side of ["top", "bottom", "left", "right"] as const) {
        const card = placed(anchor, [], side);
        expect(card.left).toBeGreaterThanOrEqual(0);
        expect(card.top).toBeGreaterThanOrEqual(0);
        expect(card.left + card.width).toBeLessThanOrEqual(VIEWPORT.width);
        expect(card.top + card.height).toBeLessThanOrEqual(VIEWPORT.height);
      }
    }
  });

  it("all but clears the arena even though the card cannot fully avoid it", () => {
    // The real Workshop geometry, and the reason `keepClear` is scored rather
    // than enforced: the arena is most of the window, and a card wide enough
    // to read does not fit in the strip beside it. Zero is not on offer. What
    // is on offer is the difference between a card sitting in the middle of
    // the fight and a corner of one clipping the edge of it — here, under a
    // hundredth of the arena, against a fifth of it before corners existed.
    const arena = box(330, 100, 800, 560);
    const startButton = box(850, 700, 110, 40);
    const card = placed(startButton, [arena], "top");
    const covered = overlapArea(arena, card) / (arena.width * arena.height);
    expect(covered).toBeLessThan(0.02);
  });

  it("does not sit on the very thing it is pointing at", () => {
    // "Tick Sitting Duck" over the top of the ticks.
    const chips = box(1140, 100, 250, 500);
    const card = placed(chips, [chips], "top");
    expect(overlapArea(chips, card)).toBe(0);
  });

  it("prefers a clear side over the requested one, and says so by moving", () => {
    const anchor = box(600, 400, 100, 40);
    const inTheWay = box(600, 100, 500, 280);
    const asked = placed(anchor, [], "top");
    const avoided = placed(anchor, [inTheWay], "top");
    expect(overlapArea(inTheWay, asked)).toBeGreaterThan(0);
    expect(overlapArea(inTheWay, avoided)).toBe(0);
  });

  it("weighs a watched region above the anchor itself", () => {
    // Given a choice between covering the label and covering the lesson, it
    // covers the label.
    const anchor = box(20, 380, 200, 40);
    const watched = box(20, 60, 600, 300);
    const card = placed(anchor, [watched], "top");
    expect(overlapArea(watched, card)).toBe(0);
  });

  it("still produces something when every side is obstructed", () => {
    // A viewport entirely spoken for. There is no right answer, so the only
    // requirement is that it stays on screen rather than throwing or fleeing.
    const everything = box(0, 0, VIEWPORT.width, VIEWPORT.height);
    const card = placed(box(600, 400, 100, 40), [everything], "top");
    expect(card.left).toBeGreaterThanOrEqual(0);
    expect(card.top).toBeGreaterThanOrEqual(0);
    expect(card.left + card.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(card.top + card.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it("copes with a viewport smaller than the card", () => {
    const tiny: Size = { width: 200, height: 150 };
    const at = placeCard(box(10, 10, 50, 50), [], CARD, tiny, "right");
    expect(at.left).toBe(14);
    expect(at.top).toBe(14);
  });
});

describe("with nothing to point at", () => {
  it("goes to the middle when the middle is free", () => {
    const at = placeCard(null, [], CARD, VIEWPORT, "bottom");
    expect(at.left).toBe((VIEWPORT.width - CARD.width) / 2);
  });

  it("gets out of the way when the middle is the fight", () => {
    // A step whose anchor lives on a tab that is not open has nothing to
    // measure, and used to centre itself — squarely over the arena, hiding the
    // thing it was in the middle of telling somebody to watch.
    const arena = box(330, 140, 790, 580);
    const middle = placeCard(null, [], CARD, VIEWPORT, "bottom");
    const moved = placeCard(null, [arena], CARD, VIEWPORT, "bottom");
    expect(overlapArea(arena, { ...middle, ...CARD })).toBeGreaterThan(0);
    expect(overlapArea(arena, { ...moved, ...CARD })).toBeLessThan(
      overlapArea(arena, { ...middle, ...CARD }),
    );
  });
});
