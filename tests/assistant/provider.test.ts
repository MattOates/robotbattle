/**
 * The corners of the JSON provider that are easy to break later.
 */

import { describe, expect, it, vi } from "vitest";
import { deadlineWhileVisible, withProtocol } from "../../src/assistant/webllm-json-provider.js";
import { ESSENTIAL_TOOL_DEFS } from "../../src/assistant/tools.js";
import type { ChatMessage } from "../../src/assistant/provider.js";

describe("attaching the protocol", () => {
  /**
   * Dropping `tools` is what buys a real system message back — WebLLM only
   * refuses one when tools are present. So the protocol belongs there, and if
   * it ever silently stops arriving the model has no idea what shape to answer
   * in and every reply is wasted.
   */
  it("appends to the system message rather than replacing it", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "the language card" },
      { role: "user", content: "how do I turn?" },
    ];
    const out = withProtocol(messages, ESSENTIAL_TOOL_DEFS);
    expect(out[0]!.role).toBe("system");
    expect(out[0]!.content).toContain("the language card");
    expect(out[0]!.content).toContain('"op"');
    expect(out[1]).toEqual(messages[1]);
  });

  it("makes a system message when there is none", () => {
    const out = withProtocol([{ role: "user", content: "hi" }], ESSENTIAL_TOOL_DEFS);
    expect(out).toHaveLength(2);
    expect(out[0]!.role).toBe("system");
    expect(out[1]!.role).toBe("user");
  });

  it("leaves the conversation otherwise untouched", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "card" },
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
      { role: "tool", content: "{}", tool_call_id: "1" },
    ];
    expect(withProtocol(messages, ESSENTIAL_TOOL_DEFS).map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
    ]);
  });
});

describe("the reply deadline", () => {
  /**
   * The deadline rescues a run that has genuinely stopped, and a backgrounded
   * tab is not that. Chrome throttles a hidden tab so hard that the generation
   * loop nearly stops with it, so a plain timer would fail a request for the
   * offence of the player looking at something else — and since an interrupted
   * engine does not recover, that false positive costs the whole session.
   */
  it("does not fire while the clock is stopped", async () => {
    vi.useFakeTimers();
    try {
      let hidden = false;
      vi.stubGlobal("document", {
        get visibilityState() {
          return hidden ? "hidden" : "visible";
        },
        addEventListener: () => {},
        removeEventListener: () => {},
      });

      const deadline = deadlineWhileVisible(1000);
      let fired = false;
      void deadline.promise.then(() => (fired = true));

      hidden = true;
      await vi.advanceTimersByTimeAsync(500);
      deadline.cancel();
      await vi.advanceTimersByTimeAsync(5000);
      expect(fired).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("fires when the time really has passed", async () => {
    vi.useFakeTimers();
    try {
      const deadline = deadlineWhileVisible(1000);
      let fired = false;
      void deadline.promise.then(() => (fired = true));
      await vi.advanceTimersByTimeAsync(1500);
      expect(fired).toBe(true);
      deadline.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops counting once cancelled", async () => {
    vi.useFakeTimers();
    try {
      const deadline = deadlineWhileVisible(1000);
      let fired = false;
      void deadline.promise.then(() => (fired = true));
      deadline.cancel();
      await vi.advanceTimersByTimeAsync(5000);
      expect(fired).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
