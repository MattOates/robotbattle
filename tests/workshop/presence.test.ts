import { describe, expect, it } from "vitest";
import { PRESENCE_FIELD, byBlock, remoteCursors } from "../../src/ui/blocks/presence.js";

const user = (name: string, color: string) => ({ name, color, peerId: name });

describe("who is on which block", () => {
  const states = new Map<number, Record<string, unknown>>([
    [1, { user: user("Me", "#fff"), [PRESENCE_FIELD]: { block: "h0.1." } }],
    [2, { user: user("Sam", "#e8a33d"), [PRESENCE_FIELD]: { block: "h0.2." } }],
    [3, { user: user("Ada", "#5fd0c5"), [PRESENCE_FIELD]: { block: "h0.2." } }],
  ]);

  it("leaves me out of it", () => {
    expect(remoteCursors(states, 1).map((c) => c.name)).toEqual(["Sam", "Ada"]);
  });

  it("ignores a peer sitting on nothing", () => {
    const idle = new Map(states);
    idle.set(4, { user: user("Idle", "#000"), [PRESENCE_FIELD]: { block: null } });
    expect(remoteCursors(idle, 1).map((c) => c.name)).toEqual(["Sam", "Ada"]);
  });

  it("ignores a peer who has not said who they are", () => {
    // Awareness arrives in pieces; a state with a block and no user yet is
    // normal for a frame or two and must not be drawn as an anonymous halo.
    const partial = new Map(states);
    partial.set(5, { [PRESENCE_FIELD]: { block: "h0.0." } });
    expect(remoteCursors(partial, 1)).toHaveLength(2);
  });

  it("is ordered stably, so two cursors do not swap every frame", () => {
    const shuffled = new Map([...states].reverse());
    expect(remoteCursors(shuffled, 1).map((c) => c.clientId)).toEqual([2, 3]);
  });

  it("groups two people on one block rather than picking one", () => {
    const grouped = byBlock(remoteCursors(states, 1));
    expect(grouped.get("h0.2.")!.map((c) => c.name)).toEqual(["Sam", "Ada"]);
  });
});
