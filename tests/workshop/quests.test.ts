import { describe, expect, it } from "vitest";
import {
  QUESTS,
  advance,
  currentQuest,
  isQuestDone,
  nextStep,
  questsFor,
  satisfies,
  settle,
  unlocks,
  type QuestSignal,
} from "../../src/workshop/quests.js";
import { LEVELS, LEVEL_SPECS, nextLevel } from "../../src/ui/level.js";
import { ARENA_PANES, ROBOT_PANES, type Pane, type PanelName } from "../../src/ui/panes.js";
import { SCREENS } from "../../src/ui/router.js";
import { SAMPLE_BOTS } from "../../src/bots/index.js";
import { fillVocab } from "../../src/learn/markdown.js";
import { Quests } from "../../src/store/quests.js";
import { TOUR_ROBOT, TOUR_SEED } from "../../src/bots/index.js";
import { applySnippet } from "../../src/ui/tour/steps.js";
import { checkScript } from "../../src/sim/world.js";
import { translate } from "../../src/learn/translate.js";
import { MemoryStore } from "../../src/store/storage.js";

const ALL_PANES: Pane[] = [...new Set([...ROBOT_PANES, ...ARENA_PANES])];
const ALL_PANELS: PanelName[] = ["robots", "behaviours", "arenas", "room", "chat", "session"];

describe("the quest table", () => {
  it("has unique ids, and unique step ids within a quest", () => {
    const ids = QUESTS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const quest of QUESTS) {
      const steps = quest.steps.map((s) => s.id);
      expect(new Set(steps).size).toBe(steps.length);
      expect(steps.length).toBeGreaterThan(0);
    }
  });

  it("names only things that exist", () => {
    for (const quest of QUESTS) {
      expect(LEVELS).toContain(quest.level);
      for (const step of quest.steps) {
        if (step.goTo) {
          expect(SCREENS as readonly string[]).toContain(step.goTo.screen);
          if (step.goTo.pane) expect(ALL_PANES).toContain(step.goTo.pane);
        }
        if (step.gate.kind === "pane") expect(ALL_PANES).toContain(step.gate.pane);
        if (step.gate.kind === "screen") {
          expect(SCREENS as readonly string[]).toContain(step.gate.screen);
        }
        if (step.gate.kind === "won" && step.gate.against !== undefined) {
          expect(SAMPLE_BOTS.map((b) => b.id)).toContain(step.gate.against);
        }
      }
      const r = quest.reward;
      if (r.kind === "unlock") {
        if (r.pane) expect(ALL_PANES).toContain(r.pane);
        if (r.panel) expect(ALL_PANELS).toContain(r.panel);
        if (r.mode) expect(SCREENS as readonly string[]).toContain(r.mode);
      }
      if (r.kind === "opponent") {
        expect(SAMPLE_BOTS.map((b) => b.id)).toContain(r.botId);
      }
    }
  });

  it("gives every level exactly one way out, and puts it last", () => {
    for (const level of LEVELS) {
      const quests = questsFor(level);
      expect(quests.length).toBeGreaterThan(0);
      const ups = quests.filter((q) => q.reward.kind === "levelUp");
      expect(ups).toHaveLength(1);
      expect(quests[quests.length - 1]!.reward.kind).toBe("levelUp");
    }
  });

  /**
   * Every `{placeholder}` has to be one `fillVocab` knows, in both worlds.
   * An unknown key is left in the text verbatim rather than failing, so
   * without this the game happily shows a child the literal string
   * "Sample {robotPlural} are practice".
   */
  it("uses only placeholders that resolve, in both worlds", () => {
    const lines: string[] = [];
    for (const quest of QUESTS) {
      lines.push(quest.title.full, quest.title.simple, quest.reward.say);
      for (const step of quest.steps) lines.push(step.say.full, step.say.simple);
    }
    for (const theme of ["mechanical", "biological"] as const) {
      for (const line of lines) {
        expect(fillVocab(line, theme), line).not.toMatch(/[{}]/);
      }
    }
  });

  it("writes every step and reward in both registers", () => {
    for (const quest of QUESTS) {
      expect(quest.title.full.length).toBeGreaterThan(0);
      expect(quest.title.simple.length).toBeGreaterThan(0);
      expect(quest.icon.length).toBeGreaterThan(0);
      for (const step of quest.steps) {
        expect(step.say.full.length).toBeGreaterThan(0);
        expect(step.say.simple.length).toBeGreaterThan(0);
      }
      expect(quest.reward.say.length).toBeGreaterThan(0);
    }
  });

  /**
   * A quest may only hand out something its own level does not already have.
   * Unlocking a pane an Engineer was born with would show a celebration for
   * nothing, and the reward line would be a lie.
   */
  it("never unlocks something the level already had", () => {
    for (const quest of QUESTS) {
      const spec = LEVEL_SPECS[quest.level];
      const r = quest.reward;
      if (r.kind !== "unlock") continue;
      if (r.pane) expect(spec.panes).not.toContain(r.pane);
      if (r.panel) expect(spec.sidebar).not.toContain(r.panel);
      if (r.mode) expect(spec.modes).not.toContain(r.mode);
    }
  });

  /**
   * And what it does hand out has to be something the *next* level keeps,
   * otherwise moving up would take it away again.
   */
  it("only unlocks things the level above also has", () => {
    for (const quest of QUESTS) {
      const up = nextLevel(quest.level);
      if (!up) continue;
      const above = LEVEL_SPECS[up];
      const r = quest.reward;
      if (r.kind !== "unlock") continue;
      if (r.pane) expect(above.panes).toContain(r.pane);
      if (r.panel) expect(above.sidebar).toContain(r.panel);
      if (r.mode) expect(above.modes).toContain(r.mode);
    }
  });
});

describe("gates", () => {
  const src = (text: string): QuestSignal => ({ kind: "source", text });

  it("matches a script regardless of case", () => {
    expect(satisfies({ kind: "sourceHas", needle: "drive" }, src("DRIVE forward 60"))).toBe(true);
    expect(satisfies({ kind: "sourceHas", needle: "drive" }, src("turn body by 90"))).toBe(false);
  });

  it("counts a win against anybody, or against one named bot", () => {
    const won = (ids: string[]): QuestSignal => ({ kind: "trial", opponents: ids, won: true });
    expect(satisfies({ kind: "won" }, won(["spinner"]))).toBe(true);
    expect(satisfies({ kind: "won", against: "hunter" }, won(["spinner"]))).toBe(false);
    // Looser than the tour's gates on purpose: beating Hunter counts whether or
    // not somebody else was in the ring at the time.
    expect(satisfies({ kind: "won", against: "hunter" }, won(["hunter", "spinner"]))).toBe(true);
  });

  it("does not count a loss as a win, but does count it as a fight", () => {
    const lost: QuestSignal = { kind: "trial", opponents: ["hunter"], won: false };
    expect(satisfies({ kind: "won", against: "hunter" }, lost)).toBe(false);
    expect(satisfies({ kind: "fought" }, lost)).toBe(true);
  });

  it("matches a bare signal by kind", () => {
    expect(satisfies({ kind: "did", what: "benchRun" }, { kind: "benchRun" })).toBe(true);
    expect(satisfies({ kind: "did", what: "benchRun" }, { kind: "blockTaken" })).toBe(false);
  });
});

describe("advancing", () => {
  /**
   * The bug this exists to stop coming back.
   *
   * `TOUR_ROBOT`, the {robot} handed to anybody who skips the tour, already
   * contains `drive`, `on sense robot`, `fire` and an `if`. When every quest
   * at the level was offered every signal, that one script finished three of
   * the five Explorer quests on the first render — so "Notice things" sat in
   * the trophy shelf above "Have a fight", and the fight quest then
   * congratulated the player with "the Duck cannot shoot — but neither can
   * you" about a {robot} that shoots very well.
   */
  it("does not let a later quest finish before an earlier one", () => {
    const finished = TOUR_ROBOT;
    const out = advance("explorer", new Set(), { kind: "source", text: finished });
    // The first quest's script step, and nothing from the third.
    expect(out.steps).toEqual(["first-spark/make-it-move"]);
    expect(out.steps).not.toContain("open-your-eyes/sense");
    expect(out.steps).not.toContain("open-your-eyes/shoot");
  });

  it("ignores a signal for a quest that is not current yet", () => {
    // Saving is the fourth quest. Doing it during the first is not an error,
    // it just is not this quest — `settle` cannot recover it either, because
    // saving is an event and not a fact about the world.
    expect(advance("explorer", new Set(), { kind: "saved" }).steps).toEqual([]);
  });

  it("meets several steps of the current quest from one signal", () => {
    // A pasted script can sense and fire in one keystroke — within one quest
    // the steps are a checklist, not an order.
    const done = new Set([
      "first-spark/open-workshop",
      "first-spark/make-it-move",
      "watch-it-lose/fight",
    ]);
    const out = advance("explorer", done, src2("on sense robot\n  fire 3\nend"));
    expect(out.steps).toContain("open-your-eyes/sense");
    expect(out.steps).toContain("open-your-eyes/shoot");
    expect(out.quests.map((q) => q.id)).toEqual(["open-your-eyes"]);
  });

  it("never reports the same step twice", () => {
    const done = new Set(["keep-it-safe/save"]);
    expect(advance("explorer", done, { kind: "saved" }).steps).toEqual([]);
    expect(advance("explorer", done, { kind: "saved" }).quests).toEqual([]);
  });

  it("ignores quests belonging to another level", () => {
    const out = advance("explorer", new Set(), { kind: "benchRun" });
    expect(out.steps).toEqual([]);
  });

  it("does nothing once the level is finished", () => {
    const all = new Set(
      questsFor("explorer").flatMap((q) => q.steps.map((st) => `${q.id}/${st.id}`)),
    );
    expect(advance("explorer", all, { kind: "saved" }).steps).toEqual([]);
  });

  function src2(text: string): QuestSignal {
    return { kind: "source", text };
  }
});

/**
 * The regression test for the whole flow: one scripted run of signals, of the
 * kind the Workshop really emits, taking somebody from a cold start to being
 * offered Builder. If the shape of the Explorer arc ever breaks, this is what
 * says so.
 */
describe("an Explorer, start to finish", () => {
  it("is walked from nothing to a level-up offer", () => {
    const store = new MemoryStore();
    const quests = new Quests(store);
    const seen: string[] = [];
    let levelUps = 0;

    const send = (signal: QuestSignal) => {
      const out = advance("explorer", quests.done(), signal);
      quests.meet(out.steps);
      seen.push(...out.quests.map((q) => q.id));
      if (out.levelUp) levelUps++;
      check();
    };

    /*
     * The invariant, asserted after every single signal rather than only at
     * the end: the finished quests are always a prefix of the level's list.
     * A "done" sitting above a "to do" in the quest log is the exact shape of
     * the bug this arc had, and checking only the final state would not have
     * caught it — the end state was right all along.
     */
    const order = questsFor("explorer").map((q) => q.id);
    const check = () => {
      const done = quests.done();
      const finished = questsFor("explorer").map((q) => isQuestDone(q, done));
      const firstOpen = finished.indexOf(false);
      if (firstOpen !== -1) {
        expect(finished.slice(firstOpen).every((f) => !f), order.join(" → ")).toBe(true);
      }
    };

    expect(currentQuest("explorer", quests.done())?.id).toBe("first-spark");
    expect(nextStep("explorer", quests.done())?.step.id).toBe("open-workshop");

    send({ kind: "screen", screen: "workshop" });
    send({ kind: "source", text: 'name "Mine"\non start\n  drive forward 60\nend' });
    expect(seen).toEqual(["first-spark"]);
    // The reward is what makes the next quest possible.
    expect(unlocks(quests.done()).panes).toContain("trial");

    send({ kind: "trial", opponents: ["sitting-duck"], won: false });
    expect(seen).toContain("watch-it-lose");

    send({ kind: "source", text: "on sense robot\n  turret.aim at event.bearing\n  fire 2\nend" });
    expect(seen).toContain("open-your-eyes");
    expect(unlocks(quests.done()).opponents).toContain("hunter");

    send({ kind: "saved" });
    send({ kind: "trial", opponents: ["hunter"], won: true });

    expect(seen).toEqual([
      "first-spark",
      "watch-it-lose",
      "open-your-eyes",
      "keep-it-safe",
      "beat-the-hunter",
    ]);
    expect(levelUps).toBe(1);
    expect(currentQuest("explorer", quests.done())).toBeNull();
    expect(nextStep("explorer", quests.done())).toBeNull();
    for (const quest of questsFor("explorer")) {
      expect(isQuestDone(quest, quests.done())).toBe(true);
    }
  });
});

describe("settling what is already true", () => {
  it("credits the current quest without making them type it again", () => {
    // The seed {robot} already drives, so the step asking for one is met the
    // moment the Workshop shows the script — no deleting and retyping a line
    // to make the editor speak.
    const done = new Set(["first-spark/open-workshop"]);
    const out = settle("explorer", done, { source: TOUR_SEED });
    expect(out.steps).toEqual(["first-spark/make-it-move"]);
    expect(out.quests.map((q) => q.id)).toEqual(["first-spark"]);
  });

  it("stops at the first quest it cannot settle", () => {
    /*
     * The finished {robot} satisfies quests one and three. It must settle one
     * and stop dead at two, which needs an actual fight — otherwise it has
     * simply reintroduced the bug by another route.
     */
    const done = new Set(["first-spark/open-workshop"]);
    const out = settle("explorer", done, { source: TOUR_ROBOT });
    expect(out.quests.map((q) => q.id)).toEqual(["first-spark"]);
    expect(out.steps).not.toContain("open-your-eyes/sense");
  });

  it("cascades through consecutive quests that are all already true", () => {
    // Builder's first two quests are both pure script checks, so a script with
    // an `if` and a `var` settles both at once and stops at the third.
    const out = settle("builder", new Set(), {
      source: "var seen = 0\non tick\n  if me.health < 50 then\n    set seen = 1\n  end\nend",
    });
    expect(out.quests.map((q) => q.id)).toEqual(["make-a-choice", "remember-something"]);
  });

  it("does nothing with no script open", () => {
    expect(settle("explorer", new Set(), { source: null }).steps).toEqual([]);
  });

  it("is idempotent", () => {
    const world = { source: TOUR_SEED };
    const first = settle("explorer", new Set(["first-spark/open-workshop"]), world);
    const after = new Set(["first-spark/open-workshop", ...first.steps]);
    expect(settle("explorer", after, world).steps).toEqual([]);
  });
});

describe("unlocks", () => {
  it("grants nothing until a quest is finished, not merely started", () => {
    const half = new Set(["open-your-eyes/sense"]);
    expect(unlocks(half).opponents).not.toContain("hunter");
    const whole = new Set(["open-your-eyes/sense", "open-your-eyes/shoot"]);
    expect(unlocks(whole).opponents).toContain("hunter");
  });
});

describe("the store", () => {
  it("records once, survives a reload, and clears", () => {
    const store = new MemoryStore();
    new Quests(store).meet(["a/b", "c/d"]);
    new Quests(store).meet(["a/b"]);
    expect([...new Quests(store).done()]).toEqual(["a/b", "c/d"]);
    expect(new Quests(store).count()).toBe(2);
    new Quests(store).clear();
    expect(new Quests(store).count()).toBe(0);
  });

  it("remembers a declined level-up until they move up", () => {
    const store = new MemoryStore();
    expect(new Quests(store).declinedLevelUp()).toBe(false);
    new Quests(store).declineLevelUp();
    expect(new Quests(store).declinedLevelUp()).toBe(true);
    new Quests(store).clearDecline();
    expect(new Quests(store).declinedLevelUp()).toBe(false);
  });
});

/**
 * The same guarantees `tests/bots/tourRobot.test.ts` gives the tour's snippets,
 * for the ones the quest helper offers. It is the same mechanism — `insert`
 * plus `applySnippet` — and the failure it prevents is the same: a child
 * pressing "Start it off for me" and being handed code that does not compile,
 * or that does not satisfy the very step that offered it.
 */
describe("the code the helper offers to write for you", () => {
  const withInsert = QUESTS.flatMap((quest) =>
    quest.steps.filter((s) => s.insert).map((step) => ({ quest, step })),
  );

  const base = 'name "Test"\nchassis tank\n\non start\n  drive forward 10\nend\n';

  it("has some", () => {
    expect(withInsert.length).toBeGreaterThan(0);
  });

  it("compiles in both worlds", () => {
    for (const { step } of withInsert) {
      for (const theme of ["mechanical", "biological"] as const) {
        const result = checkScript(translate(base + step.insert!.snippet, theme));
        expect(result.ok ? null : `${step.id} in ${theme}: ${result.error?.message}`).toBe(null);
      }
    }
  });

  it("still compiles after grafting over an existing handler", () => {
    /*
     * Two of these carry `replaces`, which means `applySnippet` cuts out the
     * `on sense robot` the previous step added and puts this one in its place.
     * Appending instead would give the script two handlers for one event, and
     * that is a compile error — so the graft, not just the snippet, is what
     * has to be checked.
     */
    let source = base;
    for (const { step } of withInsert) {
      source = applySnippet(source, step.insert!);
      const result = checkScript(source);
      expect(result.ok ? null : `after ${step.id}: ${result.error?.message}`).toBe(null);
    }
  });

  it("satisfies the gate of the step that offers it", () => {
    for (const { step } of withInsert) {
      if (step.gate.kind !== "sourceHas") continue;
      expect(
        step.insert!.snippet.toLowerCase(),
        `${step.id} offers code that does not satisfy its own gate`,
      ).toContain(step.gate.needle.toLowerCase());
    }
  });

  it("explains every step it asks for, in both registers", () => {
    // `help` is optional in the type but the Explorer arc is the one a
    // beginner meets with no other guidance, so none of it may be silent.
    for (const quest of questsFor("explorer")) {
      for (const step of quest.steps) {
        expect(step.help, `${quest.id}/${step.id} has no explanation`).toBeDefined();
        expect(step.help!.simple.length).toBeGreaterThan(0);
        expect(step.help!.full.length).toBeGreaterThan(0);
      }
    }
  });

  it("uses only placeholders that resolve in the help text too", () => {
    for (const quest of QUESTS) {
      for (const step of quest.steps) {
        if (!step.help) continue;
        for (const theme of ["mechanical", "biological"] as const) {
          expect(fillVocab(step.help.simple, theme)).not.toMatch(/[{}]/);
          expect(fillVocab(step.help.full, theme)).not.toMatch(/[{}]/);
        }
      }
    }
  });
});
