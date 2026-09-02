import { describe, expect, it } from "vitest";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as Y from "yjs";
import { PRESENCE_FIELD, byBlock, remoteCursors } from "../../src/ui/blocks/presence.js";

/**
 * Against a real `Awareness`, not a Map I made up.
 *
 * The previous version of this file handed `remoteCursors` a hand-built map
 * with the shape I had assumed awareness produces — which tests my assumption
 * and nothing else. What matters is whether it reads what `y-protocols`
 * actually stores: how a client id is assigned, what a state looks like before
 * every field has arrived, and what is left behind when somebody disconnects.
 * So these drive the real thing, and encode the ordinary way the local peer's
 * own state gets there.
 */
function peerOn(doc: Y.Doc, name: string, colour: string): Awareness {
  const awareness = new Awareness(doc);
  awareness.setLocalStateField("user", { name, color: colour, peerId: name });
  return awareness;
}

/** Join two peers' awareness the way the provider does: encode and apply. */
function sync(from: Awareness, to: Awareness): void {
  const update = encodeAwarenessUpdate(from, [from.clientID]);
  applyAwarenessUpdate(to, update, "test");
}

describe("who is on which block", () => {
  it("sees a peer's selection after a real awareness update", () => {
    const me = peerOn(new Y.Doc(), "Me", "#fff");
    const them = peerOn(new Y.Doc(), "Sam", "#e8a33d");
    them.setLocalStateField(PRESENCE_FIELD, { block: "h1.2." });
    sync(them, me);

    const seen = remoteCursors(me.getStates(), me.clientID);
    expect(seen.map((c) => c.name)).toEqual(["Sam"]);
    expect(seen[0]!.block).toBe("h1.2.");
    expect(seen[0]!.color).toBe("#e8a33d");
  });

  it("leaves me out, however my own state arrived", () => {
    const me = peerOn(new Y.Doc(), "Me", "#fff");
    me.setLocalStateField(PRESENCE_FIELD, { block: "h0.0." });
    expect(remoteCursors(me.getStates(), me.clientID)).toEqual([]);
  });

  it("ignores a peer who has said where they are but not who they are", () => {
    // Awareness arrives in pieces, and a state with a block and no user yet is
    // normal for a moment. Drawn, it is an anonymous halo in nobody's colour.
    const me = peerOn(new Y.Doc(), "Me", "#fff");
    const partial = new Awareness(new Y.Doc());
    partial.setLocalStateField(PRESENCE_FIELD, { block: "h0.0." });
    sync(partial, me);
    expect(remoteCursors(me.getStates(), me.clientID)).toEqual([]);
  });

  it("ignores a peer sitting on nothing", () => {
    const me = peerOn(new Y.Doc(), "Me", "#fff");
    const idle = peerOn(new Y.Doc(), "Idle", "#000");
    idle.setLocalStateField(PRESENCE_FIELD, { block: null });
    sync(idle, me);
    expect(remoteCursors(me.getStates(), me.clientID)).toEqual([]);
  });

  it("drops a cursor when its peer goes", () => {
    const me = peerOn(new Y.Doc(), "Me", "#fff");
    const them = peerOn(new Y.Doc(), "Sam", "#e8a33d");
    them.setLocalStateField(PRESENCE_FIELD, { block: "h1.2." });
    sync(them, me);
    expect(remoteCursors(me.getStates(), me.clientID)).toHaveLength(1);

    // What `RoomYProvider` does when a peer disconnects.
    removeAwarenessStates(me, [them.clientID], "test");
    expect(remoteCursors(me.getStates(), me.clientID)).toEqual([]);
  });

  it("groups two people on one block rather than picking one", () => {
    const me = peerOn(new Y.Doc(), "Me", "#fff");
    for (const [name, colour] of [
      ["Sam", "#e8a33d"],
      ["Ada", "#5fd0c5"],
    ] as [string, string][]) {
      const peer = peerOn(new Y.Doc(), name, colour);
      peer.setLocalStateField(PRESENCE_FIELD, { block: "h0.2." });
      sync(peer, me);
    }
    const grouped = byBlock(remoteCursors(me.getStates(), me.clientID));
    expect(grouped.get("h0.2.")!.map((c) => c.name).sort()).toEqual(["Ada", "Sam"]);
  });

  it("is ordered stably, so two cursors do not swap every frame", () => {
    const me = peerOn(new Y.Doc(), "Me", "#fff");
    const ids: number[] = [];
    for (const name of ["Sam", "Ada", "Kit"]) {
      const peer = peerOn(new Y.Doc(), name, "#e8a33d");
      peer.setLocalStateField(PRESENCE_FIELD, { block: "h0.0." });
      sync(peer, me);
      ids.push(peer.clientID);
    }
    const order = remoteCursors(me.getStates(), me.clientID).map((c) => c.clientId);
    expect(order).toEqual([...ids].sort((a, b) => a - b));
  });
});
