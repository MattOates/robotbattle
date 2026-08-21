/**
 * What the assistant is allowed to do.
 *
 * Two halves that must stay in step: the JSON Schema the model is shown, and
 * the function that runs when it calls one. They live in one table so that
 * adding a tool is one edit, and so a tool can never be advertised without an
 * implementation behind it.
 *
 * Three decisions worth stating, because they are not obvious:
 *
 * `say` is a tool. WebLLM constrains the model's output grammar to an array of
 * tool calls, which means it physically cannot answer in prose. Speech has to
 * be a function call like everything else.
 *
 * Everything is addressed by *line number*, never by character offset. Offsets
 * are an excellent way to have a small model quietly corrupt somebody's script,
 * and lines are already the shared vocabulary — the status strip under the
 * editor says "Line 4: ...", so when the assistant says line 4 it means the
 * same line the player is looking at.
 *
 * Edits go through `view.dispatch`, not through React state. That is the same
 * route the block shelf takes, and for the reason given in `CodeEditor`: in a
 * shared session the document belongs to the CRDT, and a dispatch is the only
 * edit the other people in the room ever hear about.
 */

import type { EditorState, TransactionSpec } from "@codemirror/state";
import "@codemirror/view";
import { checkScript } from "../sim/world.js";
import type { ToolDef } from "./provider.js";
import type { Contender, TrialReport } from "../workshop/trials.js";
import type { TrialWorkerIn, TrialWorkerOut } from "../workshop/trials.worker.js";
import type { ArenaSpec } from "../sim/types.js";

/**
 * The slice of the editor these tools touch.
 *
 * A real `EditorHandle` satisfies this structurally, so the Workshop passes the
 * same ref it hands the block shelf. Naming the slice rather than the class
 * means the tests can drive real CodeMirror state transactions without a DOM —
 * and it is honest about the coupling, which is to documents and transactions,
 * not to anything on screen.
 */
export interface EditorHandle {
  readonly state: EditorState;
  dispatch(spec: TransactionSpec): void;
}

export interface ToolContext {
  /** The live editor. Null when no script is on screen. */
  view: EditorHandle | null;
  /** Robots to fight when the assistant asks for a trial run. */
  opponents: Contender[];
  arena: ArenaSpec | undefined;
  /** Called with anything the assistant says, so the panel can show it. */
  onSay: (text: string) => void;
}

/** What a tool gives back. `ok: false` is a refusal the model should read and adapt to. */
export interface ToolResult {
  ok: boolean;
  [key: string]: unknown;
}

type Args = Record<string, unknown>;

interface Tool {
  def: ToolDef;
  run(args: Args, ctx: ToolContext): Promise<ToolResult> | ToolResult;
}

// ---------------------------------------------------------------------------
// Argument coercion
// ---------------------------------------------------------------------------

/**
 * The model writes its arguments as a JSON string and is not always careful
 * about types — a line number arrives as `"4"` about as often as `4`. Coercing
 * is friendlier than refusing, and refusing teaches it nothing it can act on.
 */
function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asLine(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^\s*-?\d+\s*$/.test(value)) return parseInt(value, 10);
  return null;
}

/**
 * The editor, if it is there and writable.
 *
 * Read-only is not an error case to be papered over: it means the player is
 * looking at somebody else's robot, either as a guest in a session or in a
 * trade preview. The assistant editing it would be exactly the leak those
 * screens exist to prevent.
 */
function writableView(ctx: ToolContext): { view: EditorHandle } | ToolResult {
  if (!ctx.view) return { ok: false, error: "There is no script open to edit." };
  if (ctx.view.state.readOnly) {
    return { ok: false, error: "This script belongs to someone else and cannot be edited." };
  }
  return { view: ctx.view };
}

function isRefusal(v: { view: EditorHandle } | ToolResult): v is ToolResult {
  return !("view" in v);
}

/** Apply one change as one dispatch, so one assistant edit is one undo step. */
function applyEdit(view: EditorHandle, from: number, to: number, text: string): ToolResult {
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
  });
  const source = view.state.doc.toString();
  const check = checkScript(source);
  return {
    ok: true,
    lines: view.state.doc.lines,
    // Volunteered rather than waited for. The model is told to check after
    // editing, but small models forget, and a broken script that nobody
    // mentions is the worst outcome here.
    compiles: check.ok,
    ...(check.ok ? {} : { error: `Line ${check.error?.line}: ${check.error?.message}` }),
  };
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const TOOLS: Record<string, Tool> = {
  say: {
    def: {
      type: "function",
      function: {
        name: "say",
        description:
          "Say something to the player. This is the only way to talk to them. Keep it to a sentence or two, in plain words.",
        parameters: {
          type: "object",
          properties: { text: { type: "string", description: "What to tell the player." } },
          required: ["text"],
        },
      },
    },
    run(args, ctx) {
      const text = asString(args["text"]);
      if (!text) return { ok: false, error: "say needs a `text` string." };
      ctx.onSay(text);
      return { ok: true };
    },
  },

  read_script: {
    def: {
      type: "function",
      function: {
        name: "read_script",
        description:
          "Read the player's current script, with a line number on every line. Do this before editing.",
        parameters: { type: "object", properties: {} },
      },
    },
    run(_args, ctx) {
      if (!ctx.view) return { ok: false, error: "There is no script open." };
      const doc = ctx.view.state.doc;
      return { ok: true, lines: doc.lines, script: numberedScript(ctx.view) };
    },
  },

  read_cursor: {
    def: {
      type: "function",
      function: {
        name: "read_cursor",
        description: "Find out which line the player's cursor is on, and what they have selected.",
        parameters: { type: "object", properties: {} },
      },
    },
    run(_args, ctx) {
      if (!ctx.view) return { ok: false, error: "There is no script open." };
      const state = ctx.view.state;
      const range = state.selection.main;
      const line = state.doc.lineAt(range.head);
      return {
        ok: true,
        line: line.number,
        column: range.head - line.from + 1,
        selection: range.empty ? null : state.sliceDoc(range.from, range.to),
      };
    },
  },

  insert_at_cursor: {
    def: {
      type: "function",
      function: {
        name: "insert_at_cursor",
        description:
          "Insert RoboScript at the player's cursor. Use this to add something without disturbing what is already there.",
        parameters: {
          type: "object",
          properties: { text: { type: "string", description: "The RoboScript to insert." } },
          required: ["text"],
        },
      },
    },
    run(args, ctx) {
      const target = writableView(ctx);
      if (isRefusal(target)) return target;
      const text = asString(args["text"]);
      if (text === null) return { ok: false, error: "insert_at_cursor needs a `text` string." };
      const range = target.view.state.selection.main;
      return applyEdit(target.view, range.from, range.to, text);
    },
  },

  replace_lines: {
    def: {
      type: "function",
      function: {
        name: "replace_lines",
        description:
          "Replace a range of lines, counting from 1, with new text. Both ends are included. To delete, pass an empty string.",
        parameters: {
          type: "object",
          properties: {
            start_line: { type: "number", description: "First line to replace, counting from 1." },
            end_line: { type: "number", description: "Last line to replace, included." },
            text: { type: "string", description: "What to put there instead." },
          },
          required: ["start_line", "end_line", "text"],
        },
      },
    },
    run(args, ctx) {
      const target = writableView(ctx);
      if (isRefusal(target)) return target;
      const doc = target.view.state.doc;
      const start = asLine(args["start_line"]);
      const end = asLine(args["end_line"]);
      const text = asString(args["text"]);
      if (start === null || end === null || text === null) {
        return { ok: false, error: "replace_lines needs start_line, end_line and text." };
      }
      if (start < 1 || end < start || end > doc.lines) {
        return {
          ok: false,
          error: `The script has ${doc.lines} lines, so lines ${start} to ${end} are not all there.`,
        };
      }
      return applyEdit(target.view, doc.line(start).from, doc.line(end).to, text);
    },
  },

  replace_document: {
    def: {
      type: "function",
      function: {
        name: "replace_document",
        description:
          "Replace the whole script. Only for starting again from nothing — prefer replace_lines for a change to a script that already works.",
        parameters: {
          type: "object",
          properties: { text: { type: "string", description: "The complete new script." } },
          required: ["text"],
        },
      },
    },
    run(args, ctx) {
      const target = writableView(ctx);
      if (isRefusal(target)) return target;
      const text = asString(args["text"]);
      if (text === null) return { ok: false, error: "replace_document needs a `text` string." };
      return applyEdit(target.view, 0, target.view.state.doc.length, text);
    },
  },

  check_script: {
    def: {
      type: "function",
      function: {
        name: "check_script",
        description:
          "Compile the current script and report any error. Always do this after editing, and fix what it tells you before saying you are finished.",
        parameters: { type: "object", properties: {} },
      },
    },
    run(_args, ctx) {
      if (!ctx.view) return { ok: false, error: "There is no script open." };
      const check = checkScript(ctx.view.state.doc.toString());
      if (check.ok) return { ok: true, compiles: true };
      return {
        ok: true,
        compiles: false,
        line: check.error?.line,
        message: check.error?.message,
        hint: check.error?.hint,
      };
    },
  },

  run_trials: {
    def: {
      type: "function",
      function: {
        name: "run_trials",
        description:
          "Fight the current script against the sample robots several times and report the win rate. Takes a few seconds. Use it to check whether a change actually helped.",
        parameters: {
          type: "object",
          properties: {
            trials: { type: "number", description: "Matches per opponent, 1 to 20. Default 5." },
          },
        },
      },
    },
    async run(args, ctx) {
      if (!ctx.view) return { ok: false, error: "There is no script open." };
      if (ctx.opponents.length === 0) {
        return { ok: false, error: "There is nobody to fight." };
      }
      const source = ctx.view.state.doc.toString();
      const check = checkScript(source);
      if (!check.ok) {
        return { ok: false, error: "The script does not compile yet, so it cannot fight." };
      }
      const trials = Math.min(20, Math.max(1, asLine(args["trials"]) ?? 5));
      const report = await runTrialsInWorker({
        subject: { label: "this robot", source },
        opponents: ctx.opponents,
        trials,
        seedBase: 1,
        ...(ctx.arena ? { arena: ctx.arena } : {}),
      });
      if (report.error) return { ok: false, error: report.error };
      return {
        ok: true,
        winRate: Math.round(report.overallWinRate * 100),
        matches: report.totalMatches,
        // Only the extremes. A full table would cost more of the context window
        // than it could possibly be worth to a model deciding what to try next.
        worstAgainst: report.rows
          .slice()
          .sort((a, b) => a.winRate - b.winRate)
          .slice(0, 2)
          .map((r) => `${r.label}: ${Math.round(r.winRate * 100)}%`),
      };
    },
  },
};

/**
 * Run the bench in the worker the Workshop already uses.
 *
 * A fresh worker per run, then terminated: a sweep is a one-off, and a worker
 * left alive holds its heap for a conversation that may never ask again.
 */
function runTrialsInWorker(request: TrialWorkerIn["request"]): Promise<TrialReport> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workshop/trials.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<TrialWorkerOut>) => {
      const message = event.data;
      if (message.type === "progress") return;
      worker.terminate();
      if (message.type === "done") resolve(message.report);
      else reject(new Error(message.message));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("the test bench stopped unexpectedly"));
    };
    worker.postMessage({ type: "run", request } satisfies TrialWorkerIn);
  });
}

/**
 * The script with a line number on every line.
 *
 * Shared by `read_script` and by callers that would rather hand the script over
 * than be asked for it — see `SIGHTED_TOOL_NAMES`.
 */
export function numberedScript(view: EditorHandle): string {
  const doc = view.state.doc;
  const lines: string[] = [];
  for (let n = 1; n <= doc.lines; n++) lines.push(`${n}: ${doc.line(n).text}`);
  return lines.join("\n");
}

/** The definitions to show the model. */
export const TOOL_DEFS: ToolDef[] = Object.values(TOOLS).map((t) => t.def);

/**
 * The smallest set that can still do the job, for a tight prompt budget.
 *
 * The schemas are not free — all eight cost something like six hundred tokens
 * before the conversation has started, which is a large slice of a small
 * window. These four keep the loop whole: speak, look, change, verify.
 *
 * What goes is what can be done another way. `read_cursor` and `replace_lines`
 * are precision that `read_script` plus `replace_document` can reach less
 * elegantly, and `run_trials` is a luxury for a model that is struggling to
 * write a valid line at all.
 */
export const ESSENTIAL_TOOL_NAMES = ["say", "read_script", "replace_document", "check_script"];

export const ESSENTIAL_TOOL_DEFS: ToolDef[] = ESSENTIAL_TOOL_NAMES.map((n) => TOOLS[n]!.def);

/**
 * The set for a model that may look and talk, and may not touch.
 *
 * This is not caution, it is measurement. Both models that were tried could
 * describe RoboScript from a lesson perfectly well and neither could write a
 * line of it: given the ability to edit, each replaced the player's whole
 * script with something that did not compile, was told exactly what was wrong,
 * and did the same thing again until the round cap stopped it. One wrote the
 * compile error into the script as the new program.
 *
 * The boundary is not model size. "Explain this language from a lesson in front
 * of you" is comfortably within reach; "write valid text in an unfamiliar
 * language and debug it from an error message" is not, and a few more billion
 * parameters moves you along that gradient without crossing it.
 *
 * So the tools that write are simply absent, rather than discouraged in a
 * prompt. A model cannot misuse an op that is not in the enum. `check_script`
 * stays because reading a compile error is exactly the kind of help wanted
 * here, and it changes nothing.
 *
 * `read_script` is absent for a different reason: a small model given a tool
 * for fetching the script fetches it, reads the answer, and fetches it again
 * until the cap, because every turn looks like the first one to it. The caller
 * pastes the script in with `numberedScript` instead.
 */
export const EXPLAINER_TOOL_NAMES = ["say", "check_script"];

export const EXPLAINER_TOOL_DEFS: ToolDef[] = EXPLAINER_TOOL_NAMES.map((n) => TOOLS[n]!.def);

/**
 * Speech and nothing else, for when there is nothing to look at.
 *
 * `check_script` is worth offering only while the script is broken. Left
 * available on a script that already compiles, a small model reaches for it
 * every turn — it is the only op there is — learns nothing, says the same
 * sentence again, and burns the whole round cap doing it. With no op to reach
 * for, the turn is speech, and speech ends the turn.
 */
export const SAY_ONLY_TOOL_DEFS: ToolDef[] = [TOOLS["say"]!.def];

/** Names the panel should render as speech rather than as an action. */
export const SPEECH_TOOLS = new Set(["say"]);

/**
 * Run one call. Never throws: a thrown error would end the conversation, where
 * a returned one is something the model can read and recover from.
 */
export async function runTool(name: string, argsJson: string, ctx: ToolContext): Promise<ToolResult> {
  const tool = TOOLS[name];
  if (!tool) {
    return { ok: false, error: `There is no tool called ${name}.` };
  }
  let args: Args = {};
  if (argsJson.trim()) {
    try {
      const parsed: unknown = JSON.parse(argsJson);
      if (parsed && typeof parsed === "object") args = parsed as Args;
    } catch {
      return { ok: false, error: "Those arguments were not valid JSON. Try again." };
    }
  }
  try {
    return await tool.run(args, ctx);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "That did not work." };
  }
}

/** A short human sentence for a call, for the transcript in the panel. */
export function describeCall(name: string, argsJson: string): string {
  let args: Args = {};
  try {
    args = JSON.parse(argsJson || "{}") as Args;
  } catch {
    /* the description is cosmetic; bad JSON is reported by runTool */
  }
  switch (name) {
    case "read_script":
      return "read your script";
    case "read_cursor":
      return "looked at your cursor";
    case "insert_at_cursor":
      return "typed at your cursor";
    case "replace_lines":
      return `rewrote lines ${String(args["start_line"])}–${String(args["end_line"])}`;
    case "replace_document":
      return "rewrote the whole script";
    case "check_script":
      return "checked it compiles";
    case "run_trials":
      return "ran some test matches";
    default:
      return name;
  }
}
