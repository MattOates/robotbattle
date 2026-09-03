/**
 * Where the blocks sit, and how to tidy them.
 *
 * Two things live here. One is a *stable name* for each top-level block, so a
 * position can be remembered across sessions and carried to somebody else. The
 * other is a canonical arrangement, used both by the tidy button and as the
 * layout a script gets the first time it is opened as blocks.
 *
 * ## Why not the block ids
 *
 * The ids in `blocks/bridge.ts` are derived from position in the script —
 * `h0`, `h1.2.t0.` — which is exactly right for saying "I am on this block" to
 * another peer, and exactly wrong for remembering where a block sits. Insert a
 * handler at the top and every id shifts by one, so every remembered position
 * lands on the wrong block. A layout has to be keyed on what a block *is*.
 *
 * A script cannot have two `on sense robot` handlers, and it cannot have two
 * `can dodge` routines — both are compile errors — so the event and the name
 * are already unique, already meaningful, and already survive being reordered,
 * renamed around, or traded.
 *
 * ## Why the arrangement is canonical
 *
 * So that two people who started from the same {robot} and changed different
 * parts of it end up with recognisably the same picture. If the layout were
 * merely tidy — a column, say — then adding one handler would shunt everything
 * below it and the two canvases would look nothing alike. Banded by event in a
 * fixed order, a handler somebody added appears in its own band and the rest
 * stays where it was.
 */

import { EVENT_NAMES, type EventName } from "../lang/ast.js";
import type { Block, Sketch } from "./compose.js";

/** Where one top-level block sits on the canvas. */
export interface Spot {
  x: number;
  y: number;
}

/**
 * Remembered positions, by stable key.
 *
 * Stored beside the script rather than inside it — see `store/types.ts`. A
 * layout is not part of the program: two {robotPlural} that lay out
 * differently are the same {robot}, and a comment explaining that would have
 * to be a comment the compiler carried.
 */
export type Layout = Record<string, Spot>;

/**
 * The stable name of a top-level block, or null for one that has none.
 *
 * A `can` with no name is half-typed and gets no key: remembering where an
 * unnamed block sat would mean remembering it against the next unnamed one.
 */
export function layoutKey(block: Block): string | null {
  if (block.kind === "robot") return "robot";
  if (block.kind === "can") return block.name ? `can:${block.name}` : null;
  return block.event ? `on:${block.event}` : null;
}

/** Which band a block belongs in, and where in it. */
interface Placed {
  key: string;
  block: Block;
}

/**
 * One row of the arrangement.
 *
 * It carries the event it is for rather than leaving that to be read back off
 * the keys, because a band can be made entirely of named behaviours — a
 * `can dodge given hit by bullet` with no `on hit by bullet` beside it is the
 * handler — and there would be no `on:` key in it to read.
 */
export interface Band {
  /** The event this row answers to, or null for the header and the library. */
  event: EventName | null;
  keys: string[];
}

/**
 * The canonical arrangement, as rows of keys.
 *
 * - The {robot} itself, alone, pinned top left. It is the title bar: not
 *   behaviour at all but what this thing *is* — its name, its chassis, its
 *   colour, the things it remembers — and there is exactly one of it. Sharing
 *   its row with `on start` made it read as the first of several handlers
 *   rather than as the heading over all of them.
 * - Then `on start`, at the same left margin as everything below it, because
 *   it *is* behaviour: the first thing that happens rather than part of the
 *   declaration.
 * - Then the library: every named behaviour that answers to no event. These
 *   are the parts — the things a handler `do`es — and they come *before* the
 *   handlers because that is the order they are read in. Boid is written
 *   entirely this way: `fold`, `remember`, `fly` and `forget` are the
 *   vocabulary, and `listen`, `spot` and `flock_together` are sentences built
 *   out of it. Put last, the reader meets every call before the thing it
 *   calls.
 * - Then one row per event, in the order the language lists them, holding the
 *   handler for that event and any named behaviour declared `given` it —
 *   because those run together, and with no `on` block the behaviours *are*
 *   the handler. Boid has no `on` blocks at all, so for it this is the whole
 *   of its behaviour.
 *
 * The split that matters here is not `on` against `can`: it is whether a
 * block names an event. One that does is behaviour and belongs with its
 * event; one that does not is a part, and belongs with the other parts.
 */
export function tidyBands(sketch: Sketch): Band[] {
  const placed: Placed[] = [];
  for (const block of sketch.blocks) {
    const key = layoutKey(block);
    if (key) placed.push({ key, block });
  }

  const take = (predicate: (p: Placed) => boolean): Placed[] => {
    const found = placed.filter(predicate);
    for (const p of found) placed.splice(placed.indexOf(p), 1);
    return found;
  };

  const bands: Band[] = [];

  // The title bar: the declarations, on their own.
  const header = take((p) => p.block.kind === "robot");
  if (header.length > 0) bands.push({ event: null, keys: header.map((p) => p.key) });

  // The starting work, on the line kept for it beside the heading.
  const starting = order(take((p) => p.block.event === "start"));
  if (starting.length > 0) bands.push({ event: "start", keys: starting.map((p) => p.key) });

  // Then the library, before any of the behaviour that uses it.
  const library = order(take((p) => p.block.event === null));
  if (library.length > 0) bands.push({ event: null, keys: library.map((p) => p.key) });

  // Then a row per event, in the language's own order rather than the
  // script's, so the same event lands in the same band whoever wrote the
  // {robot}.
  for (const event of EVENT_NAMES) {
    if (event === "start") continue;
    const band = order(take((p) => p.block.event === event));
    if (band.length > 0) bands.push({ event, keys: band.map((p) => p.key) });
  }

  // Anything whose event this build does not recognise, kept rather than
  // dropped: a block off the bottom is still findable, a block with no
  // position at all is not.
  const rest = order(placed.slice());
  if (rest.length > 0) bands.push({ event: null, keys: rest.map((p) => p.key) });

  return bands;
}

/**
 * Within a band: the handler first, then the behaviours by name.
 *
 * The handler first because it is the thing that runs; by name after it
 * because any order that depended on where they happen to sit in the file
 * would move them the moment somebody inserted a line.
 */
function order(band: Placed[]): Placed[] {
  return band.sort((a, b) => {
    if (a.block.kind !== b.block.kind) return a.block.kind === "on" ? -1 : 1;
    return (a.block.name ?? "").localeCompare(b.block.name ?? "");
  });
}

/** Every key a script currently has, for dropping stale positions. */
export function layoutKeys(sketch: Sketch): string[] {
  return sketch.blocks.map(layoutKey).filter((k): k is string => k !== null);
}

/**
 * Forget positions for blocks the script no longer has.
 *
 * A renamed behaviour is a new key and the old one would sit in storage
 * forever, and — worse — would come back if the name were ever reused.
 */
export function pruneLayout(layout: Layout, sketch: Sketch): Layout {
  const live = new Set(layoutKeys(sketch));
  const out: Layout = {};
  for (const [key, spot] of Object.entries(layout)) {
    if (live.has(key)) out[key] = spot;
  }
  return out;
}

/** Does this layout say where every block goes? */
export function isComplete(layout: Layout | undefined, sketch: Sketch): boolean {
  if (!layout) return false;
  const keys = layoutKeys(sketch);
  return keys.length > 0 && keys.every((k) => layout[k] !== undefined);
}


