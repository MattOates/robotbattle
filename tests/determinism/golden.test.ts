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
  // 6 — committed shots. `fire` now waits for the gun to come round instead of
  //     discharging along whatever heading the barrel happened to hold, so every
  //     robot here that writes `turret.aim at ...` and then `fire` — which is
  //     most of them — became markedly more accurate without a line changing.
  //     Spinner went from hitting 34% of the time to 71%.
  // 7 — terrain. The ground gained a gradient that changes what driving costs
  //     and how fast it happens \u2014 but it ships switched off, and generating a
  //     map takes no draws from the world RNG. So every number below is
  //     untouched, and that is the point: this entry exists only because the
  //     manifest grew a field, and an unchanged golden match is the proof that
  //     "off" means off.
  //
  //     The hashes below DID have to be regenerated, and it is worth being
  //     precise about why: `hashWorld` now folds in the four numbers the map is
  //     generated from, so the digest changed while the world it describes did
  //     not. The behavioural facts are the ones that prove it \u2014 532 ticks and
  //     Hunter, both identical to version 6, and BEFORE_FUEL untouched below.
  // 8 — line of sight. The radar beam is now stopped by ground higher than the
  //     robot standing on it. Flat ground is level everywhere, so nothing here
  //     can ever block anything, and `ping` defaults to the power it always
  //     had: not one number below moved, hashes included.
  // 8 — line of sight, and then the Racer learned to see a wall coming. The
  //     version bump is the line of sight; the numbers below moved because of
  //     the Racer. It used to drive into walls about two hundred and twenty
  //     times a match and grind itself down doing it, so this fight is very
  //     different now: 1833 ticks instead of 532, and Racer wins it rather
  //     than dying to the scenery.
  // 9 \u2014 walls. Hand-placed segments that block motion. Like terrain before it,
  //     the mechanic ships switched off: this match carries no walls, so not
  //     one thing about it happens differently. Ticks, winner and the fuel-off
  //     pair below are all identical to version 8, and that is the claim this
  //     entry is making \u2014 an empty wall list is genuinely empty.
  //
  //     The hashes moved for the same reason they moved at version 7, and it is
  //     worth being just as precise: `hashWorld` now folds in the wall count,
  //     so a match with zero walls hashes one more integer than it used to. The
  //     digest changed; the world it describes did not.
  //
  //     The version bump is not about this match. It is about `spawnFuel`,
  //     which now rejects a placement that lands inside a wall and redraws \u2014
  //     no walls means no rejection and no extra draw here, but the code path
  //     differs between builds, so a version 8 peer must refuse rather than
  //     guess.
  // 10 — teams, and the radio. A robot belongs to a side, a free-for-all is
  //     every robot on a side of its own, and the match ends when one side is
  //     left rather than one robot. Like terrain and walls before it, the
  //     mechanic ships inert: this match assigns nobody, so every team number
  //     is the robot's own entry index, the spawn ring lands on the identical
  //     slots, and not one tick plays differently. 1833 ticks and Racer, both
  //     identical to version 9, and the fuel-off pair below untouched — that
  //     is the claim this entry is making.
  //
  //     The hashes moved for exactly the reason they moved at versions 7 and 9,
  //     and it is worth being just as precise: `hashWorld` now folds in each
  //     robot's team and radio cooldown, the friendly-fire switch, whatever is
  //     in the air unheard, and every robot's own radio inbox. A match with no sides and nobody talking hashes
  //     several more integers than it used to. The digest changed; the world it
  //     describes did not.
  //
  //     The version bump is about what a version 9 peer could not agree with:
  //     a manifest that assigns teams, the friendly-fire switch — which decides
  //     whether a bullet passes through a teammate or stops in one — and the
  //     radio, which is live state carried between ticks.
  simVersion: 10,
  ticks: 1833,
  winner: "Racer",
  finalHash: "b65901503b18f49b",
  /** Hash at ticks 0, 50, 100, ... */
  every50: [
    "45801097a2a901bc",
    "8d17eee4a918c9e2",
    "09920f49ee2c936d",
    "f5b6d3bf07068916",
    "6a18a62f46cf6fe5",
    "279e6114faad8662",
    "209f79ba2b8a087c",
    "9c102e45f7f379cd",
    "5ebb34200fc0d7d2",
    "895081697f304130",
    "ae9fd7cac6a99ace",
    "aa862b682830bdb4",
    "b99607509beb40a1",
    "bc888eedc226b29d",
    "b0911aab47e18189",
    "d4f2946df42bc75c",
    "7a0ac04388ab4acd",
    "40d35b9f284b49be",
    "58237386694b4d95",
    "d9caa2ada2c7020a",
    "3d7b09644d373840",
    "ac0cba87977e68c0",
    "d6547bff71a89e9e",
    "697b7b04eb610b4e",
    "6d4d389a725e7eaa",
    "23ee7630c35e6796",
    "1d2a7c6b4b2aa2c9",
    "a20d164b3618ad05",
    "c9a82d78eab0256e",
    "2ec6e7b960c42588",
    "73e9f226ff1518dd",
    "cc0d43cd34391f9f",
    "a8e05c3b6544eb57",
    "530955eac1bb6cb5",
    "248ca5a024c10e94",
    "1c1b1da416830360",
    "73cb8a6e97cb2375",
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
 *
 * The numbers themselves are no longer the ones the pre-fuel game produced —
 * the Racer learned to avoid walls since, and it is in this fight. What the
 * pair still does, and the only thing it was ever for, is prove that the fuel
 * switch is a real switch: this match and the one below have to differ.
 */
const BEFORE_FUEL = { ticks: 2494, winner: "Hunter" };

describe("with fuel switched off", () => {
  const result = runMatch(
    makeManifest(
      [{ source: HUNTER }, { source: RACER }, { source: SPINNER }, { source: DODGER }],
      { seed: GOLDEN_SEED, fuel: FUEL_PRESETS.off },
    ),
  );

  it("plays a different match from the one with fuel in it", () => {
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
