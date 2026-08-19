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
--
-- It drives the ground like a race track. Going uphill is slow and burns fuel,
-- going downhill is quick and costs almost nothing, and going ACROSS a slope
-- costs exactly what flat ground does. So the line across a hill is the track,
-- and a drop is the straight where you open it up.
--
-- me.slope says how steep the ground is here, 0 to 100. me.uphill and
-- me.downhill say which way is up and which way is down, turned so that 0
-- means straight ahead. On a flat map slope is 0, so the racing bit never
-- runs and this is simply a fast car.
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

  if me.slope > 12 then
    if me.downhill < 50 and me.downhill > -50 then
      -- The drop is more or less ahead. That is free speed: take it.
      set name = "flat out"
      turn body by me.downhill
      drive forward 100
    else
      -- No drop worth having, so hold the line across the slope. A quarter
      -- turn from straight up the hill is the flattest way through.
      --
      -- Turning the short way matters for a car. If the hill is on the right
      -- we take the line to its left, and the other way round \u2014 either way the
      -- wheel only ever moves a little, which is what keeps the speed up.
      set name = "on the line"
      if me.uphill > 0 then
        turn body by me.uphill - 90
      else
        turn body by me.uphill + 90
      end
      drive forward 90
    end
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

const HUNGRY_HIPPO = `-- Never fights. Just eats.
--
-- Moving, turning, shooting and pinging all use up fuel. Thinking is free, and
-- so is the sense cone, which notices things all on its own.
--
-- So this robot does as little as it can. It never shoots, because shooting
-- does not find food. It never sweeps its turret, for the same reason. The one
-- thing it pays for is the ping, because the cone only sees a little way ahead
-- and the beam sees three times as far.
--
-- Finding food near or far leads to the same move: turn to face it, then drive.
name "Hungry Hippo"
chassis tank
color #ff6b6b

on start
  radar.sweep 90
  drive forward 60
end

on tick
  -- Ping as often as you are allowed. me.pingHeat counts down to zero after
  -- each one, and asking early does nothing at all.
  if me.pingHeat is 0 then
    ping
  end
end

on sense fuel
  -- The cone found food, so it is close. Turn to it and drive over it.
  set name = "nom"
  turn body by event.bearing
  drive forward 100
end

on ping fuel
  -- The beam found food a long way off. Keep the beam on it so the next ping
  -- checks it is still there, then set off.
  set name = "on my way"
  radar.aim at event.bearing
  turn body by event.bearing
  drive forward 100
end

on ping wall
  -- The beam hit the wall, so there is nothing that way. Aiming the beam
  -- stopped it sweeping, so start it sweeping again.
  set name = "hungry"
  radar.sweep 90
end

on hit wall
  turn body by 150
  drive forward 40
end

on hit by bullet
  -- Someone is shooting at it. It does not shoot back, but driving sideways
  -- makes it harder to hit.
  set name = "rude"
  turn body by event.bearing + 90
  drive forward 100
end
`;

const APEX = `-- Apex: the robot to beat. It hunts, it eats, and it is careful.
--
-- It is always doing one of four things. The variable called mode remembers
-- which one, and the label under the robot says it out loud while you watch:
--
--   0  prowling  nothing found yet, so drive about and look
--   1  stalking  the beam can see someone the cone cannot
--   2  strike    they are in the cone, so stand still and shoot
--   3  feeding   going to get some fuel
--
-- Something has to bring it back to prowling, or it would wait forever for a
-- robot that has already gone. So cold counts the ticks since it last saw
-- anything at all. Twenty quiet ticks and it starts sweeping and driving again.
--
-- When it shoots it aims where you are GOING, not where you are. A shot waits
-- until the gun has turned to face where it was aimed, and you keep moving
-- while it turns. Bullets fly at 460 - 40 x power, and the event says which way
-- you are heading and how fast, which is enough to work out where to point.
--
-- Light bullets far away, heavy ones close up. Every bullet does the same
-- damage for the fuel it costs, but heavy ones fly slower and are easier to
-- drive out of the way of.
--
-- In strike it stops. Standing still is free, and it keeps the gun pointing
-- where it was put while the shot gets ready.
--
-- It picks up fuel it happens to see, but never goes looking for it.
name "Apex"
chassis tank
color #f5f0e6

var mode = 0
var cold = 0

-- Somewhere to keep the working out while it aims.
var flight = 0
var aimx = 0
var aimy = 0

on start
  turret.sweep 25
  radar.sweep 90
  drive forward 70
end

can clock given tick
  -- One tick older since the last time anything was seen.
  set cold = cold + 1
end

can prowl given tick every 6
  -- Quiet for a while now, so go back to searching: sweep the turret and the
  -- beam again, and get moving.
  if cold > 20 then
    if mode isnt 0 then
      set mode = 0
      set name = "prowling"
    end
    drive forward 70
    turret.sweep 25
    radar.sweep 90
  end
end

can search given tick
  if me.pingHeat is 0 then
    ping
  end
end

on sense robot
  set cold = 0
  if mode isnt 2 then
    set mode = 2
    set name = "strike"
  end
  -- Near, middle and far. Each part does the same sum, and only the speed of
  -- the bullet changes, because that is what decides how long it flies for.
  if event.distance < 90 then
    set flight = event.distance / 340 + 0.05
    set aimx = event.x + cos(event.heading) * event.speed * flight
    set aimy = event.y + sin(event.heading) * event.speed * flight
    turret.aim at bearing(aimx - me.x, aimy - me.y) - me.heading
    fire 3
  else
    if event.distance < 150 then
      set flight = event.distance / 380 + 0.05
      set aimx = event.x + cos(event.heading) * event.speed * flight
      set aimy = event.y + sin(event.heading) * event.speed * flight
      turret.aim at bearing(aimx - me.x, aimy - me.y) - me.heading
      fire 2
    else
      set flight = event.distance / 420 + 0.05
      set aimx = event.x + cos(event.heading) * event.speed * flight
      set aimy = event.y + sin(event.heading) * event.speed * flight
      turret.aim at bearing(aimx - me.x, aimy - me.y) - me.heading
      fire 1
    end
  end
  -- Face them, then plant your feet while the shot gets ready.
  turn body by event.bearing
  stop
end

on ping robot
  -- Too far away for the cone. Aim ahead of them anyway, so the gun is already
  -- most of the way round when they come close enough to shoot at.
  set cold = 0
  if mode is 0 then
    set mode = 1
    set name = "stalking"
  end
  radar.aim at event.bearing
  set flight = event.distance / 400
  set aimx = event.x + cos(event.heading) * event.speed * flight
  set aimy = event.y + sin(event.heading) * event.speed * flight
  turret.aim at bearing(aimx - me.x, aimy - me.y) - me.heading
  turn body by event.bearing
end

on ping wall
  -- The beam hit the wall, so nobody is that way. Aiming the beam stopped it
  -- sweeping, so start it sweeping again.
  radar.sweep 90
end

on sense fuel
  if mode isnt 2 then
    set mode = 3
    set name = "feeding"
  end
  turn body by event.bearing
  drive forward 90
end

on ping fuel
  if mode isnt 2 then
    turn body by event.bearing
    drive forward 90
  end
  radar.aim at event.bearing
end

on hit by bullet
  -- Being shot still means somebody is out there, so this counts as seeing
  -- them, even though neither the cone nor the beam found anything.
  set cold = 0
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
