/**
 * Trading a script between two people.
 *
 * The screen is React, but the part worth protecting is not: a script only
 * moves when the person holding it says so, it moves intact however long it is,
 * and what lands in the receiving library remembers who handed it over. All
 * three are checked here over the in-process transport, with two real Sessions
 * and two real Libraries either side of it.
 */

import { describe, expect, it } from "vitest";
import { createLoopbackRoom, type LoopbackNetwork } from "../../src/net/loopback.js";
import { Session } from "../../src/net/session.js";
import type { Message } from "../../src/net/protocol.js";
import { Library } from "../../src/store/library.js";
import { MemoryStore } from "../../src/store/storage.js";
import { HUNTER, RACER } from "../../src/bots/index.js";

interface Side {
  session: Session;
  library: Library;
  name: string;
  /** Everything this side was told, in order. */
  heard: Array<{ from: string; message: Message }>;
}

/** Two people in a room, each with their own library. */
function pair(): { network: LoopbackNetwork; ada: Side; bob: Side } {
  const { network, host, guests } = createLoopbackRoom(1);
  const sides = [host, guests[0]!].map((transport, i) => {
    const name = i === 0 ? "Ada" : "Bob";
    const side: Side = {
      session: new Session({ transport, displayName: name, robot: null }),
      library: new Library(new MemoryStore()),
      name,
      heard: [],
    };
    side.session.onMessage((from, message) => side.heard.push({ from, message }));
    return side;
  });
  for (const side of sides) side.session.announce();
  network.flush();
  return { network, ada: sides[0]!, bob: sides[1]! };
}

/** The handler the Trade screen runs when someone asks for a copy. */
function answerRequest(side: Side, to: string, robotId: string, agreed: boolean): void {
  const mine = side.library.get(robotId);
  side.session.send(to, {
    t: "copyResponse",
    robotId,
    source: agreed && mine ? mine.source : null,
    reason: agreed ? null : "Not this one, sorry.",
  });
}

const lastOf = <T extends Message["t"]>(side: Side, t: T) =>
  [...side.heard].reverse().find((h) => h.message.t === t)?.message as
    | Extract<Message, { t: T }>
    | undefined;

describe("asking for a copy", () => {
  it("hands over the script when the owner agrees", () => {
    const { network, ada, bob } = pair();
    const hunter = ada.library.create(HUNTER);

    // Ada puts her shelf up; Bob sees titles, not scripts.
    ada.session.send("all", {
      t: "shelf",
      robots: ada.library.list().map((r) => ({ id: r.id, name: r.name, color: r.color })),
    });
    network.flush();

    const shelf = lastOf(bob, "shelf");
    expect(shelf?.robots.map((r) => r.name)).toEqual(["Hunter"]);
    expect(JSON.stringify(shelf)).not.toContain("on start");

    bob.session.send(ada.session.state.selfId, { t: "copyRequest", robotId: hunter.id });
    network.flush();

    const request = lastOf(ada, "copyRequest");
    expect(request?.robotId).toBe(hunter.id);

    answerRequest(ada, bob.session.state.selfId, hunter.id, true);
    network.flush();

    const response = lastOf(bob, "copyResponse");
    expect(response?.source).toBe(HUNTER);

    const landed = bob.library.importTraded(response!.source!, "Ada");
    expect(bob.library.get(landed.id)?.source).toBe(HUNTER);
    expect(landed.snapshots[0]?.origin).toMatchObject({
      kind: "trade",
      from: "Ada",
      robotName: "Hunter",
    });
  });

  it("sends nothing when the owner refuses", () => {
    const { network, ada, bob } = pair();
    const hunter = ada.library.create(HUNTER);

    bob.session.send(ada.session.state.selfId, { t: "copyRequest", robotId: hunter.id });
    network.flush();
    answerRequest(ada, bob.session.state.selfId, hunter.id, false);
    network.flush();

    const response = lastOf(bob, "copyResponse");
    expect(response?.source).toBeNull();
    expect(response?.reason).toBe("Not this one, sorry.");
    expect(bob.library.list()).toEqual([]);
  });

  it("carries a script far past one wire message", () => {
    // Trading is the mode most likely to send something large, and the
    // transport chunks above 15 kB. A script that arrives in pieces must be
    // byte-identical when it is put back together.
    const { network, ada, bob } = pair();
    const long = `${HUNTER}\n${"-- a very long comment\n".repeat(4000)}`;
    const robot = ada.library.create(long);

    bob.session.send(ada.session.state.selfId, { t: "copyRequest", robotId: robot.id });
    network.flush();
    answerRequest(ada, bob.session.state.selfId, robot.id, true);
    network.flush();

    expect(lastOf(bob, "copyResponse")?.source).toBe(long);
  });
});

describe("giving one away", () => {
  it("writes nothing until the receiver accepts", () => {
    const { network, ada, bob } = pair();
    const racer = ada.library.create(RACER);

    ada.session.send(bob.session.state.selfId, {
      t: "offer",
      robotId: racer.id,
      name: racer.name,
      color: racer.color,
      source: racer.source,
    });
    network.flush();

    const offer = lastOf(bob, "offer");
    expect(offer?.name).toBe("Racer");
    // The offer has arrived and the library is still untouched: only Bob
    // pressing something puts it there.
    expect(bob.library.list()).toEqual([]);

    const landed = bob.library.importTraded(offer!.source, "Ada");
    bob.session.send(ada.session.state.selfId, {
      t: "offerResult",
      robotId: offer!.robotId,
      accepted: true,
    });
    network.flush();

    expect(bob.library.list()).toHaveLength(1);
    expect(landed.snapshots[0]?.origin?.from).toBe("Ada");
    expect(lastOf(ada, "offerResult")?.accepted).toBe(true);
  });

  it("tells the giver when it is turned down", () => {
    const { network, ada, bob } = pair();
    bob.session.send(ada.session.state.selfId, {
      t: "offerResult",
      robotId: "whatever",
      accepted: false,
    });
    network.flush();
    expect(lastOf(ada, "offerResult")?.accepted).toBe(false);
  });
});
