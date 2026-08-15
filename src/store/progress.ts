/**
 * How far someone has got through Learn.
 *
 * A dozen lessons is daunting as a flat list and manageable as a list with
 * four ticks against it, so this exists mostly to make the index feel
 * navigable rather than to track anything.
 */

import { defaultStore, readJson, writeJson, type KeyValueStore } from "./storage.js";

const KEY = "learned";

export class Progress {
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

  isDone(id: string): boolean {
    return this.all().includes(id);
  }

  markDone(id: string): void {
    const current = this.all();
    if (current.includes(id)) return;
    writeJson(this.store, KEY, [...current, id]);
  }

  markUndone(id: string): void {
    writeJson(
      this.store,
      KEY,
      this.all().filter((x) => x !== id),
    );
  }

  count(): number {
    return this.all().length;
  }

  /**
   * The lesson to offer as "Continue": the first unread one in reading order,
   * or nothing at all once the lot is done.
   */
  next(order: readonly string[]): string | null {
    const done = this.done();
    return order.find((id) => !done.has(id)) ?? null;
  }

  clear(): void {
    this.store.remove(KEY);
  }
}
