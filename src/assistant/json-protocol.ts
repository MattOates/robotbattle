/**
 * Tool calling for models that cannot do tool calling.
 *
 * The previous attempt handed WebLLM a `tools` array and let it drive a
 * Hermes-format grammar. That constrains the *shape* of a call — an object with
 * a name and some arguments — and nothing whatever about its contents, so a
 * small model happily invents tool names, invents fields, and puts a `say`
 * payload inside a tool that takes no arguments. Shape was never the problem.
 *
 * So this asks for something a grammar can genuinely hold to. One flat JSON
 * object per turn, with `op` pinned to an `enum` of the tools that actually
 * exist and the fields declared and required. The model cannot name a tool that
 * is not there, because the grammar will not emit those tokens.
 *
 * Everything above still speaks OpenAI: the provider takes `tools` and hands
 * back `tool_calls`, and this module is the translation in the middle. That is
 * also why it is pure and separate — the interesting logic here is a schema and
 * a parser, and neither needs a GPU to test.
 *
 * Two smaller wins fall out of dropping `tools`. WebLLM only forbids a system
 * message and a custom `response_format` when tools are present, so both come
 * back — the language card can be a real system prompt again. And `say` stops
 * being a function call and becomes a field, which is a far more natural thing
 * for a small model to fill in than a function it has to remember to invoke.
 */

import type { ToolCall, ToolDef } from "./provider.js";

/** The op meaning "I have nothing to do, I am only talking". */
export const NO_OP = "none";

/** Tools that are speech rather than action, and so are not offered as ops. */
const SPEECH = new Set(["say"]);

type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
};

/**
 * The shape every reply must take.
 *
 * Deliberately flat. A nested `{op, arguments: {...}}` is the natural modelling
 * and the wrong one here: it gives a small model a second object to lose its
 * place in, and the arguments cannot be constrained per-op by a JSON schema
 * anyway. Flattening means every field the model might need is named and typed
 * at the top level, and the ones that do not apply are simply left out.
 */
export function protocolSchema(tools: readonly ToolDef[]): JsonSchema {
  const ops = tools.map((t) => t.function.name).filter((n) => !SPEECH.has(n));

  const properties: Record<string, unknown> = {
    say: {
      type: "string",
      description: "What to tell the player. Always fill this in.",
    },
    code: {
      type: "string",
      description:
        "RoboScript to show them, when an example would help. Empty otherwise.",
    },
    op: {
      type: "string",
      // The whole point. A name outside this list cannot be generated.
      enum: [NO_OP, ...ops],
      description: "The one thing to do, or none.",
    },
  };

  // The union of every parameter any tool takes, declared once. Two tools that
  // share a parameter name share its meaning here — `text` is always the text —
  // so collapsing them is honest rather than merely convenient.
  for (const tool of tools) {
    if (SPEECH.has(tool.function.name)) continue;
    for (const [name, spec] of Object.entries(tool.function.parameters.properties)) {
      properties[name] ??= spec;
    }
  }

  // Only `say` and `op` are required: an op that needs no arguments should not
  // have to invent them, which is exactly the failure this replaces.
  return { type: "object", properties, required: ["say", "op"] };
}

/**
 * How to use the protocol, in the prompt.
 *
 * The schema constrains what the model *can* emit; this tells it what the
 * options mean. Both are needed — a grammar will happily let it pick a valid op
 * for entirely the wrong reason.
 */
export function protocolInstructions(tools: readonly ToolDef[]): string {
  const lines = tools
    .filter((t) => !SPEECH.has(t.function.name))
    .map((t) => {
      const params = Object.keys(t.function.parameters.properties);
      const takes = params.length ? ` (uses ${params.join(", ")})` : " (uses nothing)";
      return `- "${t.function.name}"${takes}: ${t.function.description}`;
    });

  return [
    "Reply with one JSON object and nothing else. It has:",
    '  "say"  — what you are telling the player. Always fill this in.',
    // Described here as well as declared in the schema. A field the shape does
    // not mention is a field the model does not fill in: with `code` in the
    // schema and absent from these lines, every example came back as a
    // sentence inside `say` and the block never appeared.
    '  "code" — RoboScript to show them, whenever the answer involves writing',
    "           any. Put it here and NOT inside `say`. Empty if there is none.",
    '  "op"   — the ONE thing to do this turn, or "none" to just talk.',
    "",
    'Example: {"say":"Sweep the radar as you start.","code":"on start\\n  radar.sweep 60\\nend","op":"none"}',
    "",
    "The ops are:",
    ...lines,
    "",
    "Put the fields an op uses alongside it, at the top level. Leave out the",
    "ones it does not use. Do one thing per reply; you will be asked again.",
  ].join("\n");
}

/**
 * Turn one reply into calls the ordinary agent loop can run.
 *
 * Order matters: speech first, so the player reads why something is about to
 * happen before it happens.
 *
 * Unknown ops still get through — a grammar constrains a well-formed model, and
 * this also runs against replies that arrived some other way — so they are
 * passed along rather than dropped, and the tool runner reports them as the
 * unknown tools they are.
 */
export function callsFromReply(reply: unknown, tools: readonly ToolDef[]): ToolCall[] {
  if (!reply || typeof reply !== "object") return [];
  const body = reply as Record<string, unknown>;
  const calls: ToolCall[] = [];

  const say = typeof body["say"] === "string" ? body["say"].trim() : "";
  // A field of its own rather than a convention about prose. Asked for an
  // example of a change, a small model would describe one — "turn left to
  // avoid the hill" — and never write a line of RoboScript, because nothing in
  // a sentence obliges it to. A named, empty box does.
  const code = typeof body["code"] === "string" ? body["code"].trim() : "";
  if (say || code) {
    calls.push({
      id: `say-${calls.length}`,
      type: "function",
      // Kept apart rather than glued into the sentence, so the panel can show
      // it as code and the compiler can be pointed at it.
      function: {
        name: "say",
        // `code` is omitted rather than sent empty: it is the panel's signal
        // that there is a block to render, and an empty one is not a block.
        arguments: JSON.stringify(code ? { text: say, code } : { text: say }),
      },
    });
  }

  const op = typeof body["op"] === "string" ? body["op"] : NO_OP;
  if (op && op !== NO_OP) {
    // Hand the op only the fields it declares. The reply carries the union of
    // everyone's parameters, and passing a stray `start_line` to a tool that
    // does not take one is how a tool ends up guessing.
    const tool = tools.find((t) => t.function.name === op);
    const wanted = tool ? Object.keys(tool.function.parameters.properties) : [];
    const args: Record<string, unknown> = {};
    for (const name of wanted) {
      if (body[name] !== undefined) args[name] = body[name];
    }
    calls.push({
      id: `op-${calls.length}`,
      type: "function",
      function: { name: op, arguments: JSON.stringify(args) },
    });
  }

  return calls;
}

/**
 * Rewrite an OpenAI tool exchange as plain conversation.
 *
 * The loop above records what it did in the standard way: an assistant turn
 * carrying `tool_calls`, then a `tool` turn carrying each result. Those roles
 * only mean anything to a backend that was told about tools, and this one
 * deliberately was not — so the chat template has no idea how to render them
 * and the request fails on the second round, the moment there is any history.
 *
 * So the same exchange is retold as speech. The assistant says what it did; the
 * player reports back what happened. That is information the model can use,
 * in a shape every instruct model understands, and it keeps the tool plumbing
 * above this file completely standard.
 */
export function flattenToolTurns(
  messages: readonly {
    role: string;
    content: string | null;
    tool_calls?: readonly ToolCall[];
    tool_call_id?: string;
  }[],
): { role: "system" | "user" | "assistant"; content: string }[] {
  const out: { role: "system" | "user" | "assistant"; content: string }[] = [];
  // Which call each result belongs to, so a result can name the op it answers.
  const opFor = new Map<string, string>();

  for (const message of messages) {
    if (message.role === "assistant" && message.tool_calls?.length) {
      for (const call of message.tool_calls) opFor.set(call.id, call.function.name);
      const did = message.tool_calls
        .filter((c) => c.function.name !== "say")
        .map((c) => c.function.name);
      const said = message.tool_calls
        .filter((c) => c.function.name === "say")
        .map((c) => {
          try {
            return String((JSON.parse(c.function.arguments) as { text?: unknown }).text ?? "");
          } catch {
            return "";
          }
        })
        .filter(Boolean);
      const parts = [...said];
      if (did.length) parts.push(`(ran ${did.join(", ")})`);
      if (parts.length) out.push({ role: "assistant", content: parts.join(" ") });
      continue;
    }

    if (message.role === "tool") {
      const op = (message.tool_call_id && opFor.get(message.tool_call_id)) || "that";
      out.push({ role: "user", content: `Result of ${op}: ${message.content ?? ""}` });
      continue;
    }

    if (message.role === "system" || message.role === "user" || message.role === "assistant") {
      out.push({ role: message.role, content: message.content ?? "" });
    }
  }

  return out;
}

/**
 * Read the model's output as JSON.
 *
 * Grammar-constrained output should already be exactly one object, but this
 * runs against whatever actually arrives: a stray ``` fence, a sentence of
 * preamble, a trailing newline. Finding the outermost braces costs nothing and
 * saves a whole turn.
 */
export function parseReply(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
