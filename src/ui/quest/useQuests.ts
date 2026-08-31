/**
 * Running the quests: what is met, what just happened, and what to say about it.
 *
 * The screens know almost nothing about this. They call `signal()` when
 * something happens — the same call they already make to the tour — and render
 * `<QuestToasts>` and `<JourneyBar>`. Everything else is decided by
 * `workshop/quests.ts`, which is pure and tested.
 *
 * One deliberate asymmetry with `useTour`: this hook is mounted by the shell
 * rather than by each screen, because a quest step can be met on any screen and
 * the toast for it has to survive the navigation that met it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Quests } from "../../store/quests.js";
import {
  advance,
  currentQuest,
  settle,
  nextStep,
  questsFor,
  stepKey,
  unlocks,
  type Quest,
  type QuestSignal,
  type Step,
} from "../../workshop/quests.js";
import type { Level } from "../level.js";
import type { Pane, PanelName } from "../panes.js";
import type { ScreenName } from "../router.js";

/** One thing to celebrate. A met step, or a whole finished quest. */
export interface Celebration {
  id: number;
  kind: "step" | "quest" | "levelUp";
  icon: string;
  /** Already in the right register, already vocab-filled. */
  text: string;
  /** How far through the quest this leaves them, for the pip row. */
  pips?: { done: number; total: number };
}

export interface QuestApi {
  /** Tell the quests something happened. Cheap and safe to call constantly. */
  signal: (signal: QuestSignal) => void;
  /**
   * Tell the quests what the world looks like now.
   *
   * Separate from `signal` because it is a fact rather than an event: it may
   * be called on every render and on every keystroke, and it credits whatever
   * the current quest already asks for. See `settle`.
   */
  observe: (world: { source: string | null }) => void;
  done: ReadonlySet<string>;
  quests: readonly Quest[];
  current: Quest | null;
  next: { quest: Quest; step: Step } | null;
  /** What finished quests have handed over, to union with the level's own set. */
  unlocked: { panes: Pane[]; panels: PanelName[]; modes: ScreenName[]; opponents: string[] };
  /** Waiting to be shown, oldest first. */
  celebrations: Celebration[];
  dismiss: (id: number) => void;
  /** True when the level's last quest is done and they have not said no yet. */
  offeringLevelUp: boolean;
  declineLevelUp: () => void;
  isMet: (quest: Quest, step: Step) => boolean;
}

/**
 * @param say  Renders a line in the right register and vocabulary. Passed in
 *             rather than imported so this hook does not have to know about
 *             themes, and so the tests for the copy stay where the copy is.
 */
export function useQuests(
  level: Level,
  say: (both: { full: string; simple: string }) => string,
  fill: (text: string) => string,
): QuestApi {
  const store = useMemo(() => new Quests(), []);
  const [done, setDone] = useState<ReadonlySet<string>>(() => store.done());
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  const [declined, setDeclined] = useState(() => store.declinedLevelUp());
  const nextId = useRef(1);

  // Read back whatever another tab did. The library hook already listens for
  // the storage event; this is the same idea for one more key.
  useEffect(() => {
    const reread = () => setDone(store.done());
    window.addEventListener("focus", reread);
    return () => window.removeEventListener("focus", reread);
  }, [store]);

  /**
   * Turn an `Advance` into stored progress and cards to show.
   *
   * Shared by `signal` and `observe` because the two differ only in how they
   * work out what was met — everything after that, the storing and the
   * celebrating, is identical.
   */
  const apply = useCallback(
    (out: ReturnType<typeof advance>) => {
      if (out.steps.length === 0) return;

      store.meet(out.steps);
      const after = store.done();
      setDone(after);

      // A finished quest is celebrated as a quest, not as its last step: two
      // cards for one action reads as a stutter.
      const finished = new Set(out.quests.map((q) => q.id));
      const fresh: Celebration[] = [];

      for (const key of out.steps) {
        const questId = key.slice(0, key.indexOf("/"));
        if (finished.has(questId)) continue;
        const quest = questsFor(level).find((q) => q.id === questId);
        const step = quest?.steps.find((s) => stepKey(quest, s) === key);
        if (!quest || !step) continue;
        fresh.push({
          id: nextId.current++,
          kind: "step",
          icon: quest.icon,
          text: fill(say(step.say)),
          pips: {
            done: quest.steps.filter((s) => after.has(stepKey(quest, s))).length,
            total: quest.steps.length,
          },
        });
      }

      for (const quest of out.quests) {
        fresh.push({
          id: nextId.current++,
          kind: quest.reward.kind === "levelUp" ? "levelUp" : "quest",
          icon: quest.icon,
          text: fill(quest.reward.say),
        });
      }

      setCelebrations((queue) => [...queue, ...fresh]);
    },
    [fill, level, say, store],
  );

  const signal = useCallback(
    (incoming: QuestSignal) => apply(advance(level, store.done(), incoming)),
    [apply, level, store],
  );

  /*
   * Settling can cascade — finishing one quest can make the next current, and
   * that one may already be satisfied too — so `settle` walks forward itself
   * and returns everything it met in one go.
   */
  const observe = useCallback(
    (world: { source: string | null }) => apply(settle(level, store.done(), world)),
    [apply, level, store],
  );

  const dismiss = useCallback((id: number) => {
    setCelebrations((queue) => queue.filter((c) => c.id !== id));
  }, []);

  const declineLevelUp = useCallback(() => {
    store.declineLevelUp();
    setDeclined(true);
  }, [store]);

  const current = currentQuest(level, done);

  return {
    signal,
    observe,
    done,
    quests: questsFor(level),
    current,
    next: nextStep(level, done),
    unlocked: unlocks(done),
    celebrations,
    dismiss,
    // Nothing left to do at this level, and they have not turned it down.
    offeringLevelUp: current === null && !declined,
    declineLevelUp,
    isMet: (quest, step) => done.has(stepKey(quest, step)),
  };
}
