/** Behaviour-level execution traces and compact coverage summaries. */

import type { Value } from "../lang/bytecode.js";
import type { VmTraceEntry, VmTraceSink } from "../lang/vm.js";
import type { RobotTelemetry } from "../store/types.js";
import { summarise, type MatchResult } from "./match.js";
import { step } from "./step.js";
import { collectTelemetry } from "./telemetry.js";
import { createWorld, type MatchManifest } from "./world.js";
import { TICK_RATE, type World } from "./types.js";

export interface LineCoverage {
  executions: number;
  conditions: number;
  trueBranches: number;
  falseBranches: number;
  actions: number;
  suspensions: number;
  errors: number;
}

export interface EventCoverage {
  queued: number;
  handled: number;
  dropped: number;
}

export interface ScriptCoverage {
  sourceHash: string;
  lines: Record<number, LineCoverage>;
  events: Record<string, EventCoverage>;
}

type RawDecisionEntry = Extract<
  VmTraceEntry,
  { kind: "handler" | "condition" | "action" | "wait" | "suspend" | "error" }
>;

interface TimelineMetadata {
  occurrences?: number;
  endTick?: number;
  /** Fuel/food remaining after the last tick represented by this run. */
  endFuel?: number;
}

/** The arena-side pickup, distinct from the handler it may wake next tick. */
interface FuelPickupEntry extends TimelineMetadata {
  kind: "fuel";
  tick: number;
  line: 0;
  event: "fuel collected";
  amount: number;
}

/** A meaningful timeline moment. Repeated tick-rate work is one continuous run. */
export type DecisionEntry = (RawDecisionEntry & TimelineMetadata) | FuelPickupEntry;

export interface InspectionTrace {
  /**
   * Variable slot names, so the inspector can name a snapshot without holding
   * a chunk or recompiling. Empty until a recorder is attached to a robot.
   */
  variableNames: string[];
  timeline: DecisionEntry[];
  coverage: ScriptCoverage;
  truncated: boolean;
}

export function decisionEndTick(entry: DecisionEntry): number {
  return entry.endTick ?? entry.tick;
}

/** Timeline order follows the state shown at the end of each summarised window. */
export function chronologicalDecisions(entries: readonly DecisionEntry[]): DecisionEntry[] {
  return [...entries].sort((a, b) =>
    decisionEndTick(a) - decisionEndTick(b) || a.tick - b.tick,
  );
}

/** VM decisions happen during a tick; pickups are already timestamped after it. */
export function decisionReplayTick(entry: DecisionEntry): number {
  return entry.kind === "fuel" ? entry.tick : decisionEndTick(entry) + 1;
}

const MAX_TIMELINE = 12_000;

export function sourceHash(source: string): string {
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function blankLine(): LineCoverage {
  return {
    executions: 0,
    conditions: 0,
    trueBranches: 0,
    falseBranches: 0,
    actions: 0,
    suspensions: 0,
    errors: 0,
  };
}

function blankEvent(): EventCoverage {
  return { queued: 0, handled: 0, dropped: 0 };
}

export class TraceRecorder {
  readonly trace: InspectionTrace;
  readonly sink: VmTraceSink;
  private timelineRuns = new Map<string, {
    signature: string;
    bucket: number;
    lastTick: number;
    entry: DecisionEntry;
  }>();
  private pendingFuelEntries = new Set<DecisionEntry>();

  constructor(source: string) {
    this.trace = {
      variableNames: [],
      timeline: [],
      coverage: { sourceHash: sourceHash(source), lines: {}, events: {} },
      truncated: false,
    };
    this.sink = (entry) => this.record(entry);
  }

  /** Include handlers whose events never occur, which is often the key finding. */
  seedHandlers(handlers: Readonly<Record<string, number>>): void {
    for (const name of Object.keys(handlers)) this.event(name);
  }

  /** Slot names for the snapshots the VM records. See `readVariables`. */
  seedVariables(globals: readonly string[]): void {
    this.trace.variableNames = [...globals];
  }

  /** Attach end-of-tick energy to every run active during that tick. */
  observeFuel(tick: number, fuel: number, pickupAmount: number | null = null): void {
    for (const entry of this.pendingFuelEntries) entry.endFuel = fuel;
    this.pendingFuelEntries.clear();

    if (pickupAmount !== null) {
      this.pushTimeline({
        kind: "fuel",
        tick,
        line: 0,
        event: "fuel collected",
        amount: pickupAmount,
        endFuel: fuel,
      });
    }
  }

  private line(line: number): LineCoverage {
    return this.trace.coverage.lines[line] ??= blankLine();
  }

  private event(name: string): EventCoverage {
    return this.trace.coverage.events[name] ??= blankEvent();
  }

  private record(entry: VmTraceEntry): void {
    if (entry.kind === "queued") {
      this.event(entry.event).queued++;
      return;
    }
    if (entry.kind === "dropped") {
      this.event(entry.event).dropped++;
      return;
    }
    if (entry.kind === "line") {
      this.line(entry.line).executions++;
      return;
    }

    const line = this.line(entry.line);
    if (entry.kind === "handler") {
      this.event(entry.event).handled++;
      line.executions++;
    }
    if (entry.kind === "condition") {
      line.conditions++;
      if (entry.result) line.trueBranches++;
      else line.falseBranches++;
    }
    if (entry.kind === "action") line.actions++;
    if (entry.kind === "suspend") line.suspensions++;
    if (entry.kind === "error") line.errors++;

    this.recordTimeline(entry);
  }

  /**
   * A 30 Hz event loop can perform the same decision thousands of times. The
   * heatmap keeps every occurrence; the timeline summarises repeated work in
   * one-second windows. Bounding a run matters: independently grouping a line
   * across the whole match creates overlapping time ranges whose end-state
   * energy cannot be read chronologically.
   */
  private recordTimeline(entry: RawDecisionEntry): void {
    if (entry.kind === "error") {
      const moment = { ...entry } as DecisionEntry;
      if (this.pushTimeline(moment)) this.pendingFuelEntries.add(moment);
      return;
    }

    const site = timelineSite(entry);
    const signature = timelineSignature(entry);
    const bucket = Math.floor(entry.tick / TICK_RATE);
    const previous = this.timelineRuns.get(site);
    if (
      previous &&
      previous.bucket === bucket &&
      previous.signature === signature &&
      entry.tick >= previous.lastTick
    ) {
      previous.lastTick = entry.tick;
      previous.entry.endTick = entry.tick;
      previous.entry.occurrences = (previous.entry.occurrences ?? 1) + 1;
      // The run is labelled with the tick and the energy it ended on, so the
      // values shown beside it have to be the ones from that same moment.
      if ("variables" in entry && "variables" in previous.entry) {
        previous.entry.eventValues = entry.eventValues;
        previous.entry.variables = entry.variables;
      }
      this.pendingFuelEntries.add(previous.entry);
      return;
    }

    const moment = { ...entry, occurrences: 1 } as DecisionEntry;
    if (this.pushTimeline(moment)) {
      this.timelineRuns.set(site, { signature, bucket, lastTick: entry.tick, entry: moment });
      this.pendingFuelEntries.add(moment);
    }
  }

  private pushTimeline(entry: DecisionEntry): boolean {
    if (this.trace.timeline.length >= MAX_TIMELINE) {
      this.trace.truncated = true;
      return false;
    }
    this.trace.timeline.push(entry);
    return true;
  }
}

function timelineSite(entry: RawDecisionEntry): string {
  switch (entry.kind) {
    case "handler": return `handler:${entry.event}`;
    case "condition": return `condition:${entry.event}:${entry.line}`;
    case "action": return `action:${entry.event}:${entry.line}:${entry.action}`;
    case "wait": return `wait:${entry.event}:${entry.line}`;
    case "suspend": return `suspend:${entry.event}:${entry.line}`;
    case "error": return `error:${entry.event}:${entry.line}`;
  }
}

function timelineSignature(entry: RawDecisionEntry): string {
  switch (entry.kind) {
    case "condition": return String(entry.result);
    case "wait": return String(entry.ticks);
    // Action arguments and sensor payloads often change by tiny amounts every
    // tick. Their snapshots remain available on the representative entry; the
    // timeline groups the fact that the same source decision stayed active.
    default: return entry.kind;
  }
}

export interface InspectedMatch {
  result: MatchResult;
  telemetry: RobotTelemetry[];
  trace: InspectionTrace;
}

/**
 * Attach a fresh recorder to one robot in a world that has not been stepped yet.
 * The single place that knows the order this setup has to happen in.
 */
export function attachRecorder(world: World, robotId: number, source: string): TraceRecorder {
  const recorder = new TraceRecorder(source);
  const robot = world.robots[robotId];
  if (robot) {
    recorder.seedHandlers(robot.chunk.handlers);
    recorder.seedVariables(robot.chunk.globals);
    robot.vm.setTraceSink(recorder.sink);
    recorder.observeFuel(world.tick, robot.fuel);
  }
  return recorder;
}

/** Re-run a stored manifest and observe one robot without changing the match. */
export function inspectManifest(manifest: MatchManifest, robotId: number): InspectedMatch {
  const world = createWorld(manifest);
  const recorder = attachRecorder(world, robotId, manifest.entries[robotId]?.source ?? "");
  while (!world.over && world.tick < manifest.maxTicks) {
    step(world);
    observeRobotFuel(recorder, world, robotId);
  }
  return {
    result: summarise(world),
    telemetry: collectTelemetry(world),
    trace: recorder.trace,
  };
}

/** Record the inspected robot's end-of-tick fuel and any real pickup effect. */
export function observeRobotFuel(
  recorder: TraceRecorder,
  world: World,
  robotId: number,
): void {
  const robot = world.robots[robotId];
  if (!robot) return;
  const pickups = world.effects.filter(
    (effect) => effect.type === "pickup" && effect.actorId === robotId,
  );
  const amount = pickups.length > 0
    ? pickups.reduce((total, effect) => total + (effect.amount ?? 0), 0)
    : null;
  recorder.observeFuel(world.tick, robot.fuel, amount);
}

/**
 * Coverage is line-indexed, so merging two scripts adds up unrelated lines. The
 * hash guards it here; callers that hold the sources (see `HistoryPane`) filter
 * on source equality first, because eight hex digits can collide.
 */
export function mergeCoverage(items: readonly ScriptCoverage[]): ScriptCoverage | null {
  const first = items[0];
  if (!first || items.some((item) => item.sourceHash !== first.sourceHash)) return null;
  const merged: ScriptCoverage = { sourceHash: first.sourceHash, lines: {}, events: {} };
  for (const item of items) {
    for (const [rawLine, values] of Object.entries(item.lines)) {
      const line = Number(rawLine);
      const target = merged.lines[line] ??= blankLine();
      for (const key of Object.keys(target) as Array<keyof LineCoverage>) target[key] += values[key];
    }
    for (const [name, values] of Object.entries(item.events)) {
      const target = merged.events[name] ??= blankEvent();
      target.queued += values.queued;
      target.handled += values.handled;
      target.dropped += values.dropped;
    }
  }
  return merged;
}

export function describeDecision(entry: DecisionEntry, fuelWord = "fuel"): string {
  const start = (entry.tick / TICK_RATE).toFixed(1);
  const end = (decisionEndTick(entry) / TICK_RATE).toFixed(1);
  const time = end === start ? `${start}s` : `${start}–${end}s`;
  switch (entry.kind) {
    case "handler": return `${time}  ${entry.event}`;
    case "condition": return `${time}  condition was ${entry.result ? "true" : "false"}`;
    case "action": return `${time}  ${actionWords(entry.action, entry.args)}`;
    case "wait": return `${time}  waited ${entry.ticks} tick${entry.ticks === 1 ? "" : "s"}`;
    case "suspend": return `${time}  ran out of thinking time`;
    case "error": return `${time}  runtime error: ${entry.message}`;
    case "fuel": return `${time}  collected ${formatValue(entry.amount)} ${fuelWord}`;
  }
}

function actionWords(action: string, args: readonly Value[]): string {
  const value = args.map(formatValue).join(", ");
  const names: Record<string, string> = {
    drive: "drive",
    stop: "stop",
    turnBodyTo: "turn body to",
    turnBodyBy: "turn body by",
    turretTurnTo: "turn turret to",
    turretTurnBy: "turn turret by",
    turretAim: "aim turret at",
    turretSweep: "sweep turret",
    fire: "fire",
    radarTurnTo: "turn radar to",
    radarTurnBy: "turn radar by",
    radarAim: "aim radar at",
    radarSweep: "sweep radar",
    ping: "ping",
    broadcast: "broadcast",
  };
  return `${names[action] ?? action}${value ? ` ${value}` : ""}`;
}

function formatValue(value: Value): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (typeof value === "string") return `“${value}”`;
  return String(value);
}
