/**
 * Which quest steps have been met.
 *
 * The same shape as `progress.ts` and `tour.ts`: a plain class over a
 * `KeyValueStore`, no React, so the whole thing is testable and so the
 * cross-tab `storage` listener in `useLibrary.ts` picks up changes for free.
 *
 * Only the *met steps* are stored. Which quests are finished, what they have
 * unlocked and what to do next are all derived from that set by
 * `workshop/quests.ts` — see `unlocks()` for why: a stored list of unlocked
 * panes would need migrating every time a reward changed, and would be able to
 * disagree with the quest table it came from.
 */

import { defaultStore, readJson, writeJson, type KeyValueStore } from "./storage.js";

const KEY = "quests";
const DECLINED_KEY = "questsDeclinedLevelUp";

export class Quests {
  private store: KeyValueStore;

  constructor(store: KeyValueStore = defaultStore()) {
    this.store = store;
  }

  private all(): string[] {
    return readJson<string[]>(this.store, KEY, []);
  }

  done(): ReadonlySet<string> {
    return new Set(this.all());
  }

  /**
   * Record met steps.
   *
   * Takes a list rather than one at a time because a single signal can meet
   * several steps at once — pasting a script that both senses and fires ticks
   * two boxes off one keystroke — and writing them one by one would read the
   * store back between writes and lose all but the last.
   */
  meet(keys: readonly string[]): void {
    if (keys.length === 0) return;
    const current = this.all();
    const added = keys.filter((k) => !current.includes(k));
    if (added.length === 0) return;
    writeJson(this.store, KEY, [...current, ...added]);
  }

  isMet(key: string): boolean {
    return this.all().includes(key);
  }

  count(): number {
    return this.all().length;
  }

  /**
   * Whether they have turned down a level-up.
   *
   * Kept so the offer is made once and then becomes a quiet badge on the
   * settings control. A celebration that reappears every time you finish
   * something stops being a celebration.
   */
  declinedLevelUp(): boolean {
    return this.store.get(DECLINED_KEY) === "yes";
  }

  declineLevelUp(): void {
    this.store.set(DECLINED_KEY, "yes");
  }

  /** Cleared when they do move up, so the next level's offer is fresh. */
  clearDecline(): void {
    this.store.remove(DECLINED_KEY);
  }

  clear(): void {
    this.store.remove(KEY);
    this.store.remove(DECLINED_KEY);
  }
}
