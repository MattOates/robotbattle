/**
 * Teams, and the claim the whole design rests on: that a free-for-all is not a
 * different kind of match but simply every robot on a team of its own.
 *
 * The test that matters most here is the one asserting that a manifest with no
 * teams hashes identically to one that spells out `0, 1, 2, 3`. If that ever
 * stops being true, teams have stopped being free and every match played before
 * they existed has quietly changed.
 */

import { describe, expect, it } from "vitest";
import { createWorld, makeManifest } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { hashWorld } from "../../src/sim/hash.js";
import { clampTeams } from "../../src/sim/types.js";

const IDLE = `name "Idle"\nchassis tank\n`;

function world(teams: (number | undefined)[], seed = 4) {
  return createWorld(
    makeManifest(
      teams.map((team) => (team === undefined ? { source: IDLE } : { source: IDLE, team })),
      { seed },
    ),
  );
}

describe("a free-for-all is every robot on its own team", () => {
  it("gives each robot its own entry index as a team", () => {
    const w = world([undefined, undefined, undefined]);
    expect(w.robots.map((r) => r.team)).toEqual([0, 1, 2]);
  });

  it("hashes the same as spelling those teams out by hand", () => {
    // The load-bearing assertion. Identical hashes mean identical spawn
    // positions, identical RNG draws and an identical world — so nothing that
    // was recorded before teams existed replays as a different match.
    expect(hashWorld(world([undefined, undefined, undefined]))).toBe(
      hashWorld(world([0, 1, 2])),
    );
  });

  it("hashes differently once two robots share a side", () => {
    expect(hashWorld(world([undefined, undefined]))).not.toBe(hashWorld(world([0, 0])));
  });

  it("does not end a one-robot match, exactly as before", () => {
    const w = world([undefined]);
    step(w);
    expect(w.over).toBe(false);
  });
});

describe("the match ends when one side is left", () => {
  it("keeps going while two sides are alive, however few robots that is", () => {
    const w = world([0, 0, 1]);
    w.robots[1]!.alive = false;
    step(w);
    expect(w.over).toBe(false);
  });

  it("ends with survivors still standing once the other side is gone", () => {
    const w = world([0, 0, 1]);
    w.robots[2]!.alive = false;
    step(w);
    expect(w.over).toBe(true);
    expect(w.winnerTeam).toBe(0);
    expect(w.robots.filter((r) => r.alive)).toHaveLength(2);
  });

  it("names a winner that is a real, living robot on the winning side", () => {
    const w = world([0, 0, 1]);
    w.robots[2]!.alive = false;
    w.robots[0]!.health = 20;
    w.robots[1]!.health = 90;
    step(w);
    // The healthiest survivor, so the winner is the robot at the top of the
    // results table rather than whichever id happened to come first.
    expect(w.winnerId).toBe(1);
    expect(w.robots[w.winnerId!]!.alive).toBe(true);
    expect(w.robots[w.winnerId!]!.team).toBe(w.winnerTeam);
  });

  it("leaves both winner fields null when everybody dies at once", () => {
    const w = world([0, 1]);
    for (const r of w.robots) r.alive = false;
    step(w);
    expect(w.over).toBe(true);
    expect(w.winnerTeam).toBeNull();
    expect(w.winnerId).toBeNull();
  });

  it("still ends a free-for-all on the last robot standing", () => {
    const w = world([undefined, undefined, undefined]);
    w.robots[0]!.alive = false;
    w.robots[1]!.alive = false;
    step(w);
    expect(w.over).toBe(true);
    expect(w.winnerId).toBe(2);
  });
});

describe("a timeout is decided by side, not by robot", () => {
  it("gives it to the side with the most health between them", () => {
    // Robot 2 is the healthiest robot in the arena, but its side is the
    // weaker one — which is exactly the case that separates the two rules.
    const w = createWorld(
      makeManifest(
        [
          { source: IDLE, team: 0 },
          { source: IDLE, team: 0 },
          { source: IDLE, team: 1 },
        ],
        { seed: 4, maxTicks: 1 },
      ),
    );
    w.robots[0]!.health = 60;
    w.robots[1]!.health = 60;
    w.robots[2]!.health = 99;
    step(w);
    expect(w.over).toBe(true);
    expect(w.winnerTeam).toBe(0);
  });
});

describe("teams arriving from a remote host", () => {
  it("falls back to the entry index for anything that is not a whole team", () => {
    expect(clampTeams([0, undefined, 1.5, NaN, -1, 99])).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("keeps teams that are inside the field", () => {
    expect(clampTeams([1, 1, 0, 0])).toEqual([1, 1, 0, 0]);
  });
});

describe("where a side starts", () => {
  it("puts teammates next to each other on the ring", () => {
    // Entries 0 and 2 are one side, 1 and 3 the other. Whoever shares a team
    // should end up adjacent, which is what the slot remap is for.
    const w = world([0, 1, 0, 1], 11);
    const angle = (r: { x: number; y: number }) =>
      Math.atan2(r.y - w.height / 2, r.x - w.width / 2);
    const order = [...w.robots].sort((a, b) => angle(a) - angle(b)).map((r) => r.team);
    // Going round the ring, the two sides form two runs rather than alternating.
    const changes = order.filter((t, i) => i > 0 && t !== order[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(1);
  });
});
