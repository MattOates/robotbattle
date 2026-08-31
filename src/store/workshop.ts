/** Small, non-essential Workshop layout preferences. */

import { defaultStore, readJson, writeJson, type KeyValueStore } from "./storage.js";

const KEY = "workshopLayout";
const PANES = new Set(["editor", "map", "trial", "bench", "history"]);

interface WorkshopLayout {
  pane?: string;
  selectedRobotId?: string | null;
  selectedArenaId?: string | null;
  accordions?: Record<string, boolean>;
}

export class WorkshopPrefs {
  constructor(private store: KeyValueStore = defaultStore()) {}

  pane<T extends string>(fallback: T): T {
    const pane = this.read().pane;
    return typeof pane === "string" && PANES.has(pane) ? pane as T : fallback;
  }

  selectedRobotId(): string | null {
    const id = this.read().selectedRobotId;
    return typeof id === "string" ? id : null;
  }

  selectedArenaId(): string | null {
    const id = this.read().selectedArenaId;
    return typeof id === "string" ? id : null;
  }

  accordion(id: string, fallback: boolean): boolean {
    const value = this.read().accordions?.[id];
    return typeof value === "boolean" ? value : fallback;
  }

  setPane(pane: string): void {
    this.patch({ pane });
  }

  setSelectedRobotId(selectedRobotId: string | null): void {
    this.patch({ selectedRobotId });
  }

  setSelectedArenaId(selectedArenaId: string | null): void {
    this.patch({ selectedArenaId });
  }

  setAccordion(id: string, open: boolean): void {
    const current = this.read();
    this.write({ ...current, accordions: { ...current.accordions, [id]: open } });
  }

  private read(): WorkshopLayout {
    const value = readJson<unknown>(this.store, KEY, {});
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as WorkshopLayout
      : {};
  }

  private patch(change: Partial<WorkshopLayout>): void {
    this.write({ ...this.read(), ...change });
  }

  private write(value: WorkshopLayout): void {
    // Layout memory is a courtesy. A full or restricted store must never make
    // a button in the Workshop fail.
    try {
      writeJson(this.store, KEY, value);
    } catch {
      /* carry on with this visit's React state */
    }
  }
}
