/**
 * The editor has to recognise every word the language does.
 *
 * Highlighting keeps its own tables — it works off a tolerant scanner rather
 * than the parser, so a half-typed line still colours sensibly — and that means
 * the two can drift. When they do, the symptom is quiet: a brand new
 * instruction renders in the colour of somebody's variable, and looks like a
 * typo to the one person least able to tell.
 *
 * So this holds the highlighter against the parser's own reserved list, and
 * against the synonym table, in both worlds.
 */

import { describe, expect, it } from "vitest";
import { styleFor } from "../../src/ui/roboscript-editor.js";
import { RESERVED } from "../../src/lang/parser.js";
import { scanLine } from "../../src/lang/scan.js";
import { SYNONYMS } from "../../src/lang/vocab.js";
import { EVENT_NAMES } from "../../src/lang/ast.js";
import { wordsIn } from "../../src/lang/reference.js";

/** The style the editor would paint a word, given what came before it. */
function styleOf(line: string, index = 0): string | null {
  const tokens = scanLine(line);
  const token = tokens[index];
  if (!token) throw new Error(`no token ${index} in ${JSON.stringify(line)}`);
  return styleFor(token, tokens[index - 1]);
}

describe("every word the language reserves", () => {
  it("is recognised as something other than a variable", () => {
    const unknown = [...RESERVED].filter((word) => {
      const style = styleOf(word);
      return style === "variableName" || style === null;
    });
    expect(unknown, "reserved words the highlighter does not know").toEqual([]);
  });
});

/**
 * Reserved words are not the whole language, and the gap is where this test
 * failed to earn its keep.
 *
 * An event name is spelled out of ordinary identifiers on purpose — `fuel`,
 * `slope`, `ridge` and `radio` are all events, and all of them are still legal
 * variable names, so none of them appear in `RESERVED`. The check above
 * therefore could not see them, and every one of them shipped rendering as
 * somebody's variable: `fuel` and `slope` since terrain arrived, `radio` from
 * the day it was added.
 *
 * So the events are held against the highlighter directly, from the one list
 * that knows an event exists.
 */
describe("every word an event is spelled with", () => {
  const eventWords = [...new Set(EVENT_NAMES.flatMap((name) => name.split(" ")))];

  /**
   * `by` reads as a modifier rather than an event word, and deliberately: it
   * appears in `hit by bullet`, but `turn by 90` is far and away the commoner
   * sight, and one token is all the scanner has to go on. It still has to be
   * *known* — which is what the second test below checks for every word.
   */
  const spelledAsEvents = eventWords.filter((w) => w !== "by");

  it.each(spelledAsEvents)("`%s` reads as an event word after `on`", (word) => {
    expect(styleOf(`on ${word}`, 1)).toBe("eventWord");
  });

  it.each(eventWords)("`%s` is recognised as something other than a variable", (word) => {
    const style = styleOf(`on ${word}`, 1);
    expect(style).not.toBe("variableName");
    expect(style).not.toBeNull();
  });

  it("covers the events that are not reserved words at all", () => {
    // Guards the guard: if these ever became keywords, the test above would be
    // subsumed by the reserved-word one and this file would be checking
    // nothing new.
    const unreserved = eventWords.filter((w) => !RESERVED.has(w));
    expect(unreserved.length).toBeGreaterThan(0);
    expect(unreserved).toContain("radio");
  });
});

/**
 * The same hole on the instruction side. `broadcast` shipped uncoloured because
 * adding an action meant editing a list in the editor that nothing pointed at.
 */
describe("every word an action is spelled with", () => {
  const actionWords = [...wordsIn("actions")].filter((w) => /^[a-z]+$/.test(w));

  it.each(actionWords)("`%s` is recognised as something other than a variable", (word) => {
    const style = styleOf(word);
    expect(style).not.toBe("variableName");
    expect(style).not.toBeNull();
  });
});

describe("the radar", () => {
  it("reads as an instruction, like the turret does", () => {
    expect(styleOf("radar.sweep 60")).toBe("action");
    expect(styleOf("turret.sweep 60")).toBe("action");
    expect(styleOf("ping")).toBe("action");
  });

  it("reads as an event after `on`, like sensing does", () => {
    // `on ping robot` is naming an event, not issuing an instruction, and the
    // colour should say so.
    expect(styleOf("on ping robot", 1)).toBe("eventWord");
    expect(styleOf("on sense robot", 1)).toBe("eventWord");
    expect(styleOf("on ping wall", 2)).toBe("eventWord");
  });

  it("styles what follows a dot as a property", () => {
    expect(styleOf("radar.aim at 0", 2)).toBe("propertyName");
    expect(styleOf("me.pingHeat", 2)).toBe("propertyName");
  });
});

describe("both vocabularies", () => {
  it("paints a synonym exactly like the word it stands for", () => {
    // The whole point of classifying by canonical form: an eyespot is a radar,
    // and a peek is a ping, so they had better be the same colour.
    for (const synonym of SYNONYMS) {
      const mechanical = styleOf(synonym.mechanical);
      const biological = styleOf(synonym.biological);
      expect(biological, `${synonym.biological} vs ${synonym.mechanical}`).toBe(mechanical);
    }
  });

  it("knows the biological spellings of the new instrument", () => {
    expect(styleOf("eyespot.sweep 60")).toBe("action");
    expect(styleOf("peek")).toBe("action");
    expect(styleOf("on peek organism", 1)).toBe("eventWord");
  });
});
