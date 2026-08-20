/**
 * The lobby, driven over the in-process transport.
 *
 * This is the payoff of having a transport interface: a three-peer room with
 * joins, leaves, roster sync and a whole match can be exercised in CI with no
 * browser and no broker.
 */

import { describe, expect, it } from "vitest";
import { createLoopbackRoom, LoopbackNetwork, LoopbackTransport } from "../../src/net/loopback.js";
import { Session } from "../../src/net/session.js";
import type { Message, RobotEntry } from "../../src/net/protocol.js";
import { HUNTER, RACER, SPINNER } from "../../src/bots/index.js";

const entry = (name: string, source: string, color = "#ff8800"): RobotEntry => ({
  name,
  color,
  source,
});

interface Room {
  network: LoopbackNetwork;
  sessions: Session[];
}

/** A host plus `guestCount` guests, all announced and settled. */
function room(guestCount: number, robots: RobotEntry[]): Room {
  const { network, host, guests } = createLoopbackRoom(guestCount);
  const transports = [host, ...guests];
  const sessions = transports.map(
    (transport, i) =>
      new Session({
        transport,
        displayName: i === 0 ? "Host" : `Guest ${i}`,
        robot: robots[i] ?? null,
      }),
  );
  for (const session of sessions) session.announce();
  network.flush();
  return { network, sessions };
}

describe("roster", () => {
  it("shows everyone to everyone", () => {
    const { sessions } = room(2, [
      entry("Hunter", HUNTER),
      entry("Racer", RACER),
      entry("Spinner", SPINNER),
    ]);
    for (const session of sessions) {
      expect(session.state.peers).toHaveLength(3);
      expect(session.state.peers.map((p) => p.robot?.name).sort()).toEqual([
        "Hunter",
        "Racer",
        "Spinner",
      ]);
    }
  });

  it("announces itself even when the roster arrives before its own link", () => {
    // A real transport can deliver the host's roster before the guest's link
    // to the host is up. Announcing on "someone joined" therefore posts into an
    // empty link set and the guest shows as "Joining…" forever; announcing on
    // "I can send" is what actually works.
    const network = new LoopbackNetwork();
    const host = new LoopbackTransport(network, "host", "host");
    host.connect();
    const hostSession = new Session({ transport: host, displayName: "Host", robot: null });

    const guest = new LoopbackTransport(network, "guest1", "host");
    // Session first, transport second: the guest is listening before anything
    // about the room has reached it.
    new Session({ transport: guest, displayName: "Ada", robot: entry("Racer", RACER) });
    guest.connect();
    network.flush();

    const seen = hostSession.state.peers.find((p) => p.id === "guest1");
    expect(seen?.displayName).toBe("Ada");
    expect(seen?.robot?.name).toBe("Racer");
  });

  it("reports when it can actually send", () => {
    const network = new LoopbackNetwork();
    const host = new LoopbackTransport(network, "host", "host");
    host.connect();
    // A host relays, so it is always able to send.
    expect(host.ready).toBe(true);

    const guest = new LoopbackTransport(network, "guest1", "host");
    expect(guest.ready).toBe(false);
    guest.connect();
    expect(guest.ready).toBe(true);
  });

  it("marks exactly one host, and agrees who it is", () => {
    const { sessions } = room(2, [entry("Hunter", HUNTER)]);
    for (const session of sessions) {
      const hosts = session.state.peers.filter((p) => p.isHost);
      expect(hosts).toHaveLength(1);
      expect(hosts[0]!.displayName).toBe("Host");
    }
  });

  it("carries display names from guests to everyone", () => {
    const { sessions } = room(2, [entry("Hunter", HUNTER)]);
    expect(sessions[0]!.state.peers.map((p) => p.displayName).sort()).toEqual([
      "Guest 1",
      "Guest 2",
      "Host",
    ]);
  });

  it("propagates ready state", () => {
    const { network, sessions } = room(1, [entry("Hunter", HUNTER), entry("Racer", RACER)]);
    sessions[1]!.setReady(true);
    network.flush();
    for (const session of sessions) {
      const guest = session.state.peers.find((p) => !p.isHost)!;
      expect(guest.ready).toBe(true);
    }
  });

  it("starts everyone as not ready", () => {
    // Nobody is entered into a battle they have not agreed to.
    const { sessions } = room(2, [entry("Hunter", HUNTER), entry("Racer", RACER)]);
    for (const session of sessions) {
      expect(session.state.peers.every((p) => !p.ready)).toBe(true);
    }
  });

  it("lets the host see exactly who is holding things up", () => {
    const { network, sessions } = room(2, [
      entry("Hunter", HUNTER),
      entry("Racer", RACER),
      entry("Spinner", SPINNER),
    ]);
    sessions[0]!.setReady(true);
    sessions[1]!.setReady(true);
    network.flush();

    const waiting = sessions[0]!.state.peers.filter((p) => !p.ready);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.displayName).toBe("Guest 2");
  });

  it("delivers a nudge only to the peer it is aimed at", () => {
    const { network, sessions } = room(2, [
      entry("Hunter", HUNTER),
      entry("Racer", RACER),
      entry("Spinner", SPINNER),
    ]);
    const atGuest1: Message[] = [];
    const atGuest2: Message[] = [];
    sessions[1]!.onMessage((_f, m) => atGuest1.push(m));
    sessions[2]!.onMessage((_f, m) => atGuest2.push(m));

    sessions[1]!.setReady(true);
    network.flush();

    // The host prods whoever is not ready — and only them.
    for (const peer of sessions[0]!.state.peers) {
      if (!peer.ready && peer.id !== sessions[0]!.state.selfId) {
        sessions[0]!.send(peer.id, { t: "nudge", text: "Everyone is waiting on you" });
      }
    }
    network.flush();

    expect(atGuest1).toHaveLength(0);
    expect(atGuest2.filter((m) => m.t === "nudge")).toHaveLength(1);
  });

  it("un-readies a peer that changes its robot", () => {
    // Readiness is agreement to fight with a particular robot, so swapping it
    // has to withdraw that agreement rather than silently carry it over.
    const { network, sessions } = room(1, [entry("Hunter", HUNTER), entry("Racer", RACER)]);
    sessions[1]!.setReady(true);
    network.flush();
    expect(sessions[0]!.state.peers.find((p) => !p.isHost)?.ready).toBe(true);

    sessions[1]!.setReady(false);
    sessions[1]!.setRobot(entry("Spinner", SPINNER));
    network.flush();

    const guest = sessions[0]!.state.peers.find((p) => !p.isHost)!;
    expect(guest.ready).toBe(false);
    expect(guest.robot?.name).toBe("Spinner");
  });

  it("propagates a robot swapped in the lobby", () => {
    const { network, sessions } = room(1, [entry("Hunter", HUNTER), entry("Racer", RACER)]);
    sessions[1]!.setRobot(entry("Spinner", SPINNER, "#7fd1e0"));
    network.flush();
    const seen = sessions[0]!.state.peers.find((p) => !p.isHost)!;
    expect(seen.robot?.name).toBe("Spinner");
    expect(sessions[0]!.entries().map((e) => e.robot.name).sort()).toEqual([
      "Hunter",
      "Spinner",
    ]);
  });

  it("drops a peer that leaves, for everyone", () => {
    const { network, sessions } = room(2, [
      entry("Hunter", HUNTER),
      entry("Racer", RACER),
      entry("Spinner", SPINNER),
    ]);
    sessions[2]!.close();
    network.flush();
    expect(sessions[0]!.state.peers).toHaveLength(2);
    expect(sessions[1]!.state.peers).toHaveLength(2);
    expect(sessions[0]!.entries().map((e) => e.robot.name).sort()).toEqual(["Hunter", "Racer"]);
  });
});

describe("entries for a manifest", () => {
  it("includes the host's own robot", () => {
    const { sessions } = room(1, [entry("Hunter", HUNTER), entry("Racer", RACER)]);
    expect(sessions[0]!.entries()).toHaveLength(2);
  });

  it("orders identically however peers joined", () => {
    // Every peer must build the same manifest, so the order cannot depend on
    // arrival timing.
    const a = room(2, [entry("Hunter", HUNTER), entry("Racer", RACER), entry("Spinner", SPINNER)]);
    expect(a.sessions[0]!.entries().map((e) => e.peerId)).toEqual([
      "guest1",
      "guest2",
      "host",
    ]);
  });

  it("leaves out a peer with no robot", () => {
    const { sessions } = room(1, [entry("Hunter", HUNTER), null as never]);
    expect(sessions[0]!.entries()).toHaveLength(1);
  });
});

describe("mode messages", () => {
  it("passes non-lobby messages through to listeners, and not lobby ones", () => {
    const { network, sessions } = room(1, [entry("Hunter", HUNTER), entry("Racer", RACER)]);
    const seen: Message[] = [];
    sessions[1]!.onMessage((_from, message) => seen.push(message));

    sessions[0]!.broadcast({ t: "chat", robotId: "bot_a", text: "hello", at: 1 });
    sessions[0]!.setNotice("waiting for one more");
    network.flush();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ t: "chat", robotId: "bot_a", text: "hello", at: 1 });
    // A notice is lobby state, so it lands on the state rather than the listener.
    expect(sessions[1]!.state.notice).toBe("waiting for one more");
  });

  it("delivers a broadcast to the sender too", () => {
    const { network, sessions } = room(1, [entry("Hunter", HUNTER), entry("Racer", RACER)]);
    const seen: Message[] = [];
    sessions[0]!.onMessage((_from, message) => seen.push(message));
    sessions[0]!.broadcast({ t: "chat", robotId: "bot_a", text: "hi", at: 2 });
    network.flush();
    expect(seen).toHaveLength(1);
  });

  it("routes a direct message to one peer only", () => {
    const { network, sessions } = room(2, [
      entry("Hunter", HUNTER),
      entry("Racer", RACER),
      entry("Spinner", SPINNER),
    ]);
    const atGuest1: Message[] = [];
    const atGuest2: Message[] = [];
    sessions[1]!.onMessage((_f, m) => atGuest1.push(m));
    sessions[2]!.onMessage((_f, m) => atGuest2.push(m));

    sessions[0]!.send("guest2", { t: "peek", kind: "robot" as const, id: "x" });
    network.flush();

    expect(atGuest1).toHaveLength(0);
    expect(atGuest2).toHaveLength(1);
  });

  it("relays guest to guest through the host", () => {
    // Guests hold no link to each other, so this only works if the host
    // forwards. Worth asserting, because every mode depends on it.
    const { network, sessions } = room(2, [
      entry("Hunter", HUNTER),
      entry("Racer", RACER),
      entry("Spinner", SPINNER),
    ]);
    const seen: Message[] = [];
    sessions[2]!.onMessage((_f, m) => seen.push(m));
    sessions[1]!.send("guest2", { t: "copyRequest", kind: "robot" as const, id: "abc" });
    network.flush();
    expect(seen).toEqual([{ t: "copyRequest", kind: "robot" as const, id: "abc" }]);
  });

  it("ignores malformed traffic instead of crashing", () => {
    const { network, sessions } = room(1, [entry("Hunter", HUNTER), entry("Racer", RACER)]);
    const seen: Message[] = [];
    sessions[1]!.onMessage((_f, m) => seen.push(m));
    // Junk from another browser must not take the lobby down.
    sessions[0]!.broadcast({ t: "not-a-real-type" } as unknown as Message);
    sessions[0]!.broadcast(null as unknown as Message);
    network.flush();
    expect(seen).toHaveLength(0);
    expect(sessions[1]!.state.peers).toHaveLength(2);
  });

  it("clamps a hostile display name and colour", () => {
    const network = new LoopbackNetwork();
    const host = new LoopbackTransport(network, "host", "host");
    host.connect();
    const guest = new LoopbackTransport(network, "guest1", "host");
    guest.connect();
    network.flush();

    const hostSession = new Session({ transport: host, displayName: "Host", robot: null });
    new Session({ transport: guest, displayName: "Guest", robot: null });

    guest.send("all", {
      t: "hello",
      displayName: "x".repeat(500),
      robot: { name: "y".repeat(500), color: "javascript:alert(1)", source: "chassis tank\n" },
    });
    network.flush();

    const info = hostSession.state.peers.find((p) => p.id === "guest1")!;
    expect(info.displayName.length).toBeLessThanOrEqual(24);
    expect(info.robot!.name.length).toBeLessThanOrEqual(32);
    expect(info.robot!.color).toBe("#8a8f98");
  });
});
