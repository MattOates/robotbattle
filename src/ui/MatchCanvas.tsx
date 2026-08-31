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
import { observeRobotFuel, TraceRecorder, type InspectionTrace } from "../sim/inspection.js";

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
    /** Which side, counting from zero. */
    team: number;
    error: string | null;
  }>;
  /** True when at least two robots share a side, so the scoreboard groups them. */
  teamed: boolean;
  /** The side that won, counting from zero, or null. */
  winnerTeam: number | null;
}

export interface MatchOutcome {
  result: MatchResult;
  telemetry: RobotTelemetry[];
  inspection?: InspectionTrace;
}

interface Props {
  manifest: MatchManifest | null;
  theme: Theme;
  showCones: boolean;
  running: boolean;
  /** Increment to advance exactly one tick while paused. */
  stepSignal?: number;
  /** Rebuild a paused replay at this tick. Used by the Behaviour Inspector. */
  seekTick?: number;
  /**
   * Playback rate. 1 is real time, which is what a live match must always be;
   * a replay of something already decided can reasonably be skimmed faster.
   */
  speed?: number;
  onStatus?: (status: MatchStatus) => void;
  /** Fired once when a match ends, with everything worth keeping. */
  onFinished?: (outcome: MatchOutcome) => void;
  /** Record semantic script decisions for this entry. Off unless explicitly requested. */
  traceRobotId?: number;
  /**
   * Called once per simulated tick, with the world as it now stands.
   *
   * The one place anything can see `world.effects` before the next `step`
   * throws them away, which is what a commentator needs and what the renderer
   * already uses. **Strictly read-only**: writing here, or drawing from
   * `world.rng`, would change the match and every peer would disagree about
   * what happened.
   */
  onTick?: (world: World) => void;
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
  seekTick,
  speed = 1,
  onStatus,
  onFinished,
  traceRobotId,
  autoRestart,
  onTick,
  fit = "contain",
  ambient = false,
  className,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<ArenaRenderer | null>(null);
  const worldRef = useRef<World | null>(null);
  const manifestRef = useRef<MatchManifest | null>(manifest);
  const traceRef = useRef<TraceRecorder | null>(null);
  const traceRobotRef = useRef<number | undefined>(traceRobotId);

  // Read inside the animation frame without re-creating it.
  const runningRef = useRef(running);
  const speedRef = useRef(speed);
  const statusRef = useRef(onStatus);
  // Held in a ref for the same reason as the others here: the loop is built
  // once, and a caller passing a fresh closure each render must not rebuild it.
  const tickRef = useRef(onTick);
  const finishedRef = useRef(onFinished);
  const restartRef = useRef(autoRestart);
  /** Guards against reporting the same match's end twice. */
  const reportedRef = useRef(false);
  /** Set when a paused arena needs one more frame: a new match, a theme
   * change, a single step. Cleared as soon as that frame is drawn. */
  const redrawRef = useRef(true);
  runningRef.current = running;
  speedRef.current = speed;
  statusRef.current = onStatus;
  tickRef.current = onTick;
  finishedRef.current = onFinished;
  restartRef.current = autoRestart;
  traceRobotRef.current = traceRobotId;

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
      team: r.team,
      error: r.scriptError ? `line ${r.scriptError.line}: ${r.scriptError.message}` : null,
    })),
    teamed: new Set(world.robots.map((r) => r.team)).size < world.robots.length,
    winnerTeam: world.winnerTeam,
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
        redrawRef.current = true;
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
    redrawRef.current = true;
  }, [theme]);

  useEffect(() => {
    rendererRef.current?.setShowSenseCones(showCones);
    redrawRef.current = true;
  }, [showCones]);

  // --- new match ----------------------------------------------------------
  useEffect(() => {
    manifestRef.current = manifest;
    reportedRef.current = false;
    redrawRef.current = true;
    if (!manifest) {
      worldRef.current = null;
      traceRef.current = null;
      rendererRef.current?.reset();
      return;
    }
    const world = createWorld(manifest);
    const tracedSource = traceRobotId === undefined ? null : manifest.entries[traceRobotId]?.source;
    const recorder = tracedSource === null || tracedSource === undefined
      ? null
      : new TraceRecorder(tracedSource);
    if (recorder && traceRobotId !== undefined) {
      const robot = world.robots[traceRobotId];
      if (robot) recorder.seedHandlers(robot.chunk.handlers);
      robot?.vm.setTraceSink(recorder.sink);
      if (robot) recorder.observeFuel(world.tick, robot.fuel);
    }
    traceRef.current = recorder;
    worldRef.current = world;
    rendererRef.current?.reset();
    rendererRef.current?.onStep(world);
    statusRef.current?.(readStatus(world));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, traceRobotId]);

  useEffect(() => {
    if (seekTick === undefined || !manifest) return;
    const world = createWorld(manifest);
    const target = Math.max(0, Math.min(world.maxTicks, Math.floor(seekTick)));
    while (!world.over && world.tick < target) step(world);
    worldRef.current = world;
    reportedRef.current = world.over || world.tick >= world.maxTicks;
    rendererRef.current?.reset();
    rendererRef.current?.onStep(world);
    redrawRef.current = true;
    statusRef.current?.(readStatus(world));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekTick, manifest]);

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

      // A match that reaches its tick limit is a draw, and is over as far as
      // this screen is concerned. Without this the loop would keep stepping a
      // world nobody can win — forever, and never reporting a result.
      const limit = manifestRef.current?.maxTicks ?? Number.POSITIVE_INFINITY;
      const ended = () => world.over || world.tick >= limit;

      if (runningRef.current && !ended()) {
        const rate = Math.max(0.1, speedRef.current);
        // Clamping stops a backgrounded tab trying to catch up on thousands of
        // ticks the instant it becomes visible again. The allowance scales with
        // the playback rate, so a fast replay is not clamped back to real time.
        accumulator = Math.min(accumulator + elapsed * rate, TICK_MS * MAX_CATCHUP * rate);
        while (accumulator >= TICK_MS && !ended()) {
          step(world);
          const recorder = traceRef.current;
          const robotId = traceRobotRef.current;
          if (recorder && robotId !== undefined) observeRobotFuel(recorder, world, robotId);
          renderer.onStep(world);
          tickRef.current?.(world);
          accumulator -= TICK_MS;
        }
      } else {
        accumulator = 0;
      }

      // A paused arena has nothing new to show, and a lesson page holds three
      // of them. Redrawing an unchanging picture sixty times a second is pure
      // heat, so a stopped arena paints once — when something asks it to — and
      // then leaves the GPU alone.
      //
      // Only the drawing is skipped, deliberately. Everything around it — the
      // simulation, the end-of-match report, the status callback — runs on
      // every frame regardless, so a mistake in the condition below can cost
      // a wasted repaint but can never stop a match from running.
      const owed = redrawRef.current || (ended() && !reportedRef.current) || renderer.animating;
      if (runningRef.current || owed) {
        redrawRef.current = false;
        renderer.draw(accumulator / TICK_MS);
      }

      if (ended() && !reportedRef.current) {
        reportedRef.current = true;
        statusRef.current?.(readStatus(world));
        const inspection = traceRef.current?.trace;
        finishedRef.current?.({
          result: summarise(world),
          telemetry: collectTelemetry(world),
          ...(inspection ? { inspection } : {}),
        });

        const restart = restartRef.current;
        const currentManifest = manifestRef.current;
        if (restart && currentManifest) {
          // Menu background: roll straight into another fight.
          const next = createWorld({ ...currentManifest, seed: restart() });
          traceRef.current = null;
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
    const recorder = traceRef.current;
    const robotId = traceRobotRef.current;
    if (recorder && robotId !== undefined) observeRobotFuel(recorder, world, robotId);
    rendererRef.current?.onStep(world);
    tickRef.current?.(world);
    redrawRef.current = true;
    statusRef.current?.(readStatus(world));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepSignal]);

  const classes = ["match-canvas", `fit-${fit}`, ambient ? "ambient" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return <div className={classes} ref={hostRef} aria-hidden={ambient || undefined} />;
}
