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
import { systemPrompt, retrieve } from "./knowledge.js";
import { TOOL_DEFS, type EditorHandle, type ToolContext } from "./tools.js";
import { assistantRuntime, downloadSizeGB, type LoadProgress } from "./runtime.js";
import type { ChatProvider } from "./provider.js";
import type { Contender } from "../workshop/trials.js";
import type { ArenaSpec } from "../sim/types.js";
import type { Theme } from "../lang/vocab.js";

const MAX_QUESTION_LENGTH = 300;

type Status = "cold" | "loading" | "ready" | "failed";

interface Props {
  theme: Theme;
  modelId: string;
  /** The live editor, so the assistant can read and change the script. */
  editorRef: React.MutableRefObject<EditorHandle | null>;
  opponents: Contender[];
  arena: ArenaSpec | undefined;
  /** False while the player is only looking at somebody else's robot. */
  editable: boolean;
}

export function AssistantPanel({ theme, modelId, editorRef, opponents, arena, editable }: Props) {
  const [status, setStatus] = useState<Status>("cold");
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
  const latest = useRef({ opponents, arena });
  latest.current = { opponents, arena };

  const runtime = useMemo(() => assistantRuntime(), []);
  const supported = useMemo(() => runtime?.available() ?? false, [runtime]);
  const size = downloadSizeGB(modelId);

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
        agentRef.current = new Agent(systemPrompt(theme), {
          provider,
          tools: TOOL_DEFS,
          ctx,
          onEntry: (entry) => setEntries((prev) => [...prev, entry]),
        });
      }

      // The lesson that bears on this question, if there is one. Retrieved per
      // question rather than kept in the prompt, because the context window
      // cannot hold seventeen chapters and only one of them is ever relevant.
      const lessons = retrieve(question, theme);
      const asked = lessons.length
        ? `${question}\n\nThis may help:\n${lessons.join("\n\n")}`
        : question;

      try {
        await agentRef.current.ask(asked, controller.signal);
      } finally {
        setThinking(false);
        abortRef.current = null;
      }
    },
    [arena, editorRef, opponents, theme],
  );

  // No runtime compiled in, or one that has looked and decided this machine
  // cannot run it. Shown rather than hidden, because a panel that silently
  // vanishes reads as a bug.
  if (!supported) {
    return (
      <section className="panel chat-panel assistant-panel">
        <div className="panel-head">
          <span className="silkscreen">Assistant</span>
        </div>
        <div className="panel-body">
          <p className="empty small">
            {runtime
              ? "This browser cannot run the assistant. Chrome or Edge on a desktop machine will."
              : "This build has no assistant in it."}
          </p>
        </div>
      </section>
    );
  }

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
            A helper that can read your script and change it for you.
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
                    <span className="chat-text">{entry.text}</span>
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
