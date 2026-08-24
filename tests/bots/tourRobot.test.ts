/**
 * The onboarding tour's code.
 *
 * The tour hands people two things: snippets it offers to paste into their
 * script, and a finished robot for anyone who skips. Both are the very first
 * RoboScript a new player ever sees, so a parse error in either is the worst
 * possible first impression the game could make.
 */

import { describe, expect, it } from "vitest";
import { checkScript, makeManifest } from "../../src/sim/world.js";
import { runMatch } from "../../src/sim/match.js";
import { translate } from "../../src/learn/translate.js";
import { TOUR_ROBOT, TOUR_SEED, HUNTER, SITTING_DUCK } from "../../src/bots/index.js";
import { TOURS, WORKSHOP_TOUR, applySnippet } from "../../src/ui/tour/steps.js";
import { runTrials } from "../../src/workshop/trials.js";
import { BRANDING } from "../../src/ui/branding.js";
import type { Theme } from "../../src/lang/vocab.js";

const THEMES: Theme[] = ["mechanical", "biological"];

describe("the robot the tour builds", () => {
  it("compiles", () => {
    const result = checkScript(TOUR_ROBOT);
    expect(result.ok ? null : result.error?.message).toBe(null);
  });

  it("compiles in both worlds", () => {
    for (const theme of THEMES) {
      const result = checkScript(translate(TOUR_ROBOT, theme));
      expect(result.ok ? null : `${theme}: ${result.error?.message}`).toBe(null);
    }
  });

  it("does the things the tour promises it does", () => {
    // The tour's whole arc is "see it, shoot it, then stop standing still".
    // A skipper is handed the finished article, so it had better be finished.
    expect(TOUR_ROBOT).toMatch(/on sense robot/);
    expect(TOUR_ROBOT).toMatch(/fire /);
    // The second lesson: choose your range rather than charging at one speed.
    expect(TOUR_ROBOT).toMatch(/if event\.distance/);
  });
});

describe("the snippets the tour offers to paste", () => {
  const snippets = Object.values(TOURS)
    .flat()
    .filter((step) => step.insert)
    .map((step) => ({ id: step.id, snippet: step.insert!.snippet }));

  it("has some", () => {
    expect(snippets.length).toBeGreaterThan(0);
  });

  it("compiles each one when appended to a bare robot", () => {
    // A handler on its own is not a program; what matters is that it is valid
    // in the place the tour actually puts it.
    const base = 'name "Test"\nchassis tank\n\non start\n  drive forward 10\nend\n';
    for (const { id, snippet } of snippets) {
      const result = checkScript(base + snippet);
      expect(result.ok ? null : `${id}: ${result.error?.message}`).toBe(null);
    }
  });

  it("compiles each one in both worlds", () => {
    const base = 'name "Test"\nchassis tank\n\non start\n  drive forward 10\nend\n';
    for (const { id, snippet } of snippets) {
      for (const theme of THEMES) {
        const result = checkScript(translate(base + snippet, theme));
        expect(result.ok ? null : `${id} in ${theme}: ${result.error?.message}`).toBe(null);
      }
    }
  });

  it("satisfies the gate of the step that offers it", () => {
    // A snippet that does not contain what its own step is waiting for would
    // leave the player pasting it in and the tour refusing to move on.
    for (const step of Object.values(TOURS).flat()) {
      if (!step.insert) continue;
      if (step.gate.kind !== "sourceHas") continue;
      expect(
        step.insert.snippet.toLowerCase(),
        `${step.id} offers code that does not satisfy its own gate`,
      ).toContain(step.gate.needle.toLowerCase());
    }
  });
});

describe("the characters", () => {
  it("gives every world a named helper with a voice", () => {
    for (const theme of THEMES) {
      const character = BRANDING[theme].character;
      expect(character.name).not.toBe("");
      expect(character.greeting).not.toBe("");
      // A Piper voice id, e.g. en_GB-alan-medium.
      expect(character.voiceId).toMatch(/^[a-z]{2}_[A-Z]{2}-\w+-(x_low|low|medium|high)$/);
      expect(character.voiceMB).toBeGreaterThan(0);
    }
  });

  it("gives the two worlds different characters", () => {
    expect(BRANDING.mechanical.character.name).not.toBe(BRANDING.biological.character.name);
    expect(BRANDING.mechanical.character.voiceId).not.toBe(
      BRANDING.biological.character.voiceId,
    );
  });
});

describe("walking the tour with its own snippets", () => {
  /** Apply every insert the Workshop tour offers, in order, from the seed. */
  function walk(): string[] {
    let source = TOUR_SEED;
    const stages = [source];
    for (const step of WORKSHOP_TOUR) {
      if (!step.insert) continue;
      source = applySnippet(source, step.insert);
      stages.push(source);
    }
    return stages;
  }

  it("compiles at every stage", () => {
    // Somebody following the tour exactly must never reach a script that does
    // not run. Every intermediate state is a state a real player sits in.
    walk().forEach((source, i) => {
      const result = checkScript(source);
      expect(result.ok ? null : `stage ${i}: ${result.error?.message}`).toBe(null);
    });
  });

  it("compiles at every stage in both worlds", () => {
    for (const [i, source] of walk().entries()) {
      for (const theme of THEMES) {
        const result = checkScript(translate(source, theme));
        expect(result.ok ? null : `stage ${i} ${theme}: ${result.error?.message}`).toBe(null);
      }
    }
  });

  it("never leaves two handlers for the same event", () => {
    // The second combat snippet rewrites the first rather than adding to it;
    // duplicating `on sense robot` would be a compile error in the player's
    // face, which is exactly what `replaces` exists to prevent.
    for (const source of walk()) {
      const senses = source.match(/^on sense robot$/gm) ?? [];
      expect(senses.length).toBeLessThanOrEqual(1);
    }
  });

  it("ends up behaving exactly like the robot a skipper is handed", () => {
    // The two paths through onboarding have to converge, or the tour teaches
    // one robot while the skip button hands over another.
    //
    // Compared by running them rather than by reading them: the walked script
    // ends up with its handlers in a different order and without the comments,
    // neither of which the simulation cares about. Identical final hashes
    // against a real opponent is the strongest statement available that these
    // are the same robot.
    const walked = walk().at(-1)!;
    for (const seed of [1, 2, 3, 4, 5]) {
      const a = runMatch(makeManifest([{ source: walked }, { source: HUNTER }], { seed }));
      const b = runMatch(makeManifest([{ source: TOUR_ROBOT }, { source: HUNTER }], { seed }));
      expect(a.finalHash, `seed ${seed}`).toBe(b.finalHash);
    }
  });
});

describe("applySnippet", () => {
  const base = 'name "T"\nchassis tank\n\non start\n  drive forward 10\nend\n';

  it("appends when nothing is being replaced", () => {
    const out = applySnippet(base, { label: "x", snippet: "\non tick\n  fire 1\nend\n" });
    expect(out).toContain("on start");
    expect(out).toContain("on tick");
  });

  it("replaces a named handler in place", () => {
    const withSense = base + "\non sense robot\n  fire 1\nend\n";
    const out = applySnippet(withSense, {
      label: "x",
      snippet: "on sense robot\n  fire 3\nend",
      replaces: "sense robot",
    });
    expect(out).toContain("fire 3");
    expect(out).not.toContain("fire 1");
    expect(out.match(/on sense robot/g)).toHaveLength(1);
    expect(checkScript(out).ok).toBe(true);
  });

  it("falls back to appending when the handler is not there to replace", () => {
    // The player may have deleted or renamed it. Appending still gives them a
    // working script, which is better than silently doing nothing.
    const out = applySnippet(base, {
      label: "x",
      snippet: "on sense robot\n  fire 3\nend",
      replaces: "sense robot",
    });
    expect(checkScript(out).ok).toBe(true);
    expect(out).toContain("on sense robot");
  });

  it("keeps handlers that come after the one it replaces", () => {
    const withBoth =
      base + "\non sense robot\n  fire 1\nend\n\non hit wall\n  turn body by 90\nend\n";
    const out = applySnippet(withBoth, {
      label: "x",
      snippet: "on sense robot\n  fire 3\nend",
      replaces: "sense robot",
    });
    expect(out).toContain("on hit wall");
    expect(checkScript(out).ok).toBe(true);
  });
});

describe("the difficulty arc", () => {
  /**
   * The tour's whole claim, checked against the simulation.
   *
   * The arc is: beat a Sitting Duck once you can shoot, then meet the Hunter
   * and find that shooting is not enough. If the middle robot quietly starts
   * beating the Hunter, or the finished one stops, the tour is telling people
   * something that is no longer true — and nothing else in this suite would
   * notice. Deterministic: fixed seed base, fixed trial count.
   */
  const stage = (id: string) => {
    let source = TOUR_SEED;
    for (const step of WORKSHOP_TOUR) {
      if (step.insert) source = applySnippet(source, step.insert);
      if (step.id === id) break;
    }
    return source;
  };

  const rate = (source: string, opponent: string, label: string) =>
    runTrials({
      subject: { label: "subject", source },
      opponents: [{ id: label, label, source: opponent, kind: "arena" }],
      trials: 120,
      seedBase: 4242,
    }).rows[0]!.winRate;

  const mid = stage("arm-it");
  const final = stage("pick-your-range");

  it("lets the first fix beat the Duck", () => {
    expect(rate(mid, SITTING_DUCK, "duck")).toBeGreaterThan(65);
  });

  it("does not let the first fix beat the Hunter", () => {
    // If this ever passes 50 the tour is walking people into a fight they win,
    // then telling them they need to try harder.
    expect(rate(mid, HUNTER, "hunter")).toBeLessThan(50);
  });

  it("lets the second fix beat the Hunter", () => {
    expect(rate(final, HUNTER, "hunter")).toBeGreaterThan(50);
  });

  it("makes the second fix a real improvement, not noise", () => {
    expect(rate(final, HUNTER, "hunter") - rate(mid, HUNTER, "hunter")).toBeGreaterThan(8);
  });

  it("keeps the finished robot good against the Duck", () => {
    expect(rate(TOUR_ROBOT, SITTING_DUCK, "duck")).toBeGreaterThan(65);
  });
});
