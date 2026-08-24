import { describe, expect, it } from "vitest";
import {
  TOUR_ANCHORS,
  TOURS,
  WORKSHOP_TOUR,
  isSatisfied,
  type Gate,
  type TourSignal,
} from "../../src/ui/tour/steps.js";
import { Tours } from "../../src/store/tour.js";
import { MemoryStore } from "../../src/store/storage.js";

describe("gates", () => {
  it("advances a narration step only on Next", () => {
    const gate: Gate = { kind: "next" };
    expect(isSatisfied(gate, { kind: "next" })).toBe(true);
    expect(isSatisfied(gate, { kind: "pane", pane: "trial" })).toBe(false);
  });

  it("matches a pane by name", () => {
    const gate: Gate = { kind: "pane", pane: "trial" };
    expect(isSatisfied(gate, { kind: "pane", pane: "trial" })).toBe(true);
    expect(isSatisfied(gate, { kind: "pane", pane: "bench" })).toBe(false);
  });

  it("requires the opponent set to match exactly, in any order", () => {
    const gate: Gate = { kind: "opponents", exactly: ["sitting-duck"] };
    expect(isSatisfied(gate, { kind: "opponents", ids: ["sitting-duck"] })).toBe(true);
    // The default pair is still ticked alongside it: not yet.
    expect(
      isSatisfied(gate, { kind: "opponents", ids: ["sitting-duck", "spinner"] }),
    ).toBe(false);
    expect(isSatisfied(gate, { kind: "opponents", ids: [] })).toBe(false);
  });

  it("is order-insensitive about a multi-opponent set", () => {
    const gate: Gate = { kind: "opponents", exactly: ["spinner", "racer"] };
    expect(isSatisfied(gate, { kind: "opponents", ids: ["racer", "spinner"] })).toBe(true);
  });

  it("tells a win from a loss against the same opponent", () => {
    const won: Gate = { kind: "trialWon", against: ["spinner"] };
    const lost: Gate = { kind: "trialLost", against: ["spinner"] };
    const win: TourSignal = { kind: "trial", opponents: ["spinner"], won: true };
    const loss: TourSignal = { kind: "trial", opponents: ["spinner"], won: false };

    expect(isSatisfied(won, win)).toBe(true);
    expect(isSatisfied(won, loss)).toBe(false);
    expect(isSatisfied(lost, loss)).toBe(true);
    expect(isSatisfied(lost, win)).toBe(false);
  });

  it("does not accept a win against the wrong opponent", () => {
    // The near-miss that matters: beating the Duck must not satisfy the step
    // that is waiting for the Spinner.
    const gate: Gate = { kind: "trialWon", against: ["spinner"] };
    expect(
      isSatisfied(gate, { kind: "trial", opponents: ["sitting-duck"], won: true }),
    ).toBe(false);
  });

  it("finds a needle in the script regardless of case", () => {
    const gate: Gate = { kind: "sourceHas", needle: "on sense" };
    expect(isSatisfied(gate, { kind: "source", text: "ON SENSE robot" })).toBe(true);
    expect(isSatisfied(gate, { kind: "source", text: "on start" })).toBe(false);
  });

  it("ignores signals of an unrelated kind", () => {
    const gate: Gate = { kind: "trialWon", against: ["spinner"] };
    expect(isSatisfied(gate, { kind: "saved" })).toBe(false);
    expect(isSatisfied(gate, { kind: "next" })).toBe(false);
  });
});

describe("step definitions", () => {
  const every = Object.values(TOURS).flat();

  it("gives every step a unique id within its tour", () => {
    for (const [id, steps] of Object.entries(TOURS)) {
      const ids = steps.map((s) => s.id);
      expect(new Set(ids).size, `${id} has a duplicate step id`).toBe(ids.length);
    }
  });

  it("only points at anchors the overlay knows about", () => {
    const known = new Set<string>(TOUR_ANCHORS);
    for (const step of every) {
      if (step.anchor === null) continue;
      expect(known.has(step.anchor), `${step.id} points at ${step.anchor}`).toBe(true);
    }
  });

  it("gives every step something to say", () => {
    for (const step of every) {
      expect(step.title.trim(), step.id).not.toBe("");
      expect(step.body.trim(), step.id).not.toBe("");
    }
  });

  it("beats an easy opponent before being asked to beat a hard one", () => {
    // The arc is the feature: win against the Duck, then meet something that
    // is genuinely better than you are.
    const ids = WORKSHOP_TOUR.map((s) => s.id);
    expect(ids.indexOf("beat-duck")).toBeGreaterThan(ids.indexOf("arm-it"));
    expect(ids.indexOf("beat-hunter")).toBeGreaterThan(ids.indexOf("beat-duck"));
    expect(ids.indexOf("pick-your-range")).toBeGreaterThan(ids.indexOf("meet-the-wall"));
  });

  it("never demands a defeat it cannot promise", () => {
    // The player beats Hunter about four times in ten. A `trialLost` gate on
    // that fight would strand the four who won, so the fight itself is the
    // gate. Nothing in any tour may wait for a loss.
    for (const step of Object.values(TOURS).flat()) {
      expect(step.gate.kind, `${step.id} waits for a defeat`).not.toBe("trialLost");
    }
  });

  it("gives every insert step a gate its own snippet satisfies", () => {
    for (const step of WORKSHOP_TOUR) {
      if (!step.insert) continue;
      expect(step.gate.kind).toBe("sourceHas");
    }
  });
});

describe("Tours storage", () => {
  it("starts every tour unseen", () => {
    const tours = new Tours(new MemoryStore());
    expect(tours.state("workshop")).toBe("unseen");
    expect(tours.isSettled("workshop")).toBe(false);
  });

  it("remembers which step it was on, so a reload resumes", () => {
    const store = new MemoryStore();
    new Tours(store).begin("workshop", "meet");
    new Tours(store).advanceTo("workshop", "open-trial");
    // A fresh instance, as a reload would build.
    expect(new Tours(store).state("workshop")).toEqual({ step: "open-trial" });
  });

  it("settles on skip and on finish", () => {
    const store = new MemoryStore();
    const tours = new Tours(store);
    tours.skip("arena");
    tours.finish("workshop");
    expect(tours.state("arena")).toBe("skipped");
    expect(tours.state("workshop")).toBe("done");
    expect(tours.isSettled("arena")).toBe(true);
    expect(tours.isSettled("tournament")).toBe(false);
  });

  it("keeps the tours apart", () => {
    const tours = new Tours(new MemoryStore());
    tours.finish("workshop");
    expect(tours.state("arena")).toBe("unseen");
  });

  it("round-trips the mute setting", () => {
    const store = new MemoryStore();
    new Tours(store).setMuted(true);
    expect(new Tours(store).muted()).toBe(true);
  });

  it("offers the tours again on reset but keeps the mute preference", () => {
    const tours = new Tours(new MemoryStore());
    tours.finish("workshop");
    tours.setMuted(true);
    tours.reset();
    expect(tours.state("workshop")).toBe("unseen");
    // Muting is a preference about audio, not a fact about the tour.
    expect(tours.muted()).toBe(true);
  });
});

describe("the opening on the menu", () => {
  it("greets by name before it explains anything", () => {
    const first = WORKSHOP_TOUR[0]!;
    expect(first.screen).toBe("menu");
    expect(first.title).toContain("{name}");
  });

  it("stays on the menu until it has asked them to move", () => {
    // Every menu step comes before every Workshop step: the tour walks in one
    // direction, and a step that sends somebody back would be a mess to render
    // when only one screen is mounted at a time.
    const screens = WORKSHOP_TOUR.map((s) => s.screen ?? "workshop");
    expect(screens.lastIndexOf("menu")).toBeLessThan(screens.indexOf("workshop"));
  });

  it("hands over by waiting for the Workshop to open", () => {
    const menuSteps = WORKSHOP_TOUR.filter((s) => s.screen === "menu");
    const last = menuSteps.at(-1)!;
    expect(last.gate).toEqual({ kind: "screen", screen: "workshop" });
  });

  it("advances a screen gate only for the screen it names", () => {
    const gate = { kind: "screen", screen: "workshop" } as const;
    expect(isSatisfied(gate, { kind: "screen", screen: "workshop" })).toBe(true);
    expect(isSatisfied(gate, { kind: "screen", screen: "arena" })).toBe(false);
    expect(isSatisfied(gate, { kind: "next" })).toBe(false);
  });
});
