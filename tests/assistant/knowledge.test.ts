/**
 * The language card.
 *
 * The card is the assistant's whole knowledge of RoboScript, and it is
 * *generated* from the parser's own tables precisely so that it cannot drift
 * from the language. That claim is only worth anything if something checks it,
 * which is what the second test here does: every RoboScript word the card names
 * has to be a word the real lexer accepts. Add an event, rename a property, and
 * the card follows along or this fails.
 */

import { describe, expect, it } from "vitest";
import { briefCard, languageCard, retrieve, systemPrompt } from "../../src/assistant/knowledge.js";
import { ESSENTIAL_TOOL_DEFS, TOOL_DEFS } from "../../src/assistant/tools.js";
import { tokenize } from "../../src/lang/lexer.js";
import { healthPropertyFor, THEMES, type Theme } from "../../src/lang/vocab.js";
import { EVENT_NAMES } from "../../src/lang/ast.js";

const themes = Object.keys(THEMES) as Theme[];

describe("the language card", () => {
  it.each(themes)("describes the language in the %s world", (theme) => {
    const card = languageCard(theme);
    expect(card).toContain("on start");
    expect(card).toContain("arena.width");
    // Themed, so the card must offer `me.vitality` to a biological player
    // rather than a word their completion popup would never suggest.
    expect(card).toContain(`me.${healthPropertyFor(theme)}`);
  });

  it.each(themes)("is spelled in the %s vocabulary", (theme) => {
    const card = languageCard(theme);
    const word = theme === "biological" ? "swim" : "drive";
    expect(card).toContain(word);
  });

  /**
   * The budget matters as much as the content. Every model that can do tool
   * calling here has a 4096 token context window, which also has to hold the
   * tool definitions, the player's script and the conversation. If the card
   * grows past roughly a third of the window there is no room left to work in.
   */
  it.each(themes)("fits the %s card in its share of the context window", (theme) => {
    const approxTokens = systemPrompt(theme).length / 4;
    expect(approxTokens).toBeLessThan(1600);
  });

  it.each(themes)("only names words the lexer accepts in the %s world", (theme) => {
    const card = languageCard(theme);
    // The bullet lists are the claims about the language; the prose around them
    // is ordinary English and is not being asserted about.
    const claims = card
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).split(" — ")[0]!.trim());

    for (const claim of claims) {
      // A line may list several members at once, e.g. "turret.aim, turret.turn".
      for (const raw of claim.split(",")) {
        const word = raw.trim().replace(/\(\)$/, "");
        if (!word) continue;
        expect(() => tokenize(word), `card names \`${word}\``).not.toThrow();
      }
    }
  });
});

describe("the brief card, for a tight budget", () => {
  /**
   * The reason this exists. An in-browser 7B has a 4096 token window that also
   * has to hold the tool schemas, the player's script and the conversation.
   * The full card and all eight schemas come to about 2150 tokens of that
   * before the player has asked anything, and this class of model has a loose
   * enough grip on the tool schema without being crowded further.
   */
  it.each(themes)("keeps the whole %s turn well under the cliff", (theme) => {
    const total =
      (systemPrompt(theme, "tight").length + JSON.stringify(ESSENTIAL_TOOL_DEFS).length) / 4;
    expect(total).toBeLessThan(800);
  });

  it.each(themes)("is a large cut on the roomy %s prompt, not a trim", (theme) => {
    const roomy = systemPrompt(theme, "roomy").length + JSON.stringify(TOOL_DEFS).length;
    const tight = systemPrompt(theme, "tight").length + JSON.stringify(ESSENTIAL_TOOL_DEFS).length;
    expect(tight * 2).toBeLessThan(roomy);
  });

  /**
   * The cut is by detail, never by coverage. A model missing an event name
   * invents one; a model missing the sentence explaining an event still copies
   * the name correctly.
   */
  it.each(themes)("still names every %s event and property", (theme) => {
    const brief = briefCard(theme);
    for (const name of EVENT_NAMES) expect(brief).toContain(`on ${name}`);
    const full = languageCard(theme);
    for (const prop of full.match(/\bme\.\w+/g) ?? []) expect(brief).toContain(prop);
  });

  it.each(themes)("only names words the lexer accepts in the %s world", (theme) => {
    for (const word of briefCard(theme).match(/\b[a-z]+\.[a-z]+\b/gi) ?? []) {
      expect(() => tokenize(word), `brief card names \`${word}\``).not.toThrow();
    }
  });
});

describe("lesson retrieval", () => {
  it("finds the chapter that matches the question", () => {
    const [snippet] = retrieve("how do I turn my robot around?", "mechanical");
    expect(snippet).toBeDefined();
    expect(snippet!.toLowerCase()).toContain("turn");
  });

  it("returns nothing when the question has no content words", () => {
    expect(retrieve("what about it?", "mechanical")).toEqual([]);
  });

  it("stays inside its budget, which is the only reason it fits", () => {
    for (const q of ["how do I turn", "radar ping wall", "fuel terrain slope"]) {
      for (const snippet of retrieve(q, "mechanical")) {
        expect(snippet.length).toBeLessThan(2600);
      }
    }
  });

  /**
   * Taking the opening of a chapter was the obvious thing and quietly the
   * wrong one — lessons open with scene-setting, so a narrow question got four
   * paragraphs about what a robot is. With no ability to look anything up for
   * itself, what the assistant can say is almost entirely what it was handed.
   */
  it("quotes the part of the lesson that is about the question", () => {
    const [snippet] = retrieve("what does gunHeat mean and when can I fire?", "mechanical");
    expect(snippet).toBeDefined();
    expect(snippet!.toLowerCase()).toMatch(/gunheat|cool/);
  });

  it("offers a second opinion as well as a first", () => {
    // Cheap insurance: the top match is a guess, and there is budget for two.
    expect(retrieve("radar ping wall", "mechanical").length).toBeGreaterThan(1);
  });

  it("marks a quote that starts mid-lesson, so it does not read as the whole", () => {
    const snippets = retrieve("what does gunHeat mean and when can I fire?", "mechanical");
    expect(snippets.some((s) => s.includes("…"))).toBe(true);
  });

  it("leaves no live-editor fences in what it hands the model", () => {
    for (const snippet of retrieve("radar ping wall", "mechanical", 3)) {
      expect(snippet).not.toContain("```try");
    }
  });

  it("resolves the world blocks rather than passing both through", () => {
    for (const snippet of retrieve("fuel terrain slope", "biological", 3)) {
      expect(snippet).not.toContain(":::bot");
      expect(snippet).not.toContain(":::bio");
    }
  });
});
