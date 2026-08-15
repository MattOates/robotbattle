import { beforeEach, describe, expect, it } from "vitest";
import { BattleLog, MAX_RECORDS } from "../../src/store/battles.js";
import { MemoryStore } from "../../src/store/storage.js";
import { createWorld, makeManifest } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { summarise } from "../../src/sim/match.js";
import { collectTelemetry } from "../../src/sim/telemetry.js";
import { HUNTER, RACER, SITTING_DUCK } from "../../src/bots/index.js";
import type { BattleRecord } from "../../src/store/types.js";

let store: MemoryStore;
let log: BattleLog;

beforeEach(() => {
  store = new MemoryStore();
  log = new BattleLog(store);
});

/** Play a real 1v1 and shape it into a record, the way the Workshop does. */
function playBattle(
  a: string,
  b: string,
  seed: number,
  myRobotId: string | null = "bot_mine",
): Omit<BattleRecord, "id" | "at"> {
  const manifest = makeManifest([{ source: a }, { source: b }], { seed });
  const world = createWorld(manifest);
  while (!world.over && world.tick < world.maxTicks) step(world);
  return {
    mode: "trial",
    manifest,
    result: summarise(world),
    telemetry: collectTelemetry(world),
    myRobotId,
    myEntryIndex: myRobotId === null ? null : 0,
  };
}

describe("battle records", () => {
  it("stores a battle and reads it back after a reload", () => {
    const battle = log.record(playBattle(HUNTER, RACER, 1));
    const reloaded = new BattleLog(store);
    expect(reloaded.get(battle.id)?.result.finalHash).toBe(battle.result.finalHash);
  });

  it("keeps the manifest, so the battle is replayable", () => {
    const battle = log.record(playBattle(HUNTER, RACER, 42));
    const stored = log.get(battle.id)!;
    // Re-running the stored manifest must reproduce the stored result exactly.
    const world = createWorld(stored.manifest);
    while (!world.over && world.tick < world.maxTicks) step(world);
    expect(summarise(world).finalHash).toBe(stored.result.finalHash);
  });

  it("lists newest first", () => {
    log.record(playBattle(HUNTER, RACER, 1));
    const second = log.record(playBattle(HUNTER, RACER, 2));
    expect(log.list()[0]!.id).toBe(second.id);
  });

  it("filters to one robot's battles", () => {
    log.record(playBattle(HUNTER, RACER, 1, "bot_a"));
    log.record(playBattle(HUNTER, RACER, 2, "bot_b"));
    expect(log.forRobot("bot_a")).toHaveLength(1);
  });

  it("caps how many battles it keeps", () => {
    for (let seed = 1; seed <= MAX_RECORDS + 8; seed++) {
      log.record(playBattle(HUNTER, SITTING_DUCK, seed));
    }
    expect(log.list()).toHaveLength(MAX_RECORDS);
  });

  it("drops the oldest when it prunes", () => {
    const first = log.record(playBattle(HUNTER, SITTING_DUCK, 1));
    for (let seed = 2; seed <= MAX_RECORDS + 3; seed++) {
      log.record(playBattle(HUNTER, SITTING_DUCK, seed));
    }
    expect(log.get(first.id)).toBeUndefined();
  });
});

describe("head to head", () => {
  it("tallies wins and losses per opponent", () => {
    for (let seed = 1; seed <= 12; seed++) {
      log.record(playBattle(HUNTER, RACER, seed, "bot_mine"));
    }
    const [record] = log.headToHead("bot_mine");
    expect(record?.opponent).toBe("Racer");
    expect(record!.wins + record!.losses + record!.draws).toBe(12);
    // Spawn jitter should give a mixed record rather than a clean sweep.
    expect(record!.wins).toBeGreaterThan(0);
  });

  it("survives records being pruned away", () => {
    // The whole reason the tally is stored rather than derived.
    for (let seed = 1; seed <= MAX_RECORDS + 20; seed++) {
      log.record(playBattle(HUNTER, SITTING_DUCK, seed, "bot_mine"));
    }
    expect(log.list()).toHaveLength(MAX_RECORDS);
    const [record] = log.headToHead("bot_mine");
    expect(record!.wins + record!.losses + record!.draws).toBe(MAX_RECORDS + 20);
  });

  it("keeps separate tallies per opponent", () => {
    log.record(playBattle(HUNTER, RACER, 1, "bot_mine"));
    log.record(playBattle(HUNTER, SITTING_DUCK, 2, "bot_mine"));
    expect(log.headToHead("bot_mine").map((h) => h.opponent).sort()).toEqual([
      "Racer",
      "Sitting Duck",
    ]);
  });

  it("records nothing for a free-for-all", () => {
    // Finishing above someone in a melee is not a win against them, so there
    // is no honest tally to keep.
    const manifest = makeManifest(
      [{ source: HUNTER }, { source: RACER }, { source: SITTING_DUCK }],
      { seed: 3 },
    );
    const world = createWorld(manifest);
    while (!world.over && world.tick < world.maxTicks) step(world);
    log.record({
      mode: "arena",
      manifest,
      result: summarise(world),
      telemetry: collectTelemetry(world),
      myRobotId: "bot_mine",
      myEntryIndex: 0,
    });
    expect(log.headToHead("bot_mine")).toEqual([]);
    // The battle itself is still kept.
    expect(log.list()).toHaveLength(1);
  });

  it("ignores battles that aren't yours", () => {
    log.record(playBattle(HUNTER, RACER, 1, null));
    expect(log.headToHead()).toEqual([]);
  });
});
