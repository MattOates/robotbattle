import { describe, expect, it } from "vitest";
import { runMatch } from "../../src/sim/match.js";
import { readVariables } from "../../src/lang/vm.js";
import {
  attachRecorder,
  chronologicalDecisions,
  describeDecision,
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

  it("leaves an untraced match byte-identical", () => {
    const manifest = makeManifest([{ source: SCRIPT }, { source: SPINNER }], { seed: 31 });
    const plain = runMatch(manifest);
    const again = runMatch(manifest);
    expect(again.finalHash).toBe(plain.finalHash);
    // Nothing observes, so nothing is recorded and no snapshots are built.
    const world = createWorld(manifest);
    const recorder = new TraceRecorder(SCRIPT);
    for (let i = 0; i < 20; i++) step(world);
    expect(recorder.trace.timeline).toHaveLength(0);
    expect(recorder.trace.coverage.lines).toEqual({});
  });

  it("names variable snapshots and hides compiler temporaries", () => {
    const manifest = makeManifest([{ source: SCRIPT }, { source: SPINNER }], { seed: 37 });
    const world = createWorld(manifest);
    const recorder = attachRecorder(world, 0, SCRIPT);
    for (let i = 0; i < 6; i++) step(world);

    const entry = recorder.trace.timeline.find((item) => item.kind === "condition");
    expect(entry).toBeDefined();
    const named = readVariables(recorder.trace.variableNames, entry!.variables);
    expect(named.map(([name]) => name)).toContain("seen");
    expect(named.some(([name]) => name.startsWith("__"))).toBe(false);
    expect(Number(named.find(([name]) => name === "seen")?.[1])).toBeGreaterThan(0);
  });

  it("counts events that overflow the queue as dropped", () => {
    const listener = `name "Listener"
chassis tank
on sense robot
  wait 30
end
`;
    const manifest = makeManifest([{ source: listener }, { source: SPINNER }], { seed: 41 });
    const world = createWorld(manifest);
    const recorder = attachRecorder(world, 0, listener);
    // The queue holds eight. The ninth pushes the oldest out, and the tracer
    // has to see that as information the script never got to act on.
    for (let i = 0; i < 12; i++) world.robots[0]!.vm.enqueue("sense robot", { bearing: i });

    expect(recorder.trace.coverage.events["sense robot"]?.queued).toBe(12);
    expect(recorder.trace.coverage.events["sense robot"]?.dropped).toBe(4);
  });

  it("caps the timeline but keeps counting coverage", () => {
    const manifest = makeManifest([{ source: SCRIPT }, { source: SPINNER }], { seed: 43 });
    const world = createWorld(manifest);
    const recorder = attachRecorder(world, 0, SCRIPT);
    // Fill the timeline by hand rather than simulating twelve thousand moments.
    for (let i = 0; i < 12_000; i++) {
      recorder.trace.timeline.push({
        kind: "wait", tick: i, line: 1, event: "tick", ticks: 1,
      });
    }
    for (let i = 0; i < 20; i++) step(world);

    expect(recorder.trace.truncated).toBe(true);
    expect(recorder.trace.timeline).toHaveLength(12_000);
    expect(recorder.trace.coverage.events.tick?.handled).toBeGreaterThan(0);
  });

  it("only shows a time range when a run actually spans one", () => {
    const moment = describeDecision({ kind: "wait", tick: 30, line: 4, event: "tick", ticks: 2 });
    expect(moment).toBe("1.0s  waited 2 ticks");

    const run = describeDecision({
      kind: "wait", tick: 30, line: 4, event: "tick", ticks: 2, endTick: 75, occurrences: 4,
    });
    expect(run).toBe("1.0\u20132.5s  waited 2 ticks");
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
