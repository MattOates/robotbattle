/**
 * Runs and draws a match. Used by every screen that shows a battle: the
 * Workshop's trial panel, the Arena's fullscreen view, the tournament, and the
 * live background behind the main menu.
 *
 * The loop is the one place where real time meets simulation time. Real time
 * only decides HOW MANY ticks to run; it never reaches the simulation, which
 * always advances by exactly DT. That is what keeps a match on a slow laptop
 * identical to the same match on a fast one.
 */

import { useEffect, useRef } from "react";
import { ArenaRenderer } from "../render/arena.js";
import { hashWorld } from "../sim/hash.js";
import { step } from "../sim/step.js";
import { TICK_RATE, type World } from "../sim/types.js";
import { createWorld, type MatchManifest } from "../sim/world.js";
import { collectTelemetry } from "../sim/telemetry.js";
import { summarise, type MatchResult } from "../sim/match.js";
import type { RobotTelemetry } from "../store/types.js";
import type { Theme } from "../lang/vocab.js";

export interface MatchStatus {
  tick: number;
  over: boolean;
  hash: string;
  winnerName: string | null;
  robots: Array<{
    id: number;
    name: string;
    declaredName: string;
    color: string;
    health: number;
    kills: number;
    damageDealt: number;
    alive: boolean;
    error: string | null;
  }>;
}

export interface MatchOutcome {
  result: MatchResult;
  telemetry: RobotTelemetry[];
}

interface Props {
  manifest: MatchManifest | null;
  theme: Theme;
  showCones: boolean;
  running: boolean;
  /** Increment to advance exactly one tick while paused. */
  stepSignal?: number;
  onStatus?: (status: MatchStatus) => void;
  /** Fired once when a match ends, with everything worth keeping. */
  onFinished?: (outcome: MatchOutcome) => void;
  /**
   * Menu background: when a match ends, start another with a fresh seed.
   * Returns the seed to use.
   */
  autoRestart?: () => number;
  /** `contain` letterboxes inside the panel; `cover` fills the screen. */
  fit?: "contain" | "cover";
  /** Dim and mute the arena so it can sit behind UI. */
  ambient?: boolean;
  className?: string;
}

const TICK_MS = 1000 / TICK_RATE;
/** Never simulate more than this many ticks in one frame after a stall. */
const MAX_CATCHUP = 5;
const STATUS_INTERVAL = 100;

export function MatchCanvas({
  manifest,
  theme,
  showCones,
  running,
  stepSignal = 0,
  onStatus,
  onFinished,
  autoRestart,
  fit = "contain",
  ambient = false,
  className,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<ArenaRenderer | null>(null);
  const worldRef = useRef<World | null>(null);
  const manifestRef = useRef<MatchManifest | null>(manifest);

  // Read inside the animation frame without re-creating it.
  const runningRef = useRef(running);
  const statusRef = useRef(onStatus);
  const finishedRef = useRef(onFinished);
  const restartRef = useRef(autoRestart);
  /** Guards against reporting the same match's end twice. */
  const reportedRef = useRef(false);
  runningRef.current = running;
  statusRef.current = onStatus;
  finishedRef.current = onFinished;
  restartRef.current = autoRestart;

  const readStatus = (world: World): MatchStatus => ({
    tick: world.tick,
    over: world.over,
    hash: hashWorld(world),
    winnerName:
      world.winnerId !== null ? (world.robots[world.winnerId]?.declaredName ?? null) : null,
    robots: world.robots.map((r) => ({
      id: r.id,
      name: r.name,
      declaredName: r.declaredName,
      color: r.color,
      health: r.health,
      kills: r.kills,
      damageDealt: r.damageDealt,
      alive: r.alive,
      error: r.scriptError ? `line ${r.scriptError.line}: ${r.scriptError.message}` : null,
    })),
  });

  // --- renderer lifecycle -------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    const renderer = new ArenaRenderer({ theme, showSenseCones: showCones });
    const width = manifest?.width ?? 900;
    const height = manifest?.height ?? 620;

    void renderer.init(host, width, height).then(() => {
      // React may unmount before Pixi finishes initialising.
      if (cancelled) renderer.destroy();
      else {
        rendererRef.current = renderer;
        if (worldRef.current) renderer.onStep(worldRef.current);
      }
    });

    return () => {
      cancelled = true;
      rendererRef.current = null;
      renderer.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest?.width, manifest?.height]);

  useEffect(() => {
    rendererRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    rendererRef.current?.setShowSenseCones(showCones);
  }, [showCones]);

  // --- new match ----------------------------------------------------------
  useEffect(() => {
    manifestRef.current = manifest;
    reportedRef.current = false;
    if (!manifest) {
      worldRef.current = null;
      rendererRef.current?.reset();
      return;
    }
    const world = createWorld(manifest);
    worldRef.current = world;
    rendererRef.current?.reset();
    rendererRef.current?.onStep(world);
    statusRef.current?.(readStatus(world));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest]);

  // --- the loop -----------------------------------------------------------
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let accumulator = 0;
    let lastStatus = 0;

    const tickLoop = (now: number) => {
      frame = requestAnimationFrame(tickLoop);
      const renderer = rendererRef.current;
      const world = worldRef.current;

      const elapsed = now - last;
      last = now;
      if (!renderer || !world) return;

      if (runningRef.current && !world.over) {
        // Clamping stops a backgrounded tab trying to catch up on thousands of
        // ticks the instant it becomes visible again.
        accumulator = Math.min(accumulator + elapsed, TICK_MS * MAX_CATCHUP);
        while (accumulator >= TICK_MS && !world.over) {
          step(world);
          renderer.onStep(world);
          accumulator -= TICK_MS;
        }
      } else {
        accumulator = 0;
      }

      renderer.draw(accumulator / TICK_MS);

      if (world.over && !reportedRef.current) {
        reportedRef.current = true;
        statusRef.current?.(readStatus(world));
        finishedRef.current?.({
          result: summarise(world),
          telemetry: collectTelemetry(world),
        });

        const restart = restartRef.current;
        const currentManifest = manifestRef.current;
        if (restart && currentManifest) {
          // Menu background: roll straight into another fight.
          const next = createWorld({ ...currentManifest, seed: restart() });
          worldRef.current = next;
          reportedRef.current = false;
          renderer.reset();
          renderer.onStep(next);
        }
      }

      if (now - lastStatus >= STATUS_INTERVAL) {
        lastStatus = now;
        statusRef.current?.(readStatus(world));
      }
    };

    frame = requestAnimationFrame(tickLoop);
    return () => cancelAnimationFrame(frame);
  }, []);

  // --- single step while paused -------------------------------------------
  useEffect(() => {
    if (stepSignal === 0) return;
    const world = worldRef.current;
    if (!world || world.over) return;
    step(world);
    rendererRef.current?.onStep(world);
    statusRef.current?.(readStatus(world));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepSignal]);

  const classes = [
    "match-canvas",
    `fit-${fit}`,
    ambient ? "ambient" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return <div className={classes} ref={hostRef} aria-hidden={ambient || undefined} />;
}
