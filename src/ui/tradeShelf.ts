/**
 * What is on the table.
 *
 * Trading starts with nothing shared. You put things out deliberately, one at a
 * time, and only those are visible to the room — a library is a private working
 * space, and opening it wholesale the moment you join a room is not something
 * anybody asked for.
 *
 * The rule lives here rather than in the screen because it is the rule the
 * network has to obey, not a piece of presentation. Every incoming `peek` and
 * `copyRequest` names something chosen by somebody else's browser, and a name
 * is easy to keep hold of: a peer who saw something on the table a minute ago,
 * or who guesses, must not be able to read a thing you have since taken back.
 * So the answer to "may they see this?" is asked of the table, never of the
 * library.
 *
 * Three kinds go through here — a robot, a place, a block — and they are kept
 * in one list rather than three because "is this out?" has to be one question
 * with one answer. A second list is a second place to forget to check.
 */

import type { ShelfItem, TradeGoods, TradeKind } from "../net/protocol.js";
import type { StoredArena, StoredRobot } from "../store/types.js";
import { blockBundle, type LibraryBlock } from "../workshop/blocks.js";

/**
 * Everything you *could* put out, in the order the shelf shows it.
 *
 * Built by the screen from the live library, so something deleted elsewhere
 * simply stops being here.
 */
export interface Tradeables {
  robots: readonly StoredRobot[];
  arenas: readonly StoredArena[];
  blocks: readonly LibraryBlock[];
}

/**
 * A block has no id of its own — it is a piece of text inside a robot — so it
 * is named by the robot it lives in and what it is called. Unique within a
 * library, which is all an id has to be.
 */
export function blockId(block: LibraryBlock): string {
  return `${block.robotId}/${block.name}`;
}

/** How the table refers to one thing. Kinds have their own id spaces. */
export function tableKey(kind: TradeKind, id: string): string {
  return `${kind}:${id}`;
}

/** Everything you own, as shelf rows — whether or not it is out. */
export function allTradeables(lib: Tradeables): ShelfItem[] {
  return [
    ...lib.robots.map(
      (r): ShelfItem => ({
        kind: "robot",
        id: r.id,
        name: r.name,
        color: r.color,
        locomotion: r.locomotion ?? "skid",
      }),
    ),
    ...lib.arenas.map(
      (a): ShelfItem => ({
        kind: "arena",
        id: a.id,
        name: a.name,
        walls: a.spec.walls.length,
      }),
    ),
    ...lib.blocks.map((b): ShelfItem => {
      const item: ShelfItem = {
        kind: "block",
        id: blockId(b),
        name: b.name,
        from: b.robotName,
      };
      // A block written without `given` fits anywhere, and the row says so by
      // leaving the field off rather than by carrying an empty one.
      if (b.given) item.event = b.given;
      return item;
    }),
  ];
}

/** How each thing you have put out looks, in the order you put it there. */
export function shelfFor(lib: Tradeables, offered: readonly string[]): ShelfItem[] {
  const mine = new Map(allTradeables(lib).map((item) => [tableKey(item.kind, item.id), item]));
  const out: ShelfItem[] = [];
  for (const key of offered) {
    const item = mine.get(key);
    if (item) out.push(item);
  }
  return out;
}

/**
 * The goods behind one shelf row, or null for anything not on the table.
 *
 * Null covers several situations on purpose — never offered, taken back, and
 * deleted — because the answer given to the room is the same in all of them,
 * and saying which would leak the very thing being withheld.
 */
export function offeredGoods(
  lib: Tradeables,
  offered: readonly string[],
  kind: unknown,
  id: unknown,
): TradeGoods | null {
  if (typeof id !== "string") return null;
  if (kind !== "robot" && kind !== "arena" && kind !== "block") return null;
  if (!offered.includes(tableKey(kind, id))) return null;

  if (kind === "robot") {
    const robot = lib.robots.find((r) => r.id === id);
    return robot
      ? { kind: "robot", name: robot.name, color: robot.color, source: robot.source }
      : null;
  }
  if (kind === "arena") {
    const arena = lib.arenas.find((a) => a.id === id);
    return arena ? { kind: "arena", name: arena.name, spec: arena.spec } : null;
  }
  const block = lib.blocks.find((b) => blockId(b) === id);
  return block
    ? {
        kind: "block",
        name: block.name,
        // Packed with whatever it hands off to, or it arrives somewhere that
        // has never heard of the block it calls and will not compile.
        text: blockBundle(block, lib.blocks),
        from: block.robotName,
      }
    : null;
}

/** Drop a key from the table, or add it at the end if it is not there yet. */
export function toggleOffered(offered: readonly string[], key: string): string[] {
  return offered.includes(key) ? offered.filter((o) => o !== key) : [...offered, key];
}

/**
 * Forget anything that has since gone.
 *
 * Blocks make this matter more than it used to: editing a robot can rename or
 * delete a block without anybody thinking of it as deleting something, so the
 * table has to be re-checked against the library rather than trusted.
 */
export function pruneOffered(offered: readonly string[], lib: Tradeables): string[] {
  const live = new Set(allTradeables(lib).map((item) => tableKey(item.kind, item.id)));
  return offered.filter((key) => live.has(key));
}
