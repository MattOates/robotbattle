import { describe, expect, it } from "vitest";
import { parse } from "../../src/lang/parser.js";
import { compile } from "../../src/lang/compiler.js";
import { RoboScriptError } from "../../src/lang/errors.js";
import { SAMPLE_BOTS } from "../../src/bots/index.js";

function expectError(source: string): RoboScriptError {
  try {
    compile(parse(source));
  } catch (err) {
    if (err instanceof RoboScriptError) return err;
    throw err;
  }
  throw new Error("expected the script to be rejected, but it compiled");
}

describe("metadata", () => {
  it("reads name, chassis and colour", () => {
    const p = parse(`name "Sparky"\nchassis tank\ncolor #ff8800\n`);
    expect(p.name).toBe("Sparky");
    expect(p.locomotion).toBe("skid");
    expect(p.color).toBe("#ff8800");
  });

  it("expands short colours", () => {
    expect(parse(`color #f80\n`).color).toBe("#ff8800");
  });

  it("defaults to a tank when no chassis is given", () => {
    expect(parse(`name "x"\n`).locomotion).toBe("skid");
  });
});

describe("blocks", () => {
  it("parses every event handler", () => {
    const p = parse(`
on start
end
on tick
end
on sense robot
end
on sense bullet
end
on sense wall
end
on hit wall
end
on hit robot
end
on hit by bullet
end
on bullet hit
end
on bullet missed
end
on robot destroyed
end
`);
    expect(p.handlers.map((h) => h.event)).toEqual([
      "start", "tick", "sense robot", "sense bullet", "sense wall",
      "hit wall", "hit robot", "hit by bullet", "bullet hit",
      "bullet missed", "robot destroyed",
    ]);
  });

  it("closes an if with a single end", () => {
    const p = parse(`
on tick
  if 1 < 2 then
    fire
  end
end
`);
    expect(p.handlers[0]!.body).toHaveLength(1);
  });

  it("handles if/else", () => {
    const p = parse(`
on tick
  if 1 < 2
    fire
  else
    stop
  end
end
`);
    const stmt = p.handlers[0]!.body[0]!;
    expect(stmt.type).toBe("if");
    if (stmt.type === "if") {
      expect(stmt.then).toHaveLength(1);
      expect(stmt.otherwise).toHaveLength(1);
    }
  });

  it("chains else if with one shared end", () => {
    const p = parse(`
on tick
  if me.health > 80
    fire 3
  else if me.health > 40
    fire 2
  else
    fire 1
  end
end
`);
    expect(p.handlers[0]!.body).toHaveLength(1);
  });
});

describe("friendly errors", () => {
  it("reports an unclosed block by name and line", () => {
    const err = expectError(`on sense robot\n  fire\n`);
    expect(err.line).toBe(1);
    expect(err.message).toContain("on sense robot");
    expect(err.hint).toContain("end");
  });

  it("rejects an unknown variable and lists what exists", () => {
    const err = expectError(`var speed_a = 1\non tick\n  fire speed_b\nend\n`);
    expect(err.message).toContain("speed_b");
    expect(err.hint).toContain("speed_a");
  });

  it("rejects an unknown property and lists the real ones", () => {
    const err = expectError(`on tick\n  fire me.torque\nend\n`);
    expect(err.message).toContain("torque");
    expect(err.hint).toContain("health");
  });

  it("refuses a reserved word as a variable name", () => {
    const err = expectError(`var turret = 1\n`);
    expect(err.message).toContain("already uses");
  });

  it("rejects break outside a loop", () => {
    const err = expectError(`on tick\n  break\nend\n`);
    expect(err.message).toContain("inside a loop");
  });

  it("catches a duplicated handler", () => {
    const err = expectError(`on tick\nend\non tick\nend\n`);
    expect(err.message).toContain("already have");
  });

  it("explains an unterminated string", () => {
    const err = expectError(`name "Sparky\n`);
    expect(err.message).toContain("closing quote");
  });

  it("reports a wrong argument count", () => {
    const err = expectError(`on tick\n  fire min(1)\nend\n`);
    expect(err.message).toContain("needs 2");
  });
});

describe("sample bots", () => {
  it.each(SAMPLE_BOTS.map((b) => [b.id, b.source] as const))(
    "%s compiles",
    (_id, source) => {
      expect(() => compile(parse(source))).not.toThrow();
    },
  );
});
