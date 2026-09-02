import { describe, expect, it } from "vitest";
import { checkScript } from "../../src/sim/world.js";
import { scriptRuns } from "../../src/ui/ScriptStatus.js";
import { SAMPLE_BOTS, TOUR_ROBOT, TOUR_SEED } from "../../src/bots/index.js";

/**
 * The status line is JSX and there is no jsdom here, so what is tested is the
 * thing it decides: whether a script runs. The dead end it exists to fix was
 * not a wording problem — a broken script disabled Start, and at the simple
 * register there is no editor tab, so there was nowhere for the message to
 * appear and nothing to press.
 */
describe("whether a robot will run", () => {
  it("agrees with the compiler", () => {
    for (const { id, source } of [
      ...SAMPLE_BOTS.map((b) => ({ id: b.id, source: b.source })),
      { id: "seed", source: TOUR_SEED },
      { id: "tour", source: TOUR_ROBOT },
    ]) {
      expect(scriptRuns(source), id).toBe(checkScript(source).ok);
      expect(scriptRuns(source), id).toBe(true);
    }
  });

  it("says no to a script that does not compile", () => {
    expect(scriptRuns('name "X"\nchassis tank\n\non start\n  drive sideways 3\nend')).toBe(false);
  });

  /**
   * The failures a card- or block-built robot can actually have.
   *
   * Cards and blocks cannot assemble something invalid — that is tested in
   * `compose.test.ts` — so a broken script at this register came in from
   * somewhere: a traded robot, or a raw block somebody was handed. Those are
   * exactly the cases where the reader cannot see a line number and needs a
   * way through to the code.
   */
  it("still reports the problem for a script full of hand-written code", () => {
    const traded = 'name "T"\nchassis tank\n\non start\n  do somethingNobodyDefined\nend';
    const result = checkScript(traded);
    expect(result.ok).toBe(false);
    expect(result.error?.message.length).toBeGreaterThan(0);
  });

  it("carries a hint on the failures that have one", () => {
    // The compiler's own wording is kept rather than reworded — it is already
    // first person, plain, and in the author's own spelling.
    const missing = checkScript('name "X"\nchassis tank\n\non start\n  set seen\nend');
    expect(missing.ok).toBe(false);
    expect(missing.error?.message).toContain("set seen");
    expect(missing.error?.hint).toContain("=");
  });
});
