/**
 * The radio.
 *
 * Two properties are worth more than the rest of this file put together: that a
 * message is anonymous, and that it is bounded. The first is the whole point of
 * the feature — everybody hears everything and nothing says who spoke, so
 * saying who you are without also telling the enemy is left as the player's
 * problem. The second is what stops a `loop` with a `broadcast` in it deciding
 * how everybody else's event queue is spent.
 */

import { describe, expect, it } from "vitest";
import { createWorld, makeManifest } from "../../src/sim/world.js";
import { step } from "../../src/sim/step.js";
import { hashWorld } from "../../src/sim/hash.js";
import { RADIO } from "../../src/sim/types.js";

/** Records everything it hears into its own label, oldest first. */
const EARS = `name "-"
chassis tank
var heard = "-"
on radio
  set heard = heard + "/" + event.data
  set name = heard
end
`;
const MUTE = `name "Mute"\nchassis tank\n`;

function say(what: string) {
  return `name "Talker"\nchassis tank\non start\n  broadcast ${what}\nend\n`;
}

function world(sources: string[], seed = 6) {
  return createWorld(makeManifest(sources.map((source) => ({ source })), { seed }));
}

describe("when a message arrives", () => {
  it("is not heard in the tick it was sent", () => {
    const w = world([say('"hi"'), EARS]);
    step(w);
    expect(w.robots[1]!.name).toBe("-");
    // It is sitting in the world instead, which is where the hash can see it.
    expect(w.radio).toEqual([{ from: 0, data: "hi" }]);
  });

  it("is heard on the very next tick", () => {
    const w = world([say('"hi"'), EARS]);
    step(w);
    step(w);
    expect(w.robots[1]!.name).toBe("-/hi");
    expect(w.radio).toHaveLength(0);
  });

  it("reaches the other side as well as your own", () => {
    // Anonymity is the feature. Nothing here filters by team, on purpose.
    const w = createWorld(
      makeManifest(
        [
          { source: say('"plan"'), team: 0 },
          { source: EARS, team: 0 },
          { source: EARS, team: 1 },
        ],
        { seed: 6 },
      ),
    );
    step(w);
    step(w);
    expect(w.robots[1]!.name).toBe("-/plan");
    expect(w.robots[2]!.name).toBe("-/plan");
  });

  it("says nothing about who sent it", () => {
    const w = world([say('"hi"'), EARS]);
    step(w);
    step(w);
    // The payload is exactly one field. No sender, no bearing, no distance.
    expect(Object.keys({ data: "" })).toEqual(["data"]);
    expect(w.robots[1]!.name).toBe("-/hi");
  });

  it("is not heard by whoever said it", () => {
    const w = world([
      `name "-"\nchassis tank\nvar heard = "-"\non start\n  broadcast "hi"\nend\non radio\n  set heard = heard + "/" + event.data\n  set name = heard\nend\n`,
      MUTE,
    ]);
    step(w);
    step(w);
    expect(w.robots[0]!.name).toBe("-");
  });
});

describe("what keeps it bounded", () => {
  it("sends once per cooldown however hard a script tries", () => {
    const spam = `name "Spam"\nchassis tank\non tick\n  broadcast "x"\nend\n`;
    const w = world([spam, MUTE]);
    let sent = 0;
    for (let i = 0; i < RADIO.cooldown * 3; i++) {
      step(w);
      sent += w.radio.length;
    }
    // Three cooldowns' worth of ticks, so three messages — not thirty.
    expect(sent).toBe(3);
  });

  it("cuts a message that is too long", () => {
    const w = world([say(`"${"a".repeat(RADIO.maxLength + 40)}"`), MUTE]);
    step(w);
    expect(w.radio[0]!.data).toHaveLength(RADIO.maxLength);
  });

  it("spends fuel, because speaking is work", () => {
    const w = world([say('"hi"'), MUTE]);
    const before = w.robots[0]!.fuel;
    step(w);
    expect(w.robots[0]!.fuel).toBeLessThan(before);
  });

  /**
   * Sending costs; **listening does not**, and that asymmetry is deliberate.
   *
   * If hearing a message cost anything, the radio would be a weapon: shouting
   * at somebody would drain their tank whether they wanted the conversation or
   * not, and the counter-play would be to have no `on radio` block at all —
   * which is to say, to switch the feature off. The cost has to sit with the
   * robot that chose to speak.
   */
  it("costs the listener nothing at all", () => {
    const talkers = Array.from({ length: 5 }, () => say('"spam"'));
    const w = world([...talkers, EARS]);
    const ears = w.robots.at(-1)!;
    // Standing perfectly still, so the only thing that could move the gauge is
    // the basal drain everybody pays for being alive.
    const quiet = world([MUTE, EARS]);
    for (let i = 0; i < 60; i++) {
      step(w);
      step(quiet);
    }
    expect(ears.name).not.toBe("-");
    expect(ears.fuel).toBe(quiet.robots[1]!.fuel);
  });

  it("hands one robot no more than the per-tick cap at a time", () => {
    // Every talker speaks on `start`, so they all land in the same tick.
    const talkers = Array.from({ length: RADIO.maxPerTick + 3 }, () => say('"x"'));
    const w = world([...talkers, EARS]);
    step(w);
    step(w);
    const ears = w.robots.at(-1)!;
    expect(ears.name.split("/").length - 1).toBe(RADIO.maxPerTick);
    // The rest are not gone. They are in this robot's own inbox, waiting.
    expect(ears.inbox).toHaveLength(3);
  });
});

describe("nothing sent is lost", () => {
  /**
   * The guarantee: a message that was sent arrives. Not "arrives if the robot
   * happened not to be busy", and not "arrives if nobody else spoke in the same
   * tick" — which is what a single shared list handed out once per tick gave,
   * and which forced anybody writing a flock to stagger its transmissions by
   * hand against a collision they had no way to detect.
   */
  it("delivers every message when more arrive at once than fit", () => {
    const talkers = Array.from({ length: 7 }, () => say('"x"'));
    const w = world([...talkers, EARS]);
    for (let i = 0; i < 6; i++) step(w);
    const ears = w.robots.at(-1)!;
    expect(ears.name.split("/").length - 1).toBe(7);
    expect(ears.inbox).toHaveLength(0);
  });

  it("delivers every message to a robot that reads them slowly", () => {
    // Reads its post every twelfth tick. Under the old rule it would have
    // heard a fraction of what was said; now it hears all of it, later.
    const SLOW = `name "-"\nchassis tank\nvar heard = 0\non radio every 1\n  wait 12 ticks\n  set heard = heard + 1\n  set name = heard\nend\n`;
    const talkers = Array.from({ length: 6 }, () => say('"x"'));
    const w = world([...talkers, SLOW]);
    for (let i = 0; i < 120; i++) step(w);
    const slow = w.robots.at(-1)!;
    expect(Number(slow.name)).toBe(6);
  });

  it("keeps them in the order they were sent", () => {
    const w = world([say('"a"'), say('"b"'), say('"c"'), EARS]);
    for (let i = 0; i < 4; i++) step(w);
    expect(w.robots.at(-1)!.name).toBe("-/a/b/c");
  });

  it("still delivers to a robot whose queue was full when it arrived", () => {
    // The message cannot be handed over on the tick it lands, because the
    // queue is full of things that matter more. It must not be lost for that:
    // it waits in the inbox and goes in as soon as there is room.
    const BOTH = `name "-"\nchassis tank\nvar heard = 0\non hit by bullet\n  wait 3 ticks\nend\non radio\n  set heard = heard + 1\n  set name = heard\nend\n`;
    const w = world([say('"x"'), BOTH]);
    const r = w.robots[1]!;
    for (let i = 0; i < 12; i++) {
      r.vm.enqueue("hit by bullet", {
        bearing: 0, distance: 0, power: 1, health: 100, friend: false, x: 0, y: 0,
      });
    }
    for (let i = 0; i < 60; i++) step(w);
    expect(r.name).toBe("1");
    expect(r.inbox).toHaveLength(0);
  });

  it("gives up only when a robot has stopped reading altogether", () => {
    const r = world([say('"x"'), EARS]).robots[1]!;
    for (let i = 0; i < RADIO.inbox + 5; i++) r.inbox.push(`m${i}`);
    expect(r.inbox.length).toBe(RADIO.inbox + 5);
    // The cap is what stops an unread inbox growing without bound, since every
    // message in it is hashed on every peer, every tick.
    expect(RADIO.inbox).toBeGreaterThan(RADIO.maxPerTick * 4);
  });
});

describe("determinism", () => {
  it("puts what is in flight into the hash", () => {
    const quiet = world([MUTE, MUTE]);
    const loud = world([say('"hi"'), MUTE]);
    step(quiet);
    step(loud);
    expect(hashWorld(quiet)).not.toBe(hashWorld(loud));
  });

  it("runs the same match the same way twice", () => {
    const once = world([say('"hi"'), EARS, MUTE]);
    const twice = world([say('"hi"'), EARS, MUTE]);
    for (let i = 0; i < 40; i++) {
      step(once);
      step(twice);
    }
    expect(hashWorld(once)).toBe(hashWorld(twice));
  });

  it("flattens a number the same way on every machine", () => {
    // `toText` trims float noise to two decimals, so two peers cannot format
    // the same number differently and hash differently for it.
    const w = world([say("1 / 3"), MUTE]);
    step(w);
    expect(w.radio[0]!.data).toBe("0.33");
  });
});

describe("priority", () => {
  /**
   * Radio is the lowest-priority event there is. Everything else in the arena
   * is something that happened TO you, and under overload the newest of those
   * is what matters — so a full queue drops its oldest to make room. A
   * broadcast must never be able to do that, or a chatty enemy could deafen you
   * to being shot, which is a weapon nobody designed.
   */
  const BOTH = `name "-"
chassis tank
var heard = 0
on hit by bullet
  wait 5 ticks
end
on radio
  set heard = heard + 1
end
`;

  it("is refused rather than evicting an event that matters", () => {
    const w = world([BOTH, MUTE]);
    const r = w.robots[0]!;
    for (let i = 0; i < 12; i++) {
      r.vm.enqueue("hit by bullet", {
        bearing: 0,
        distance: 0,
        power: 1,
        health: 100,
        friend: false,
        x: 0,
        y: 0,
      });
    }
    // Refused, and it says so — which is how the caller knows to hold on to the
    // message rather than assuming it was taken.
    expect(r.vm.enqueue("radio", { data: "x" }, true)).toBe(false);
    expect(r.vm.hasQueued("radio")).toBe(false);
    expect(r.vm.hasQueued("hit by bullet")).toBe(true);
  });

  it("takes a free slot when there is one", () => {
    const w = world([BOTH, MUTE]);
    const r = w.robots[0]!;
    expect(r.vm.enqueue("radio", { data: "x" }, true)).toBe(true);
    expect(r.vm.hasQueued("radio")).toBe(true);
  });
});
