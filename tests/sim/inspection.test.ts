import { describe, expect, it } from "vitest";
import { runMatch } from "../../src/sim/match.js";
import {
  chronologicalDecisions,
  decisionEndTick,
  decisionReplayTick,
  TraceRecorder,
  inspectManifest,
  mergeCoverage,
  observeRobotFuel,
  sourceHash,
} from "../../src/sim/inspection.js";
import { createWorld, makeManifest } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { FUEL_PRESETS } from "../../src/sim/types.js";
import { SPINNER } from "../../src/bots/index.js";

const SCRIPT = `name "Inspector"
chassis tank
var seen = 0
on start
  drive forward 40
end
on tick
  set seen = seen + 1
  if seen > 2 then
    turn body by 5
  else
    stop
  end
end
`;

describe("Behaviour Inspector", () => {
  it("records handlers, decisions, actions and source coverage", () => {
    const manifest = makeManifest([{ source: SCRIPT }, { source: SPINNER }], { seed: 7 });
    const world = createWorld(manifest);
    const recorder = new TraceRecorder(SCRIPT);
    world.robots[0]!.vm.setTraceSink(recorder.sink);
    for (let i = 0; i < 8; i++) step(world);

    expect(recorder.trace.timeline.some((entry) => entry.kind === "handler" && entry.event === "start")).toBe(true);
    expect(recorder.trace.timeline.some((entry) => entry.kind === "condition" && entry.result)).toBe(true);
    expect(recorder.trace.timeline.some((entry) => entry.kind === "condition" && !entry.result)).toBe(true);
    expect(recorder.trace.timeline.some((entry) => entry.kind === "action" && entry.action === "drive")).toBe(true);
    expect(recorder.trace.coverage.lines[9]?.conditions).toBeGreaterThan(0);
    expect(recorder.trace.coverage.events.tick?.handled).toBeGreaterThan(0);
  });

  it("groups uninterrupted tick-rate work without changing raw coverage", () => {
    const manifest = makeManifest([{ source: SCRIPT }, { source: SPINNER }], { seed: 17 });
    const world = createWorld(manifest);
    const recorder = new TraceRecorder(SCRIPT);
    world.robots[0]!.vm.setTraceSink(recorder.sink);
    for (let i = 0; i < 8; i++) step(world);

    const tickRuns = recorder.trace.timeline.filter(
      (entry) => entry.kind === "handler" && entry.event === "tick",
    );
    expect(tickRuns).toHaveLength(1);
    expect(tickRuns[0]?.occurrences).toBe(8);
    expect(tickRuns[0]?.endTick).toBe(7);
    expect(recorder.trace.coverage.events.tick?.handled).toBe(8);

    const outcomes = recorder.trace.timeline
      .filter((entry) => entry.kind === "condition")
      .map((entry) => entry.result);
    expect(outcomes).toEqual([false, true]);
  });

  it("bounds long-running summaries so their end states stay chronological", () => {
    const manifest = makeManifest([{ source: SCRIPT }, { source: SPINNER }], { seed: 19 });
    const world = createWorld(manifest);
    const recorder = new TraceRecorder(SCRIPT);
    const robot = world.robots[0]!;
    robot.vm.setTraceSink(recorder.sink);
    recorder.observeFuel(world.tick, robot.fuel);
    for (let i = 0; i < 65; i++) {
      step(world);
      observeRobotFuel(recorder, world, 0);
    }

    const tickRuns = recorder.trace.timeline.filter(
      (entry) => entry.kind === "handler" && entry.event === "tick",
    );
    expect(tickRuns).toHaveLength(3);
    for (const run of tickRuns) {
      expect(Math.floor((run.endTick ?? run.tick) / 30)).toBe(Math.floor(run.tick / 30));
    }
    const chronological = chronologicalDecisions(recorder.trace.timeline);
    expect(chronological.map(decisionEndTick)).toEqual(
      [...chronological.map(decisionEndTick)].sort((a, b) => a - b),
    );
    expect(decisionReplayTick(tickRuns[0]!)).toBe(decisionEndTick(tickRuns[0]!) + 1);
  });

  it("shows pickups and the energy at the end of each active run", () => {
    const manifest = makeManifest([{ source: SCRIPT }, { source: SPINNER }], {
      seed: 27,
      fuel: { ...FUEL_PRESETS.arena, maxOnField: 0 },
    });
    const world = createWorld(manifest);
    const robot = world.robots[0]!;
    robot.fuel = 20;
    world.fuel.push({ id: 1, x: robot.x, y: robot.y, amount: 25 });
    const recorder = new TraceRecorder(SCRIPT);
    robot.vm.setTraceSink(recorder.sink);
    recorder.observeFuel(world.tick, robot.fuel);

    step(world);
    observeRobotFuel(recorder, world, 0);

    const pickup = recorder.trace.timeline.find((entry) => entry.kind === "fuel");
    expect(pickup).toMatchObject({ amount: 25, endFuel: robot.fuel });
    expect(decisionReplayTick(pickup!)).toBe(pickup!.tick);
    expect(recorder.trace.timeline.some((entry) => entry.endFuel === robot.fuel)).toBe(true);
  });

  it("does not change the deterministic result", () => {
    const manifest = makeManifest([{ source: SCRIPT }, { source: SPINNER }], { seed: 71 });
    const ordinary = runMatch(manifest);
    const inspected = inspectManifest(manifest, 0);
    expect(inspected.result.finalHash).toBe(ordinary.finalHash);
    expect(inspected.result.standings).toEqual(ordinary.standings);
  });

  it("only merges coverage from the same source", () => {
    const a = new TraceRecorder(SCRIPT).trace.coverage;
    const b = new TraceRecorder(SCRIPT).trace.coverage;
    a.lines[4] = { executions: 2, conditions: 0, trueBranches: 0, falseBranches: 0, actions: 1, suspensions: 0, errors: 0 };
    b.lines[4] = { executions: 3, conditions: 0, trueBranches: 0, falseBranches: 0, actions: 2, suspensions: 0, errors: 0 };
    expect(mergeCoverage([a, b])?.lines[4]?.executions).toBe(5);
    expect(mergeCoverage([a, { ...b, sourceHash: sourceHash(`${SCRIPT}\n-- changed`) }])).toBeNull();
  });
});
