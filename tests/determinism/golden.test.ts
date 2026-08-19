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
import { runMatchWithHashes } from "../../src/sim/match.js";
import { makeManifest, SIM_VERSION } from "../../src/sim/world.js";
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
  simVersion: 5,
  ticks: 379,
  winner: "Hunter",
  finalHash: "e65e0383837cf87e",
  /** Hash at ticks 0, 50, 100, ... */
  every50: [
    "e6ae9f5548451dd8",
    "81eda9f0b151114d",
    "1e0007853add2844",
    "f9bae0dd4fc3a8b3",
    "e4da6be28b100ef1",
    "b94cfd3d25e2fd75",
    "72521d0b8cc9b2de",
    "e577bd0722a07bfa",
  ],
};

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
