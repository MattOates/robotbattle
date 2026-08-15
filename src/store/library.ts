/**
 * The robot library: what you have built, and the named versions of it.
 *
 * A robot's display name and colour are *derived* from its script rather than
 * stored alongside it. Two sources of truth for a robot's name would drift the
 * moment someone edited the `name` line, so the library caches what the script
 * says and falls back to the last good value while the script is mid-edit.
 */

import { parse } from "../lang/parser.js";
import {
  defaultStore,
  newId,
  readJson,
  writeJson,
  type KeyValueStore,
} from "./storage.js";
import type { Snapshot, StoredRobot } from "./types.js";

const KEY = "robots";

/** A blank robot that already does something, so a new entry is never a dead end. */
export const STARTER_SCRIPT = `name "New Robot"
chassis tank
color #7fd1e0

on start
  turret.sweep 45
  drive forward 60
end

on sense robot
  turret.aim at event.bearing
  fire 2
end

on hit wall
  turn body by 150
end
`;

export interface RobotMeta {
  name: string;
  color: string;
}

/**
 * Read the name and colour out of a script. Returns null while the script does
 * not parse, which is the normal state of something being typed.
 */
export function deriveMeta(source: string): RobotMeta | null {
  try {
    const program = parse(source);
    return { name: program.name, color: program.color };
  } catch {
    return null;
  }
}

export class Library {
  private store: KeyValueStore;

  constructor(store: KeyValueStore = defaultStore()) {
    this.store = store;
  }

  list(): StoredRobot[] {
    return readJson<StoredRobot[]>(this.store, KEY, []);
  }

  get(id: string): StoredRobot | undefined {
    return this.list().find((r) => r.id === id);
  }

  private save(robots: StoredRobot[]): void {
    writeJson(this.store, KEY, robots);
  }

  create(source: string = STARTER_SCRIPT): StoredRobot {
    const meta = deriveMeta(source);
    const now = Date.now();
    const robot: StoredRobot = {
      id: newId("bot"),
      name: meta?.name ?? "New Robot",
      color: meta?.color ?? "#7fd1e0",
      source,
      createdAt: now,
      updatedAt: now,
      snapshots: [],
    };
    this.save([...this.list(), robot]);
    return robot;
  }

  /** Update the working copy, re-deriving the cached name and colour. */
  updateSource(id: string, source: string): StoredRobot | undefined {
    let updated: StoredRobot | undefined;
    const robots = this.list().map((robot) => {
      if (robot.id !== id) return robot;
      const meta = deriveMeta(source);
      updated = {
        ...robot,
        source,
        // Keep the previous name while the script is broken, so the library
        // doesn't flicker to "unnamed" on every keystroke.
        name: meta?.name ?? robot.name,
        color: meta?.color ?? robot.color,
        updatedAt: Date.now(),
      };
      return updated;
    });
    if (updated) this.save(robots);
    return updated;
  }

  duplicate(id: string): StoredRobot | undefined {
    const original = this.get(id);
    if (!original) return undefined;
    const now = Date.now();
    const copy: StoredRobot = {
      ...original,
      id: newId("bot"),
      // Snapshots belong to the original's history, not the copy's.
      snapshots: [],
      createdAt: now,
      updatedAt: now,
    };
    this.save([...this.list(), copy]);
    return copy;
  }

  remove(id: string): void {
    this.save(this.list().filter((r) => r.id !== id));
  }

  /** Import a robot from elsewhere — a trade, or a shared script. */
  import(source: string): StoredRobot {
    return this.create(source);
  }

  // ---- snapshots --------------------------------------------------------

  /** Freeze the current working copy under a name. */
  saveSnapshot(id: string, label: string): Snapshot | undefined {
    const robot = this.get(id);
    if (!robot) return undefined;
    const snapshot: Snapshot = {
      id: newId("snap"),
      label: label.trim() || `v${robot.snapshots.length + 1}`,
      source: robot.source,
      createdAt: Date.now(),
      pinned: false,
    };
    this.save(
      this.list().map((r) =>
        // Newest first: the version you just took is the one you want to test.
        r.id === id ? { ...r, snapshots: [snapshot, ...r.snapshots] } : r,
      ),
    );
    return snapshot;
  }

  /** Copy a snapshot back over the working copy. */
  restoreSnapshot(robotId: string, snapshotId: string): StoredRobot | undefined {
    const robot = this.get(robotId);
    const snapshot = robot?.snapshots.find((s) => s.id === snapshotId);
    if (!robot || !snapshot) return undefined;
    return this.updateSource(robotId, snapshot.source);
  }

  removeSnapshot(robotId: string, snapshotId: string): void {
    this.save(
      this.list().map((r) =>
        r.id === robotId
          ? { ...r, snapshots: r.snapshots.filter((s) => s.id !== snapshotId) }
          : r,
      ),
    );
  }

  togglePin(robotId: string, snapshotId: string): void {
    this.save(
      this.list().map((r) =>
        r.id === robotId
          ? {
              ...r,
              snapshots: r.snapshots.map((s) =>
                s.id === snapshotId ? { ...s, pinned: !s.pinned } : s,
              ),
            }
          : r,
      ),
    );
  }

  renameSnapshot(robotId: string, snapshotId: string, label: string): void {
    this.save(
      this.list().map((r) =>
        r.id === robotId
          ? {
              ...r,
              snapshots: r.snapshots.map((s) =>
                s.id === snapshotId ? { ...s, label: label.trim() || s.label } : s,
              ),
            }
          : r,
      ),
    );
  }
}
