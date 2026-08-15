/**
 * The key/value layer under the Workshop's library.
 *
 * Abstracted for two concrete reasons rather than on principle: tests run in
 * Node where `localStorage` does not exist, and `localStorage` is a temporary
 * home — a few hundred battle records will eventually want IndexedDB, and this
 * is the seam that makes that swap invisible to callers.
 */

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** Keys belonging to this store, for usage accounting. */
  keys(): string[];
}

/** Thrown when a write cannot fit. Callers prune and retry. */
export class StorageFullError extends Error {
  constructor(message = "there is no room left to save this") {
    super(message);
    this.name = "StorageFullError";
  }
}

const PREFIX = "robobattle:";

export class MemoryStore implements KeyValueStore {
  private data = new Map<string, string>();

  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.data.set(key, value);
  }
  remove(key: string): void {
    this.data.delete(key);
  }
  keys(): string[] {
    return [...this.data.keys()].sort();
  }
}

class LocalStorageStore implements KeyValueStore {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(PREFIX + key, value);
    } catch (err) {
      // Safari in private mode throws on any write; a full quota throws
      // QuotaExceededError. Both mean the same thing to a caller.
      throw new StorageFullError(
        err instanceof Error && err.name === "QuotaExceededError"
          ? "there is no room left to save this"
          : "this browser will not let the Workshop save anything",
      );
    }
  }

  remove(key: string): void {
    try {
      window.localStorage.removeItem(PREFIX + key);
    } catch {
      // Nothing useful to do; a failed delete is not worth interrupting anyone.
    }
  }

  keys(): string[] {
    const out: string[] = [];
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key?.startsWith(PREFIX)) out.push(key.slice(PREFIX.length));
      }
    } catch {
      return [];
    }
    return out.sort();
  }
}

/** Whether persistence is actually available in this browser. */
export function storageAvailable(): boolean {
  try {
    const probe = PREFIX + "__probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function defaultStore(): KeyValueStore {
  return typeof window !== "undefined" && storageAvailable()
    ? new LocalStorageStore()
    : new MemoryStore();
}

/** Read and parse, falling back if absent or corrupt. */
export function readJson<T>(store: KeyValueStore, key: string, fallback: T): T {
  const raw = store.get(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A corrupt entry is not worth crashing the Workshop over; treat it as
    // absent so the player can carry on and overwrite it.
    return fallback;
  }
}

export function writeJson(store: KeyValueStore, key: string, value: unknown): void {
  store.set(key, JSON.stringify(value));
}

/** Approximate bytes held, for the Workshop's storage meter. */
export function usedBytes(store: KeyValueStore): number {
  let total = 0;
  for (const key of store.keys()) {
    total += key.length + (store.get(key)?.length ?? 0);
  }
  // localStorage counts UTF-16 code units, so two bytes per character.
  return total * 2;
}

/** Rough browser budget, used only to draw a meter. */
export const STORAGE_BUDGET_BYTES = 5 * 1024 * 1024;

let idCounter = 0;

/** A unique id. Falls back to a counter where crypto is unavailable. */
export function newId(prefix: string): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && "randomUUID" in globalCrypto) {
    return `${prefix}_${globalCrypto.randomUUID().slice(0, 8)}`;
  }
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}
