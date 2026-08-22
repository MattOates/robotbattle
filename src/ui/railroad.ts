/**
 * Railroad diagrams for the reference page.
 *
 * Chevrotain ships `createSyntaxDiagramsCode`, which emits an HTML page that
 * pulls its renderer and stylesheet off a CDN. This game works offline and
 * renders in whichever theme the player chose, so neither the network nor a
 * fixed palette is available to us. It is a few hundred lines to draw the seven
 * shapes ourselves, against a vendored library plus its stylesheet plus the
 * job of restyling both, so we draw them.
 *
 * A diagram is laid out before it is drawn: `measure` gives every node a width,
 * a height and a baseline — how far down the node the through-line runs — and
 * `draw` then places it, knowing that its own line comes in and goes out at
 * that height. Everything else is arithmetic.
 */

import { labelOf, type Syntax } from "../lang/reference.js";
import { wordFor, type Theme } from "../lang/vocab.js";

/** Space around and inside things, in SVG units. */
const PAD = 10;
const GAP = 12;
/** Height of one box, and so of a single-track line. */
const BOX = 26;
/** Vertical space between the branches of a choice. */
const LANE = 12;
/** How far a branch or a loop bulges out sideways before it turns. */
const TURN = 10;
const CHAR = 7.4;

interface Measured {
  node: Syntax;
  width: number;
  height: number;
  /** Distance from the top of this box to its through-line. */
  baseline: number;
  parts: Measured[];
  /** For a repeat with a separator: the separator's own measurement. */
  extra?: Measured;
}

function labelWidth(text: string): number {
  return Math.max(BOX + PAD, text.length * CHAR + PAD * 2);
}

function measure(node: Syntax, theme: Theme): Measured {
  const leaf = (width: number): Measured => ({
    node,
    width,
    height: BOX,
    baseline: BOX / 2,
    parts: [],
  });

  switch (node.kind) {
    case "word":
      return leaf(labelWidth(wordFor(node.text, theme)));
    case "placeholder":
      return leaf(labelWidth(node.text));
    case "rule":
      return leaf(labelWidth(labelOf(node.name)));

    case "sequence": {
      const parts = node.of.map((part) => measure(part, theme));
      const baseline = Math.max(...parts.map((p) => p.baseline));
      const below = Math.max(...parts.map((p) => p.height - p.baseline));
      return {
        node,
        parts,
        width: parts.reduce((sum, p) => sum + p.width, 0) + GAP * (parts.length - 1),
        height: baseline + below,
        baseline,
      };
    }

    case "choice": {
      const parts = node.of.map((part) => measure(part, theme));
      // Every branch is drawn to the same width so the joins line up, and the
      // through-line stays on the first branch — the one a reader takes if they
      // read the diagram like a sentence.
      const width = Math.max(...parts.map((p) => p.width)) + TURN * 4;
      const height =
        parts.reduce((sum, p) => sum + p.height, 0) + LANE * (parts.length - 1);
      return { node, parts, width, height, baseline: parts[0]!.baseline };
    }

    case "optional": {
      const inner = measure(node.of, theme);
      // A bypass line above, so the eye reads "or nothing".
      return {
        node,
        parts: [inner],
        width: inner.width + TURN * 4,
        height: inner.height + LANE + BOX / 2,
        baseline: LANE + BOX / 2 + inner.baseline,
      };
    }

    case "repeat": {
      const inner = measure(node.of, theme);
      const extra = node.separator ? measure(node.separator, theme) : undefined;
      // The return path runs underneath, and carries the separator if there is
      // one — which is exactly what a comma between parameters is.
      const back = Math.max(BOX, extra?.height ?? 0) + LANE;
      const width = Math.max(inner.width, extra?.width ?? 0) + TURN * 4;
      const height = inner.height + back + (node.least === 0 ? LANE + BOX / 2 : 0);
      const top = node.least === 0 ? LANE + BOX / 2 : 0;
      return {
        node,
        parts: [inner],
        ...(extra ? { extra } : {}),
        width,
        height,
        baseline: top + inner.baseline,
      };
    }
  }
}

// --- drawing ---------------------------------------------------------------

type Bits = string[];

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A run of track through a list of waypoints, with its own rounded corners.
 *
 * Every segment is horizontal or vertical, so a corner is always a quarter
 * turn, and the radius shrinks to fit whichever of the two segments is shorter.
 * Placing the straights and the curves separately — which is how this was
 * written first — means every joint is an arithmetic claim that the two ends
 * meet, and the diagrams were full of the places where they did not.
 */
function track(out: Bits, points: readonly [number, number][]): void {
  if (points.length < 2) return;

  const parts: string[] = [`M${points[0]![0]} ${points[0]![1]}`];

  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1]!;
    const [cx, cy] = points[i]!;
    const [nx, ny] = points[i + 1]!;

    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(TURN, inLen / 2, outLen / 2);

    // Stop short of the corner, curve through it, carry on.
    const ax = cx - Math.sign(cx - px) * r;
    const ay = cy - Math.sign(cy - py) * r;
    const bx = cx + Math.sign(nx - cx) * r;
    const by = cy + Math.sign(ny - cy) * r;

    parts.push(`L${ax} ${ay}`, `Q${cx} ${cy} ${bx} ${by}`);
  }

  const last = points[points.length - 1]!;
  parts.push(`L${last[0]} ${last[1]}`);
  out.push(`<path class="rr-line" d="${parts.join(" ")}"/>`);
}

/** A straight run, which is just a track with two points. */
function line(out: Bits, x1: number, y1: number, x2: number, y2: number): void {
  out.push(`<path class="rr-line" d="M${x1} ${y1} L${x2} ${y2}"/>`);
}

function box(out: Bits, m: Measured, x: number, y: number, theme: Theme): void {
  const node = m.node;
  const text =
    node.kind === "rule"
      ? labelOf(node.name)
      : node.kind === "word"
        ? // A fixed word is spelt in the player's own vocabulary, the same as
          // the one-line form above it. Without this the line said `tank` and
          // the diagram under it said `skid`.
          wordFor(node.text, theme)
        : (node as { text: string }).text;
  const rounded = node.kind !== "rule";
  const cls =
    node.kind === "word" ? "rr-word" : node.kind === "placeholder" ? "rr-placeholder" : "rr-rule";
  // A rule box is a way in to that rule. The name rides on the group so one
  // listener on the page can act on any of them, rather than a listener per
  // box on a diagram that never changes.
  const link = node.kind === "rule" ? ` data-rule="${esc(node.name)}"` : "";
  out.push(
    `<g${link}${node.kind === "rule" ? ' class="rr-link"' : ""}>`,
    `<rect class="${cls}" x="${x}" y="${y}" width="${m.width}" height="${BOX}" rx="${
      rounded ? BOX / 2 : 3
    }"/>`,
    `<text class="rr-text" x="${x + m.width / 2}" y="${y + BOX / 2}">${esc(text)}</text>`,
    "</g>",
  );
}

function draw(out: Bits, m: Measured, x: number, y: number, theme: Theme): void {
  const node = m.node;
  const mid = y + m.baseline;
  const right = x + m.width;
  /** Where an inner box sits, leaving room for the tracks either side of it. */
  const at = x + TURN * 2;

  switch (node.kind) {
    case "word":
    case "placeholder":
    case "rule":
      box(out, m, x, mid - BOX / 2, theme);
      return;

    case "sequence": {
      let cursor = x;
      m.parts.forEach((part, i) => {
        if (i > 0) {
          line(out, cursor, mid, cursor + GAP, mid);
          cursor += GAP;
        }
        draw(out, part, cursor, mid - part.baseline, theme);
        cursor += part.width;
      });
      return;
    }

    case "choice": {
      const wide = Math.max(...m.parts.map((p) => p.width));
      let top = y;
      m.parts.forEach((part, i) => {
        const partMid = top + part.baseline;
        // Branches start at the same x and are padded on the right. Centring
        // them looked tidier in isolation and read worse: the first word of
        // each choice is what the eye scans down, and centring puts every one
        // of them in a different place.
        draw(out, part, at, top, theme);
        line(out, at + part.width, partMid, at + wide, partMid);

        if (i === 0) {
          // The first branch is the one the through-line runs along.
          line(out, x, mid, at, mid);
          line(out, at + wide, mid, right, mid);
        } else {
          // The rest drop off the main line and come back to it.
          track(out, [
            [x, mid],
            [x + TURN, mid],
            [x + TURN, partMid],
            [at, partMid],
          ]);
          track(out, [
            [at + wide, partMid],
            [right - TURN, partMid],
            [right - TURN, mid],
            [right, mid],
          ]);
        }
        top += part.height + LANE;
      });
      return;
    }

    case "optional": {
      const inner = m.parts[0]!;
      draw(out, inner, at, mid - inner.baseline, theme);
      line(out, x, mid, at, mid);
      line(out, at + inner.width, mid, right, mid);
      // The way past, arching over the top, so the eye reads "or nothing".
      bypass(out, x, right, mid, y + BOX / 2);
      return;
    }

    case "repeat": {
      const inner = m.parts[0]!;
      draw(out, inner, at, mid - inner.baseline, theme);
      line(out, x, mid, at, mid);
      line(out, at + inner.width, mid, right, mid);

      // The way back round, underneath. If there is a separator it sits on that
      // return path, which is exactly what a comma between parameters is: the
      // thing you pass through on your way to going round again.
      const under = mid + (inner.height - inner.baseline) + LANE + BOX / 2;
      if (m.extra) {
        const sep = m.extra;
        const sx = x + (m.width - sep.width) / 2;
        draw(out, sep, sx, under - sep.baseline, theme);
        track(out, [
          [right, mid],
          [right - TURN, mid],
          [right - TURN, under],
          [sx + sep.width, under],
        ]);
        track(out, [
          [sx, under],
          [x + TURN, under],
          [x + TURN, mid],
          [x, mid],
        ]);
      } else {
        track(out, [
          [right, mid],
          [right - TURN, mid],
          [right - TURN, under],
          [x + TURN, under],
          [x + TURN, mid],
          [x, mid],
        ]);
      }

      // None will do, so there is also a way past the whole thing.
      if (node.least === 0) bypass(out, x, right, mid, y + BOX / 2);
      return;
    }
  }
}

/** The arch over the top that skips whatever is on the main line. */
function bypass(out: Bits, x: number, right: number, mid: number, over: number): void {
  track(out, [
    [x, mid],
    [x + TURN, mid],
    [x + TURN, over],
    [right - TURN, over],
    [right - TURN, mid],
    [right, mid],
  ]);
}

/**
 * One rule as a standalone SVG.
 *
 * Returned as a string rather than as elements because it is static: nothing
 * here re-renders, and building it through React would cost a component per
 * path for no benefit. The caller sets it with `dangerouslySetInnerHTML`, which
 * is safe precisely because every word in it came from the grammar.
 */
export function railroad(syntax: Syntax, theme: Theme = "mechanical"): string {
  const m = measure(syntax, theme);
  const width = m.width + PAD * 2 + 40;
  const height = m.height + PAD * 2;
  const out: Bits = [];
  const mid = PAD + m.baseline;

  // The entry and exit stubs, so a diagram reads as a piece of track rather
  // than as a floating box.
  out.push(`<path class="rr-cap" d="M${PAD} ${mid - 6} L${PAD} ${mid + 6}"/>`);
  line(out, PAD, mid, PAD + 20, mid);
  draw(out, m, PAD + 20, PAD, theme);
  line(out, PAD + 20 + m.width, mid, width - PAD, mid);
  out.push(`<path class="rr-cap" d="M${width - PAD} ${mid - 6} L${width - PAD} ${mid + 6}"/>`);

  return `<svg class="railroad" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">${out.join(
    "",
  )}</svg>`;
}
