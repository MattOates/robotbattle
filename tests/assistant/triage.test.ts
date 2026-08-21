/**
 * Sorting the question before answering it.
 *
 * This exists because of one real exchange:
 *
 *     You:       can you see my script?
 *     Assistant: Let's add a sense cone to your robot!
 *                Your robot is now equipped with a sense cone.
 *
 * Both sentences false. "See" scored against the sensing chapter, a lesson
 * about sense cones went into the prompt, and the assistant answered the lesson
 * rather than the question. The routing is what stops that, so what is tested
 * here is mostly the routing's failure modes — a small model doing the sorting
 * can get it wrong, and none of the wrong answers may throw.
 */

import { describe, expect, it, vi } from "vitest";
import { parseTriage, triage, triageMessages, TRIAGE_SCHEMA } from "../../src/assistant/triage.js";
import type { ChatProvider } from "../../src/assistant/provider.js";

/** A provider that answers the sorting question with whatever it is given. */
function sorter(content: string | null): ChatProvider {
  return {
    id: "fake",
    chat: vi.fn().mockResolvedValue({ content, tool_calls: [], finishReason: "stop" }),
    dispose() {},
  };
}

describe("the sorting question", () => {
  it("constrains the kinds a model can choose between", () => {
    const kind = (TRIAGE_SCHEMA["properties"] as Record<string, { enum: string[] }>)["kind"]!;
    expect(kind.enum).toEqual(["language", "script", "assistant", "other"]);
  });

  /**
   * Deliberately says nothing about RoboScript. This call is about the shape of
   * the question, not its subject, and the language card would only give a
   * small model more to be distracted by.
   */
  it("asks about the question, not about the language", () => {
    const [system] = triageMessages("how do I turn?");
    expect(system!.role).toBe("system");
    // No language card: none of the reference sections, and short enough that
    // it cannot be smuggling one in. Worked examples do name a few RoboScript
    // words, which is the point of them.
    expect(system!.content).not.toContain("## Actions");
    expect(system!.content).not.toContain("me.health");
    expect(system!.content!.length).toBeLessThan(1600);
  });

  /**
   * Descriptions alone sent almost everything to "assistant": a small model
   * reads four paragraphs about itself and concludes the question is about
   * itself. Examples are what it actually follows, so there must be one of
   * each kind.
   */
  it("shows a worked example of every kind", () => {
    const [system] = triageMessages("how do I turn?");
    for (const kind of ["language", "script", "assistant", "other"]) {
      expect(system!.content).toContain(`"kind":"${kind}"`);
    }
  });

  it("puts the question itself in a user turn", () => {
    const messages = triageMessages("how do I turn?");
    expect(messages.at(-1)).toEqual({ role: "user", content: "how do I turn?" });
  });
});

describe("reading the answer", () => {
  it("takes a kind and a topic", () => {
    expect(parseTriage('{"kind":"language","topic":"radar sweep"}')).toEqual({
      kind: "language",
      topic: "radar sweep",
    });
  });

  it("digs the object out of a chatty reply", () => {
    expect(parseTriage('Sure: {"kind":"other","topic":""} ')).toEqual({ kind: "other", topic: "" });
  });

  it("refuses a kind that is not one of the four", () => {
    expect(parseTriage('{"kind":"banana","topic":"x"}')).toBeNull();
    expect(parseTriage('{"topic":"x"}')).toBeNull();
  });

  it("returns null rather than throwing on nonsense", () => {
    for (const junk of [null, "", "not json", "{ broken"]) {
      expect(parseTriage(junk)).toBeNull();
    }
  });

  it("tolerates a missing topic, since only language questions need one", () => {
    expect(parseTriage('{"kind":"assistant"}')).toEqual({ kind: "assistant", topic: "" });
  });
});

describe("routing", () => {
  it("routes a question about the assistant away from the lessons", async () => {
    const routed = await triage(sorter('{"kind":"assistant","topic":""}'), "can you see my script?");
    expect(routed.kind).toBe("assistant");
    expect(routed.topic).toBe("");
  });

  it("names a topic to look up for a language question", async () => {
    const routed = await triage(
      sorter('{"kind":"language","topic":"sense cone"}'),
      "how does my robot see things?",
    );
    expect(routed).toEqual({ kind: "language", topic: "sense cone" });
  });

  /**
   * A misroute should cost the cheaper mistake. Looking up a lesson that was
   * not needed wastes a paragraph; failing to look one up that was needed is a
   * wrong answer. So the fallback is the old always-retrieve behaviour.
   */
  it("falls back to treating it as a language question when sorting fails", async () => {
    for (const bad of [null, "nonsense", '{"kind":"banana"}']) {
      expect(await triage(sorter(bad), "how do I turn?")).toEqual({
        kind: "language",
        topic: "how do I turn?",
      });
    }
  });

  it("survives a provider that throws, rather than losing the question", async () => {
    const broken: ChatProvider = {
      id: "broken",
      chat: vi.fn().mockRejectedValue(new Error("the GPU went away")),
      dispose() {},
    };
    await expect(triage(broken, "how do I turn?")).resolves.toEqual({
      kind: "language",
      topic: "how do I turn?",
    });
  });

  it("asks for the sorting shape and no tools", async () => {
    const provider = sorter('{"kind":"other","topic":""}');
    await triage(provider, "hello");
    const req = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(req.json.schema).toBe(TRIAGE_SCHEMA);
    expect(req.tools).toEqual([]);
    // One right answer; nothing to gain by looking for a different one.
    expect(req.temperature).toBe(0);
  });
});
