/**
 * A lesson's live example: a small editor and a small arena, side by side.
 *
 * Built entirely from parts that already exist. The arena is deliberately
 * small — robots start close together, so a lesson about turning or sensing
 * makes its point in seconds rather than half a minute.
 *
 * Edits live in component state and are never saved to the library. A tutorial
 * page is a scratch pad; nobody should build their real robot here and lose it
 * by clicking Next.
 */

import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { CodeEditor } from "../ui/CodeEditor.js";
import { MatchCanvas, type MatchStatus } from "../ui/MatchCanvas.js";
import { checkScript, makeManifest, type MatchManifest } from "../sim/world.js";
import { SAMPLE_BOTS } from "../bots/index.js";
import type { Theme } from "../lang/vocab.js";

interface Props {
  /** Already translated into the reader's world. */
  source: string;
  /**
   * Sample-bot ids to fight, from the fence's `opponents=` parameter, comma
   * separated. Deliberately a string rather than an array: an array literal
   * from the caller is a new value on every render, which would rebuild the
   * manifest every render and restart the match under the reader.
   */
  opponents: string;
  theme: Theme;
  /** Draw the sense cones — worth it in the lesson about sensing. */
  cones?: boolean;
}

const ARENA = { width: 460, height: 320 } as const;

export function Playground({ source, opponents, theme, cones = false }: Props) {
  const [code, setCode] = useState(source);
  const [seed, setSeed] = useState(1);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<MatchStatus | null>(null);

  // Switching world re-translates the example, which means starting over.
  useEffect(() => {
    setCode(source);
    setRunning(false);
    setSeed((s) => s + 1);
  }, [source]);

  const check = checkScript(code);

  const others = useMemo(() => {
    const wanted = opponents.split(",").filter(Boolean);
    return SAMPLE_BOTS.filter((bot) => wanted.includes(bot.id));
  }, [opponents]);

  // Only built when the script compiles: `createWorld` parses, so handing it a
  // broken script would throw inside the renderer rather than showing the
  // error the editor has already underlined.
  const manifest = useMemo<MatchManifest | null>(() => {
    if (!check.ok) return null;
    return makeManifest(
      [{ source: code }, ...others.map((bot) => ({ source: bot.source }))],
      { seed, width: ARENA.width, height: ARENA.height, maxTicks: 30 * 45 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, others]);

  const play = () => {
    if (!check.ok) return;
    setSeed((s) => s + 1);
    setRunning(true);
  };

  const reset = () => {
    setCode(source);
    setRunning(false);
    setSeed((s) => s + 1);
  };

  return (
    <div className="playground">
      <div className="playground-editor">
        <CodeEditor source={code} theme={theme} onChange={setCode} />
      </div>

      <div className="playground-arena">
        <MatchCanvas
          manifest={manifest}
          theme={theme}
          showCones={cones}
          running={running}
          onStatus={setStatus}
        />
        <div className="playground-controls">
          <button
            type="button"
            className="btn small primary"
            onClick={play}
            disabled={!check.ok}
            title={check.ok ? undefined : "Fix the error before running it"}
          >
            {running ? "Run again" : "Play"}
          </button>
          <button type="button" className="btn small" onClick={reset}>
            Reset
          </button>
          <span className="spacer" />
          <span className="roster-meta">
            {!check.ok
              ? "Not running — there is a mistake"
              : status?.over
                ? status.winnerName
                  ? `${status.winnerName} won`
                  : "Nobody left"
                : running
                  ? `tick ${status?.tick ?? 0}`
                  : others.length > 0
                    ? `vs ${others.map((b) => b.title).join(", ")}`
                    : "on its own"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * A lesson page holds several independent examples, and React unmounts an
 * entire tree when a component throws. Without a boundary, one arena failing
 * takes every other example on the page — and the prose — down with it, which
 * is exactly the wrong failure for a tutorial. Each example is fenced off so
 * the worst case is one dead widget on an otherwise readable page.
 */
export class PlaygroundBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <div className="playground playground-failed">
          <p className="roster-meta">
            This example could not be shown. The rest of the lesson still works —
            reloading the page usually brings it back.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
