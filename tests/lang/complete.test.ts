/**
 * Completion is only useful if it tells the truth. These tests pin the two
 * properties that make it trustworthy:
 *
 *  - it narrows correctly as a phrase is typed, and
 *  - it never offers something the compiler would reject.
 */

import { describe, expect, it } from "vitest";
import { completeAt, contextAt, variablesIn } from "../../src/lang/complete.js";
import { compile } from "../../src/lang/compiler.js";
import { parse } from "../../src/lang/parser.js";
import { EVENT_NAMES } from "../../src/lang/ast.js";
import type { Theme } from "../../src/lang/vocab.js";

/** Complete at the point marked by `|` in the fixture. */
function at(fixture: string, theme: Theme = "mechanical"): string[] {
  const pos = fixture.indexOf("|");
  if (pos < 0) throw new Error("fixture needs a | to mark the cursor");
  const source = fixture.slice(0, pos) + fixture.slice(pos + 1);
  return completeAt(source, pos, theme)?.options.map((o) => o.label) ?? [];
}

describe("events", () => {
  it("offers every event after `on`", () => {
    const labels = at("on |");
    expect(labels).toEqual([...EVENT_NAMES]);
  });

  it("narrows to the sensing events after `on sense`", () => {
    expect(at("on sense |")).toEqual(["robot", "bullet", "wall"]);
  });

  it("narrows after `on hit`", () => {
    expect(at("on hit |")).toEqual(["wall", "robot", "by"]);
  });

  it("finishes `on hit by`", () => {
    expect(at("on hit by |")).toEqual(["bullet"]);
  });

  it("narrows after `on bullet`", () => {
    expect(at("on bullet |")).toEqual(["hit", "missed"]);
  });

  it("filters on a partly typed word", () => {
    // The editor filters by prefix, so what matters is that the word being
    // typed is offered for replacement rather than appended to.
    const source = "on se";
    const result = completeAt(source, source.length, "mechanical");
    expect(result?.from).toBe(3);
    expect(result?.options.map((o) => o.label)).toContain("sense robot");
  });

  it("describes what each event carries", () => {
    const source = "on ";
    const result = completeAt(source, source.length, "mechanical");
    const senseRobot = result?.options.find((o) => o.label === "sense robot");
    expect(senseRobot?.info).toContain("event.bearing");
    expect(senseRobot?.info).toContain("event.distance");
  });
});

describe("event fields depend on the handler", () => {
  it("offers the full set inside `on sense robot`", () => {
    expect(at("on sense robot\n  fire event.|\nend\n")).toEqual([
      "bearing", "distance", "heading", "speed", "health", "name", "x", "y",
    ]);
  });

  it("offers only bearing and distance inside `on sense wall`", () => {
    // A wall genuinely cannot tell you its health, so it is not offered.
    expect(at("on sense wall\n  fire event.|\nend\n")).toEqual(["bearing", "distance"]);
  });

  it("offers power inside `on hit by bullet`", () => {
    expect(at("on hit by bullet\n  fire event.|\nend\n")).toContain("power");
  });

  it("offers nothing inside `on start`, which carries no information", () => {
    expect(at("on start\n  fire event.|\nend\n")).toEqual([]);
  });

  it("agrees with what the compiler accepts, for every event", () => {
    // The guarantee: anything offered compiles, and the compiler's own list
    // matches the one the editor shows.
    for (const event of EVENT_NAMES) {
      const source = `on ${event}\n  fire event.\nend\n`;
      const offered = at(`on ${event}\n  fire event.|\nend\n`);
      for (const field of offered) {
        expect(() =>
          compile(parse(source.replace("event.", `event.${field}`))),
        ).not.toThrow();
      }
      // And something absent really is rejected.
      expect(() =>
        compile(parse(source.replace("event.", "event.nonsense"))),
      ).toThrow();
    }
  });
});

describe("the action grammar", () => {
  it("offers directions after drive", () => {
    expect(at("on tick\n  drive |\nend\n")).toEqual(["forward", "back"]);
  });

  it("offers to and by after turn body", () => {
    expect(at("on tick\n  turn body |\nend\n")).toEqual(["to", "by"]);
  });

  it("offers the turret's abilities after a dot", () => {
    expect(at("on tick\n  turret.|\nend\n")).toEqual(["aim", "turn", "sweep"]);
  });

  it("offers `at` after turret.aim", () => {
    expect(at("on tick\n  turret.aim |\nend\n")).toEqual(["at"]);
  });

  it("suggests firing powers", () => {
    expect(at("on tick\n  fire |\nend\n").slice(0, 3)).toEqual(["1", "2", "3"]);
  });

  it("offers the two chassis kinds", () => {
    expect(at("chassis |")).toEqual(["tank", "car"]);
  });

  it("offers a colour palette", () => {
    expect(at("color |")[0]).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("position awareness", () => {
  it("offers declarations at the top level", () => {
    expect(at("|")).toEqual(["on", "name", "chassis", "color", "var"]);
  });

  it("offers actions inside a handler", () => {
    const labels = at("on tick\n  |\nend\n");
    expect(labels).toContain("drive");
    expect(labels).toContain("fire");
    expect(labels).toContain("if");
    expect(labels).not.toContain("on");
  });

  it("knows it has left the handler again", () => {
    expect(contextAt("on tick\nend\n", "on tick\nend\n".length).inHandler).toBe(false);
  });

  it("does not mistake `break if` for a new block", () => {
    const source = "on tick\n  loop\n    break if 1 > 0\n  end\nend\n";
    expect(contextAt(source, source.length).inHandler).toBe(false);
  });

  it("does not mistake `else if` for a new block", () => {
    const source = "on tick\n  if 1 > 0\n    fire\n  else if 2 > 1\n    stop\n  end\nend\n";
    expect(contextAt(source, source.length).inHandler).toBe(false);
  });

  it("still knows the event deep inside nested blocks", () => {
    const source = "on sense robot\n  loop\n    if 1 > 0\n      fire event.|\n";
    expect(at(source)).toContain("bearing");
  });

  it("stays quiet inside comments and text", () => {
    expect(at("on tick\n  -- drive |\nend\n")).toEqual([]);
    expect(at('name "Spa|')).toEqual([]);
  });
});

describe("variables", () => {
  it("finds declarations anywhere in the script", () => {
    expect(variablesIn("var target = 0\non tick\n  for step = 1 to 3\n  end\nend\n")).toEqual([
      "target",
      "step",
    ]);
  });

  it("offers them in an expression", () => {
    expect(at("var target = 0\non tick\n  fire |\nend\n")).toContain("target");
  });

  it("offers them after set, alongside the name label", () => {
    expect(at("var target = 0\non tick\n  set |\nend\n")).toEqual(["name", "target"]);
  });

  it("works even while the script is broken", () => {
    // The moment you most want help is when the file does not compile.
    const source = "var target = 0\non sense robot\n  turret.aim at ";
    expect(completeAt(source, source.length, "mechanical")?.options.map((o) => o.label)).toContain(
      "target",
    );
  });
});

describe("themed vocabulary", () => {
  it("suggests biological words in the biological theme", () => {
    const labels = at("on tick\n  |\nend\n", "biological");
    expect(labels).toContain("swim");
    expect(labels).toContain("sting");
    expect(labels).toContain("stinger");
    expect(labels).not.toContain("drive");
  });

  it("names the biological chassis kinds", () => {
    expect(at("chassis |", "biological")).toEqual(["ciliate", "flagellate"]);
  });

  it("offers `stung` rather than `hit by bullet`", () => {
    expect(at("on |", "biological")).toContain("stung");
  });

  it("offers the health property under its themed name", () => {
    expect(at("on tick\n  fire me.|\nend\n", "biological")).toContain("vitality");
    expect(at("on tick\n  fire me.|\nend\n", "mechanical")).toContain("health");
  });

  it("describes events in the theme's own words too", () => {
    const source = "on ";
    const bio = completeAt(source, source.length, "biological");
    const senseOrganism = bio?.options.find((o) => o.label === "sense organism");
    expect(senseOrganism?.detail).toContain("organism");
    expect(senseOrganism?.detail).not.toContain("robot");

    const senseDart = bio?.options.find((o) => o.label === "sense dart");
    expect(senseDart?.detail).toContain("dart");
    expect(senseDart?.detail).not.toContain("bullet");
  });

  it("describes health in the theme's own words", () => {
    const fixture = "on sense organism\n  fire event.|\nend\n";
    const pos = fixture.indexOf("|");
    const source = fixture.slice(0, pos) + fixture.slice(pos + 1);
    const health = completeAt(source, pos, "biological")?.options.find(
      (o) => o.label === "health",
    );
    expect(health?.detail).toContain("vitality");
  });

  it("suggests words that actually compile", () => {
    // Every themed suggestion has to survive the real parser.
    for (const theme of ["mechanical", "biological"] as const) {
      for (const label of at("chassis |", theme)) {
        expect(() => parse(`chassis ${label}\n`)).not.toThrow();
      }
      for (const label of at("on tick\n  fire me.|\nend\n", theme)) {
        expect(() => compile(parse(`on tick\n  fire me.${label}\nend\n`))).not.toThrow();
      }
    }
  });
});
