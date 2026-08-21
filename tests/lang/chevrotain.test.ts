/**
 * The new parser against the old one, on every program this repository has.
 *
 * Not "does it parse" but "does it compile to the same bytecode", because
 * `tests/determinism/golden.test.ts` hashes a whole match and peers on
 * different builds have to agree exactly. A difference here is not a wrong
 * answer, it is a desync mid-battle, and this is the only place it shows up
 * before somebody is playing.
 */

import { describe, expect, it } from "vitest";
import { parse as handWritten } from "../../src/lang/parser.js";
import { parseWithChevrotain } from "../../src/lang/build-ast.js";
import { compile } from "../../src/lang/compiler.js";
import type { RoboScriptError } from "../../src/lang/errors.js";
import { programIdentity } from "../../src/lang/bytecode.js";
import { SAMPLE_BOTS } from "../../src/bots/index.js";
import { extractCode, loadLessons, selectWorld, fillVocab, CODE_LANGS } from "../../src/learn/markdown.js";
import { THEMES, type Theme } from "../../src/lang/vocab.js";

const identical = (source: string): void => {
  expect(programIdentity(compile(parseWithChevrotain(source)))).toBe(
    programIdentity(compile(handWritten(source))),
  );
};

describe("the sample robots", () => {
  it.each(SAMPLE_BOTS.map((b) => [b.title, b.source] as const))(
    "%s compiles identically",
    (_title, source) => identical(source),
  );
});

describe("every example in every lesson, in both worlds", () => {
  /**
   * The widest corpus available, and the one that covers the corners the
   * sample robots do not — `wait`, `repeat`, `given`, cadence clauses, `do`
   * with arguments.
   */
  const cases: [string, string][] = [];
  for (const theme of Object.keys(THEMES) as Theme[]) {
    for (const lesson of loadLessons()) {
      const body = fillVocab(selectWorld(lesson.body, theme, lesson.id), theme);
      extractCode(body).forEach(({ info, code }, i) => {
        if (CODE_LANGS.has(info.lang) && code.trim()) {
          cases.push([`${lesson.id} #${i} (${theme})`, code]);
        }
      });
    }
  }

  it.each(cases)("%s", (_name, source) => {
    // Some lesson snippets are fragments the real parser also rejects; only
    // compare the ones that are whole programs.
    let expected: string;
    try {
      expected = programIdentity(compile(handWritten(source)));
    } catch {
      return;
    }
    expect(programIdentity(compile(parseWithChevrotain(source)))).toBe(expected);
  });
});

describe("the corners a corpus might miss", () => {
  const H = 'name "x"\nchassis tank\n';
  it.each([
    ["reversing negates its argument", `${H}on tick\n  drive back 40\nend\n`],
    ["left association", `${H}on tick\n  turn by 100 - 20 - 5\nend\n`],
    ["precedence", `${H}on tick\n  turn by 2 + 3 * 4 mod 5\nend\n`],
    ["a bare fire gains its default", `${H}on tick\n  fire\nend\n`],
    ["comparison folding", `${H}var x = 0\non tick\n  if x is not 1\n    stop\n  end\nend\n`],
    ["a lone = reads as is", `${H}var x = 0\non tick\n  if x = 1\n    stop\n  end\nend\n`],
    ["else if chains", `${H}var x = 0\non tick\n  if x is 1\n    stop\n  else if x is 2\n    fire 1\n  else\n    fire 2\n  end\nend\n`],
    ["cadence clauses", `${H}on tick every 5 after 10\n  stop\nend\n`],
    ["at, on its own", `${H}on hit by bullet at 3\n  stop\nend\n`],
    ["routines with defaults", `${H}can shove with power=2\n  fire power\nend\non tick\n  do shove with 3\nend\n`],
    ["given, and cadence together", `${H}can rally given hit wall after 2\n  turn chassis by 150\nend\n`],
    ["calls and properties", `${H}var x = 0\non tick\n  set x = distance(me.x, me.y, arena.width, 0)\nend\n`],
    ["waiting", `${H}on start\n  wait 15 ticks\n  stop\nend\n`],
    ["break with a condition", `${H}on tick\n  loop\n    break if me.gunHeat is 0\n  end\nend\n`],
    ["nested unary minus", `${H}var x = 0\non tick\n  set x = -(3 - 5)\nend\n`],
    ["the radar's four members", `${H}on tick\n  radar.aim at 0\n  radar.turn by 5\n  radar.sweep 60\n  radar.ping\nend\n`],
    ["turret.fire, which takes nothing", `${H}on tick\n  turret.fire\nend\n`],
  ])("%s", (_what, source) => identical(source));
});

describe("and refuses the same programs, in the same words", () => {
  /**
   * Agreeing on what compiles is only half of it. The reason `parser.ts` was
   * hand-written in the first place was the quality of its refusals, so the new
   * front end has to reproduce them to the letter — and the cadence rules in
   * particular, which are checked after parsing and so are the easiest thing to
   * leave behind when the parsing moves.
   */
  const H = 'name "x"\nchassis tank\n';
  const message = (e: unknown) => (e as RoboScriptError).message;
  const hint = (e: unknown) => (e as RoboScriptError).hint;

  it.each([
    ["the same clause twice", `${H}on tick every 2 every 3\n  stop\nend\n`],
    ["a clause that is not a number", `${H}on tick every me\n  stop\nend\n`],
    ["a fractional count", `${H}on tick every 2.5\n  stop\nend\n`],
    ["a count of zero", `${H}on tick every 0\n  stop\nend\n`],
    ["`at` beside anything else", `${H}on tick at 3 every 2\n  stop\nend\n`],
    ["no room between after and before", `${H}on tick after 9 before 10\n  stop\nend\n`],
    ["a cadence that never comes round", `${H}on tick every 20 before 10\n  stop\nend\n`],
    ["the same, counting from `after`", `${H}on tick after 5 every 20 before 10\n  stop\nend\n`],
    ["a routine repeating a clause", `${H}can go after 1 after 2\n  stop\nend\n`],
  ])("%s", (_what, source) => {
    let expected: unknown;
    expect(() => {
      try {
        handWritten(source);
      } catch (e) {
        expected = e;
        throw e;
      }
    }).toThrow();

    let actual: unknown;
    expect(() => {
      try {
        parseWithChevrotain(source);
      } catch (e) {
        actual = e;
        throw e;
      }
    }).toThrow();

    expect([message(actual), hint(actual)]).toEqual([message(expected), hint(expected)]);
  });
});
