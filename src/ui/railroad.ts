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

function measure(node: Syntax): Measured {
  const leaf = (width: number): Measured => ({
    node,
    width,
    height: BOX,
    baseline: BOX / 2,
    parts: [],
  });

  switch (node.kind) {
    case "word":
    case "placeholder":
      return leaf(labelWidth(node.text));
    case "rule":
      return leaf(labelWidth(labelOf(node.name)));

    case "sequence": {
      const parts = node.of.map(measure);
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
      const parts = node.of.map(measure);
      // Every branch is drawn to the same width so the joins line up, and the
      // through-line stays on the first branch — the one a reader takes if they
      // read the diagram like a sentence.
      const width = Math.max(...parts.map((p) => p.width)) + TURN * 4;
      const height =
        parts.reduce((sum, p) => sum + p.height, 0) + LANE * (parts.length - 1);
      return { node, parts, width, height, baseline: parts[0]!.baseline };
    }

    case "optional": {
      const inner = measure(node.of);
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
      const inner = measure(node.of);
      const extra = node.separator ? measure(node.separator) : undefined;
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

function line(out: Bits, x1: number, y1: number, x2: number, y2: number): void {
  out.push(`<path class="rr-line" d="M${x1} ${y1} L${x2} ${y2}"/>`);
}

/** A quarter-circle corner, used everywhere a track changes direction. */
function corner(out: Bits, x: number, y: number, dx: number, dy: number): void {
  out.push(
    `<path class="rr-line" d="M${x} ${y} Q${x + dx} ${y} ${x + dx} ${y + dy}"/>`,
  );
}

function box(out: Bits, m: Measured, x: number, y: number): void {
  const node = m.node;
  const text = node.kind === "rule" ? labelOf(node.name) : (node as { text: string }).text;
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

function draw(out: Bits, m: Measured, x: number, y: number): void {
  const node = m.node;
  const mid = y + m.baseline;

  switch (node.kind) {
    case "word":
    case "placeholder":
    case "rule":
      box(out, m, x, mid - BOX / 2);
      return;

    case "sequence": {
      let at = x;
      m.parts.forEach((part, i) => {
        if (i > 0) {
          line(out, at, mid, at + GAP, mid);
          at += GAP;
        }
        draw(out, part, at, mid - part.baseline);
        at += part.width;
      });
      return;
    }

    case "choice": {
      const right = x + m.width;
      let top = y;
      m.parts.forEach((part, i) => {
        const inner = x + TURN * 2;
        const partMid = top + part.baseline;
        const wide = Math.max(...m.parts.map((p) => p.width));
        const offset = inner + (wide - part.width) / 2;
        draw(out, part, offset, top);
        line(out, inner, partMid, offset, partMid);
        line(out, offset + part.width, partMid, inner + wide, partMid);
        if (i === 0) {
          // The first branch is the straight-through one.
          line(out, x, mid, inner, mid);
          line(out, inner + wide, mid, right, mid);
        } else {
          // Everything else drops off the main line and comes back to it.
          corner(out, x, mid, TURN, TURN);
          line(out, x + TURN, mid + TURN, x + TURN, partMid - TURN);
          corner(out, x + TURN, partMid - TURN, TURN, TURN);
          corner(out, right - TURN, partMid, TURN, -TURN);
          line(out, right, partMid - TURN, right, mid + TURN);
          corner(out, right - TURN, mid + TURN, TURN, -TURN);
          line(out, x + TURN * 2, partMid, inner, partMid);
        }
        top += part.height + LANE;
      });
      return;
    }

    case "optional": {
      const inner = m.parts[0]!;
      const right = x + m.width;
      const at = x + TURN * 2;
      draw(out, inner, at, mid - inner.baseline);
      line(out, x, mid, at, mid);
      line(out, at + inner.width, mid, right, mid);
      // The bypass, arching over the top.
      const over = y + BOX / 2;
      corner(out, x, mid, TURN, -TURN);
      line(out, x + TURN, mid - TURN, x + TURN, over + TURN);
      corner(out, x + TURN, over + TURN, TURN, -TURN);
      line(out, x + TURN * 2, over, right - TURN * 2, over);
      out.push(
        `<path class="rr-line" d="M${right - TURN * 2} ${over} Q${right - TURN} ${over} ${
          right - TURN
        } ${over + TURN}"/>`,
      );
      line(out, right - TURN, over + TURN, right - TURN, mid - TURN);
      out.push(
        `<path class="rr-line" d="M${right - TURN} ${mid - TURN} Q${right - TURN} ${mid} ${right} ${mid}"/>`,
      );
      return;
    }

    case "repeat": {
      const inner = m.parts[0]!;
      const right = x + m.width;
      const at = x + TURN * 2;
      draw(out, inner, at, mid - inner.baseline);
      line(out, x, mid, at, mid);
      line(out, at + inner.width, mid, right, mid);

      // The way back round, underneath, with the separator on it if there is
      // one — `a , b , c` is one item and a comma, going round twice.
      const under = mid + inner.height - inner.baseline + LANE + BOX / 2;
      corner(out, right, mid, -TURN, TURN);
      line(out, right - TURN, mid + TURN, right - TURN, under - TURN);
      corner(out, right - TURN, under - TURN, -TURN, TURN);
      corner(out, x + TURN, under, -TURN, -TURN);
      line(out, x + TURN, under - TURN, x + TURN, mid + TURN);
      corner(out, x + TURN, mid + TURN, -TURN, -TURN);
      if (m.extra) {
        const sep = m.extra;
        const sx = x + (m.width - sep.width) / 2;
        draw(out, sep, sx, under - sep.baseline);
        line(out, x + TURN * 2, under, sx, under);
        line(out, sx + sep.width, under, right - TURN * 2, under);
      } else {
        line(out, x + TURN * 2, under, right - TURN * 2, under);
      }

      if (node.least === 0) {
        // None will do, so there is a way past the whole thing as well.
        const over = y + BOX / 2;
        line(out, x + TURN, mid - TURN, x + TURN, over + TURN);
        corner(out, x + TURN, over + TURN, TURN, -TURN);
        line(out, x + TURN * 2, over, right - TURN * 2, over);
        line(out, right - TURN, over + TURN, right - TURN, mid - TURN);
        out.push(
          `<path class="rr-line" d="M${x} ${mid} Q${x + TURN} ${mid} ${x + TURN} ${mid - TURN}"/>`,
          `<path class="rr-line" d="M${right - TURN * 2} ${over} Q${right - TURN} ${over} ${
            right - TURN
          } ${over + TURN}"/>`,
          `<path class="rr-line" d="M${right - TURN} ${mid - TURN} Q${right - TURN} ${mid} ${right} ${mid}"/>`,
        );
      }
      return;
    }
  }
}

/**
 * One rule as a standalone SVG.
 *
 * Returned as a string rather than as elements because it is static: nothing
 * here re-renders, and building it through React would cost a component per
 * path for no benefit. The caller sets it with `dangerouslySetInnerHTML`, which
 * is safe precisely because every word in it came from the grammar.
 */
export function railroad(syntax: Syntax): string {
  const m = measure(syntax);
  const width = m.width + PAD * 2 + 40;
  const height = m.height + PAD * 2;
  const out: Bits = [];
  const mid = PAD + m.baseline;

  // The entry and exit stubs, so a diagram reads as a piece of track rather
  // than as a floating box.
  out.push(`<path class="rr-cap" d="M${PAD} ${mid - 6} L${PAD} ${mid + 6}"/>`);
  line(out, PAD, mid, PAD + 20, mid);
  draw(out, m, PAD + 20, PAD);
  line(out, PAD + 20 + m.width, mid, width - PAD, mid);
  out.push(`<path class="rr-cap" d="M${width - PAD} ${mid - 6} L${width - PAD} ${mid + 6}"/>`);

  return `<svg class="railroad" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">${out.join(
    "",
  )}</svg>`;
}
