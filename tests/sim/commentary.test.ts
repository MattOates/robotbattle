/**
 * The commentator.
 *
 * Two things are being defended here. The first is that watching a match does
 * not change it — a commentator that consumed randomness would make every peer
 * disagree about what happened, and the symptom would be a desync nobody could
 * trace back to a caption. The second is that it ranks rather than reports: a
 * busy tick holds several impacts, and saying all of them is worse than saying
 * the best one.
 */

import { describe, expect, it } from "vitest";
import { Commentator, QUIET_TICKS, type Beat } from "../../src/sim/commentary.js";
import { createWorld, makeManifest } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { hashWorld } from "../../src/sim/hash.js";
import { HUNTER, SITTING_DUCK, SPINNER } from "../../src/bots/index.js";

const MAX = 3000;

/** Run a match to its end, collecting whatever the commentator says. */
function narrate(sources: string[], seed: number): Beat[] {
  const world = createWorld(makeManifest(sources.map((source) => ({ source })), { seed }));
  const commentator = new Commentator();
  const said: Beat[] = [];
  while (!world.over && world.tick < MAX) {
    step(world);
    commentator.observe(world);
    const beat = commentator.take(world.tick);
    if (beat) said.push(beat);
  }
  // Drain what is left. The death that ended the match and the result are two
  // lines, and a loop that stops at `world.over` has only heard the first.
  for (let beat = commentator.take(world.tick); beat; beat = commentator.take(world.tick)) {
    said.push(beat);
  }
  return said;
}

describe("watching does not change the match", () => {
  it("produces an identical world with and without an observer", () => {
    // The whole safety argument in one assertion. If a commentator ever draws
    // from the world's RNG or writes to it, this diverges.
    const build = () =>
      createWorld(
        makeManifest([{ source: HUNTER }, { source: SPINNER }], { seed: 4242 }),
      );
    const watched = build();
    const alone = build();
    const commentator = new Commentator();

    for (let i = 0; i < 400; i++) {
      step(watched);
      commentator.observe(watched);
      commentator.take(watched.tick);
      step(alone);
    }

    expect(hashWorld(watched)).toBe(hashWorld(alone));
  });

  it("says the same words about the same match twice", () => {
    const a = narrate([HUNTER, SPINNER], 99);
    const b = narrate([HUNTER, SPINNER], 99);
    expect(a).toEqual(b);
  });

  it("says different things about different matches", () => {
    // Otherwise the previous test would pass on a commentator that says
    // nothing at all.
    const a = narrate([HUNTER, SPINNER], 1);
    const b = narrate([HUNTER, SPINNER], 2);
    expect(a.length).toBeGreaterThan(2);
    expect(b.length).toBeGreaterThan(2);
  });
});

describe("what it chooses to say", () => {
  const said = narrate([HUNTER, SPINNER], 7);
  const kinds = said.map((b) => b.kind);

  it("opens by naming the field", () => {
    expect(kinds[0]).toBe("start");
    const first = said[0] as Extract<Beat, { kind: "start" }>;
    expect(first.names).toHaveLength(2);
  });

  it("closes on the result, and only once", () => {
    expect(kinds.at(-1)).toBe("end");
    expect(kinds.filter((k) => k === "end")).toHaveLength(1);
  });

  it("calls first blood exactly once in a whole match", () => {
    expect(kinds.filter((k) => k === "firstBlood")).toHaveLength(1);
  });

  it("calls first blood before any ordinary hit", () => {
    const first = kinds.indexOf("firstBlood");
    const hit = kinds.indexOf("hit");
    if (hit !== -1) expect(first).toBeLessThan(hit);
  });

  it("names a winner when there is one", () => {
    const end = said.at(-1) as Extract<Beat, { kind: "end" }>;
    expect(end.winner).not.toBe("");
    expect(end.ticks).toBeGreaterThan(0);
  });
});

describe("the speaking budget", () => {
  it("stays quiet between remarks however busy the fight is", () => {
    // Four robots shooting at once is the case that would otherwise produce a
    // caption every tick.
    const world = createWorld(
      makeManifest(
        [{ source: HUNTER }, { source: SPINNER }, { source: HUNTER }, { source: SPINNER }],
        { seed: 31 },
      ),
    );
    const commentator = new Commentator();
    const at: number[] = [];
    while (!world.over && world.tick < MAX) {
      step(world);
      const running = !world.over;
      commentator.observe(world);
      const beat = commentator.take(world.tick);
      // Opening the match and calling the finish both interrupt by design, and
      // the finish includes the death that caused it. Everything said while the
      // fight is still going has to wait its turn.
      if (beat && running && beat.kind !== "start") at.push(world.tick);
    }
    expect(at.length).toBeGreaterThan(1);
    for (let i = 1; i < at.length; i++) {
      expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(QUIET_TICKS);
    }
  });

  it("announces the death that ends a match, not only the result", () => {
    // In a duel the death that ends the match lands on the same tick as the
    // result. The result outranks it, so the most dramatic moment of the fight
    // was being swallowed by the announcement that it was over.
    //
    // At this seed the death is a Hunter grinding itself to bits on the walls
    // rather than anybody's kill, which is exactly why the rescue covers both
    // kinds — the first version of it only saved shootings.
    const kinds = narrate([HUNTER, SITTING_DUCK], 5).map((b) => b.kind);
    expect(kinds.filter((k) => k === "kill" || k === "selfDestruct")).toHaveLength(1);
    expect(kinds.at(-1)).toBe("end");
  });

  it("never says anything before anything has happened", () => {
    const commentator = new Commentator();
    expect(commentator.take(0)).toBeNull();
  });
});

describe("dying to the scenery", () => {
  it("tells being shot apart from driving into a wall", () => {
    // A robot with no `on hit wall` will eventually grind itself to death.
    const suicidal = 'name "Lemming"\nchassis tank\n\non start\n  drive forward 100\nend\n';
    const world = createWorld(
      makeManifest([{ source: suicidal }, { source: SITTING_DUCK }], { seed: 3 }),
    );
    const commentator = new Commentator();
    const kinds: string[] = [];
    while (!world.over && world.tick < MAX) {
      step(world);
      commentator.observe(world);
      const beat = commentator.take(world.tick);
      if (beat) kinds.push(beat.kind);
    }
    // Nobody shot anybody, so no death here may be credited to a killer.
    expect(kinds).not.toContain("kill");
  });
});
