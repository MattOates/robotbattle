/**
 * The lessons themselves.
 *
 * Two things are checked, and both exist because a tutorial that is subtly
 * wrong is worse than no tutorial:
 *
 *  - every example compiles, in both worlds, to the same program
 *  - shared prose never uses a word that only reads correctly in one world
 */

import { describe, expect, it } from "vitest";
import { compile } from "../../src/lang/compiler.js";
import { parse } from "../../src/lang/parser.js";
import { programIdentity } from "../../src/lang/bytecode.js";
import { translate } from "../../src/learn/translate.js";
import { findBareVocab } from "../../src/learn/lint.js";
import {
  CODE_LANGS,
  extractCode,
  loadLessons,
  selectWorld,
  SECTION_ORDER,
} from "../../src/learn/markdown.js";
import { SAMPLE_BOTS } from "../../src/bots/index.js";
import { RADAR, SENSE } from "../../src/sim/types.js";

const lessons = loadLessons();

describe("the lesson files", () => {
  it("finds some", () => {
    expect(lessons.length).toBeGreaterThan(0);
  });

  it("quotes the simulation's real numbers", () => {
    /**
     * Prose drifts silently. The sensing lesson spent a release telling people
     * their cone reached 320 steps when the simulation had already cut it, and
     * nothing anywhere noticed — so the figures a lesson states outright are
     * held against the constants they describe.
     */
    const radar = lessons.find((l) => l.id === "radar");
    expect(radar, "the radar lesson").toBeDefined();
    expect(radar!.body, `the cone's range (${SENSE.range})`).toContain(`${SENSE.range} steps`);
    expect(radar!.body, `the beam's range (${RADAR.range})`).toContain(`${RADAR.range} steps`);
    expect(radar!.body).toContain(`${SENSE.halfAngle}° either side`);
    expect(radar!.body).toContain(`${RADAR.halfAngle}° either side`);

    // And no lesson may quote a range the simulation has moved on from.
    for (const lesson of lessons) {
      for (const stale of [320, 260, 780]) {
        expect(lesson.body, `${lesson.id} quotes an old range`).not.toContain(`${stale} steps`);
      }
    }
  });

  it("gives every lesson a title and a known section", () => {
    for (const lesson of lessons) {
      expect(lesson.title, lesson.id).toBeTruthy();
      expect(SECTION_ORDER, lesson.id).toContain(lesson.section);
    }
  });

  it("uses a unique id and ordering within each section", () => {
    const seen = new Set<string>();
    for (const lesson of lessons) {
      const key = `${lesson.section}#${lesson.order}`;
      expect(seen.has(key), `two lessons share ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("closes every :::bot / :::bio block", () => {
    for (const lesson of lessons) {
      expect(() => selectWorld(lesson.body, "mechanical", lesson.id)).not.toThrow();
      expect(() => selectWorld(lesson.body, "biological", lesson.id)).not.toThrow();
    }
  });
});

describe("every example compiles, in both worlds", () => {
  const blocks = lessons.flatMap((lesson) =>
    extractCode(lesson.body)
      .filter((block) => CODE_LANGS.has(block.info.lang))
      .map((block, index) => ({ id: `${lesson.id} block ${index + 1}`, ...block })),
  );

  it("finds some", () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it.each(blocks.map((b) => [b.id, b.code] as const))("%s", (_id, code) => {
    const bot = translate(code, "mechanical");
    const bio = translate(code, "biological");
    // A `robo` snippet can be a fragment rather than a whole robot, so only
    // whole programs are compiled; fragments still have to translate cleanly.
    if (!/^\s*(name|chassis|color|on|var)\b/m.test(code)) {
      expect(bio.length).toBeGreaterThan(0);
      return;
    }
    expect(() => compile(parse(bot))).not.toThrow();
    expect(() => compile(parse(bio))).not.toThrow();
    // The real guarantee: translating cannot change what the program does.
    expect(programIdentity(compile(parse(bio)))).toBe(programIdentity(compile(parse(bot))));
  });

  it("names only opponents that exist", () => {
    const known = new Set(SAMPLE_BOTS.map((b) => b.id));
    for (const block of blocks) {
      for (const id of (block.info.params["opponents"] ?? "").split(",").filter(Boolean)) {
        expect(known, `${block.id} names an unknown opponent`).toContain(id);
      }
    }
  });
});

describe("shared prose reads correctly in both worlds", () => {
  it.each(lessons.map((l) => [l.id, l.body] as const))(
    "%s uses placeholders rather than bare words",
    (_id, body) => {
      const warnings = findBareVocab(body);
      // Reported in full, because "line 12 says robot" is the whole fix.
      expect(warnings.map((w) => `line ${w.line}: "${w.word}" in — ${w.text}`)).toEqual([]);
    },
  );
});
