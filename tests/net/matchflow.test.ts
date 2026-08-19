/**
 * The end-to-end multiplayer claim, tested without a browser:
 *
 *   the host broadcasts one manifest, and every peer independently arrives at
 *   exactly the same battle.
 *
 * If this holds, there is no netcode left to write for a match.
 */

import { describe, expect, it } from "vitest";
import { createLoopbackRoom } from "../../src/net/loopback.js";
import { Session } from "../../src/net/session.js";
import {
  entryIndexFor,
  manifestFromParticipants,
  newMatchId,
  type Participant,
} from "../../src/net/matchsetup.js";
import { runMatch, runMatchWithHashes } from "../../src/sim/match.js";
import type { Message, RobotEntry } from "../../src/net/protocol.js";
import type { MatchManifest } from "../../src/sim/world.js";
import { DODGER, HUNTER, RACER, SPINNER } from "../../src/bots/index.js";

const robots: RobotEntry[] = [
  { name: "Hunter", color: "#ff8800", source: HUNTER },
  { name: "Racer", color: "#ffd166", source: RACER },
  { name: "Spinner", color: "#7fd1e0", source: SPINNER },
  { name: "Dodger", color: "#b085f5", source: DODGER },
];

function room(guestCount: number) {
  const { network, host, guests } = createLoopbackRoom(guestCount);
  const sessions = [host, ...guests].map(
    (transport, i) =>
      new Session({
        transport,
        displayName: i === 0 ? "Host" : `Guest ${i}`,
        robot: robots[i]!,
      }),
  );
  for (const session of sessions) session.announce();
  network.flush();
  return { network, sessions };
}

describe("running a match across a room", () => {
  it("gives every peer the identical battle", () => {
    const { network, sessions } = room(3);
    const received = new Map<number, MatchManifest>();
    sessions.forEach((session, i) => {
      session.onMessage((_from, message: Message) => {
        if (message.t === "start") received.set(i, message.manifest);
      });
    });

    const participants = sessions[0]!.entries() as Participant[];
    const manifest = manifestFromParticipants(participants, 4242);
    sessions[0]!.broadcast({ t: "start", matchId: newMatchId(), manifest, label: "Arena" });
    network.flush();

    expect(received.size).toBe(4);

    // Each peer simulates on its own; the hash streams must agree tick for tick.
    const streams = [...received.values()].map((m) => runMatchWithHashes(m).hashes);
    for (const stream of streams) {
      expect(stream).toEqual(streams[0]);
    }
    expect(streams[0]!.length).toBeGreaterThan(20);
  });

  it("carries the host's fuel settings to every peer", () => {
    // Fuel rides inside the manifest rather than in a message of its own, so
    // the property to prove is that a guest never has to be told separately —
    // and never simulates the host's match under different terms.
    const { network, sessions } = room(3);
    const received = new Map<number, MatchManifest>();
    sessions.forEach((session, i) => {
      session.onMessage((_from, message: Message) => {
        if (message.t === "start") received.set(i, message.manifest);
      });
    });

    const lean = { spawnEveryTicks: 40, maxOnField: 9, amount: 35, radius: 13 };
    const participants = sessions[0]!.entries() as Participant[];
    const manifest = manifestFromParticipants(participants, 4242, { fuel: lean });
    sessions[0]!.broadcast({ t: "start", matchId: newMatchId(), manifest, label: "Arena" });
    network.flush();

    expect(received.size).toBe(4);
    for (const m of received.values()) expect(m.fuel).toEqual(lean);

    const streams = [...received.values()].map((m) => runMatchWithHashes(m).hashes);
    for (const stream of streams) expect(stream).toEqual(streams[0]);

    // And the settings genuinely changed the battle, so the agreement above is
    // about these settings rather than about them being ignored.
    const dflt = manifestFromParticipants(participants, 4242);
    expect(runMatch(manifest).finalHash).not.toBe(runMatch(dflt).finalHash);
  });

  it("lets every peer work out which robot is theirs", () => {
    const { sessions } = room(3);
    const participants = sessions[0]!.entries() as Participant[];
    const indices = sessions.map((s) => entryIndexFor(participants, s.state.selfId));
    expect(new Set(indices).size).toBe(4);
    expect(indices.every((i) => i !== null)).toBe(true);
  });

  it("is unaffected by a peer dropping mid-battle", () => {
    // The elegant consequence of shipping manifests instead of state: a peer
    // leaving is a spectating problem, never a simulation one.
    const { network, sessions } = room(3);
    const participants = sessions[0]!.entries() as Participant[];
    const manifest = manifestFromParticipants(participants, 99);
    const expected = runMatch(manifest);

    sessions[3]!.close();
    network.flush();

    // The host's roster shrinks, but the match in flight does not change.
    expect(sessions[0]!.state.peers).toHaveLength(3);
    expect(runMatch(manifest).finalHash).toBe(expected.finalHash);
    expect(runMatch(manifest).winnerName).toBe(expected.winnerName);
  });

  it("builds the same manifest whoever assembles it", () => {
    // Guests can verify the host's manifest rather than simply trusting it.
    const { sessions } = room(2);
    const fromHost = manifestFromParticipants(sessions[0]!.entries() as Participant[], 7);
    const rebuilt = manifestFromParticipants(
      [...(sessions[0]!.entries() as Participant[])].reverse(),
      7,
    );
    expect(rebuilt).toEqual(fromHost);
  });

  it("detects a peer that has drifted", () => {
    // Hash exchange exists to notice disagreement, not to fix it.
    const { sessions } = room(1);
    const manifest = manifestFromParticipants(sessions[0]!.entries() as Participant[], 3);
    const honest = runMatchWithHashes(manifest);
    const tampered = runMatchWithHashes({ ...manifest, seed: manifest.seed + 1 });
    expect(tampered.hashes[10]).not.toBe(honest.hashes[10]);
  });
});
