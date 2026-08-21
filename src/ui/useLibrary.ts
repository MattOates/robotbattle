/**
 * React bindings for the stored robot library.
 *
 * The `Library` itself is deliberately plain — no React, no observables — so
 * this hook is the only place that has to think about re-rendering.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Library } from "../store/library.js";
import { ArenaLibrary } from "../store/arenas.js";
import { BattleLog } from "../store/battles.js";
import { ChatLog } from "../store/chat.js";
import { assistantRuntime, resolveModelId } from "../assistant/runtime.js";
import {
  defaultStore,
  isOurKey,
  storageAvailable,
  usedBytes,
  STORAGE_BUDGET_BYTES,
} from "../store/storage.js";

/**
 * Re-read stored state when another tab changes it.
 *
 * The `storage` event fires in every tab *except* the one that made the change,
 * which is exactly right: that tab already knows. Focus and visibility are
 * belt-and-braces for a tab that was backgrounded and throttled while the
 * event went by.
 */
function useCrossTabSync(refresh: () => void): void {
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (isOurKey(event.key)) refresh();
    };
    const onWake = () => refresh();

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [refresh]);
}
import type { StoredArena, StoredRobot } from "../store/types.js";
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
  /** The places you have built. Independent of the robots; see `store/arenas.ts`. */
  arenaLib: ArenaLibrary;
  /** Kept in state alongside `robots` so a shelf re-renders when one is saved. */
  arenas: StoredArena[];
  battles: BattleLog;
  chat: ChatLog;
  robots: StoredRobot[];
  refresh: () => void;
  storage: { used: number; budget: number; available: boolean };
  /** Throw away every robot and every battle. Not undoable. */
  clearAll: () => void;
  /** Forget battle history but keep the robots. */
  clearHistory: () => void;
}

export function useLibrary(): LibraryApi {
  const store = useMemo(() => defaultStore(), []);
  const library = useMemo(() => new Library(store), [store]);
  const arenaLib = useMemo(() => new ArenaLibrary(store), [store]);
  const battles = useMemo(() => new BattleLog(store), [store]);
  const chat = useMemo(() => new ChatLog(store), [store]);
  const [robots, setRobots] = useState<StoredRobot[]>(() => library.list());
  const [arenas, setArenas] = useState<StoredArena[]>(() => arenaLib.list());
  // Held in state rather than recomputed each render: it walks every key.
  const [used, setUsed] = useState(() => usedBytes(store));
  const seeded = useRef(false);

  const refresh = useCallback(() => {
    setRobots(library.list());
    setArenas(arenaLib.list());
    setUsed(usedBytes(store));
  }, [arenaLib, library, store]);

  // Editing a robot in the Workshop should reach a lobby open in another tab,
  // so what goes into a match is what you last wrote — not what existed when
  // the lobby happened to open.
  useCrossTabSync(refresh);

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

  const clearHistory = useCallback(() => {
    battles.clear();
    refresh();
  }, [battles, refresh]);

  const clearAll = useCallback(() => {
    for (const robot of library.list()) library.remove(robot.id);
    for (const arena of arenaLib.list()) arenaLib.remove(arena.id);
    battles.clear();
    chat.clearAll();
    // Let the seeding effect run again so they are not left with nothing.
    seeded.current = false;
    refresh();
  }, [arenaLib, battles, chat, library, refresh]);

  return {
    library,
    arenaLib,
    battles,
    chat,
    robots,
    arenas,
    refresh,
    clearAll,
    clearHistory,
    storage: {
      used,
      budget: STORAGE_BUDGET_BYTES,
      available: typeof window === "undefined" ? false : storageAvailable(),
    },
  };
}

const THEME_KEY = "theme";
const NAME_KEY = "playerName";
const ONBOARDED_KEY = "onboarded";
const ASSISTANT_MODEL_KEY = "assistantModel";

export interface Profile {
  name: string;
  theme: Theme;
  /** False on a first visit, when nothing has been chosen yet. */
  onboarded: boolean;
  /**
   * Which model the assistant should download when it is first asked to.
   *
   * A preference rather than a state: storing it does not mean anything has
   * been downloaded. Changing it after a model is loaded takes effect the next
   * time the Workshop is opened, which is the honest behaviour when the
   * alternative is silently starting a second multi-gigabyte fetch.
   */
  assistantModel: string;
}

/**
 * Who you are and which world you play in — asked once, then used everywhere:
 * chat, trading, pair programming, and which vocabulary the editor suggests.
 */
export function useProfile(): {
  profile: Profile;
  setName: (name: string) => void;
  setTheme: (theme: Theme) => void;
  setAssistantModel: (id: string) => void;
  complete: (name: string, theme: Theme) => void;
} {
  const store = useMemo(() => defaultStore(), []);

  // A stored id the current runtime no longer offers would fail at the moment
  // the player pressed the button, so an unknown one falls back rather than
  // being trusted. Empty when this build has no assistant at all.
  const readModel = useCallback(() => resolveModelId(store.get(ASSISTANT_MODEL_KEY)), [store]);

  const [profile, setProfile] = useState<Profile>(() => {
    const name = store.get(NAME_KEY) ?? "";
    const theme: Theme = store.get(THEME_KEY) === "biological" ? "biological" : "mechanical";
    // Anyone who already has a name predates the welcome screen; do not make
    // them sit through it.
    const onboarded = store.get(ONBOARDED_KEY) === "yes" || name.trim() !== "";
    return { name, theme, onboarded, assistantModel: readModel() };
  });

  useEffect(() => {
    document.documentElement.dataset["arena"] = profile.theme;
  }, [profile.theme]);

  // Changing your name or your world in one tab should be true in all of them.
  const reread = useCallback(() => {
    setProfile((current) => {
      const name = store.get(NAME_KEY) ?? "";
      const theme: Theme = store.get(THEME_KEY) === "biological" ? "biological" : "mechanical";
      const onboarded = store.get(ONBOARDED_KEY) === "yes" || name.trim() !== "";
      const assistantModel = readModel();
      if (
        name === current.name &&
        theme === current.theme &&
        onboarded === current.onboarded &&
        assistantModel === current.assistantModel
      ) {
        // Returning the same object avoids a pointless re-render on every
        // focus event.
        return current;
      }
      return { name, theme, onboarded, assistantModel };
    });
  }, [readModel, store]);
  useCrossTabSync(reread);

  const setName = useCallback(
    (name: string) => {
      const trimmed = name.slice(0, 24);
      store.set(NAME_KEY, trimmed);
      setProfile((p) => ({ ...p, name: trimmed }));
    },
    [store],
  );

  const setTheme = useCallback(
    (theme: Theme) => {
      store.set(THEME_KEY, theme);
      setProfile((p) => ({ ...p, theme }));
    },
    [store],
  );

  const setAssistantModel = useCallback(
    (id: string) => {
      if (!assistantRuntime()?.models.some((m) => m.id === id)) return;
      store.set(ASSISTANT_MODEL_KEY, id);
      setProfile((p) => ({ ...p, assistantModel: id }));
    },
    [store],
  );

  const complete = useCallback(
    (name: string, theme: Theme) => {
      const trimmed = name.trim().slice(0, 24) || "Player";
      store.set(NAME_KEY, trimmed);
      store.set(THEME_KEY, theme);
      store.set(ONBOARDED_KEY, "yes");
      setProfile((p) => ({ ...p, name: trimmed, theme, onboarded: true }));
    },
    [store],
  );

  return { profile, setName, setTheme, setAssistantModel, complete };
}

