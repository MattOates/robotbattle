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
import { drivableMazeGrid, generateFittingMaze } from "../sim/maze.js";
import { FUEL_PRESETS, TERRAIN_PRESETS } from "../sim/types.js";
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
  /**
   * Put fuel in the playground. Off by default, and opted into per lesson the
   * same way `cones` is.
   *
   * A lesson teaches one idea, and cells appearing during the lesson on sense
   * cones are an unexplained second one — the reader has no way to find out
   * what the turquoise circles are until much later. So the world a lesson
   * shows stays as small as the lesson, and the lesson that introduces fuel
   * turns it on.
   */
  fuel?: boolean;
  /**
   * Put terrain in the playground. Off for the same reason as fuel: a lesson
   * about turning should not have its robot mysteriously slowing down on a hill
   * nobody has explained yet.
   */
  terrain?: boolean;
  /**
   * Put a labyrinth in the playground.
   *
   * Its own option rather than something the arena always has, for the same
   * reason as fuel and terrain: a lesson should show only as much world as it
   * is teaching. The maze is generated from a fixed seed so that the picture is
   * the same every time the lesson is opened — a chapter about finding your way
   * through *this* maze is easier to follow than one about a different maze
   * each visit.
   */
  maze?: boolean;
  /**
   * How many copies of the reader's own script take the field, on one side.
   *
   * For the lessons where one robot cannot show the idea at all. A flock of one
   * does not flock, and a robot that calls out what it has found has nobody to
   * call to — so the reader edits one script and watches a whole side of them
   * change together, which is the only way those lessons demonstrate anything.
   *
   * Above 1 the copies share a team, and they have to: a robot that identifies
   * its own side by `me.team` would otherwise give every copy a different name
   * for the flock, and they would ignore each other completely.
   */
  copies?: number;
}

const ARENA = { width: 460, height: 320 } as const;

export function Playground({
  source,
  opponents,
  copies = 1,
  theme,
  cones = false,
  fuel = false,
  terrain = false,
  maze = false,
}: Props) {
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
    // Mapped rather than filtered, so `opponents=hunter,hunter` really is two
    // Hunters. Filtering the sample list could only ever yield one of each.
    return opponents
      .split(",")
      .filter(Boolean)
      .map((id) => SAMPLE_BOTS.find((bot) => bot.id === id))
      .filter((bot): bot is (typeof SAMPLE_BOTS)[number] => bot !== undefined);
  }, [opponents]);

  // Only built when the script compiles: `createWorld` parses, so handing it a
  // broken script would throw inside the renderer rather than showing the
  // error the editor has already underlined.
  // Fixed seed, and built once: the playground arena is small, so this is the
  // finest maze a robot can still get down inside it.
  const walls = useMemo(() => {
    if (!maze) return [];
    const grid = drivableMazeGrid(ARENA.width, ARENA.height);
    return generateFittingMaze(20260820, grid.cols, grid.rows, ARENA.width, ARENA.height);
  }, [maze]);

  const manifest = useMemo<MatchManifest | null>(() => {
    if (!check.ok) return null;
    // At one copy this is exactly the arena every existing lesson builds: no
    // teams stated, so nothing that was tuned against it moves.
    const side = Math.max(1, Math.min(6, Math.floor(copies)));
    const entries =
      side > 1
        ? [
            ...Array.from({ length: side }, () => ({ source: code, team: 0 })),
            ...others.map((bot) => ({ source: bot.source, team: 1 })),
          ]
        : [{ source: code }, ...others.map((bot) => ({ source: bot.source }))];
    return makeManifest(entries, {
      seed,
      width: ARENA.width,
      height: ARENA.height,
      maxTicks: 30 * 45,
      fuel: fuel ? FUEL_PRESETS.arena : FUEL_PRESETS.off,
      terrain: terrain ? TERRAIN_PRESETS.arena : TERRAIN_PRESETS.off,
      walls,
      ...(side > 1 ? { friendlyFire: false } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, others, copies, fuel, terrain, walls]);

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
