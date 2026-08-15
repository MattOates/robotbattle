/**
 * Large messages.
 *
 * An RTCDataChannel will not carry an arbitrarily large message, and browsers
 * disagree on exactly where the ceiling is. Splitting happens in the shared
 * transport layer, which means these tests exercise the same code path WebRTC
 * will use — the thing that cannot be verified any other way without two real
 * machines on a real network.
 *
 * Yjs is why this matters in practice: a pair-programming room sends the whole
 * document to each newcomer, and that grows without bound as people type.
 */

import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createLoopbackRoom, LoopbackNetwork, LoopbackTransport } from "../../src/net/loopback.js";
import { Session } from "../../src/net/session.js";
import { RoomYProvider } from "../../src/net/yprovider.js";
import type { Message } from "../../src/net/protocol.js";
import { HUNTER } from "../../src/bots/index.js";

/** Comfortably past the 16 kB every engine agrees on. */
const BIG = 400 * 1024;

function room(guests: number) {
  const { network, host, guests: peers } = createLoopbackRoom(guests);
  const sessions = [host, ...peers].map(
    (transport, i) =>
      new Session({
        transport,
        displayName: i === 0 ? "Host" : `Guest ${i}`,
        robot: { name: "Hunter", color: "#ff8800", source: HUNTER },
      }),
  );
  for (const s of sessions) s.announce();
  network.flush();
  return { network, sessions, transports: [host, ...peers] };
}

function collect(session: Session): Message[] {
  const seen: Message[] = [];
  session.onMessage((_from, message) => seen.push(message));
  return seen;
}

describe("splitting and rejoining", () => {
  it("carries a message far larger than any data channel would take", () => {
    const { network, sessions } = room(1);
    const seen = collect(sessions[1]!);

    const huge = "x".repeat(BIG);
    sessions[0]!.broadcast({ t: "ydoc", kind: "sync", data: huge });
    network.flush();

    expect(seen).toHaveLength(1);
    const got = seen[0] as Extract<Message, { t: "ydoc" }>;
    expect(got.data).toHaveLength(BIG);
    expect(got.data).toBe(huge);
  });

  it("actually splits it, rather than sending one giant frame", () => {
    // If this ever stops holding, the ceiling has moved and WebRTC will start
    // failing sends in the field where nothing here would catch it.
    const network = new LoopbackNetwork();
    const host = new LoopbackTransport(network, "host", "host");
    host.connect();
    const guest = new LoopbackTransport(network, "guest1", "host");
    guest.connect();
    network.flush();

    const frames: number[] = [];
    const original = network.deliver.bind(network);
    vi.spyOn(network, "deliver").mockImplementation((to, from, raw) => {
      frames.push(raw.length);
      original(to, from, raw);
    });

    host.send("guest1", { t: "ydoc", kind: "sync", data: "y".repeat(BIG) });
    network.flush();

    expect(frames.length).toBeGreaterThan(20);
    for (const size of frames) expect(size).toBeLessThanOrEqual(16 * 1024);
    vi.restoreAllMocks();
  });

  it("keeps small messages as a single frame", () => {
    const network = new LoopbackNetwork();
    const host = new LoopbackTransport(network, "host", "host");
    host.connect();
    const guest = new LoopbackTransport(network, "guest1", "host");
    guest.connect();
    network.flush();

    const frames: string[] = [];
    const original = network.deliver.bind(network);
    vi.spyOn(network, "deliver").mockImplementation((to, from, raw) => {
      frames.push(raw);
      original(to, from, raw);
    });

    host.send("guest1", { t: "chat", robotId: "bot_a", text: "hello", at: 1 });
    network.flush();

    expect(frames).toHaveLength(1);
    expect(frames[0]).not.toContain('"chunk"');
    vi.restoreAllMocks();
  });

  it("survives multi-byte characters landing on a slice boundary", () => {
    // Slicing a JS string can cut a surrogate pair in half. The halves have to
    // rejoin to exactly the original.
    const { network, sessions } = room(1);
    const seen = collect(sessions[1]!);

    const emoji = "🤖🧬".repeat(60 * 1024);
    sessions[0]!.broadcast({ t: "ydoc", kind: "sync", data: emoji });
    network.flush();

    const got = seen[0] as Extract<Message, { t: "ydoc" }>;
    expect(got.data).toBe(emoji);
    expect([...got.data].length).toBe([...emoji].length);
  });

  it("relays a large message from guest to guest through the host", () => {
    // The host re-sends what it relays, so the message is split twice over.
    const { network, sessions } = room(2);
    const seen = collect(sessions[2]!);

    const huge = "z".repeat(BIG);
    sessions[1]!.send("guest2", { t: "ydoc", kind: "sync", data: huge });
    network.flush();

    expect(seen).toHaveLength(1);
    expect((seen[0] as Extract<Message, { t: "ydoc" }>).data).toBe(huge);
  });

  it("does not mix up two large messages arriving at once", () => {
    const { network, sessions } = room(2);
    const seen = collect(sessions[0]!);

    const fromOne = "1".repeat(BIG);
    const fromTwo = "2".repeat(BIG);
    // Interleaved: both peers talk before either has finished.
    sessions[1]!.send("host", { t: "ydoc", kind: "sync", data: fromOne });
    sessions[2]!.send("host", { t: "ydoc", kind: "sync", data: fromTwo });
    network.flush();

    expect(seen).toHaveLength(2);
    const datas = seen.map((m) => (m as Extract<Message, { t: "ydoc" }>).data);
    expect(datas).toContain(fromOne);
    expect(datas).toContain(fromTwo);
  });

  it("forgets half-finished messages when a peer drops", () => {
    // A peer that starts a large message and then vanishes must not leave its
    // slices held forever. Delivered by hand because a queued send always
    // completes: the point is a stream that genuinely stops half way.
    const network = new LoopbackNetwork();
    const host = new LoopbackTransport(network, "host", "host");
    host.connect();
    const guest = new LoopbackTransport(network, "guest1", "host");
    guest.connect();
    network.flush();

    const session = new Session({ transport: host, displayName: "Host", robot: null });
    const seen = collect(session);
    const pending = (host as unknown as { pending: Map<string, Map<string, unknown>> }).pending;

    // One slice of three, and then silence.
    network.deliver(
      "host",
      "guest1",
      JSON.stringify({ k: "chunk", id: "half", i: 0, n: 3, part: "a".repeat(2000) }),
    );
    network.flush();
    expect(pending.get("guest1")?.size).toBe(1);

    guest.close();
    network.flush();

    expect(pending.has("guest1")).toBe(false);
    expect(seen).toHaveLength(0);
  });
});

describe("hostile input", () => {
  const badChunk = (raw: unknown) => {
    const network = new LoopbackNetwork();
    const host = new LoopbackTransport(network, "host", "host");
    host.connect();
    const guest = new LoopbackTransport(network, "guest1", "host");
    guest.connect();
    network.flush();
    const session = new Session({ transport: host, displayName: "Host", robot: null });
    const seen = collect(session);
    network.deliver("host", "guest1", JSON.stringify(raw));
    network.flush();
    return seen;
  };

  it("ignores a slice count that would blow up memory", () => {
    expect(badChunk({ k: "chunk", id: "a", i: 0, n: 1e9, part: "x" })).toHaveLength(0);
  });

  it("ignores an out-of-range slice index", () => {
    expect(badChunk({ k: "chunk", id: "a", i: 5, n: 2, part: "x" })).toHaveLength(0);
    expect(badChunk({ k: "chunk", id: "a", i: -1, n: 2, part: "x" })).toHaveLength(0);
  });

  it("ignores malformed slices", () => {
    expect(badChunk({ k: "chunk", id: 7, i: 0, n: 1, part: "x" })).toHaveLength(0);
    expect(badChunk({ k: "chunk", id: "a", i: 0, n: 1, part: 42 })).toHaveLength(0);
    expect(badChunk({ k: "chunk" })).toHaveLength(0);
  });

  it("caps how many unfinished messages one peer can start", () => {
    const network = new LoopbackNetwork();
    const host = new LoopbackTransport(network, "host", "host");
    host.connect();
    const guest = new LoopbackTransport(network, "guest1", "host");
    guest.connect();
    network.flush();

    // Fifty messages begun and none completed must not accumulate.
    for (let i = 0; i < 50; i++) {
      network.deliver(
        "host",
        "guest1",
        JSON.stringify({ k: "chunk", id: `m${i}`, i: 0, n: 2, part: "a".repeat(1000) }),
      );
    }
    network.flush();

    const pending = (host as unknown as { pending: Map<string, Map<string, unknown>> }).pending;
    expect(pending.get("guest1")!.size).toBeLessThanOrEqual(8);
  });
});

describe("a real Yjs document", () => {
  it("syncs a document too big for one frame", () => {
    // The case that actually made chunking necessary.
    const { network, sessions } = room(1);

    const owner = new RoomYProvider(sessions[0]!, { name: "Host", color: "#e8a33d", peerId: "host" });
    const joiner = new RoomYProvider(sessions[1]!, { name: "Guest", color: "#5fd0c5", peerId: "guest1" });

    // A long editing session's worth of text.
    const script = `${HUNTER}\n`.repeat(400);
    owner.seed("bot_a", script);
    owner.greet("guest1");
    network.flush();

    expect(Y.encodeStateAsUpdate(owner.doc).length).toBeGreaterThan(16 * 1024);
    expect(joiner.textFor("bot_a").toString()).toBe(script);

    owner.destroy();
    joiner.destroy();
  });

  it("carries edits made after the initial sync", () => {
    const { network, sessions } = room(1);
    const owner = new RoomYProvider(sessions[0]!, { name: "Host", color: "#e8a33d", peerId: "host" });
    const joiner = new RoomYProvider(sessions[1]!, { name: "Guest", color: "#5fd0c5", peerId: "guest1" });

    owner.seed("bot_a", "name \"Shared\"\n");
    owner.greet("guest1");
    network.flush();

    joiner.textFor("bot_a").insert(joiner.textFor("bot_a").length, "chassis tank\n");
    network.flush();

    expect(owner.textFor("bot_a").toString()).toBe("name \"Shared\"\nchassis tank\n");

    owner.destroy();
    joiner.destroy();
  });
});
