/**
 * The conversation loop.
 *
 * Deliberately knows nothing about WebLLM, WebGPU or React: it takes a
 * `ChatProvider`, a set of tools and a question, and drives one exchange to a
 * finish. That is what makes it testable without a model — the tests hand it a
 * fake provider with scripted replies — and what will make a hosted provider a
 * drop-in later.
 *
 * The loop has to be defensive in ways a loop against a frontier model would
 * not be. An 8B model constrained to emit tool calls will sometimes call a tool
 * that does not exist, forget to say anything, or happily go round for ever
 * reading the script it has already read. Each of those has a guard here, and
 * the guard is always "carry on and tell the player something", never "throw".
 */

import type { ChatMessage, ChatProvider, ToolDef } from "./provider.js";
import { describeCall, runTool, SPEECH_TOOLS, type ToolContext } from "./tools.js";

/** One line in the panel's transcript. */
export type Entry =
  | { kind: "player"; text: string }
  | { kind: "assistant"; text: string; code?: string }
  | { kind: "action"; text: string }
  | { kind: "error"; text: string };

/**
 * How many times round before we stop.
 *
 * Six is enough for the longest sensible sequence — read, edit, check, fix,
 * check, say — and short enough that a model stuck in a loop wastes seconds
 * rather than minutes.
 */
const MAX_ROUNDS = 6;

/**
 * How many past messages to carry.
 *
 * The context window is 4096 tokens and the language card is about a third of
 * it, so history is the thing that has to give. Kept as whole exchanges from
 * the end, so a tool result is never orphaned from the call it answers.
 */
const HISTORY_LIMIT = 12;

export interface AgentOptions {
  provider: ChatProvider;
  tools: ToolDef[];
  ctx: ToolContext;
  /** Reported as they happen, so the panel can show work in progress. */
  onEntry: (entry: Entry) => void;
  /**
   * How many times round before giving up, when the default is too generous.
   *
   * An assistant that can only talk has no sequence to work through, so a
   * turn that has not finished in two or three goes is not going to. Each one
   * is a full generation on somebody's GPU, and six of them to deliver nothing
   * is how a laptop gets hot for no reason.
   */
  maxRounds?: number;
}

/**
 * Attach this turn's material to the question being asked, without storing it.
 *
 * Appended to the last thing the player said, which within a turn is always
 * the question itself — tool results come after it and carry the `tool` role.
 */
function withContext(messages: ChatMessage[], context?: string): ChatMessage[] {
  if (!context) return messages;
  const at = messages.map((m) => m.role).lastIndexOf("user");
  if (at === -1) return [...messages, { role: "user", content: context }];
  const copy = [...messages];
  copy[at] = { ...copy[at]!, content: `${copy[at]!.content ?? ""}\n\n${context}` };
  return copy;
}

export class Agent {
  private history: ChatMessage[] = [];
  /** The caller's context, with speech routed into the transcript. */
  private readonly ctx: ToolContext;

  constructor(
    private readonly systemPrompt: string,
    private readonly options: AgentOptions,
  ) {
    // Read through to the caller's context on every access rather than copying
    // it. An agent outlives any one question, and the editor it should be
    // typing into is remounted whenever the player switches robot — a spread
    // here would freeze the first one it ever saw.
    this.ctx = {
      get view() {
        return options.ctx.view;
      },
      get opponents() {
        return options.ctx.opponents;
      },
      get arena() {
        return options.ctx.arena;
      },
      // `say` reaches the panel through the same ordered stream as everything
      // else. Two channels would leave the panel guessing whether "rewrote
      // lines 3–5" happened before or after "I have made that faster", which is
      // the one thing the transcript exists to make obvious.
      onSay: (text, code) => {
        options.onEntry({ kind: "assistant", text, ...(code ? { code } : {}) });
        options.ctx.onSay(text, code);
      },
    };
  }

  /** Forget the conversation but keep the loaded model. */
  reset(): void {
    this.history = [];
  }

  /**
   * The signal, like the tool set, belongs to the question rather than to the
   * agent: the agent is built once and answers many, so anything captured at
   * construction would only ever apply to the first one.
   */
  async ask(
    question: string,
    signal?: AbortSignal,
    forTurn?: ToolDef[],
    context?: string,
  ): Promise<void> {
    const { provider, onEntry } = this.options;
    // The set can change between questions — there is nothing worth offering
    // to check on a script that already compiles — and the agent is built once
    // and kept, so it cannot be settled at construction.
    const tools = forTurn ?? this.options.tools;
    const ctx = this.ctx;

    // The question is remembered; the material gathered to answer it is not.
    // A quoted lesson runs to a couple of thousand characters, and keeping
    // them meant that after a few questions the window held mostly OLD
    // lessons — which is how "can I ping them twice and diff the x,y?" got
    // answered out of a paragraph about picking your robot's colour.
    this.history.push({ role: "user", content: question });

    let spoke = false;
    const rounds = this.options.maxRounds ?? MAX_ROUNDS;
    for (let round = 0; round < rounds; round++) {
      if (signal?.aborted) return;

      let reply;
      try {
        reply = await provider.chat({
          messages: [
            { role: "system", content: this.systemPrompt },
            ...withContext(this.trimmed(), context),
          ],
          tools,
        });
      } catch (err) {
        onEntry({
          kind: "error",
          text: err instanceof Error ? err.message : "The assistant stopped unexpectedly.",
        });
        return;
      }

      if (signal?.aborted) return;

      // No tool calls. Under WebLLM's constrained grammar this should not
      // happen, but a hosted provider is free to answer in prose — so if there
      // is prose, it is the answer.
      if (reply.tool_calls.length === 0) {
        const text = reply.content?.trim();
        if (text) {
          onEntry({ kind: "assistant", text });
          this.history.push({ role: "assistant", content: text });
        } else {
          onEntry({ kind: "error", text: "The assistant did not manage to answer that." });
        }
        return;
      }

      this.history.push({ role: "assistant", content: reply.content, tool_calls: reply.tool_calls });

      let onlySpeech = true;
      for (const call of reply.tool_calls) {
        const name = call.function.name;
        if (!SPEECH_TOOLS.has(name)) {
          onlySpeech = false;
          onEntry({ kind: "action", text: describeCall(name, call.function.arguments) });
        }

        const result = await runTool(name, call.function.arguments, ctx);
        if (SPEECH_TOOLS.has(name)) {
          if (result.ok) spoke = true;
          // Speech can be refused — an example that does not compile is sent
          // back rather than shown — and a refused turn is not a finished one.
          else onlySpeech = false;
        }

        this.history.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }

      // It said its piece and asked for nothing further. That is the end of a
      // turn, and going round again would only invite it to repeat itself.
      if (onlySpeech) return;
    }

    // Out of rounds with nothing said. Usually this is an example that never
    // compiled however many times it was sent back, so say that plainly rather
    // than leaving the player looking at a silent panel.
    if (!spoke) {
      onEntry({
        kind: "error",
        text: "I could not come up with an example for that which actually works. Try asking about one small piece of it.",
      });
    }
  }

  /**
   * The tail of the conversation, cut on an exchange boundary.
   *
   * A `tool` message whose matching call has been trimmed away is not just
   * wasteful, it is malformed — the API requires every tool result to answer a
   * call that is still present. So the window is walked back to the first
   * `user` message rather than cut at a fixed count.
   */
  private trimmed(): ChatMessage[] {
    if (this.history.length <= HISTORY_LIMIT) return this.history;
    let start = this.history.length - HISTORY_LIMIT;
    while (start > 0 && this.history[start]?.role !== "user") start--;
    return this.history.slice(start);
  }
}
