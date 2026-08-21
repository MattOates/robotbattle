/**
 * The conversation loop, driven by a provider that never thinks.
 *
 * The point of the `ChatProvider` seam is that the loop can be tested without
 * five gigabytes of weights, so these tests hand it scripted replies. What they
 * are really checking is the loop's behaviour when the model misbehaves, which
 * with an 8B model constrained to emit tool calls is not the exceptional case:
 * it will call tools that do not exist, forget to speak, and go round for ever
 * given the chance.
 */

import { describe, expect, it, vi } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { Agent, type Entry } from "../../src/assistant/agent.js";
import { TOOL_DEFS, type EditorHandle, type ToolContext } from "../../src/assistant/tools.js";
import type {
  ChatMessage,
  ChatProvider,
  ChatResponse,
  ToolCall,
} from "../../src/assistant/provider.js";

function handle(doc: string): EditorHandle {
  let state = EditorState.create({ doc });
  return {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
  };
}

function toolCall(name: string, args: unknown, id = name): ToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

const speak = (text: string): ChatResponse => ({
  content: null,
  tool_calls: [toolCall("say", { text })],
  finishReason: "tool_calls",
});

/** A provider that replays a fixed script, then repeats its last reply for ever. */
function fakeProvider(replies: ChatResponse[]): ChatProvider & { calls: number } {
  let index = 0;
  return {
    id: "fake",
    calls: 0,
    async chat() {
      this.calls++;
      const reply = replies[Math.min(index, replies.length - 1)];
      index++;
      return reply!;
    },
    dispose() {},
  };
}

function harness(replies: ChatResponse[], doc = 'name "Sparky"\n') {
  const entries: Entry[] = [];
  const said: string[] = [];
  const ctx: ToolContext = {
    view: handle(doc),
    opponents: [],
    arena: undefined,
    onSay: (text) => said.push(text),
  };
  const provider = fakeProvider(replies);
  const agent = new Agent("you are a test", {
    provider,
    tools: TOOL_DEFS,
    ctx,
    onEntry: (entry) => entries.push(entry),
  });
  return { agent, entries, said, ctx, provider };
}

describe("a plain answer", () => {
  it("stops as soon as the model has only spoken", async () => {
    const { agent, said, provider } = harness([speak("A tank turns on the spot.")]);
    await agent.ask("what is a tank?");
    expect(said).toEqual(["A tank turns on the spot."]);
    expect(provider.calls).toBe(1);
  });

  it("accepts prose from a provider that allows it", async () => {
    // WebLLM's grammar forbids this, but a hosted model is free to answer
    // without calling anything, and that answer must not be thrown away.
    const { agent, entries } = harness([
      { content: "Straight from the model.", tool_calls: [], finishReason: "stop" },
    ]);
    await agent.ask("hello");
    expect(entries).toEqual([{ kind: "assistant", text: "Straight from the model." }]);
  });
});

describe("doing work", () => {
  it("feeds each tool result back and carries on", async () => {
    const { agent, ctx, said } = harness([
      { content: null, tool_calls: [toolCall("read_script", {})], finishReason: "tool_calls" },
      {
        content: null,
        tool_calls: [toolCall("insert_at_cursor", { text: "chassis tank\n" })],
        finishReason: "tool_calls",
      },
      speak("Added a tank chassis."),
    ]);
    await agent.ask("make me a tank");
    expect(ctx.view!.state.doc.toString()).toContain("chassis tank");
    expect(said).toEqual(["Added a tank chassis."]);
  });

  it("shows its actions but not its speech as actions", async () => {
    const { agent, entries } = harness([
      { content: null, tool_calls: [toolCall("check_script", {})], finishReason: "tool_calls" },
      speak("It compiles."),
    ]);
    await agent.ask("does it work?");
    expect(entries).toEqual([
      { kind: "action", text: "checked it compiles" },
      { kind: "assistant", text: "It compiles." },
    ]);
  });

  it("runs several calls from one reply in order", async () => {
    const { agent, ctx } = harness([
      {
        content: null,
        tool_calls: [
          toolCall("replace_document", { text: "name \"A\"\n" }, "one"),
          toolCall("insert_at_cursor", { text: "chassis tank\n" }, "two"),
        ],
        finishReason: "tool_calls",
      },
      speak("done"),
    ]);
    await agent.ask("rewrite it");
    expect(ctx.view!.state.doc.toString()).toBe('name "A"\nchassis tank\n');
  });
});

describe("when the model misbehaves", () => {
  it("tells the model there is no such tool instead of giving up", async () => {
    const { agent, said } = harness([
      { content: null, tool_calls: [toolCall("rm_rf", {})], finishReason: "tool_calls" },
      speak("Sorry, I got confused."),
    ]);
    await agent.ask("break things");
    expect(said).toEqual(["Sorry, I got confused."]);
  });

  it("stops after the round cap rather than looping for ever", async () => {
    // A model that only ever reads the script would otherwise never finish.
    const { agent, provider, entries } = harness([
      { content: null, tool_calls: [toolCall("read_script", {})], finishReason: "tool_calls" },
    ]);
    await agent.ask("hello?");
    expect(provider.calls).toBeLessThanOrEqual(6);
    expect(entries.at(-1)).toMatchObject({ kind: "error" });
  });

  it("says something when the model returns nothing at all", async () => {
    const { agent, entries } = harness([{ content: null, tool_calls: [], finishReason: "stop" }]);
    await agent.ask("hello");
    expect(entries).toEqual([
      { kind: "error", text: "The assistant did not manage to answer that." },
    ]);
  });

  it("reports a provider failure as an error rather than throwing", async () => {
    const provider: ChatProvider = {
      id: "broken",
      chat: vi.fn().mockRejectedValue(new Error("the GPU went away")),
      dispose() {},
    };
    const entries: Entry[] = [];
    const agent = new Agent("prompt", {
      provider,
      tools: TOOL_DEFS,
      ctx: { view: handle(""), opponents: [], arena: undefined, onSay: () => {} },
      onEntry: (entry) => entries.push(entry),
    });
    await expect(agent.ask("hello")).resolves.toBeUndefined();
    expect(entries).toEqual([{ kind: "error", text: "the GPU went away" }]);
  });
});

describe("cancelling", () => {
  it("stops before saying anything when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const entries: Entry[] = [];
    const agent = new Agent("prompt", {
      provider: fakeProvider([speak("too late")]),
      tools: TOOL_DEFS,
      ctx: { view: handle(""), opponents: [], arena: undefined, onSay: () => {} },
      onEntry: (entry) => entries.push(entry),
    });
    await agent.ask("hello", controller.signal);
    expect(entries).toEqual([]);
  });
});

describe("history", () => {
  /**
   * The window is 4096 tokens and the language card takes a third of it, so
   * history is what has to be cut. It must be cut on an exchange boundary: a
   * `tool` message whose call has been trimmed away is malformed, not merely
   * wasteful, and providers reject it.
   */
  it("never sends a tool result whose call has been trimmed away", async () => {
    const seen: { role: string; tool_call_id?: string; tool_calls?: unknown[] }[][] = [];
    const provider: ChatProvider = {
      id: "recorder",
      async chat(req) {
        seen.push(req.messages);
        return speak("ok");
      },
      dispose() {},
    };
    const agent = new Agent("prompt", {
      provider,
      tools: TOOL_DEFS,
      ctx: { view: handle('name "x"\n'), opponents: [], arena: undefined, onSay: () => {} },
      onEntry: () => {},
    });

    for (let i = 0; i < 12; i++) await agent.ask(`question ${i}`);

    for (const messages of seen) {
      const offered = new Set<string>();
      for (const message of messages) {
        for (const call of (message.tool_calls ?? []) as ToolCall[]) offered.add(call.id);
        if (message.role === "tool") {
          expect(offered.has(message.tool_call_id!)).toBe(true);
        }
      }
    }
  });

  /**
   * The agent is built once and answers many questions, while the editor under
   * it is remounted whenever the player switches robot. If the agent held the
   * view it was built with, it would go on typing into a document that is no
   * longer on screen.
   */
  it("edits the editor that is on screen now, not the one it was built with", async () => {
    const first = handle("first\n");
    const second = handle("second\n");
    let current = first;

    const ctx: ToolContext = {
      get view() {
        return current;
      },
      opponents: [],
      arena: undefined,
      onSay: () => {},
    };
    const agent = new Agent("prompt", {
      // One edit-then-speak exchange per question asked below.
      provider: fakeProvider([
        {
          content: null,
          tool_calls: [toolCall("replace_document", { text: "written\n" })],
          finishReason: "tool_calls",
        },
        speak("done"),
        {
          content: null,
          tool_calls: [toolCall("replace_document", { text: "written\n" })],
          finishReason: "tool_calls",
        },
        speak("done"),
      ]),
      tools: TOOL_DEFS,
      ctx,
      onEntry: () => {},
    });

    await agent.ask("write to it");
    expect(first.state.doc.toString()).toBe("written\n");

    current = second;
    await agent.ask("write to it again");
    expect(second.state.doc.toString()).toBe("written\n");
    // The first editor was left exactly as it was.
    expect(first.state.doc.toString()).toBe("written\n");
  });

  it("forgets the conversation on reset", async () => {
    const seen: unknown[][] = [];
    const provider: ChatProvider = {
      id: "recorder",
      async chat(req) {
        seen.push(req.messages);
        return speak("ok");
      },
      dispose() {},
    };
    const agent = new Agent("prompt", {
      provider,
      tools: TOOL_DEFS,
      ctx: { view: handle(""), opponents: [], arena: undefined, onSay: () => {} },
      onEntry: () => {},
    });
    await agent.ask("first");
    agent.reset();
    await agent.ask("second");
    // System prompt plus the one new question, and nothing of the first.
    expect(seen[1]).toHaveLength(2);
  });
});

describe("what the conversation remembers", () => {
  /** Capture every request so history can be inspected across turns. */
  function recorder() {
    const seen: ChatMessage[][] = [];
    const provider: ChatProvider = {
      id: "recorder",
      async chat(req) {
        seen.push(req.messages);
        return speak("ok");
      },
      dispose() {},
    };
    const agent = new Agent("prompt", {
      provider,
      tools: TOOL_DEFS,
      ctx: { view: handle(""), opponents: [], arena: undefined, onSay: () => {} },
      onEntry: () => {},
    });
    return { seen, agent };
  }

  /**
   * A quoted lesson runs to a couple of thousand characters. Kept in history,
   * a few questions in the window holds mostly OLD lessons — which is how a
   * question about tracking an enemy came back as "change the colour of your
   * robot", out of a paragraph retrieved two questions earlier.
   */
  it("uses this turn's material and does not carry it into the next", async () => {
    const { seen, agent } = recorder();
    await agent.ask("what is a tank?", undefined, undefined, "LESSON ABOUT COLOUR");
    // It has to reach the model, or retrieval is pointless.
    expect(JSON.stringify(seen[0])).toContain("LESSON ABOUT COLOUR");

    await agent.ask("how do I ping?", undefined, undefined, "LESSON ABOUT RADAR");
    const second = JSON.stringify(seen[1]);
    expect(second).toContain("LESSON ABOUT RADAR");
    expect(second).not.toContain("LESSON ABOUT COLOUR");
  });

  it("still remembers what was asked, so a follow-up makes sense", async () => {
    const { seen, agent } = recorder();
    await agent.ask("what is a tank?", undefined, undefined, "LESSON");
    await agent.ask("can you give an example?");
    expect(JSON.stringify(seen[1])).toContain("what is a tank?");
  });

  it("attaches material to the question rather than as a turn of its own", async () => {
    const { seen, agent } = recorder();
    await agent.ask("what is a tank?", undefined, undefined, "MATERIAL");
    const users = seen[0]!.filter((m) => m.role === "user");
    expect(users).toHaveLength(1);
    expect(users[0]!.content).toContain("what is a tank?");
    expect(users[0]!.content).toContain("MATERIAL");
  });
});
