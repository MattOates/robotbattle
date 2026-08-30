/**
 * Who you last chose to fight.
 *
 * Small, but it is the difference between a bench and a fresh form. Somebody
 * tuning a robot against the Hunter runs the same fight twenty times in a row,
 * and re-ticking the same box each time — after the panel had helpfully put
 * Spinner and Racer back — is twenty small insults.
 *
 * Deliberately only the opponents. Fuel and ground are conditions of a
 * particular experiment rather than a standing preference, and quietly carrying
 * "hilly" into next week's session would be a worse surprise than a reset.
 */

import { defaultStore, readJson, writeJson, type KeyValueStore } from "./storage.js";

const KEY = "trialOpponents";

/** What a new player finds ticked: one that moves and one that shoots. */
export const DEFAULT_OPPONENTS: readonly string[] = ["spinner", "racer"];

export class TrialPrefs {
  private store: KeyValueStore;

  constructor(store: KeyValueStore = defaultStore()) {
    this.store = store;
  }

  opponents(): string[] {
    const saved = readJson<unknown>(this.store, KEY, null);
    // Anything that is not a list of strings is treated as absent rather than
    // trusted: this is read straight into a UI on the first render.
    if (!Array.isArray(saved) || saved.some((id) => typeof id !== "string")) {
      return [...DEFAULT_OPPONENTS];
    }
    return saved as string[];
  }

  setOpponents(ids: readonly string[]): void {
    writeJson(this.store, KEY, [...ids]);
  }
}
