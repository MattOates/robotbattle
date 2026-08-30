/**
 * Where a coach mark goes.
 *
 * Pure arithmetic over rectangles — no DOM, no React — so the rules can be
 * argued with in a test rather than by squinting at a screenshot.
 *
 * The rule that matters is not "put the card on the side the step asked for".
 * It is "do not cover the thing you have just told somebody to look at". A step
 * saying *watch what it does* while sitting on top of the arena is worse than
 * one on the wrong side of its anchor, so the requested side is a preference
 * that loses to an obstruction.
 */

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type Placement = "top" | "bottom" | "left" | "right";

export interface Size {
  width: number;
  height: number;
}

const MARGIN = 14;

/** Every side, in the order they are tried when nothing else separates them. */
const SIDES: readonly Placement[] = ["right", "bottom", "left", "top"];

/**
 * The four corners of the screen, tried as well as the four sides.
 *
 * Beside a large panel there may be no side that clears it — the Workshop's
 * arena is most of the window, and a card wide enough to read does not fit
 * between it and the edge. Retreating to a corner is often the least-bad
 * answer, and it is never available if the only candidates hug the anchor.
 */
const CORNERS = ["tl", "tr", "bl", "br"] as const;

function clamp(value: number, low: number, high: number): number {
  // `high` can be below `low` on a viewport smaller than the card, and a naive
  // min/max then pins it to the wrong edge. Low wins.
  return Math.max(low, Math.min(value, Math.max(low, high)));
}

/** How much of each other two rectangles share. Zero when they merely touch. */
export function overlapArea(a: Box, b: Box): number {
  const width = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

/** The card, placed on one particular side and pulled back into the viewport. */
function candidate(anchor: Box, side: Placement, card: Size, viewport: Size): Box {
  const x = (value: number) => clamp(value, MARGIN, viewport.width - card.width - MARGIN);
  const y = (value: number) => clamp(value, MARGIN, viewport.height - card.height - MARGIN);

  switch (side) {
    case "top":
      return { ...card, top: y(anchor.top - MARGIN - card.height), left: x(anchor.left) };
    case "bottom":
      return { ...card, top: y(anchor.top + anchor.height + MARGIN), left: x(anchor.left) };
    case "left":
      return { ...card, top: y(anchor.top), left: x(anchor.left - MARGIN - card.width) };
    case "right":
      return { ...card, top: y(anchor.top), left: x(anchor.left + anchor.width + MARGIN) };
  }
}

function cornerBox(corner: (typeof CORNERS)[number], card: Size, viewport: Size): Box {
  const right = Math.max(MARGIN, viewport.width - card.width - MARGIN);
  const bottom = Math.max(MARGIN, viewport.height - card.height - MARGIN);
  return {
    ...card,
    left: corner === "tl" || corner === "bl" ? MARGIN : right,
    top: corner === "tl" || corner === "tr" ? MARGIN : bottom,
  };
}

/**
 * Pick a corner for the card.
 *
 * Scored rather than chosen: covering something the player was told to watch
 * costs the most, covering the anchor itself costs less but still counts, and
 * being on the wrong side costs a token amount so that a tie goes to whatever
 * the step asked for. With `keepClear` empty and room on the preferred side
 * this returns exactly what the old code did.
 */
export function placeCard(
  anchor: Box | null,
  keepClear: readonly Box[],
  card: Size,
  viewport: Size,
  prefer: Placement,
): { top: number; left: number } {
  let best: Box | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  const middle: Box = {
    ...card,
    top: Math.max(MARGIN, (viewport.height - card.height) / 2),
    left: Math.max(MARGIN, (viewport.width - card.width) / 2),
  };

  // With nothing to point at the card goes to the middle — unless the middle is
  // where the fight is. A step that says "watch for a moment" while its anchor
  // is on a tab that is not open used to centre itself squarely over the arena
  // and hide the very thing it was talking about.
  const options: Array<{ box: Box; side: Placement | null }> = anchor
    ? [
        ...SIDES.map((side) => ({ box: candidate(anchor, side, card, viewport), side })),
        ...CORNERS.map((corner) => ({ box: cornerBox(corner, card, viewport), side: null })),
      ]
    : [
        { box: middle, side: prefer },
        ...CORNERS.map((corner) => ({ box: cornerBox(corner, card, viewport), side: null })),
      ];

  for (const { box, side } of options) {
    // Weighted so that no amount of overlapping the anchor outranks keeping a
    // watched region clear: the anchor is a label, the arena is the lesson.
    let score = anchor ? overlapArea(anchor, box) : 0;
    for (const clear of keepClear) score += overlapArea(clear, box) * 8;
    // A corner is a retreat, not a preference: it loses every tie to a side
    // that is beside the thing being pointed at.
    if (side === null) score += 2;
    else if (side !== prefer) score += 1;
    if (score < bestScore) {
      bestScore = score;
      best = box;
    }
  }

  return { top: best!.top, left: best!.left };
}
