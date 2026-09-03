/**
 * Who is on which block.
 *
 * The text editor gets cursors from `y-codemirror.next`, which knows how to
 * turn a character offset into a caret. A block canvas has no character
 * offsets and there is no equivalent binding for Blockly, so this is the small
 * amount of it that is actually needed: each peer says which block it has
 * selected, and everybody draws a halo and a name on that block.
 *
 * It works at all because block ids are derived from position in the script
 * rather than minted per workspace — see `bridge.ts`. Blockly's own ids differ
 * on every peer, so "I am on block `xY3k`" would name nothing on anybody
 * else's screen; `h0.2.t1.` names the same statement everywhere the script
 * agrees.
 *
 * Pure over plain objects, so the awareness shape can be tested without a peer.
 */

/** What one peer publishes about itself. */
export interface BlockPresence {
  /** The block they have selected, or null when they are on none. */
  block: string | null;
}

export interface PeerUser {
  name: string;
  color: string;
  peerId: string;
}

/** One peer's cursor, ready to draw. */
export interface RemoteCursor {
  clientId: number;
  block: string;
  name: string;
  color: string;
}

/** The awareness field this module owns. Namespaced so it cannot collide. */
export const PRESENCE_FIELD = "blocks";

/**
 * Everyone except me who is sitting on a block.
 *
 * Two people on the same block is normal and both are returned — the drawing
 * layer stacks their names rather than picking one, because "we are both
 * looking at this" is exactly the thing worth showing.
 */
export function remoteCursors(
  states: Map<number, Record<string, unknown>>,
  selfClientId: number,
): RemoteCursor[] {
  const out: RemoteCursor[] = [];
  for (const [clientId, state] of states) {
    if (clientId === selfClientId) continue;
    const presence = state[PRESENCE_FIELD] as BlockPresence | undefined;
    const user = state["user"] as PeerUser | undefined;
    if (!presence?.block || !user) continue;
    out.push({
      clientId,
      block: presence.block,
      name: user.name,
      color: user.color,
    });
  }
  // Stable order, so two cursors on one block do not swap places every frame.
  return out.sort((a, b) => a.clientId - b.clientId);
}

/** Group cursors by the block they are on, for stacking their labels. */
export function byBlock(cursors: readonly RemoteCursor[]): Map<string, RemoteCursor[]> {
  const map = new Map<string, RemoteCursor[]>();
  for (const cursor of cursors) {
    const held = map.get(cursor.block);
    if (held) held.push(cursor);
    else map.set(cursor.block, [cursor]);
  }
  return map;
}
