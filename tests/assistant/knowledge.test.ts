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
import {
  briefCard,
  languageCard,
  retrieve,
  retrieveExample,
  systemPrompt,
  worldFacts,
} from "../../src/assistant/knowledge.js";
import {
  ESSENTIAL_TOOL_DEFS,
  EXPLAINER_TOOL_DEFS,
  exampleCompiles,
  TOOL_DEFS,
} from "../../src/assistant/tools.js";
import { tokenize } from "../../src/lang/lexer.js";
import { healthPropertyFor, THEMES, type Theme } from "../../src/lang/vocab.js";
import { EVENT_NAMES } from "../../src/lang/ast.js";
import { BULLET, SENSE, TICK_RATE } from "../../src/sim/types.js";

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
    // The Tutor's card. Larger than the Guide's on purpose — it is what the
    // extra three and a half gigabytes were downloaded for — but still under
    // half the window, so the script, two quoted lessons and the conversation
    // all still fit beside it.
    expect(approxTokens).toBeLessThan(1900);
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

describe("what the world does, as against what the language says", () => {
  /**
   * Read out of the simulation's own constants, never typed here. A number
   * written down would be true until somebody retuned the balance, and then it
   * would be a lie nobody noticed — and advice about leading a target is only
   * as good as the bullet speed behind it.
   */
  it.each(themes)("quotes the real numbers in the %s world", (theme) => {
    const facts = worldFacts(theme);
    expect(facts).toContain(String(TICK_RATE));
    expect(facts).toContain(String(SENSE.range));
    expect(facts).toContain(String(BULLET.baseSpeed));
  });

  it("moves when the simulation moves", () => {
    // The point of generating it: this is the sentence people ask about most,
    // and it has to follow TICK_RATE rather than a memory of it.
    expect(worldFacts("mechanical")).toContain(`${TICK_RATE} ticks in a second`);
  });

  it("reaches both cards, since both are asked the same questions", () => {
    for (const budget of ["tight", "roomy"] as const) {
      expect(systemPrompt("mechanical", budget)).toContain("How the world works");
    }
  });

  /**
   * The vocabulary rule the rest of the app follows: a microcosm player is
   * never shown a word from the arena. `arena` and `health` come from a
   * different lookup than the rest and were the two that stayed mechanical.
   */
  it("speaks the microcosm's words", () => {
    const facts = worldFacts("biological");
    expect(facts).toContain("microcosm");
    expect(facts).toContain("vitality");
    expect(facts).not.toMatch(/\barena\b/);
    expect(facts).not.toMatch(/\bhealth\b/);
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
  it.each(themes)("keeps the whole %s turn small enough to leave room", (theme) => {
    // Measured against the set the explainer actually sends, which is speech
    // alone on a script that compiles. The ceiling is a budget rather than a
    // cliff — the earlier "it hangs past 1500 tokens" turned out to be Chrome
    // throttling a hidden tab — but the window is 4096 and it still has to
    // hold two quoted lessons and the player's script.
    const total =
      (systemPrompt(theme, "tight").length + JSON.stringify(EXPLAINER_TOOL_DEFS).length) / 4;
    // Raised twice: once for the cadence rules, once for the world facts.
    // Both earn it. Without cadence the only periodic-looking word on the
    // card was `repeat` — a loop that finishes inside one tick — and that is
    // exactly what it reached for when asked about a schedule. Without the
    // world facts the advice is shaped right and numbered by guesswork. A
    // third of the window still leaves the script, two quoted lessons and the
    // answer with room.
    expect(total).toBeLessThan(1300);
  });

  it.each(themes)("is a large cut on the roomy %s prompt, not a trim", (theme) => {
    const roomy = systemPrompt(theme, "roomy").length + JSON.stringify(TOOL_DEFS).length;
    const tight = systemPrompt(theme, "tight").length + JSON.stringify(ESSENTIAL_TOOL_DEFS).length;
    // Still a large cut rather than a trim, though less dramatic now that both
    // cards carry the cadence rules — those are worth their room in either.
    expect(tight * 1.6).toBeLessThan(roomy);
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

describe("quoting an example instead of writing one", () => {
  /**
   * The reason this is worth doing at all: every example in every lesson is
   * compiled by tests/learn/content.test.ts, in both worlds, on every run. So
   * a quotation cannot be the invented command or one-line `if` a small model
   * produces when asked to compose. It is somebody else's answer to a
   * neighbouring question, which beats a confident wrong one.
   */
  it.each(themes)("finds a real %s example and says where it came from", (theme) => {
    const quote = retrieveExample("how do I turn", theme);
    expect(quote).not.toBeNull();
    expect(quote!.code).toContain("turn");
    expect(quote!.from.length).toBeGreaterThan(0);
  });

  it.each(themes)("quotes %s code that actually compiles", (theme) => {
    for (const q of ["how do I turn", "fire at a robot", "sweep the radar"]) {
      const quote = retrieveExample(q, theme);
      if (quote) expect(exampleCompiles(quote.code).ok, `${q}: ${quote.code}`).toBe(true);
    }
  });

  /**
   * The chapter counts as well as the code. Nobody asking how to "shoot" will
   * find that word in an example that says `fire` — but the lesson it sits in
   * is called "Shooting", and that is the connection being made.
   */
  it("finds an example through the name of its lesson", () => {
    expect(retrieveExample("how do I shoot at an enemy?", "mechanical")?.from).toBe("Shooting");
  });

  /**
   * People ask about bullets and hills; the lessons say bullet and hill. One
   * trailing `s` was the whole difference between finding the right chapter
   * and finding nothing at all.
   */
  it.each([
    ["dodge bullets", "Reacting"],
    ["avoid hills", "There and back again"],
    ["walls", "Walls and edges"],
  ])("matches %s despite the plural", (question, lesson) => {
    expect(retrieveExample(question, "mechanical")?.from).toBe(lesson);
  });

  it("has nothing to quote for a question with no subject", () => {
    expect(retrieveExample("what about it?", "mechanical")).toBeNull();
  });
});
