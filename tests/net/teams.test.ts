/**
 * Turning a room with sides in it into a manifest.
 *
 * The property under test is the one the whole peer-to-peer design rests on:
 * every peer, given the same room, builds a byte-identical manifest. Teams ride
 * along on the entries and must not disturb that — which is why the spawn ring
 * groups teammates inside `createWorld` rather than by reordering entries here.
 */

import { describe, expect, it } from "vitest";
import {
  entryIndexFor,
  manifestFromParticipants,
  type Participant,
} from "../../src/net/matchsetup.js";

const robot = (name: string) => ({ name, color: "#ff8800", source: `name "${name}"\nchassis tank\n` });

const ROOM: Participant[] = [
  { peerId: "c", displayName: "Cal", robot: robot("C"), team: 1 },
  { peerId: "a", displayName: "Ada", robot: robot("A"), team: 0 },
  { peerId: "d", displayName: "Dee", robot: robot("D"), team: 1 },
  { peerId: "b", displayName: "Bo", robot: robot("B"), team: 0 },
];

describe("building a manifest from a room with sides", () => {
  it("orders entries by peer id, never by team", () => {
    const m = manifestFromParticipants(ROOM, 1);
    expect(m.entries.map((e) => e.source.match(/"(\w)"/)![1])).toEqual(["A", "B", "C", "D"]);
  });

  it("puts each person's side on their own entry", () => {
    const m = manifestFromParticipants(ROOM, 1);
    expect(m.entries.map((e) => e.team)).toEqual([0, 0, 1, 1]);
  });

  it("still agrees with entryIndexFor about whose robot is whose", () => {
    const m = manifestFromParticipants(ROOM, 1);
    for (const p of ROOM) {
      const index = entryIndexFor(ROOM, p.peerId)!;
      expect(m.entries[index]!.team).toBe(p.team);
    }
  });

  it("builds the same manifest whatever order the room is listed in", () => {
    const shuffled = [ROOM[2]!, ROOM[0]!, ROOM[3]!, ROOM[1]!];
    expect(manifestFromParticipants(shuffled, 1)).toEqual(manifestFromParticipants(ROOM, 1));
  });

  it("leaves the team off entirely for a free-for-all", () => {
    // So a manifest from a room without sides is byte-identical to one built
    // before teams existed, and every stored replay still matches.
    const ffa = ROOM.map(({ team: _t, ...rest }) => rest);
    const m = manifestFromParticipants(ffa, 1);
    expect(m.entries.every((e) => !("team" in e))).toBe(true);
  });
});

describe("the friendly-fire setting", () => {
  it("travels in the manifest when the host sets it", () => {
    expect(manifestFromParticipants(ROOM, 1, { friendlyFire: false }).friendlyFire).toBe(false);
  });

  it("is on when nobody said otherwise", () => {
    expect(manifestFromParticipants(ROOM, 1).friendlyFire).toBe(true);
  });
});
