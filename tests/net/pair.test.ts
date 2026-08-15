/**
 * Shared editing with more than two people.
 *
 * A CRDT converges regardless of how many writers there are, so the question
 * is never "does the merge work" — it is whether the plumbing around it (who
 * gets sent the document, who hears about whom, what happens when someone
 * leaves) holds up as the room grows.
 */

import { describe, expect, it } from "vitest";
import { createLoopbackRoom, LoopbackTransport } from "../../src/net/loopback.js";
import { Session } from "../../src/net/session.js";
import { RoomYProvider, CURSOR_COLORS } from "../../src/net/yprovider.js";
import { HUNTER } from "../../src/bots/index.js";

/** The session robot these tests work on. */
const ROBOT = "bot_shared";

interface Room {
  flush: () => void;
  sessions: Session[];
  providers: RoomYProvider[];
  transports: LoopbackTransport[];
  addPeer: (name: string) => { session: Session; provider: RoomYProvider };
}

/** A room of `people` (owner plus guests), each with a live provider. */
function pairRoom(people: number, seedWith?: string): Room {
  const { network, host, guests } = createLoopbackRoom(people - 1);
  const transports = [host, ...guests];
  const sessions = transports.map(
    (transport, i) =>
      new Session({
        transport,
        displayName: i === 0 ? "Owner" : `Guest ${i}`,
        robot: { name: "Hunter", color: "#ff8800", source: HUNTER },
      }),
  );
  for (const s of sessions) s.announce();
  network.flush();

  const providers = sessions.map(
    (session, i) =>
      new RoomYProvider(session, {
        name: i === 0 ? "Owner" : `Guest ${i}`,
        color: CURSOR_COLORS[i % CURSOR_COLORS.length]!,
        peerId: session.state.selfId,
      }),
  );

  if (seedWith !== undefined) providers[0]!.seed(ROBOT, seedWith);
  // The owner hands the document to everyone already present.
  for (const peer of sessions[0]!.state.peers) {
    if (peer.id !== sessions[0]!.state.selfId) providers[0]!.greet(peer.id);
  }
  network.flush();

  let next = people;
  return {
    flush: () => network.flush(),
    sessions,
    providers,
    transports,
    addPeer(name: string) {
      const id = `guest${next++}`;
      const transport = new LoopbackTransport(network, id, "host");
      const session = new Session({ transport, displayName: name, robot: null });
      transport.connect();
      network.flush();
      const provider = new RoomYProvider(session, { name, color: "#6ad98a", peerId: id });
      // Whoever owns the room brings a newcomer up to date.
      providers[0]!.greet(id);
      network.flush();
      return { session, provider };
    },
  };
}

describe("a room of more than two", () => {
  it("gives everyone the document", () => {
    const script = 'name "Together"\nchassis tank\n';
    const room = pairRoom(5, script);
    for (const provider of room.providers) {
      expect(provider.textFor(ROBOT).toString()).toBe(script);
    }
  });

  it("converges when four people edit at once", () => {
    const room = pairRoom(4, "");
    // Every writer inserts before anything has been exchanged, which is the
    // case a naive merge gets wrong.
    room.providers.forEach((provider, i) => provider.textFor(ROBOT).insert(0, `-- line ${i}\n`));
    room.flush();

    const texts = room.providers.map((p) => p.textFor(ROBOT).toString());
    for (const text of texts) expect(text).toBe(texts[0]);
    // Nothing was lost or duplicated in the merge.
    for (let i = 0; i < 4; i++) {
      expect(texts[0]!.match(new RegExp(`-- line ${i}\\n`, "g"))).toHaveLength(1);
    }
  });

  it("shows everyone in the room to everyone", () => {
    const room = pairRoom(5);
    for (const session of room.sessions) {
      expect(session.state.peers).toHaveLength(5);
    }
  });

  it("gives everyone a cursor the others can see", () => {
    const room = pairRoom(4, "hello");
    room.flush();
    for (const provider of room.providers) {
      expect(provider.awareness.getStates().size).toBe(4);
    }
  });

  it("catches up someone who arrives late", () => {
    const room = pairRoom(3, "name \"Start\"\n");
    room.providers[1]!.textFor(ROBOT).insert(room.providers[1]!.textFor(ROBOT).length, "chassis car\n");
    room.flush();

    const latecomer = room.addPeer("Latecomer");
    expect(latecomer.provider.textFor(ROBOT).toString()).toBe('name "Start"\nchassis car\n');
    expect(latecomer.provider.awareness.getStates().size).toBeGreaterThan(1);
  });

  it("carries a latecomer's own edits back to everyone", () => {
    const room = pairRoom(3, "start\n");
    const latecomer = room.addPeer("Latecomer");
    latecomer.provider.textFor(ROBOT).insert(latecomer.provider.textFor(ROBOT).length, "mine\n");
    room.flush();
    for (const provider of room.providers) {
      expect(provider.textFor(ROBOT).toString()).toBe("start\nmine\n");
    }
  });

  it("takes a leaver's cursor away from everyone else", () => {
    // A ghost cursor sitting in the document forever is the obvious failure
    // mode here, so leaving has to be announced before we stop listening.
    const room = pairRoom(4, "hello");
    room.flush();
    expect(room.providers[1]!.awareness.getStates().size).toBe(4);

    room.providers[3]!.destroy();
    room.flush();

    expect(room.providers[1]!.awareness.getStates().size).toBe(3);
    expect(room.providers[0]!.awareness.getStates().size).toBe(3);
  });

  it("keeps working after someone leaves", () => {
    const room = pairRoom(4, "");
    room.providers[3]!.destroy();
    room.transports[3]!.close();
    room.flush();

    room.providers[1]!.textFor(ROBOT).insert(0, "still here\n");
    room.flush();
    expect(room.providers[0]!.textFor(ROBOT).toString()).toBe("still here\n");
    expect(room.providers[2]!.textFor(ROBOT).toString()).toBe("still here\n");
  });

  it("delivers chat to everyone, including the sender", () => {
    const room = pairRoom(4);
    const inboxes = room.sessions.map((session) => {
      const seen: string[] = [];
      session.onMessage((_from, message) => {
        if (message.t === "chat") seen.push(message.text);
      });
      return seen;
    });

    room.sessions[0]!.broadcast({ t: "chat", robotId: ROBOT, text: "shall we use a car?", at: 1 });
    room.flush();

    // Four people in the room means four copies, the sender's own included —
    // otherwise you cannot see what you just said.
    for (const inbox of inboxes) expect(inbox).toEqual(["shall we use a car?"]);
  });

  it("carries chat from one guest to the other guests", () => {
    // Guests hold no link to each other, so this only works if the host
    // relays. Worth its own test because two-person rooms never exercise it.
    const room = pairRoom(4);
    const inboxes = room.sessions.map((session) => {
      const seen: string[] = [];
      session.onMessage((_from, message) => {
        if (message.t === "chat") seen.push(message.text);
      });
      return seen;
    });

    room.sessions[2]!.broadcast({ t: "chat", robotId: ROBOT, text: "mine fires too slowly", at: 2 });
    room.flush();

    for (const inbox of inboxes) expect(inbox).toEqual(["mine fires too slowly"]);
  });

  it("keeps chat and document edits from interfering", () => {
    const room = pairRoom(3, "start\n");
    const chat: string[] = [];
    room.sessions[0]!.onMessage((_from, message) => {
      if (message.t === "chat") chat.push(message.text);
    });

    room.sessions[1]!.broadcast({ t: "chat", robotId: ROBOT, text: "adding a sweep", at: 3 });
    room.providers[1]!.textFor(ROBOT).insert(room.providers[1]!.textFor(ROBOT).length, "turret.sweep 45\n");
    room.flush();

    expect(chat).toEqual(["adding a sweep"]);
    expect(room.providers[0]!.textFor(ROBOT).toString()).toBe("start\nturret.sweep 45\n");
  });

  it("attributes each message to the person who sent it", () => {
    const room = pairRoom(3);
    const senders: string[] = [];
    room.sessions[0]!.onMessage((from, message) => {
      if (message.t === "chat") senders.push(from);
    });

    room.sessions[1]!.broadcast({ t: "chat", robotId: ROBOT, text: "one", at: 1 });
    room.sessions[2]!.broadcast({ t: "chat", robotId: ROBOT, text: "two", at: 2 });
    room.flush();

    expect(new Set(senders).size).toBe(2);
    expect(senders).toContain("guest1");
    expect(senders).toContain("guest2");
  });

  it("does not send the whole document once per pair", () => {
    // Everyone greeting everyone is O(n^2) full-document sends on join, which
    // for a big script is the difference between a room that works and one
    // that stalls when the fifth person arrives.
    const room = pairRoom(5, HUNTER.repeat(20));
    let fullSends = 0;
    for (const provider of room.providers) {
      const original = provider.greet.bind(provider);
      provider.greet = (peerId: string) => {
        fullSends++;
        original(peerId);
      };
    }
    room.addPeer("Sixth");
    // One newcomer should cost one hand-over, not one per person already here.
    expect(fullSends).toBeLessThanOrEqual(2);
  });
});
