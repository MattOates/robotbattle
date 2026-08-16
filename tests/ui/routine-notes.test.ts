/**
 * The note the editor prints at the end of a `can` line.
 *
 * Whether a block runs by itself is decided by the rest of the file, so the
 * line cannot say — and the difference between a block that runs and one that
 * sits there doing nothing is otherwise invisible. That makes this note the
 * only answer a reader gets, which makes it worth testing on its own.
 */

import { describe, expect, it } from "vitest";
import { completionKeepsGoing, routineNote, routinesIn } from "../../src/lang/complete.js";

/** Every `can` line's note, keyed by block name. */
function notes(source: string, theme: "mechanical" | "biological" = "mechanical") {
  const { routines, handled } = routinesIn(source);
  return Object.fromEntries(routines.map((r) => [r.name, routineNote(r, handled, theme)]));
}

describe("reading a script", () => {
  it("says when a block becomes the handler", () => {
    expect(notes("can dodge given hit by bullet\n  stop\nend\n")).toEqual({
      dodge: "runs on hit by bullet",
    });
  });

  it("says when a handler written out has taken over", () => {
    const source = `can dodge given hit by bullet
  stop
end

on hit by bullet
  stop
end
`;
    expect(notes(source)).toEqual({ dodge: "your `on hit by bullet` runs instead" });
  });

  it("says when a block cannot run alone because it needs something", () => {
    expect(notes("can shove with effort given hit by bullet\n  fire effort\nend\n")).toEqual({
      shove: "needs effort — run it with `do`",
    });
  });

  it("counts a starting value as enough to run alone", () => {
    expect(notes("can shove with effort=2 given hit by bullet\n  fire effort\nend\n")).toEqual({
      shove: "runs on hit by bullet",
    });
  });

  it("says nothing at all about a block with no event", () => {
    // There is only one thing such a block could possibly do, so a note saying
    // so is furniture — and furniture at the end of the line you are typing.
    expect(notes("can regroup\n  stop\nend\n")).toEqual({ regroup: "" });
  });

  it("speaks the reader's vocabulary", () => {
    expect(notes("can dodge given hit by bullet\n  stop\nend\n", "biological")).toEqual({
      dodge: "runs on stung",
    });
  });
});

describe("how often a block runs", () => {
  it("says the cadence, because the line alone reads as 'every time'", () => {
    expect(notes("can sweep given tick every 30\n  stop\nend\n")).toEqual({
      sweep: "runs on tick, one in 30",
    });
  });

  it("says all of it when the clauses are combined", () => {
    expect(notes("can sweep given tick every 30 after 90 before 900\n  stop\nend\n")).toEqual({
      sweep: "runs on tick, after 90, then one in 30, before 900",
    });
  });

  it("says it for a block with no event, which otherwise has no note", () => {
    expect(notes("can rare every 10\n  stop\nend\n")).toEqual({ rare: "one in 10" });
  });

  it("still gives way to a handler written out", () => {
    const source = "can sweep given tick every 30\n  stop\nend\n\non tick\n  stop\nend\n";
    expect(notes(source)).toEqual({ sweep: "your `on tick` runs instead" });
  });
});

describe("accepting a suggestion", () => {
  it("leaves a space after a word that must be followed by another", () => {
    // Without this, accepting `given` and typing the event gives `givensense`.
    for (const word of ["can", "do", "given", "with", "on", "set", "var"]) {
      expect(completionKeepsGoing(word), word).toBe(true);
    }
  });

  it("leaves none after a word that finishes an instruction", () => {
    for (const word of ["end", "break", "continue", "stop", "fire", "else"]) {
      expect(completionKeepsGoing(word), word).toBe(false);
    }
  });
});

describe("reading a script that is still being typed", () => {
  it("does not fall over on a half-written line", () => {
    expect(() => routinesIn("can \ncan dodge given \non \n")).not.toThrow();
  });

  it("picks out parameters and their starting values", () => {
    const { routines } = routinesIn(
      "can shove with effort=2, angle given sense robot\n  stop\nend\n",
    );
    expect(routines[0]).toMatchObject({
      name: "shove",
      params: ["effort", "angle"],
      given: "sense robot",
      runsAlone: false,
    });
  });

  it("notices handlers written in either vocabulary", () => {
    // `stung` is one word for a three-word event, so the scan has to
    // canonicalise before deciding a handler exists.
    const source = "can dodge given hit by bullet\n  stop\nend\n\non stung\n  stop\nend\n";
    expect(notes(source)).toEqual({ dodge: "your `on hit by bullet` runs instead" });
  });
});

describe("ordinals in the note", () => {
  const only = (n: number) => routinesIn(`can x given tick at ${n}\n  stop\nend\n`).routines[0]!;
  const note = (n: number) => routineNote(only(n), new Set(), "mechanical");

  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [101, "101st"],
    [111, "111th"],
  ])("says %i as the %s", (n, expected) => {
    expect(note(n)).toBe(`runs on tick, only the ${expected}`);
  });
});
