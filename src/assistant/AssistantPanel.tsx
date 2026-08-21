/**
 * The assistant, as a panel in the Workshop sidebar.
 *
 * It looks like the chat panel next to it on purpose: a conversation is a
 * conversation, and the player already knows how that widget works. The only
 * new thing it shows is a line for each action taken on their script, so that
 * "it changed something and I do not know what" never happens.
 *
 * The loading story is most of this file, and deliberately so. Turning this on
 * downloads several gigabytes of model weights, which is not something to do to
 * somebody's connection because they clicked a panel open. So nothing happens
 * until a button that names the real size is pressed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Agent, type Entry } from "./agent.js";
import { hasSubject, systemPrompt, retrieve, retrieveExample } from "./knowledge.js";
import { triage } from "./triage.js";
import {
  EXPLAINER_TOOL_DEFS,
  SAY_ONLY_TOOL_DEFS,
  numberLines,
  TOOL_DEFS,
  type EditorHandle,
  type ToolContext,
} from "./tools.js";
import { checkScript } from "../sim/world.js";
import { CodeEditor } from "../ui/CodeEditor.js";
import { assistantRuntime, downloadSizeGB, type LoadProgress } from "./runtime.js";
import { useAssistantUsable } from "./useAssistant.js";
import type { ChatProvider } from "./provider.js";
import type { Contender } from "../workshop/trials.js";
import type { ArenaSpec } from "../sim/types.js";
import type { Theme } from "../lang/vocab.js";

const MAX_QUESTION_LENGTH = 300;

/**
 * `asking` is the moment before we know whether the model is already here.
 * Brief, and worth having: showing a download button and then snatching it away
 * a beat later is worse than showing nothing at all for that beat.
 */
type Status = "asking" | "cold" | "loading" | "ready" | "failed";

interface Props {
  theme: Theme;
  modelId: string;
  /** The live editor, so the assistant can read and change the script. */
  editorRef: React.MutableRefObject<EditorHandle | null>;
  /**
   * The script as text.
   *
   * Not read off `editorRef`, which is only populated while the Editor tab is
   * on screen — asking about your robot from the test bench got an assistant
   * that could not see it at all.
   */
  script: string;
  opponents: Contender[];
  arena: ArenaSpec | undefined;
  /** False while the player is only looking at somebody else's robot. */
  editable: boolean;
}

export function AssistantPanel({
  theme,
  modelId,
  editorRef,
  script,
  opponents,
  arena,
  editable,
}: Props) {
  const [status, setStatus] = useState<Status>("asking");
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const providerRef = useRef<ChatProvider | null>(null);
  const agentRef = useRef<Agent | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The agent outlives any one question, so its context must not capture what
  // was true when it was built. The editor in particular is remounted whenever
  // the player switches robot, and an agent holding the previous view would be
  // typing into a document nobody is looking at.
  /** The question before this one, and the last thing worth looking up. */
  const lastQuestion = useRef<string | null>(null);
  const lastTopic = useRef<string | null>(null);

  const latest = useRef({ opponents, arena });
  latest.current = { opponents, arena };

  const runtime = useMemo(() => assistantRuntime(), []);
  const supported = useAssistantUsable();
  const size = downloadSizeGB(modelId);

  // What this runtime can actually carry, and what it can be trusted with. A
  // tight budget gets the short card and the tools that cannot write — a local
  // model of this size explains RoboScript well and cannot compose it at all,
  // so the editing tools are absent rather than merely discouraged. See
  // `PromptBudget` and `EXPLAINER_TOOL_NAMES`.
  const budget = runtime?.promptBudget ?? "roomy";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries.length, thinking]);

  // Let go of the GPU when the player leaves the Workshop. A model left resident
  // is several gigabytes of video memory held for a screen nobody is looking at.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      providerRef.current?.dispose();
      providerRef.current = null;
      agentRef.current = null;
    };
  }, []);

  // Already downloaded means already agreed to. The consent this asks for is
  // about somebody's connection and disk, and neither is spent twice — so the
  // second visit goes straight to loading and then to a chat box, which is
  // what was wanted both times.
  useEffect(() => {
    if (!runtime || supported !== true) return;
    let cancelled = false;
    void runtime.isCached(modelId).then((cached) => {
      if (cancelled) return;
      if (cached) void load();
      else setStatus("cold");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, runtime, supported]);

  const load = useCallback(async () => {
    if (!runtime) return;
    setStatus("loading");
    setFailure(null);
    try {
      providerRef.current = await runtime.create(modelId, setProgress);
      setStatus("ready");
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "The assistant could not start.");
      setStatus("failed");
    }
  }, [modelId, runtime]);

  const ask = useCallback(
    async (question: string) => {
      const provider = providerRef.current;
      if (!provider) return;

      setEntries((prev) => [...prev, { kind: "player", text: question }]);
      setThinking(true);

      // Offer `check_script` only while there is something wrong to look at.
      // On a script that already compiles it is the only op available, so a
      // small model calls it every turn, learns nothing, repeats itself, and
      // burns the whole round cap. With no op to reach for, the turn is speech,
      // and speech ends the turn.
      const broken = script.trim() ? !checkScript(script).ok : false;
      const tools =
        budget !== "tight" ? TOOL_DEFS : broken ? EXPLAINER_TOOL_DEFS : SAY_ONLY_TOOL_DEFS;

      const controller = new AbortController();
      abortRef.current = controller;

      // Read through on every tool call rather than captured once, so the
      // assistant always acts on the editor that is actually on screen.
      const ctx: ToolContext = {
        get view() {
          return editorRef.current;
        },
        get opponents() {
          return latest.current.opponents;
        },
        get arena() {
          return latest.current.arena;
        },
        // Speech already reaches the transcript through the agent; this is the
        // hook for anything else that might want to hear it.
        onSay: () => {},
      };

      // Built once and kept, so the conversation has a memory across questions.
      if (!agentRef.current) {
        agentRef.current = new Agent(systemPrompt(theme, budget), {
          provider,
          tools,
          ctx,
          onEntry: (entry) => setEntries((prev) => [...prev, entry]),
          // Nothing to work through when it can only talk, so a turn that has
          // not landed in three goes will not land in six.
          ...(budget === "tight" ? { maxRounds: 3 } : {}),
        });
      }

      // The lesson that bears on this question, if there is one. Retrieved per
      // question rather than kept in the prompt, because the context window
      // cannot hold seventeen chapters and only one of them is ever relevant.
      // Sort the question before answering it. Looking up a lesson for every
      // question is how "can you see my script?" got answered with a chapter
      // about sense cones — see `triage.ts`.
      const composes = runtime?.models.find((m) => m.id === modelId)?.composes ?? true;

      const routed = await triage(provider, question, lastQuestion.current ?? undefined);
      lastQuestion.current = question;

      // A follow-up that names nothing of its own — "can you give an example?"
      // — borrows the subject of the question before it. One that names
      // something does NOT, however little the sorter made of it: an inherited
      // subject on a question that had its own is how "can I ping them twice
      // and diff the x,y?" came back as "change the colour of your robot".
      const topic =
        routed.topic || (hasSubject(question) ? question : (lastTopic.current ?? question));
      if (routed.kind === "language") lastTopic.current = topic;

      // Gathered for this question only, and deliberately not remembered.
      const parts: string[] = [];

      // On a tight budget the script is given rather than fetched. A small
      // model handed a tool for reading it will read it, and read it again,
      // until the round cap stops it — see `EXPLAINER_TOOL_NAMES`.
      // Always, including when the question is about the assistant itself.
      // "Can you see my script?" was being answered without the script in
      // front of it, which made the honest answer a lucky guess.
      if (budget === "tight" && script.trim()) {
        parts.push(`My script right now:\n${numberLines(script)}`);
        // Volunteered rather than waited for. "Why will this not work?" is one
        // of the two questions people actually ask, and the answer is usually
        // sitting in the compiler already — a model that has to remember to go
        // and look for it will often not bother.
        const check = checkScript(script);
        if (!check.ok) {
          parts.push(
            `It does not compile. Line ${check.error?.line}: ${check.error?.message}` +
              (check.error?.hint ? ` (${check.error.hint})` : ""),
          );
        }
      }

      // Only a question about the language gets a lesson, and it is looked up
      // by the topic the sorting call named rather than by the whole sentence,
      // so "can you see my script" cannot match on the word "see".
      // A question about their own script often wants a lesson too — "what do
      // I need to change to avoid hills" is about their robot AND about the
      // ground, and answering it without the terrain chapter produced advice
      // to drive up and down hills, which is the opposite of the lesson's
      // point. One chapter rather than two, because the script is in the
      // window as well and something has to give.
      const lessons =
        routed.kind === "language"
          ? retrieve(topic, theme)
          : routed.kind === "script"
            ? retrieve(topic, theme, 1)
            : [];
      if (lessons.length) parts.push(lessons.join("\n\n"));
      const material = parts.join("\n\n");

      // A model that does not compose gets an example anyway — quoted from a
      // lesson, attributed, and known to compile because every lesson example
      // is built on every test run. Attached after the answer rather than
      // inside it, so it is plainly somebody else's code and not a claim.
      const quotation =
        !composes && routed.kind !== "assistant"
          ? retrieveExample(topic || question, theme)
          : null;

      try {
        await agentRef.current.ask(question, controller.signal, tools, material || undefined);
        if (quotation && !controller.signal.aborted) {
          setEntries((prev) => [
            ...prev,
            {
              kind: "assistant",
              text: "",
              code: quotation.code,
              codeFrom: quotation.from,
            },
          ]);
        }

      } finally {
        setThinking(false);
        abortRef.current = null;
      }
    },
    [budget, editorRef, script, theme]
  );

  // Nothing at all until we know, and nothing ever if the answer is no. The
  // Workshop does not offer the tray in that case either, so this is only
  // reached by a machine that changed its mind mid-session.
  if (supported !== true) return null;

  return (
    <section className="panel chat-panel assistant-panel">
      <div className="panel-head">
        <span className="silkscreen">Assistant</span>
        <span className="spacer" />
        {status === "ready" && entries.length > 0 ? (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              agentRef.current?.reset();
              lastQuestion.current = null;
              lastTopic.current = null;
              setEntries([]);
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      {status === "cold" || status === "failed" ? (
        <div className="panel-body">
          <p className="empty small">
            Someone to ask about RoboScript. It can read your script and explain
            it, but it will not change anything — that is still yours to type.
            {/* Only claimed when it is true. A runtime with nothing to download
                is one doing its thinking somewhere else, and promising privacy
                on its behalf would be a lie. */}
            {size > 0 ? " It runs on your own machine — nothing you write is sent anywhere." : null}
          </p>
          {failure ? <p className="notice bad">{failure}</p> : null}
          <button type="button" className="btn small" onClick={() => void load()}>
            {size > 0 ? `Download and start (${size} GB, once)` : "Start the assistant"}
          </button>
        </div>
      ) : null}

      {status === "loading" ? (
        <div className="panel-body">
          <p className="empty small">{progress?.text ?? "Starting…"}</p>
          {progress?.fraction !== null && progress?.fraction !== undefined ? (
            <progress className="assistant-progress" value={progress.fraction} max={1} />
          ) : null}
        </div>
      ) : null}

      {status === "ready" ? (
        <>
          <div className="chat-log">
            {entries.length === 0 ? (
              <p className="empty small">
                Ask for something — &ldquo;make it dodge bullets&rdquo;, or &ldquo;why will this not
                compile?&rdquo;
              </p>
            ) : null}
            {entries.map((entry, i) => (
              <div
                key={i}
                className={
                  entry.kind === "player"
                    ? "chat-line mine"
                    : entry.kind === "action"
                      ? "chat-line action"
                      : entry.kind === "error"
                        ? "chat-line bad"
                        : "chat-line"
                }
              >
                {entry.kind === "action" ? (
                  <span className="chat-text">It {entry.text}.</span>
                ) : (
                  <>
                    <span className="chat-who">{entry.kind === "player" ? "You" : "Assistant"}</span>
                    {entry.text ? <span className="chat-text">{entry.text}</span> : null}
                    {/* The editor's own highlighter, in preview mode: the same
                        colours as the script it is talking about, and no second
                        implementation to drift from the language. */}
                    {entry.kind === "assistant" && entry.code ? (
                      <div className={`chat-code${entry.codeError ? " suspect" : ""}`}>
                        <CodeEditor
                          source={entry.code}
                          theme={theme}
                          onChange={() => {}}
                          preview
                          // Copyable only when it builds. Something you cannot
                          // lift out is something you have to read as you
                          // retype, which is exactly the right amount of
                          // friction for an example known to be wrong.
                          copyable={!entry.codeError}
                        />
                        {entry.codeFrom ? (
                          <span className="chat-code-from">from “{entry.codeFrom}”</span>
                        ) : null}
                        {entry.codeError ? (
                          <span className="chat-code-warn" title={entry.codeError}>
                            ⚠ will not compile
                          </span>
                        ) : (
                          /* Selecting inside an editor is fiddly with a mouse
                             and worse on a trackpad, and this is the one thing
                             the player has to get out of the panel. */
                          <button
                            type="button"
                            className="chat-code-copy"
                            onClick={() => void navigator.clipboard?.writeText(entry.code ?? "")}
                          >
                            Copy
                          </button>
                        )}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ))}
            {thinking ? <div className="chat-line action">
              <span className="chat-text">Thinking…</span>
            </div> : null}
            <div ref={endRef} />
          </div>
          <form
            className="chat-compose"
            onSubmit={(e) => {
              e.preventDefault();
              const text = draft.trim().slice(0, MAX_QUESTION_LENGTH);
              if (!text || thinking) return;
              setDraft("");
              void ask(text);
            }}
          >
            <input
              className="text-input"
              value={draft}
              maxLength={MAX_QUESTION_LENGTH}
              placeholder={editable ? "Ask for help…" : "Ask about this robot…"}
              onChange={(e) => setDraft(e.target.value)}
              disabled={thinking}
            />
            <button type="submit" className="btn small" disabled={thinking || draft.trim() === ""}>
              Ask
            </button>
          </form>
        </>
      ) : null}
    </section>
  );
}
