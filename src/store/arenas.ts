/**
 * The arena library: the places you have built.
 *
 * Deliberately a much thinner thing than `Library` next door. A robot carries a
 * script that has to be parsed to know its own name, and a history of versions
 * because a script that used to win is worth getting back to. A map is neither:
 * its name is just a name, and there is no "this wall layout used to work".
 * What is left is a small CRUD store over a list, and resisting the temptation
 * to make it symmetrical with the robot library is most of the design.
 *
 * Everything is validated on the way *in* rather than on the way out, through
 * `clampWalls` — an arena can arrive from another peer, and a stored arena that
 * was never checked is a desync waiting for whoever loads it into a match.
 */

import { clampTerrainConfig, clampWalls, TERRAIN_PRESETS, type ArenaSpec } from "../sim/types.js";
import { defaultStore, newId, readJson, writeJson, type KeyValueStore } from "./storage.js";
import type { StoredArena, TradeOrigin } from "./types.js";

const KEY = "arenas";

/**
 * What a new arena starts as: flat ground, no walls, ready to be drawn on.
 *
 * Terrain off rather than on, matching `makeManifest`'s default. Somebody who
 * opens the editor to lay out a maze should get a blank sheet, and hills are
 * one click away if they want them.
 */
export function blankArena(): ArenaSpec {
  return { terrain: { ...TERRAIN_PRESETS.off }, walls: [] };
}

/** Bring a spec into a state the simulation will accept, wherever it came from. */
export function normaliseSpec(spec: ArenaSpec): ArenaSpec {
  return {
    terrain: clampTerrainConfig(spec.terrain),
    walls: clampWalls(spec.walls),
  };
}

/** A name is always shown, so it is never allowed to be empty. */
function cleanName(name: string, fallback: string): string {
  return name.trim().slice(0, 40) || fallback;
}

export class ArenaLibrary {
  private store: KeyValueStore;

  constructor(store: KeyValueStore = defaultStore()) {
    this.store = store;
  }

  list(): StoredArena[] {
    return readJson<StoredArena[]>(this.store, KEY, []);
  }

  get(id: string): StoredArena | undefined {
    return this.list().find((a) => a.id === id);
  }

  private save(arenas: StoredArena[]): void {
    writeJson(this.store, KEY, arenas);
  }

  create(name = "New arena", spec: ArenaSpec = blankArena()): StoredArena {
    const now = Date.now();
    const arena: StoredArena = {
      id: newId("arena"),
      name: cleanName(name, "New arena"),
      spec: normaliseSpec(spec),
      createdAt: now,
      updatedAt: now,
    };
    this.save([...this.list(), arena]);
    return arena;
  }

  /** Replace the map. The editor calls this on every change it commits. */
  update(id: string, spec: ArenaSpec): StoredArena | undefined {
    let updated: StoredArena | undefined;
    const arenas = this.list().map((arena) => {
      if (arena.id !== id) return arena;
      updated = { ...arena, spec: normaliseSpec(spec), updatedAt: Date.now() };
      return updated;
    });
    if (updated) this.save(arenas);
    return updated;
  }

  rename(id: string, name: string): StoredArena | undefined {
    let updated: StoredArena | undefined;
    const arenas = this.list().map((arena) => {
      if (arena.id !== id) return arena;
      updated = { ...arena, name: cleanName(name, arena.name), updatedAt: Date.now() };
      return updated;
    });
    if (updated) this.save(arenas);
    return updated;
  }

  duplicate(id: string): StoredArena | undefined {
    const original = this.get(id);
    if (!original) return undefined;
    const now = Date.now();
    // Not the origin: a copy you made is yours, and carrying somebody else's
    // credit onto it would be the one dishonest thing this store could do.
    const { origin: _dropped, ...rest } = original;
    const copy: StoredArena = {
      ...rest,
      id: newId("arena"),
      name: cleanName(`${original.name} copy`, "New arena"),
      createdAt: now,
      updatedAt: now,
    };
    this.save([...this.list(), copy]);
    return copy;
  }

  remove(id: string): void {
    this.save(this.list().filter((a) => a.id !== id));
  }

  import(name: string, spec: ArenaSpec): StoredArena {
    return this.create(name, spec);
  }

  /**
   * Take an arena somebody handed over.
   *
   * The credit is recorded on the arena itself rather than on a version of it,
   * because unlike a script there are no versions — so this is the only place
   * "who made this" can live, and a hand-built labyrinth is exactly the kind of
   * thing that ought to keep its author's name on it.
   */
  importTraded(name: string, spec: ArenaSpec, from: string, at = Date.now()): StoredArena {
    const who = from.trim().slice(0, 24) || "someone";
    const arena = this.create(name, spec);
    const origin: TradeOrigin = { kind: "trade", from: who, at, robotName: arena.name };
    const credited = { ...arena, origin };
    this.save(this.list().map((a) => (a.id === arena.id ? credited : a)));
    return credited;
  }
}
