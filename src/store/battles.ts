/**
 * Battle history.
 *
 * Each record carries the manifest that produced it, so every past battle can
 * be replayed exactly. That is what makes history worth keeping rather than a
 * list of scores.
 *
 * Records are pruned to stay inside the storage budget; the head-to-head tally
 * is stored separately precisely so it survives that pruning.
 */

import {
  defaultStore,
  newId,
  readJson,
  usedBytes,
  writeJson,
  StorageFullError,
  STORAGE_BUDGET_BYTES,
  type KeyValueStore,
} from "./storage.js";
import type { BattleRecord, HeadToHead } from "./types.js";

const RECORDS_KEY = "battles";
const H2H_KEY = "headToHead";

/** Hard cap on stored battles, before the byte budget is even considered. */
export const MAX_RECORDS = 50;
/** Leave room for the robot library and everything else. */
const BATTLE_BUDGET_BYTES = Math.floor(STORAGE_BUDGET_BYTES * 0.6);

export class BattleLog {
  private store: KeyValueStore;

  constructor(store: KeyValueStore = defaultStore()) {
    this.store = store;
  }

  list(): BattleRecord[] {
    return readJson<BattleRecord[]>(this.store, RECORDS_KEY, []);
  }

  /** Battles a given library robot took part in, newest first. */
  forRobot(robotId: string): BattleRecord[] {
    return this.list().filter((b) => b.myRobotId === robotId);
  }

  get(id: string): BattleRecord | undefined {
    return this.list().find((b) => b.id === id);
  }

  /**
   * Store a battle. Returns the stored record.
   *
   * The head-to-head tally is updated first, so that even if the record itself
   * has to be dropped for space, the fact that the battle happened survives.
   */
  record(input: Omit<BattleRecord, "id" | "at">): BattleRecord {
    const battle: BattleRecord = { ...input, id: newId("battle"), at: Date.now() };

    this.updateHeadToHead(battle);

    let records = [battle, ...this.list()].slice(0, MAX_RECORDS);
    // Drop the oldest until it fits. A battle is worth more than its
    // predecessors, so newest wins.
    for (;;) {
      try {
        writeJson(this.store, RECORDS_KEY, records);
        break;
      } catch (err) {
        if (!(err instanceof StorageFullError) || records.length <= 1) {
          // Even one record will not fit: give up on history rather than
          // failing the battle the player just watched.
          if (records.length <= 1) {
            writeJson(this.store, RECORDS_KEY, []);
            break;
          }
          throw err;
        }
        records = records.slice(0, records.length - 1);
      }
    }

    // Also trim to the byte budget so history never crowds out the library.
    this.pruneToBudget();
    return battle;
  }

  private pruneToBudget(): void {
    let records = this.list();
    while (records.length > 1 && usedBytes(this.store) > BATTLE_BUDGET_BYTES) {
      records = records.slice(0, records.length - 1);
      writeJson(this.store, RECORDS_KEY, records);
    }
  }

  // ---- head to head -----------------------------------------------------

  headToHead(robotId?: string): HeadToHead[] {
    const all = readJson<HeadToHead[]>(this.store, H2H_KEY, []);
    const filtered = robotId ? all.filter((h) => h.robotId === robotId) : all;
    return [...filtered].sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  /**
   * Only 1v1 battles produce a head-to-head record.
   *
   * In a free-for-all "who beat whom" has no honest answer — finishing above
   * someone in a six-way melee is not a win against them — so a tally would be
   * noise dressed as data.
   */
  private updateHeadToHead(battle: BattleRecord): void {
    if (battle.myRobotId === null || battle.myEntryIndex === null) return;
    if (battle.manifest.entries.length !== 2) return;

    const mine = battle.telemetry.find((t) => t.robotId === battle.myEntryIndex);
    const theirs = battle.telemetry.find((t) => t.robotId !== battle.myEntryIndex);
    if (!mine || !theirs) return;

    const won = battle.result.winnerId === battle.myEntryIndex;
    const drawn = battle.result.winnerId === null;

    const all = readJson<HeadToHead[]>(this.store, H2H_KEY, []);
    const existing = all.find(
      (h) => h.robotId === battle.myRobotId && h.opponent === theirs.name,
    );
    const entry: HeadToHead = existing ?? {
      robotId: battle.myRobotId,
      opponent: theirs.name,
      wins: 0,
      losses: 0,
      draws: 0,
      lastPlayed: 0,
    };

    if (drawn) entry.draws += 1;
    else if (won) entry.wins += 1;
    else entry.losses += 1;
    entry.lastPlayed = battle.at;

    writeJson(this.store, H2H_KEY, existing ? all : [...all, entry]);
  }

  clear(): void {
    this.store.remove(RECORDS_KEY);
    this.store.remove(H2H_KEY);
  }
}
