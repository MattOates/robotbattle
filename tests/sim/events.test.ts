/**
 * The event documentation must describe the real simulation.
 *
 * `EVENT_DOCS` drives the compiler's checks and the editor's completion popup,
 * so if `step.ts` ever emits a field the table doesn't list — or stops emitting
 * one it does — the help becomes a lie. This test watches every event actually
 * raised during real matches and holds the two in step.
 */

import { describe, expect, it } from "vitest";
import { Vm } from "../../src/lang/vm.js";
import { EVENT_DOCS } from "../../src/lang/events.js";
import { EVENT_NAMES, type EventName } from "../../src/lang/ast.js";
import { createWorld, makeManifest } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { DODGER, HUNTER, RACER, SPINNER } from "../../src/bots/index.js";

interface Seen {
  name: string;
  keys: string[];
}

/**
 * Watch every event raised while `run` executes. The spy sits on the VM's own
 * entry point, so it sees exactly what a script would.
 */
function recordEvents(run: () => void): Seen[] {
  const seen: Seen[] = [];
  const real = Vm.prototype.enqueue;
  // Wrap rather than mock: the match must play out for real, so that what we
  // observe is genuinely what a script would have received.
  Vm.prototype.enqueue = function (this: Vm, name, payload) {
    seen.push({ name, keys: Object.keys(payload).sort() });
    return real.call(this, name, payload);
  };
  try {
    run();
  } finally {
    Vm.prototype.enqueue = real;
  }
  return seen;
}

/**
 * A robot that subscribes to everything, so no event is skipped by the
 * `handles()` early-out inside the sim.
 */
const NOSY = `chassis tank
color #7fd1e0
on start
  turret.sweep 60
  radar.sweep 90
  drive forward 80
end
on tick
  if me.pingHeat is 0 then
    ping
  end
end
${EVENT_NAMES.filter((e) => e !== "start" && e !== "tick")
  .map((e) => `on ${e}\n  set name = "x"\nend`)
  .join("\n")}
`;

const NOSY_CAR = NOSY.replace("chassis tank", "chassis car");

function playOut(): Seen[] {
  return recordEvents(() => {
    const world = createWorld(
      makeManifest(
        [
          { source: NOSY },
          { source: NOSY_CAR },
          { source: HUNTER },
          { source: RACER },
          { source: SPINNER },
          { source: DODGER },
        ],
        { seed: 31337, maxTicks: 30 * 90 },
      ),
    );
    while (!world.over && world.tick < world.maxTicks) step(world);
  });
}

describe("event payloads", () => {
  const seen = playOut();

  it("raises a good spread of events", () => {
    expect(seen.length).toBeGreaterThan(200);
  });

  it("only raises events the language knows about", () => {
    const names = new Set(seen.map((s) => s.name));
    for (const name of names) {
      expect(EVENT_NAMES).toContain(name as EventName);
    }
  });

  it("carries exactly the fields the documentation promises", () => {
    for (const { name, keys } of seen) {
      const documented = EVENT_DOCS[name as EventName].fields.map((f) => f.name).sort();
      expect(keys, `payload of \`on ${name}\``).toEqual(documented);
    }
  });

  it("exercises most of the event list, so the check has teeth", () => {
    const names = new Set(seen.map((s) => s.name));
    // `bullet missed` and `sense wall` need particular geometry, so we assert a
    // healthy majority rather than all eleven.
    expect(names.size).toBeGreaterThanOrEqual(8);
  });
});

describe("documentation quality", () => {
  it("describes every event", () => {
    for (const name of EVENT_NAMES) {
      expect(EVENT_DOCS[name].summary.length).toBeGreaterThan(10);
    }
  });

  it("describes every field", () => {
    for (const name of EVENT_NAMES) {
      for (const field of EVENT_DOCS[name].fields) {
        expect(field.detail.length, `${name}.${field.name}`).toBeGreaterThan(10);
      }
    }
  });
});
