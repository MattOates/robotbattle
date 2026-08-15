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
  simVersion: 1,
  ticks: 515,
  winner: "Hunter",
  finalHash: "aad9c4a05665f8bf",
  /** Hash at ticks 0, 50, 100, ... */
  every50: [
    "cf0fee63b182cd38",
    "bfed1beb6752325e",
    "1df6a60ef2ceb40b",
    "bf9e5377137cc281",
    "2e145b156a32e36d",
    "7a61ceec1b34534e",
    "5680673206eb8e32",
    "b7456514797d7c59",
    "b8b0f3ddc883f87a",
    "82a80ba884016001",
    "5833b1e7d70f0cb7",
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
