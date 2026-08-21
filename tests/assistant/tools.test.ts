/**
 * The assistant's hands.
 *
 * These run against real CodeMirror state rather than a stub document, because
 * risk in this feature is a model doing arithmetic on somebody's document. If
 * the line maths is wrong, it is wrong in CodeMirror's terms, so that is where
 * it has to be checked.
 *
 * No model is involved anywhere here: a tool call is a name and a JSON string,
 * and that is exactly what these tests hand over.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import {
  EXPLAINER_TOOL_DEFS,
  EXPLAINER_TOOL_NAMES,
  runTool,
  TOOL_DEFS,
  type EditorHandle,
  type ToolContext,
} from "../../src/assistant/tools.js";

const SCRIPT = `name "Sparky"
chassis tank

on start
  turret.sweep 90
end
`;

/**
 * A real `EditorState` with a dispatch that applies transactions, standing in
 * for the on-screen view. Not a mock of the document: the line arithmetic and
 * the read-only flag are CodeMirror's own, which is the part that has to be
 * right. Only the DOM is missing, and none of these tools touch it.
 */
function handle(doc: string, readOnly: boolean): EditorHandle {
  let state = EditorState.create({
    doc,
    extensions: readOnly ? [EditorState.readOnly.of(true)] : [],
  });
  return {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
  };
}

function context(doc = SCRIPT, readOnly = false): { ctx: ToolContext; said: string[] } {
  const said: string[] = [];
  return {
    said,
    ctx: {
      view: handle(doc, readOnly),
      opponents: [],
      arena: undefined,
      onSay: (text) => said.push(text),
    },
  };
}

const call = (name: string, args: unknown, ctx: ToolContext) =>
  runTool(name, JSON.stringify(args), ctx);

describe("tool definitions", () => {
  it("advertises nothing it cannot run", async () => {
    const { ctx } = context();
    for (const def of TOOL_DEFS) {
      const result = await call(def.function.name, {}, ctx);
      // Missing arguments are fine; "no such tool" is not.
      expect(String(result["error"] ?? "")).not.toContain("no tool called");
    }
  });

  it("gives every tool a description, since that is all the model has to go on", () => {
    for (const def of TOOL_DEFS) {
      expect(def.function.description.length).toBeGreaterThan(20);
    }
  });
});

describe("reading", () => {
  it("numbers the lines it reports, so the model and the player agree", async () => {
    const { ctx } = context();
    const result = await call("read_script", {}, ctx);
    expect(result.ok).toBe(true);
    expect(result["script"]).toContain('1: name "Sparky"');
    expect(result["script"]).toContain("4: on start");
    expect(result["lines"]).toBe(7);
  });

  it("reports where the cursor is", async () => {
    const { ctx } = context();
    ctx.view!.dispatch({ selection: { anchor: 0 } });
    const result = await call("read_cursor", {}, ctx);
    expect(result).toMatchObject({ ok: true, line: 1, column: 1, selection: null });
  });
});

describe("editing", () => {
  let harness: ReturnType<typeof context>;
  beforeEach(() => {
    harness = context();
  });

  it("inserts at the cursor", async () => {
    const { ctx } = harness;
    ctx.view!.dispatch({ selection: { anchor: 0 } });
    const result = await call("insert_at_cursor", { text: "-- hello\n" }, ctx);
    expect(result.ok).toBe(true);
    expect(ctx.view!.state.doc.toString().startsWith("-- hello\nname")).toBe(true);
  });

  it("replaces an inclusive range of lines", async () => {
    const { ctx } = harness;
    const result = await call(
      "replace_lines",
      { start_line: 2, end_line: 2, text: "chassis car" },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(ctx.view!.state.doc.line(2).text).toBe("chassis car");
    expect(ctx.view!.state.doc.line(1).text).toBe('name "Sparky"');
    expect(ctx.view!.state.doc.line(3).text).toBe("");
  });

  it("deletes when given empty text", async () => {
    const { ctx } = harness;
    await call("replace_lines", { start_line: 1, end_line: 2, text: "" }, ctx);
    expect(ctx.view!.state.doc.toString().startsWith("\n\non start")).toBe(true);
  });

  /**
   * The model writes its arguments as a JSON string and is not reliable about
   * types. Refusing a line number that arrived as "2" would be technically
   * correct and practically useless.
   */
  it("accepts a line number that arrived as a string", async () => {
    const { ctx } = harness;
    const result = await call("replace_lines", { start_line: "2", end_line: "2", text: "x" }, ctx);
    expect(result.ok).toBe(true);
  });

  it("refuses lines that are not there, and says how many there are", async () => {
    const { ctx } = harness;
    const result = await call("replace_lines", { start_line: 40, end_line: 50, text: "x" }, ctx);
    expect(result.ok).toBe(false);
    expect(String(result["error"])).toContain("7 lines");
    expect(ctx.view!.state.doc.toString()).toBe(SCRIPT);
  });

  it("refuses a backwards range", async () => {
    const { ctx } = harness;
    const result = await call("replace_lines", { start_line: 5, end_line: 2, text: "x" }, ctx);
    expect(result.ok).toBe(false);
  });

  it("reports a compile failure it caused without being asked", async () => {
    const { ctx } = harness;
    const result = await call("replace_lines", { start_line: 4, end_line: 4, text: "on wobble" }, ctx);
    expect(result.ok).toBe(true);
    expect(result["compiles"]).toBe(false);
    expect(String(result["error"])).toMatch(/^Line \d+:/);
  });

  it("makes one edit one undo step", async () => {
    const { ctx } = harness;
    await call("replace_document", { text: "name \"Nub\"\n" }, ctx);
    // One dispatch means one entry in the history, which is what lets the
    // player take an assistant edit back with a single Ctrl-Z.
    expect(ctx.view!.state.doc.toString()).toBe('name "Nub"\n');
  });
});

describe("someone else's script", () => {
  it("refuses every edit, and says why", async () => {
    const { ctx } = context(SCRIPT, true);
    for (const name of ["insert_at_cursor", "replace_document"]) {
      const result = await call(name, { text: "oops" }, ctx);
      expect(result.ok).toBe(false);
      expect(String(result["error"])).toContain("someone else");
    }
    const ranged = await call("replace_lines", { start_line: 1, end_line: 1, text: "oops" }, ctx);
    expect(ranged.ok).toBe(false);
    expect(ctx.view!.state.doc.toString()).toBe(SCRIPT);
  });

  it("still allows reading, which gives away nothing an editor does not", async () => {
    const { ctx } = context(SCRIPT, true);
    expect((await call("read_script", {}, ctx)).ok).toBe(true);
  });
});

describe("checking", () => {
  it("passes a good script", async () => {
    const { ctx } = context();
    expect(await call("check_script", {}, ctx)).toMatchObject({ ok: true, compiles: true });
  });

  it("reports line, message and hint for a bad one", async () => {
    const { ctx } = context("on start\n  drive sideways 10\nend\n");
    const result = await call("check_script", {}, ctx);
    expect(result["compiles"]).toBe(false);
    expect(result["line"]).toBeTypeOf("number");
    expect(result["message"]).toBeTypeOf("string");
  });
});

describe("misbehaviour", () => {
  it("returns an error rather than throwing for an unknown tool", async () => {
    const { ctx } = context();
    const result = await call("delete_everything", {}, ctx);
    expect(result.ok).toBe(false);
    expect(String(result["error"])).toContain("no tool called");
  });

  it("survives arguments that are not JSON", async () => {
    const { ctx } = context();
    const result = await runTool("say", "{not json", ctx);
    expect(result.ok).toBe(false);
    expect(String(result["error"])).toContain("valid JSON");
  });

  it("treats empty arguments as no arguments", async () => {
    const { ctx } = context();
    expect((await runTool("read_script", "", ctx)).ok).toBe(true);
  });

  it("hands what it says to the panel", async () => {
    const { ctx, said } = context();
    const result = await call("say", { text: "Try a wider sweep." }, ctx);
    expect(result.ok).toBe(true);
    expect(said).toEqual(["Try a wider sweep."]);
  });
});

describe("the explainer set", () => {
  /**
   * The load-bearing test on this branch.
   *
   * A local model of this size explains RoboScript well and cannot write it:
   * given editing tools it replaced the whole script with something that did
   * not compile, was told exactly what was wrong, and did it again until the
   * round cap. So write access is removed rather than discouraged — and the
   * check is behavioural, not a list of names, because the promise being made
   * to the player is about the document and not about our naming.
   */
  it("cannot change the document, whatever it is asked to do", async () => {
    for (const def of EXPLAINER_TOOL_DEFS) {
      const { ctx } = context();
      const before = ctx.view!.state.doc.toString();
      // Every argument shape a model might produce for any tool we define,
      // aimed at a tool that should ignore all of them.
      for (const args of [
        {},
        { text: "DESTROYED" },
        { start_line: 1, end_line: 99, text: "DESTROYED" },
        { trials: 1 },
      ]) {
        await call(def.function.name, args, ctx);
      }
      expect(ctx.view!.state.doc.toString(), `${def.function.name} left the script alone`).toBe(
        before,
      );
    }
  });

  it("offers no tool that any writing tool shares a name with", () => {
    const writes = ["insert_at_cursor", "replace_lines", "replace_document"];
    for (const name of EXPLAINER_TOOL_NAMES) expect(writes).not.toContain(name);
  });

  /**
   * Reading a compile error is the single most useful thing it can do — "why
   * will this not work" is half the questions — and it changes nothing.
   */
  it("can still read a compile error", async () => {
    const { ctx } = context("on start\n  drive sideways 10\nend\n");
    const result = await call("check_script", {}, ctx);
    expect(result["compiles"]).toBe(false);
    expect(result["message"]).toBeTypeOf("string");
  });

  it("can still speak", async () => {
    const { ctx, said } = context();
    await call("say", { text: "A tank turns on the spot." }, ctx);
    expect(said).toEqual(["A tank turns on the spot."]);
  });
});
