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

const SCOUT = `-- Sees people long before they can see it, using the radar.
--
-- The radar is a third thing you can point, alongside your body and your
-- turret. It reaches three times as far as your sense cone but is only a
-- fifth as wide, and it looks only when you ping — so it has to be aimed on
-- purpose. The trade is worth it: by the time somebody walks into your cone,
-- your gun is already pointing at them.
name "Scout"
chassis tank
color #6ad98a

on start
  drive forward 45
  -- The turret watches the near ground, the radar searches the far ground.
  turret.sweep 30
  radar.sweep 90
end

on tick
  -- Ping whenever the beam has recovered. me.pingHeat counts down to zero.
  if me.pingHeat is 0 then
    ping
  end
end

on ping robot
  -- A contact far outside the cone. Hold the beam on it so the next ping says
  -- whether it is still there, point the gun the same way, and turn to face it.
  set name = "contact"
  radar.aim at event.bearing
  turret.aim at event.bearing
  turn body by event.bearing
end

on ping wall
  -- Nothing down that line, only the edge of the arena.
  set name = "searching"
end

on sense robot
  -- Close enough for the cone, and the gun is already looking the right way.
  set name = "in range"
  turret.aim at event.bearing
  fire 3
end

on hit by bullet
  -- Shot by someone the beam has not found: get off the line of fire.
  turn body by event.bearing + 90
  drive forward 80
end

on hit wall
  turn body by 150
  drive forward 50
end
`;

const TOOLKIT = `-- A robot with no "on" blocks at all.
--
-- Each "can" block says which event it is for, and because nothing here
-- writes "on sense robot" out longhand, the blocks for an event *are* that
-- handler — running in the order they appear. Paste another one in and it
-- joins the end; delete one and the rest carry on.
--
-- That is the point of writing behaviour this way: each block is a whole
-- thought you can lift out and give to somebody else.
name "Toolkit"
chassis tank
color #ffd166

var target = 0

can look given start
  turret.sweep 40
  radar.sweep 90
  drive forward 55
end

can search given tick
  if me.pingHeat is 0 then
    ping
  end
end

-- A block can be handed something. With a starting value it still runs on its
-- own; without one it would be a block you could only "do" by hand.
can engage with power=3 given sense robot
  set name = "seen"
  set target = event.bearing
  turret.aim at event.bearing
  fire power
end

can close given sense robot
  turn body by target
  if event.distance > 150 then
    drive forward 80
  else
    drive forward 30
  end
end

can point given ping robot
  set name = "far contact"
  radar.aim at event.bearing
  turret.aim at event.bearing
  turn body by event.bearing
end

can flinch given hit by bullet
  set name = "hit"
  turn body by event.bearing + 90
  drive forward 90
end

can bounce given hit wall
  turn body by 150
  drive forward 60
end
`;

const HUNGRY_HIPPO = `-- Ignores the battle completely and eats.
--
-- Everything that moves costs fuel and nothing here ever shoots, so this is
-- the fuel economy on its own, with the fighting taken out: the gauge under
-- the hippo fills every time it reaches a cell and drains the whole time it
-- is looking for the next one.
--
-- Note what it does NOT do. It never fires, and it never sweeps the turret,
-- because both cost fuel and neither finds food. The radar is the exception
-- worth paying for: a ping is the most expensive thing here, and it still
-- pays, because food you cannot see is food you cannot eat.
name "Hungry Hippo"
chassis tank
color #ff6b6b

on start
  radar.sweep 90
  drive forward 60
end

on tick
  -- Ping whenever the beam has recovered, and only then: me.pingHeat counts
  -- down to zero, and pinging early is simply ignored.
  if me.pingHeat is 0 then
    ping
  end
end

on sense fuel
  -- Close enough for the cone. Line up and go and get it.
  set name = "nom"
  turn body by event.bearing
  drive forward 100
end

on ping fuel
  -- Right across the arena, and found only because the beam was pointed there.
  -- Hold the beam on it so the next ping says whether it is still going, and
  -- set off.
  set name = "on my way"
  radar.aim at event.bearing
  turn body by event.bearing
  drive forward 100
end

on ping wall
  -- Nothing down that line but the edge. Go back to searching.
  set name = "hungry"
  radar.sweep 90
end

on hit wall
  turn body by 150
  drive forward 40
end

on hit by bullet
  -- Somebody is shooting at it. The hippo does not shoot back, but a target
  -- that keeps moving is a harder one.
  set name = "rude"
  turn body by event.bearing + 90
  drive forward 100
end
`;

const APEX = `-- Apex: the one to beat.
--
-- Hunter and Hungry Hippo in one robot, tuned against the actual cost table
-- rather than against a feeling about it. Three measured facts shape it:
--
--   1. Going somewhere is the most expensive thing a robot does. Everything
--      else — aiming, sweeping, thinking — is small change beside it.
--   2. Firing costs the same per point of damage at every power, so the only
--      thing that makes a shot cheap is landing it. Bullets are slower the
--      heavier they are, so this fires light at range, where a slow shell can
--      be driven out of, and heavy up close, where it cannot.
--   3. Brownout takes your legs and your aim, never your gun. A starving robot
--      still hits as hard, so there is no winning by waiting for one to run
--      dry — and every version of this that tried to hide and let the others
--      burn out did measurably worse than simply going at them.
--
-- So it fights like Hunter and eats like the hippo: it never makes a special
-- trip for food, it just takes what crosses its path, which costs it nothing
-- it was not already spending.
name "Apex"
chassis tank
color #f5f0e6

on start
  turret.sweep 40
  radar.sweep 90
  drive forward 55
end

-- Every 24 ticks rather than the 12 the beam allows. Pinging on cooldown is
-- the single most expensive habit available — more per tick than driving flat
-- out — and the sense cone does the close work for nothing.
can search given tick every 24
  if me.pingHeat is 0 then
    ping
  end
end

on sense robot
  turret.aim at event.bearing
  -- Same damage per unit of fuel whichever you pick, so choose for the hit.
  if event.distance < 90 then
    fire 3
  else
    if event.distance < 150 then
      fire 2
    else
      fire 1
    end
  end
  turn body by event.bearing
  if event.distance > 150 then
    drive forward 80
  else
    drive forward 30
  end
end

on ping robot
  radar.aim at event.bearing
  turret.aim at event.bearing
  turn body by event.bearing
end

on sense fuel
  -- No condition on this. A cell in the cone is nearly always closer than the
  -- fight is, and topping up keeps the legs and the turret quick.
  turn body by event.bearing
  drive forward 90
end

on ping fuel
  radar.aim at event.bearing
  turn body by event.bearing
  drive forward 90
end

on hit by bullet
  turn body by event.bearing + 90
  drive forward 90
end

on hit wall
  turn body by 150
  drive forward 60
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
    id: "scout",
    title: "Scout",
    teaches: "the radar: aiming a third instrument, pinging, and on ping robot",
    source: SCOUT,
  },
  {
    id: "toolkit",
    title: "Toolkit",
    teaches: "can blocks: naming behaviour, and letting it run itself",
    source: TOOLKIT,
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
    id: "hungry-hippo",
    title: "Hungry Hippo",
    teaches: "fuel: sensing it near and far, and spending nothing you don't have to",
    source: HUNGRY_HIPPO,
  },
  {
    id: "apex",
    title: "Apex",
    teaches: "the one to beat: fighting and foraging, budgeted against the cost table",
    source: APEX,
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

export {
  SITTING_DUCK,
  SPINNER,
  RACER,
  HUNTER,
  DODGER,
  HUNTER_BIO,
  SCOUT,
  TOOLKIT,
  HUNGRY_HIPPO,
  APEX,
};
