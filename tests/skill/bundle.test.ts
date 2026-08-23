/**
 * The published skill, held against the language it claims to describe.
 *
 * This file matters more than most. Everything else in the repo is checked by
 * somebody running the game; the skill is read by a model, somewhere else,
 * with no way to tell a stale claim from a true one. A wrong sentence here does
 * not fail visibly — it produces a confident robot that will not compile, and
 * the person asking has no idea why.
 *
 * So: every example in it is compiled, every event and function is checked to
 * be present, and the one hand-written section is held against the compiler
 * that decides whether it is telling the truth.
 */

import { describe, expect, it } from "vitest";
import { skillBundle, SKILL_HOME } from "../../src/skill/bundle.js";
import { checkScript } from "../../src/sim/world.js";
import { parse } from "../../src/lang/parser.js";
import { tokenize } from "../../src/lang/lexer.js";
import { EVENT_NAMES } from "../../src/lang/ast.js";
import { BUILTINS } from "../../src/lang/builtins.js";
import { SAMPLE_BOTS } from "../../src/bots/index.js";

const files = skillBundle();
const byPath = new Map(files.map((f) => [f.path, f.text]));
const get = (path: string) => byPath.get(path) ?? "";

/** Every fenced RoboScript program in the bundle, with where it came from. */
function programs(): Array<{ file: string; index: number; code: string }> {
  const out: Array<{ file: string; index: number; code: string }> = [];
  for (const file of files) {
    const fences = file.text.matchAll(/```roboscript\n([\s\S]*?)```/g);
    let index = 0;
    for (const m of fences) out.push({ file: file.path, index: index++, code: m[1]! });
  }
  return out;
}

describe("the bundle exists and is shaped like a skill", () => {
  it("ships the files the two audiences need", () => {
    expect([...byPath.keys()].sort()).toEqual([
      "SKILL.md",
      "examples.md",
      "llms.txt",
      "reference.md",
      "roboscript.md",
    ]);
  });

  it("opens SKILL.md with the frontmatter a skill is found by", () => {
    const card = get("SKILL.md");
    expect(card.startsWith("---\n")).toBe(true);
    expect(card).toMatch(/^name: [a-z0-9-]+$/m);
    // The description is what decides whether a model reaches for this at all,
    // so it has to name the things somebody would actually say.
    const description = /^description: (.+)$/m.exec(card)?.[1] ?? "";
    expect(description.length).toBeGreaterThan(80);
    expect(description).toContain("RoboScript");
  });

  it("keeps the always-loaded card small", () => {
    // The point of the split: a model deciding whether `wait` exists should not
    // have to read fourteen robots to find out. If this creeps up, something
    // that belongs in the reference has been put in the card.
    expect(get("SKILL.md").length / 4).toBeLessThan(1400);
  });

  it("points at somewhere that exists", () => {
    expect(get("llms.txt")).toContain(SKILL_HOME);
    for (const f of files) expect(f.text).not.toContain("{robot}");
  });
});

describe("everything it shows compiles", () => {
  const found = programs();

  it("finds the examples at all", () => {
    // Guards the guard: a regex that matched nothing would make every test
    // below pass by vacuum.
    expect(found.length).toBeGreaterThanOrEqual(SAMPLE_BOTS.length);
  });

  it.each(found.map((p) => [`${p.file} #${p.index}`, p.code] as const))(
    "%s is a program the compiler accepts",
    (_where, code) => {
      const result = checkScript(code);
      expect(result.ok, result.error?.message).toBe(true);
    },
  );
});

describe("it describes the whole language", () => {
  const reference = get("reference.md");

  it.each(EVENT_NAMES)("names the `%s` event", (event) => {
    expect(reference).toContain(`on ${event}`);
  });

  it.each(Object.keys(BUILTINS))("names the `%s` function", (fn) => {
    expect(reference).toContain(fn);
  });

  it("names only words the lexer accepts", () => {
    // The claim lines are the ones in backticks that look like code. Ordinary
    // prose around them is English and is not being asserted about.
    for (const m of reference.matchAll(/`([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)`/gi)) {
      expect(() => tokenize(m[1]!), `reference names \`${m[1]}\``).not.toThrow();
    }
  });

  it("says the other vocabulary exists without teaching it", () => {
    expect(reference).toContain("biological");
    // Named as a translation table, not used as the language of the document.
    expect(reference).toContain("| mechanical | biological |");
  });
});

/**
 * The hand-written section, checked against the compiler.
 *
 * `HOUSE_RULES` is the one part of the bundle a person wrote, because it is
 * about which mistakes are tempting rather than about what the grammar is —
 * and the grammar cannot generate that. So each claim it makes is asserted
 * here against the thing that decides: if the language ever grows truthiness
 * or an early return, these fail and the advice gets corrected.
 */
describe("the advice it gives is true", () => {
  const HEAD = 'name "x"\nchassis tank\n';
  const rejects = (source: string) => expect(checkScript(HEAD + source).ok).toBe(false);
  const accepts = (source: string) =>
    expect(checkScript(HEAD + source), source).toMatchObject({ ok: true });

  it("is right that a condition must compare two things", () => {
    rejects("on sense robot\n  if event.friend then\n    fire 2\n  end\nend\n");
    accepts("on sense robot\n  if event.friend is false then\n    fire 2\n  end\nend\n");
  });

  it("is right that `break` only works inside a loop", () => {
    rejects("on tick\n  break\nend\n");
    accepts("on tick\n  loop\n    break\n  end\nend\n");
  });

  it("is right that you cannot write two `on tick` blocks", () => {
    rejects("on tick\n  stop\nend\non tick\n  stop\nend\n");
  });

  it("is right that several `can ... given tick` blocks are fine", () => {
    accepts("can a given tick every 2\n  stop\nend\ncan b given tick every 3\n  stop\nend\n");
  });

  it("is right that a `can` block is not a function", () => {
    rejects("can helper\n  stop\nend\non tick\n  var x = helper()\nend\n");
  });

  it("is right that a name and a chassis have defaults", () => {
    // The advice used to say they were required, and this test is why it no
    // longer does: they are not, and a skill that insists on them would have
    // been teaching a rule the compiler does not have.
    expect(checkScript("on tick\n  stop\nend\n").ok).toBe(true);
    expect(parse("on tick\n  stop\nend\n").locomotion).toBe("skid");
  });
});
