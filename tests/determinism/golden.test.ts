/**
 * Golden match.
 *
 * A fixed four-way fight with a fixed seed, pinned to the exact hash stream it
 * produced when the simulation was declared correct. The self-consistency tests
 * next door prove the sim agrees with ITSELF; this one proves it still agrees
 * with its own past, which is what catches an accidental `Math.sin` or a
 * reordered phase in the tick loop.
 *
 * If this fails, the simulation changed. That is sometimes intentional — a
 * balance tweak, a new phase — in which case bump SIM_VERSION in world.ts and
 * regenerate the constants below. It is never something to "just update"
 * without knowing which change caused it, because a silent change here means
 * peers on different builds will desync mid-match.
 */

import { describe, expect, it } from "vitest";
import { runMatch, runMatchWithHashes } from "../../src/sim/match.js";
import { makeManifest, SIM_VERSION } from "../../src/sim/world.js";
import { FUEL_PRESETS } from "../../src/sim/types.js";
import { DODGER, HUNTER, RACER, SPINNER } from "../../src/bots/index.js";

const GOLDEN_SEED = 20260815;

const GOLDEN = {
  // 2 — seeded spawn jitter. Regenerated deliberately when spawn positions
  //     stopped being a pure function of entry index.
  // 3 — the radar. Every robot gained a second heading, a ping cooldown and
  //     their goals, all of which are hashed; the sense cone was shortened at
  //     the same time, so the sample bots fight a slightly different match.
  // 4 — the cone shortened again, to three quarters of what it had been. The
  //     sample bots all hunt by sense cone, so they now spend far longer
  //     looking for each other: the same fight takes 525 ticks instead of 302.
  // 5 — fuel. The sample bots are barely affected by the resource itself over a
  //     match this short — nobody drops below about two thirds of a tank, and a
  //     full tank is exactly the capability they always had. What moved the
  //     match is the RNG: a cell is spawned on tick 0, so every later draw
  //     shifts, and these four all use `random`. Same fight, different dice:
  //     379 ticks instead of 525, and Hunter still wins it.
  //     Retuned twice since. The floor dropped from a quarter of normal
  //     capability to a tenth, and the fall to it stopped being a straight line
  //     — the penalty now grows with the square of how empty the tank is. These
  //     four never drop below about two thirds of a tank, which under the new
  //     curve costs them almost nothing, so they fight much closer to the way
  //     they did before fuel existed. Retuned again when measurement showed
  //     slewing and pinging were priced per degree without regard for how fast
  //     turrets actually move, which had every sweeping robot pinned at an
  //     empty tank: 533 ticks against the pre-fuel 525.
  simVersion: 5,
  ticks: 533,
  winner: "Hunter",
  finalHash: "3cd291228123bc9f",
  /** Hash at ticks 0, 50, 100, ... */
  every50: [
    "e6ae9f5548451dd8",
    "8070c2696f5ba6da",
    "fd6ea7dcccf3f611",
    "c2ca7aed9841ddc8",
    "63cbfeac8448a856",
    "b29a4d470f61bdaa",
    "a5750565b29af58d",
    "790d6d55e81963b2",
    "cdb6730ad2cb6686",
    "53b8e1b4d476b0ec",
    "da4ce1a6255b2730",
  ],
};

/**
 * What the same match was before fuel existed.
 *
 * Switching fuel off must not mean "fuel with a full tank" — it must mean the
 * mechanic is not there. These two numbers are the SIM_VERSION 4 golden match,
 * from before any of this was written, and a disabled match still has to
 * reproduce them. Any drain, brownout, spawn or RNG draw leaking into the
 * disabled path moves one of them.
 *
 * The hash is deliberately not pinned here: `hashWorld` now covers the tank and
 * the cell list, so the digest legitimately differs even though the physics do
 * not.
 */
const BEFORE_FUEL = { ticks: 525, winner: "Hunter" };

describe("with fuel switched off", () => {
  const result = runMatch(
    makeManifest(
      [{ source: HUNTER }, { source: RACER }, { source: SPINNER }, { source: DODGER }],
      { seed: GOLDEN_SEED, fuel: FUEL_PRESETS.off },
    ),
  );

  it("plays the match the game had before fuel existed", () => {
    expect(result.ticks).toBe(BEFORE_FUEL.ticks);
    expect(result.winnerName).toBe(BEFORE_FUEL.winner);
  });

  it("is a different match from the one with fuel on", () => {
    // Otherwise the test above would pass just as well with a broken switch.
    expect(GOLDEN.ticks).not.toBe(BEFORE_FUEL.ticks);
  });
});

describe("golden match", () => {
  const { result, hashes } = runMatchWithHashes(
    makeManifest(
      [{ source: HUNTER }, { source: RACER }, { source: SPINNER }, { source: DODGER }],
      { seed: GOLDEN_SEED },
    ),
  );

  it("still runs for the same number of ticks", () => {
    expect(result.ticks).toBe(GOLDEN.ticks);
  });

  it("still produces the same winner", () => {
    expect(result.winnerName).toBe(GOLDEN.winner);
  });

  it("matches the recorded hash at every checkpoint", () => {
    expect(hashes.filter((_, i) => i % 50 === 0)).toEqual(GOLDEN.every50);
  });

  it("matches the recorded final hash", () => {
    expect(result.finalHash).toBe(GOLDEN.finalHash);
  });

  it("has not changed simulation version without regenerating the golden data", () => {
    expect(SIM_VERSION).toBe(GOLDEN.simVersion);
  });
});
