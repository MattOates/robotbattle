import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { QUESTS } from "../../src/workshop/quests.js";

/**
 * Every gate needs something that fires it.
 *
 * Three quests shipped that could not be finished: `arenaPlayed`, `mapDrawn`
 * and `tradeGiven` were in the signal union, were gated on, and were emitted
 * by nothing anywhere in the application. Builder could never reach its
 * level-up and Engineer stopped at the map. A fourth gated on `fixApplied`
 * while claiming to be about opening the inspector.
 *
 * Nothing caught it, and the reason is worth stating: every quest test drives
 * `advance` with a signal the test itself constructs, which proves the table
 * reacts and says nothing whatever about whether the application ever sends
 * it. A test that supplies its own input cannot discover a missing caller.
 *
 * So this one reads the source. It is coarse — a grep for the literal — and
 * coarse is the point: it asks the only question that matters here, which is
 * whether the string appears somewhere that is not the table itself.
 */

const SOURCE = "src";
/** The table and the type both mention every signal; neither sends one. */
const NOT_EMITTERS = ["workshop/quests.ts", "ui/tour/steps.ts"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) && !path.endsWith(".d.ts") ? [path] : [];
  });
}

const EMITTING_FILES = sourceFiles(SOURCE)
  .filter((path) => !NOT_EMITTERS.some((skip) => path.replace(/\\/g, "/").endsWith(skip)))
  .map((path) => ({ path, text: readFileSync(path, "utf8") }));

/** Where a signal of this kind is sent, if anywhere. */
function emittersOf(signal: string): string[] {
  return EMITTING_FILES.filter((f) => f.text.includes(`kind: "${signal}"`)).map((f) => f.path);
}

describe("every quest can actually be finished", () => {
  it("has an emitter for every plain signal a quest waits on", () => {
    const orphans: string[] = [];
    for (const quest of QUESTS) {
      for (const step of quest.steps) {
        if (step.gate.kind !== "did") continue;
        if (emittersOf(step.gate.what).length === 0) {
          orphans.push(`${quest.id}/${step.id} waits on "${step.gate.what}", which nothing sends`);
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  it("waits on the signal its own words describe", () => {
    /*
     * "Open the Behaviour Inspector" was gated on `fixApplied` — the button in
     * the picture debrief that adds a suggested card. Opening the inspector
     * did nothing, and applying a fix silently completed a quest about
     * reading. A gate is a promise about what the words mean.
     */
    const inspect = QUESTS.find((q) => q.id === "read-the-machine")!.steps[0]!;
    expect(inspect.gate).toEqual({ kind: "did", what: "inspectorOpened" });
  });

  it("sends every signal from a screen the quest points at", () => {
    // A quest whose `goTo` sends you to the Arena while its signal is only
    // ever emitted by the Workshop is a quest you cannot finish where you were
    // told to go.
    for (const quest of QUESTS) {
      for (const step of quest.steps) {
        if (step.gate.kind !== "did" || !step.goTo) continue;
        const screen = step.goTo.screen;
        const where = emittersOf(step.gate.what).join(" ");
        const expected =
          screen === "workshop" ? "Workshop" : screen === "arena" ? "Arena" : "Trade";
        expect(where, `${quest.id}/${step.id} -> ${screen}`).toContain(expected);
      }
    }
  });
});
