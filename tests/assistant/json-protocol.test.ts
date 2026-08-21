/**
 * The JSON protocol.
 *
 * This exists because grammar-constrained *tool calling* pinned the shape of a
 * call and nothing about its contents, and a small model duly invented tool
 * names and fields. So the thing worth testing hardest is the opposite claim:
 * that the schema leaves the model no room to name something that is not there.
 *
 * All of it is pure — a schema and a parser — so none of it needs a model.
 */

import { describe, expect, it } from "vitest";
import {
  callsFromReply,
  flattenToolTurns,
  NO_OP,
  parseReply,
  protocolInstructions,
  protocolSchema,
} from "../../src/assistant/json-protocol.js";
import { ESSENTIAL_TOOL_DEFS, TOOL_DEFS } from "../../src/assistant/tools.js";

describe("the schema", () => {
  it("pins op to the tools that actually exist", () => {
    const schema = protocolSchema(ESSENTIAL_TOOL_DEFS);
    const op = schema.properties["op"] as { enum: string[] };
    expect(op.enum).toContain(NO_OP);
    expect(op.enum).toContain("check_script");
    // The failure this replaces: a model naming something that is not a tool.
    expect(op.enum).not.toContain("function_call");
    expect(op.enum).not.toContain("Say hello to the player");
  });

  it("offers every tool except speech as an op", () => {
    const op = protocolSchema(TOOL_DEFS).properties["op"] as { enum: string[] };
    const names = TOOL_DEFS.map((t) => t.function.name);
    for (const name of names.filter((n) => n !== "say")) expect(op.enum).toContain(name);
    // `say` is a field, not an op — it is the one thing done every turn.
    expect(op.enum).not.toContain("say");
  });

  it("requires speech and an op, and nothing else", () => {
    // An op that takes no arguments must not be made to invent them, which is
    // precisely what went wrong when the arguments were unconstrained.
    expect(protocolSchema(TOOL_DEFS).required).toEqual(["say", "op"]);
  });

  it("declares every parameter any tool takes", () => {
    const props = protocolSchema(TOOL_DEFS).properties;
    for (const tool of TOOL_DEFS) {
      for (const name of Object.keys(tool.function.parameters.properties)) {
        expect(props, `${tool.function.name} needs ${name}`).toHaveProperty(name);
      }
    }
  });

  it("describes each op in the instructions, so the enum is not a guessing game", () => {
    const text = protocolInstructions(ESSENTIAL_TOOL_DEFS);
    for (const tool of ESSENTIAL_TOOL_DEFS) {
      if (tool.function.name === "say") continue;
      expect(text).toContain(tool.function.name);
    }
  });
});

describe("reading a reply", () => {
  it("turns speech and an op into two calls, speech first", () => {
    const calls = callsFromReply(
      { say: "Adding a sweep.", op: "insert_at_cursor", text: "radar.sweep 60\n" },
      TOOL_DEFS,
    );
    expect(calls.map((c) => c.function.name)).toEqual(["say", "insert_at_cursor"]);
    expect(JSON.parse(calls[0]!.function.arguments)).toEqual({ text: "Adding a sweep." });
    expect(JSON.parse(calls[1]!.function.arguments)).toEqual({ text: "radar.sweep 60\n" });
  });

  it("treats none as talking and nothing else", () => {
    const calls = callsFromReply({ say: "A tank turns on the spot.", op: NO_OP }, TOOL_DEFS);
    expect(calls.map((c) => c.function.name)).toEqual(["say"]);
  });

  /**
   * The reply carries the union of every tool's parameters, so a tool must be
   * handed only the ones it declares. Passing a stray `start_line` to something
   * that does not take one is how a tool ends up guessing.
   */
  it("gives an op only the fields it declares", () => {
    const calls = callsFromReply(
      { say: "ok", op: "replace_document", text: "name \"A\"\n", start_line: 3, end_line: 9 },
      TOOL_DEFS,
    );
    expect(JSON.parse(calls[1]!.function.arguments)).toEqual({ text: 'name "A"\n' });
  });

  it("passes the fields a multi-argument op does declare", () => {
    const calls = callsFromReply(
      { say: "ok", op: "replace_lines", start_line: 2, end_line: 3, text: "fire 2" },
      TOOL_DEFS,
    );
    expect(JSON.parse(calls[1]!.function.arguments)).toEqual({
      start_line: 2,
      end_line: 3,
      text: "fire 2",
    });
  });

  it("says nothing when there is nothing to say", () => {
    expect(callsFromReply({ say: "   ", op: NO_OP }, TOOL_DEFS)).toEqual([]);
  });

  it("survives a reply that is not an object at all", () => {
    for (const junk of [null, undefined, "hello", 42, []]) {
      expect(() => callsFromReply(junk, TOOL_DEFS)).not.toThrow();
    }
  });

  it("passes an unknown op through for the tool runner to refuse", () => {
    // The grammar should prevent this. If something slips past it, the loop
    // already knows how to tell a model it named a tool that is not there.
    const calls = callsFromReply({ say: "ok", op: "rm_rf" }, TOOL_DEFS);
    expect(calls[1]!.function.name).toBe("rm_rf");
    expect(JSON.parse(calls[1]!.function.arguments)).toEqual({});
  });
});

describe("parsing", () => {
  it("reads a plain object", () => {
    expect(parseReply('{"say":"hi","op":"none"}')).toEqual({ say: "hi", op: "none" });
  });

  it("digs the object out of a fenced or chatty reply", () => {
    expect(parseReply('```json\n{"say":"hi","op":"none"}\n```')).toEqual({ say: "hi", op: "none" });
    expect(parseReply('Sure! {"say":"hi","op":"none"} Hope that helps.')).toEqual({
      say: "hi",
      op: "none",
    });
  });

  it("returns null rather than throwing on nonsense", () => {
    expect(parseReply("not json at all")).toBeNull();
    expect(parseReply("{ broken")).toBeNull();
    expect(parseReply("")).toBeNull();
  });
});

describe("retelling a tool exchange as conversation", () => {
  /**
   * The loop records what it did the standard way — an assistant turn carrying
   * `tool_calls`, then `tool` turns carrying results. Those roles only mean
   * something to a backend that was told about tools, and this one deliberately
   * was not, so the request fails the moment there is any history. Retelling it
   * as speech is what lets the loop above stay completely standard.
   */
  const history = [
    { role: "system", content: "the card" },
    { role: "user", content: "add a sweep" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "a",
          type: "function" as const,
          function: { name: "say", arguments: '{"text":"Let me look."}' },
        },
        { id: "b", type: "function" as const, function: { name: "read_script", arguments: "{}" } },
      ],
    },
    { role: "tool", content: '{"ok":true,"script":"1: name \\"S\\""}', tool_call_id: "b" },
  ];

  it("leaves only roles an ordinary chat template understands", () => {
    for (const m of flattenToolTurns(history)) {
      expect(["system", "user", "assistant"]).toContain(m.role);
    }
  });

  it("keeps what was said and what was done", () => {
    const out = flattenToolTurns(history);
    const assistant = out.find((m) => m.role === "assistant")!;
    expect(assistant.content).toContain("Let me look.");
    expect(assistant.content).toContain("read_script");
  });

  it("hands the result back as something the model can read", () => {
    const last = flattenToolTurns(history).at(-1)!;
    expect(last.role).toBe("user");
    // Named, so a result is not just an anonymous blob of JSON.
    expect(last.content).toContain("Result of read_script");
    expect(last.content).toContain("1: name");
  });

  it("passes an ordinary conversation through unchanged", () => {
    const plain = [
      { role: "system", content: "card" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    expect(flattenToolTurns(plain)).toEqual(plain);
  });

  it("drops an assistant turn that neither said nor did anything", () => {
    expect(flattenToolTurns([{ role: "assistant", content: null, tool_calls: [] }])).toEqual([
      { role: "assistant", content: "" },
    ]);
  });

  it("never emits a null content, which a template cannot render", () => {
    for (const m of flattenToolTurns(history)) expect(typeof m.content).toBe("string");
  });
});

describe("a model that must not write code", () => {
  /**
   * The small rung explains and quotes; it does not compose. Asked to, models
   * this size invent commands and write one-line `if` blocks — so the field is
   * taken away rather than the behaviour discouraged. A field it cannot emit
   * is a rule it cannot break.
   */
  it("is not offered a code field at all", () => {
    const schema = protocolSchema(ESSENTIAL_TOOL_DEFS, false);
    expect(schema.properties).not.toHaveProperty("code");
    expect(schema.properties).toHaveProperty("say");
  });

  it("keeps the field for a model that may compose", () => {
    expect(protocolSchema(ESSENTIAL_TOOL_DEFS, true).properties).toHaveProperty("code");
  });

  it("is told an example will be shown for it, rather than to write one", () => {
    const text = protocolInstructions(ESSENTIAL_TOOL_DEFS, false);
    expect(text).toContain("Do not write RoboScript");
    expect(text).not.toContain('"code"');
  });

  it("still carries a code field through if one somehow arrives", () => {
    // The grammar should make this unreachable; if it is not, the compiler
    // check downstream is what catches it, not silence here.
    const calls = callsFromReply({ say: "ok", code: "swerve left", op: NO_OP }, []);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.function.arguments).code).toBe("swerve left");
  });
});

describe("when the answer repeats itself", () => {
  /**
   * A model that fills in `code` often pastes the same lines into `say` too,
   * inside a fence — so the panel showed the example twice, once as flat prose
   * and once as the real block. The block is the one with highlighting, a
   * compiler verdict and a Copy button, so the prose copy is the one to lose.
   */
  it("drops a fenced copy of the code out of the sentence", () => {
    const calls = callsFromReply(
      {
        say: "Here is an example:\n\n```\non tick every 10\n  stop\nend\n```\n\nChange the number.",
        code: "on tick every 10\n  stop\nend",
        op: NO_OP,
      },
      [],
    );
    const args = JSON.parse(calls[0]!.function.arguments);
    expect(args.text).toBe("Here is an example:\n\nChange the number.");
    expect(args.code).toBe("on tick every 10\n  stop\nend");
  });

  it("leaves a sentence with no fence in it alone", () => {
    const calls = callsFromReply({ say: "Try this.", code: "stop", op: NO_OP }, []);
    expect(JSON.parse(calls[0]!.function.arguments).text).toBe("Try this.");
  });

  it("still speaks when the sentence was nothing but the fence", () => {
    // Losing the prose must not lose the turn: the example is the answer.
    const calls = callsFromReply({ say: "```\nstop\n```", code: "stop", op: NO_OP }, []);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.function.arguments).code).toBe("stop");
  });
});
