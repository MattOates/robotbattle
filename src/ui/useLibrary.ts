/**
 * React bindings for the stored robot library.
 *
 * The `Library` itself is deliberately plain — no React, no observables — so
 * this hook is the only place that has to think about re-rendering.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Library } from "../store/library.js";
import { BattleLog } from "../store/battles.js";
import { defaultStore, storageAvailable, usedBytes, STORAGE_BUDGET_BYTES } from "../store/storage.js";
import type { StoredRobot } from "../store/types.js";
import type { Theme } from "../lang/vocab.js";

const FIRST_ROBOT = `-- Your first robot. Change anything you like.
-- Press Ctrl-Space in the editor to see what you can write.
name "My First Robot"
chassis tank
color #7fd1e0

on start
  turret.sweep 45
  drive forward 60
end

on sense robot
  set name = "found you"
  turret.aim at event.bearing
  fire 2
end

on hit wall
  turn body by 150
end
`;

export interface LibraryApi {
  library: Library;
  battles: BattleLog;
  robots: StoredRobot[];
  refresh: () => void;
  storage: { used: number; budget: number; available: boolean };
}

export function useLibrary(): LibraryApi {
  const store = useMemo(() => defaultStore(), []);
  const library = useMemo(() => new Library(store), [store]);
  const battles = useMemo(() => new BattleLog(store), [store]);
  const [robots, setRobots] = useState<StoredRobot[]>(() => library.list());
  const seeded = useRef(false);

  const refresh = useCallback(() => setRobots(library.list()), [library]);

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    // A brand new player should land in the Workshop with something that
    // already works, not an empty page and a blinking cursor.
    if (library.list().length === 0) {
      library.create(FIRST_ROBOT);
      refresh();
    }
  }, [library, refresh]);

  return {
    library,
    battles,
    robots,
    refresh,
    storage: {
      used: usedBytes(store),
      budget: STORAGE_BUDGET_BYTES,
      available: typeof window === "undefined" ? false : storageAvailable(),
    },
  };
}

const THEME_KEY = "theme";

/** Theme choice, remembered between visits. */
export function usePersistentTheme(): [Theme, (theme: Theme) => void] {
  const store = useMemo(() => defaultStore(), []);
  const [theme, setThemeState] = useState<Theme>(() =>
    store.get(THEME_KEY) === "biological" ? "biological" : "mechanical",
  );

  useEffect(() => {
    document.documentElement.dataset["arena"] = theme;
  }, [theme]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      store.set(THEME_KEY, next);
    },
    [store],
  );

  return [theme, setTheme];
}

const NAME_KEY = "playerName";

/** The name shown to other people in a room. */
export function usePlayerName(): [string, (name: string) => void] {
  const store = useMemo(() => defaultStore(), []);
  const [name, setNameState] = useState<string>(() => store.get(NAME_KEY) ?? "");

  const setName = useCallback(
    (next: string) => {
      const trimmed = next.slice(0, 24);
      setNameState(trimmed);
      store.set(NAME_KEY, trimmed);
    },
    [store],
  );

  return [name, setName];
}
