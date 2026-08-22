/**
 * The reference describes the language the parser actually implements.
 *
 * The point of generating it is that it cannot drift, and the point of this
 * file is that "cannot drift" is checked rather than hoped for. A rule added to
 * the grammar with no explanation fails here by name, which is the only moment
 * anybody is going to be thinking about what it means.
 */

import { describe, expect, it } from "vitest";
import { parser } from "../../src/lang/grammar.js";
import {
  ANNOTATIONS,
  ruleDocs,
  rulesIn,
  SECTIONS,
  syntaxLine,
  type Syntax,
} from "../../src/lang/reference.js";
import { railroad } from "../../src/ui/railroad.js";
import { EVENT_DOCS } from "../../src/lang/events.js";
import { EVENT_NAMES } from "../../src/lang/ast.js";
import { checkScript } from "../../src/sim/world.js";
import { THEMES, wordFor, type Theme } from "../../src/lang/vocab.js";

describe("every rule is accounted for", () => {
  const names = Object.keys(parser.getGAstProductions());

  it("has an annotation for each of the parser's rules", () => {
    expect(names.filter((n) => !ANNOTATIONS[n])).toEqual([]);
  });

  it("has no annotation for a rule that no longer exists", () => {
    expect(Object.keys(ANNOTATIONS).filter((n) => !names.includes(n))).toEqual([]);
  });

  it("reads a shape for every one of them", () => {
    expect(ruleDocs()).toHaveLength(names.length);
  });

  it("gives every rule a short label, since diagrams show it and not the code's name", () => {
    const unlabelled = Object.entries(ANNOTATIONS).filter(
      ([, a]) => !a.label || a.label.trim() === "" || /[A-Z]/.test(a.label),
    );
    expect(unlabelled.map(([name]) => name)).toEqual([]);
  });

  it("says something about every rule a player will meet", () => {
    const silent = ruleDocs().filter((r) => r.section !== "plumbing" && r.summary.trim() === "");
    expect(silent.map((r) => r.name)).toEqual([]);
  });
});

describe("the sections", () => {
  it("between them cover every rule that is not plumbing", () => {
    const covered = new Set(SECTIONS.map((s) => s.name));
    const orphans = ruleDocs().filter((r) => r.section !== "plumbing" && !covered.has(r.section));
    expect(orphans.map((r) => r.name)).toEqual([]);
  });

  it("are each non-empty, or they would render as a heading over nothing", () => {
    for (const section of SECTIONS) {
      expect(rulesIn(section.name).length, section.name).toBeGreaterThan(0);
    }
  });
});

describe("the examples", () => {
  /**
   * Documentation that does not compile is worse than none: a beginner copies
   * it, it fails, and they conclude they cannot read.
   */
  const withExamples = ruleDocs().filter((r) => r.example);

  it("has some", () => {
    expect(withExamples.length).toBeGreaterThan(10);
  });

  it.each(withExamples.map((r) => [r.name, r.example!] as const))(
    "`%s` shows something that compiles",
    (_name, example) => {
      // Most examples are fragments, and which surroundings make one whole
      // depends on what kind of thing it is — a declaration, a block, an
      // instruction, or a bare value. Rather than encode that per rule, try
      // each reading and accept the example if any of them compiles. What is
      // being asserted is "this is real RoboScript", not "this is a statement".
      const isBlock = /^(on|can) /.test(example);
      const closed = isBlock && !example.includes("\nend") ? `${example}\n  stop\nend` : example;
      const indent = (by: string) => example.split("\n").map((l) => by + l).join("\n");

      // `on sense robot` rather than `on tick` because several examples read
      // `event.`, and a `can shove` because one of them calls it.
      const SCAFFOLD =
        'name "x"\nchassis tank\nvar target = 0\nvar power = 1\n' +
        "can shove with power = 2\n  fire power\nend\n";

      const readings = [
        `name "x"\nchassis tank\n${closed}\n`,
        `chassis tank\n${example}\n`,
        `${SCAFFOLD}on sense robot\n  loop\n${indent("    ")}\n    break\n  end\nend\n`,
        `${SCAFFOLD}on sense robot\n  set target = ${example}\nend\n`,
      ];

      const results = readings.map(checkScript);
      const why = readings
        .map((r, i) => `${r}-> ${results[i]!.error?.message ?? "ok"}`)
        .join("\n\n");
      expect(results.some((r) => r.ok), why).toBe(true);
    },
  );
});

describe("the syntax lines", () => {
  it.each(Object.keys(THEMES) as Theme[])("read in %s words", (theme) => {
    for (const rule of ruleDocs()) {
      const line = syntaxLine(rule.syntax, theme);
      expect(line, rule.name).not.toBe("");
    }
  });

  it("spells the diagram in the same words as the line above it", () => {
    // The two are generated separately, and disagreeing is worse than either
    // being wrong alone: the page would show `tank` and `skid` for the same
    // thing, an inch apart. Only the fixed words are compared — placeholders
    // and rule labels are descriptions, not things anybody types.
    const fixed = (s: Syntax): string[] => {
      switch (s.kind) {
        case "word":
          return [s.text];
        case "placeholder":
        case "rule":
          return [];
        case "sequence":
        case "choice":
          return s.of.flatMap(fixed);
        case "optional":
          return fixed(s.of);
        case "repeat":
          return [...fixed(s.of), ...(s.separator ? fixed(s.separator) : [])];
      }
    };

    for (const theme of Object.keys(THEMES) as Theme[]) {
      for (const rule of ruleDocs()) {
        const svg = railroad(rule.syntax, theme);
        const line = syntaxLine(rule.syntax, theme);
        for (const word of fixed(rule.syntax)) {
          const spelt = wordFor(word, theme);
          // `<>` and `<=` reach the SVG escaped, as any text in markup must.
          const inSvg = spelt.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          expect(svg, `${rule.name} diagram in ${theme}: ${spelt}`).toContain(`>${inSvg}<`);
          expect(line, `${rule.name} line in ${theme}: ${spelt}`).toContain(spelt);
        }
      }
    }
  });

  it("spells fixed words in the player's vocabulary", () => {
    const chassis = ruleDocs().find((r) => r.name === "chassisDecl")!;
    expect(syntaxLine(chassis.syntax, "mechanical")).toContain("chassis");
    expect(syntaxLine(chassis.syntax, "biological")).toContain("body");
  });
});

describe("the events", () => {
  it("documents every event the language has", () => {
    expect([...EVENT_NAMES].filter((e) => !EVENT_DOCS[e])).toEqual([]);
  });
});
