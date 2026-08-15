/**
 * Sample robots.
 *
 * These double as the tutorial ladder (each one introduces exactly one new
 * idea) and as the test corpus. They are inline strings rather than loose files
 * so that tests, the dev server and a future static build all read them the
 * same way with no loader configuration.
 */

export interface SampleBot {
  id: string;
  title: string;
  /** What this example is here to teach. */
  teaches: string;
  source: string;
}

const SITTING_DUCK = `-- The simplest robot there is: it just sits and waits.
-- Good for target practice while you test another robot.
name "Sitting Duck"
chassis tank
color #8a8f98

on start
  set name = "please don't"
end
`;

const SPINNER = `-- Spins on the spot and sweeps its turret, firing at anything it sees.
-- Only a tank can turn like this while standing still.
name "Spinner"
chassis tank
color #7fd1e0

on start
  turret.sweep 90
end

on tick
  turn body by 10
end

on sense robot
  turret.aim at event.bearing
  fire 2
  set name = "spotted!"
end
`;

const RACER = `-- A car: much faster than a tank, but it cannot turn on the spot,
-- so it has to drive its way around a corner.
name "Racer"
chassis car
color #ffd166

var bumps = 0

on start
  drive forward 100
  turret.sweep 60
end

on sense robot
  turret.aim at event.bearing
  fire 1
end

on hit wall
  set bumps = bumps + 1
  set name = "bumps: " + bumps
  turn body by 120
end

on tick
  -- A car that has stopped cannot steer, so always keep rolling.
  if me.speed < 20 then
    drive forward 100
  end
end
`;

const HUNTER = `-- Sweeps for a target, then chases it down and keeps shooting.
-- Shows how event.bearing points straight at whatever you just noticed.
name "Hunter"
chassis tank
color #ff8800

var seen = 0

on start
  turret.sweep 45
  drive forward 70
end

on sense robot
  set seen = seen + 1
  set name = "hunting"
  turret.aim at event.bearing
  fire 3
  -- Turn the whole robot toward the target as well as the turret.
  turn body by event.bearing
  if event.distance > 120 then
    drive forward 90
  else
    drive forward 30
  end
end

on hit by bullet
  -- Shot from behind? Turn side-on and run.
  set name = "ouch!"
  turn body by event.bearing + 90
  drive forward 100
end

on hit wall
  turn body by 150
  drive forward 70
end
`;

const DODGER = `-- Watches for incoming fire and gets out of the way.
-- Uses a loop with break, and wait to pause between moves.
name "Dodger"
chassis car
color #b085f5

on start
  drive forward 80
  turret.sweep 70
end

on sense bullet
  set name = "incoming!"
  turn body by event.bearing + 90
  drive forward 100
end

on sense robot
  turret.aim at event.bearing
  fire 2
end

on hit wall
  turn body by 135
  wait 5 ticks
  drive forward 80
end
`;

/**
 * The Hunter, written in the biological vocabulary.
 *
 * This is not a different robot: it compiles to identical bytecode and fights
 * identically. It is here to make the point that the theme is wording and art,
 * never a gameplay advantage — and the vocab test asserts exactly that against
 * HUNTER above.
 */
const HUNTER_BIO = `-- The very same robot as Hunter, in biology words.
name "Hunter"
body ciliate
color #ff8800

var seen = 0

on start
  stinger.sweep 45
  swim forward 70
end

on sense organism
  set seen = seen + 1
  set name = "hunting"
  stinger.aim at event.bearing
  sting 3
  -- Turn the whole organism toward the target as well as the stinger.
  turn body by event.bearing
  if event.distance > 120 then
    swim forward 90
  else
    swim forward 30
  end
end

on stung
  -- Stung from behind? Turn side-on and flee.
  set name = "ouch!"
  turn body by event.bearing + 90
  swim forward 100
end

on hit wall
  turn body by 150
  swim forward 70
end
`;

export const SAMPLE_BOTS: SampleBot[] = [
  {
    id: "sitting-duck",
    title: "Sitting Duck",
    teaches: "the smallest possible robot, and the name label",
    source: SITTING_DUCK,
  },
  {
    id: "spinner",
    title: "Spinner",
    teaches: "on tick, turret sweeping, and turning on the spot",
    source: SPINNER,
  },
  {
    id: "hunter",
    title: "Hunter",
    teaches: "event.bearing, chasing a target, reacting to being hit",
    source: HUNTER,
  },
  {
    id: "racer",
    title: "Racer",
    teaches: "a car's turning circle, variables, and if/else",
    source: RACER,
  },
  {
    id: "dodger",
    title: "Dodger",
    teaches: "sensing bullets, evading, and wait",
    source: DODGER,
  },
  {
    id: "hunter-bio",
    title: "Hunter (biology words)",
    teaches: "the same robot written in the biological vocabulary",
    source: HUNTER_BIO,
  },
];

export function sampleById(id: string): SampleBot | undefined {
  return SAMPLE_BOTS.find((b) => b.id === id);
}

export { SITTING_DUCK, SPINNER, RACER, HUNTER, DODGER, HUNTER_BIO };
