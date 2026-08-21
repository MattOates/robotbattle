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
--
-- It also watches for the wall and starts the corner early. A car turns in a
-- circle it cannot tighten, so by the time a wall is close there is no room
-- left to miss it \u2014 the turn has to begin while it is still a long way off.
name "Racer"
chassis car
color #ffd166

var bumps = 0
-- Ticks left of a corner. While this is counting down the racing line is
-- ignored: finishing the turn matters more than taking the cheap route, and
-- two bits of code steering the same wheel would just fight each other.
var corner = 0

on start
  drive forward 100
  turret.sweep 60
end

on sense robot
  turret.aim at event.bearing
  fire 1
end

on sense wall
  -- 150 steps is about four car lengths, which is what it takes to come round
  -- at speed. event.bearing points at the wall, so turning by a bit less than a
  -- half turn from it sends us away without doubling back on ourselves.
  if event.distance < 150 and corner is 0 then
    set name = "corner"
    set corner = 26
    turn body by event.bearing + 140
  end
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

  if corner > 0 then
    -- Mid-corner. Leave the wheel where it was put and let the turn finish.
    -- Easing off does not tighten the circle, but it does buy room.
    set corner = corner - 1
    drive forward 70
  else
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
        -- we take the line to its left, and the other way round \u2014 either way
        -- the wheel only ever moves a little, which keeps the speed up.
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
const GOAT = `-- Goat: gets to the high ground and holds it.
--
-- Height is worth something here. Anyone coming up at you is slowed to a
-- crawl and paying three times the fuel for it, while you sit still at the
-- top and pay almost nothing. So the whole plan is: walk up, stop, shoot down.
--
-- me.slope says how steep the ground is right here, 0 to 100. me.uphill says
-- which way is up, turned so that 0 means straight ahead.
--
-- The clever bit is how it knows it has arrived. The top of a hill is level,
-- the same as the bottom is \u2014 so when the slope runs out after a climb, that
-- is the summit. On a flat map the slope never turns up at all, and then there
-- is nothing to climb and the goat just goes hunting instead.
--
-- The other reason to be up here: your radar beam is stopped by ground higher
-- than you are standing on. Down in a dip you can barely see out. On the top
-- of the hill nothing is above you, so the beam goes all the way, in every
-- direction. That is why the goat only switches its radar on once it arrives.
name "Goat"
chassis tank
color #6ad98a

var climbed = 0

on start
  turret.sweep 90
  radar.sweep 90
  drive forward 70
end

on tick
  -- 2 is nearly level. Almost all of the ground is steeper than that, so any
  -- reading this low really is a top rather than a merely gentle patch. The
  -- first version used 8 and the goat kept stopping on the first easy stretch
  -- it found, pleased with itself, having climbed nothing.
  if me.slope > 2 then
    set climbed = 1
    set name = "climbing"
    turn body by me.uphill
    -- Ease off as the ground levels out, so it settles on the top instead of
    -- charging over it and having to come back. A slow climb is cheaper too.
    if me.slope > 20 then
      drive forward 70
    else
      drive forward 35
    end
  else
    if climbed = 1 then
      -- Level ground, after a climb. This is the top: hold it.
      set name = "high ground"
      stop
      -- And look around, which is only worth doing from up here. Not below 30
      -- in the tank though: pinging every time the beam recovers costs about
      -- three times what simply sitting still does, and a robot whose whole
      -- plan is to sit still would rather still be able to move afterwards.
      if me.pingHeat is 0 and me.fuel > 30 then
        ping
      end
    else
      -- Never found a hill, so there is no high ground to take. Go and look
      -- for somebody instead.
      set name = "no hills here"
      drive forward 70
    end
  end
end

on sense robot
  turret.aim at event.bearing
  fire 3
end

on ping robot
  -- Found from the top, far outside the cone. Shoot, but stay put: the hill is
  -- worth more than the chase.
  set name = "in range"
  turret.aim at event.bearing
  fire 3
end

on ping ridge
  -- Ground higher than us stopped the beam, so we are not as high as we
  -- thought. Keep sweeping rather than staring at it.
  radar.sweep 90
end

on hit by bullet
  -- Somebody is shooting up at us. Point the gun back down at them, but do
  -- not chase: giving up the hill is how you lose it.
  set name = "get off"
  turret.aim at event.bearing
  fire 3
end

on hit wall
  turn body by 140
  drive forward 70
end
`;

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

on ping ridge
  -- The beam stopped at ground higher than we are, so there could be anything
  -- behind it and we would not know. Sweep on rather than keep looking at it.
  set name = "blocked"
  radar.sweep 90
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

on ping ridge
  -- Same idea, different reason: high ground stopped the beam short. Look
  -- somewhere else rather than staring at the hill.
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

on ping ridge
  -- High ground cut the beam short. Nothing to learn from a hillside, and the
  -- aim it was holding is worthless now, so put the beam back to sweeping.
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

const MOUSE = `-- Mouse does not fight for the room. It works out the shape of it.
--
-- The rule is the oldest one there is for a maze: keep your left hand on the
-- wall and walk. Never take your hand off, and you will trace the whole of it
-- and come back to where you started — no map, no memory, no idea where you
-- are. A wall is enough.
--
-- Turning that into a robot needs two things the others never do.
--
-- The first is something that looks SIDEWAYS. The sense cone only faces front,
-- so the radar is used here as a whisker rather than as a way to find people —
-- aimed at -90, hard left, and pinged over and over. \`on ping wall\` comes back
-- with how much room is out that way, and that one number is the hand on the
-- wall.
--
-- The second is knowing how big a square of the maze is. A robot that walks
-- too far overshoots the openings; one that walks too little never reaches
-- them. So the first thing Mouse does is stand still and MEASURE: one ping
-- right, one ping left, plus its own width, is the width of the passage it is
-- standing in — and in a maze built on a grid, that is one square. Everything
-- afterwards is a fraction of that measurement rather than a number somebody
-- guessed, which is why it works in a maze you drew as well as one the game
-- made.
--
-- It stops before every decision. That looks slow, and it is, but a ping can
-- only be sent so often and a reading taken mid-corner is a reading of
-- somewhere the robot no longer is. Standing still to look is what makes the
-- readings mean anything. Given long enough it gets round the whole labyrinth;
-- a single match is not long enough, so what you watch is an honest robot
-- part-way through a patient job.
name "Mouse"
chassis tank
color #f5f0e6

-- Which way it means to face: 0, 90, 180 or -90, and nothing in between. A
-- maze is built out of right angles, so a robot that only ever holds one of
-- four headings can never end up askew in a corridor.
var dir = 0

-- 9 measuring, 0 stopped and thinking, 1 turning, 2 walking.
var mode = 9
var timer = 40

-- The last things it was told, kept because an event is a moment and a
-- decision needs the moment to still be there when it is taken.
var leftGap = 0
var rightGap = 0
var frontGap = 999

-- Whether it has ever actually had a wall under its hand.
--
-- You cannot follow a wall you have not found yet. Without this, Mouse turned
-- left on every decision in an open arena — which is what the rule literally
-- says to do when the left is clear, and which walks a robot round and round a
-- box one stride wide. Made to find a wall first, it drives straight out until
-- it meets one and then goes round the outside.
var onWall = 0

-- Where the current walk began, so how far it has come is measured on the
-- ground rather than counted in ticks. Ticks were what this used to use, and
-- they are a lie the moment anything changes the speed — a hill, a low tank,
-- a scrape along a wall — because the same count of them covers a different
-- distance every time.
var markX = 0
var markY = 0
var gone = 0

-- How long it has been asking to move and not moving.
--
-- The same two numbers again, read a different way: if the throttle is open and
-- the ground is not going past, the robot is wedged on a corner rather than
-- walking. Without this it could sit there grinding for eight seconds at a
-- time, which is most of what "Mouse gets stuck" looked like from the outside.
var wedged = 0

-- One square of the maze, and how far to walk in one go.
var square = 74
var stride = 62

on start
  set dir = 0
  set mode = 9
  set timer = 40
end

on tick
  -- Measuring the passage, once, before anything else happens. Right first,
  -- then left, giving the radar time to come round between the two.
  if mode is 9 then
    stop
    set timer = timer - 1
    if timer > 20 then
      radar.aim at 90
      if me.pingHeat is 0 and timer < 36 then
        ping
      end
    else
      radar.aim at -90
      if me.pingHeat is 0 and timer < 16 then
        ping
      end
    end
    if timer < 1 then
      -- The gap either side, plus the robot in the middle of it. Held between
      -- sane bounds: at a junction a ping can run away down a corridor and
      -- report a room far bigger than the square really is.
      set square = max(46, min(160, leftGap + rightGap + 36))
      set stride = square * 0.85
      set mode = 0
      set timer = 14
    end
  else
    radar.aim at -90
    if me.pingHeat is 0 then
      ping
    end
    set gone = sqrt((me.x - markX) * (me.x - markX) + (me.y - markY) * (me.y - markY))
  end

  -- Stopped, and deciding. Left first, always: that IS the left-hand rule, and
  -- checking the wall ahead first instead would mean never taking a left turn
  -- at the exact place where every left turn is — a gap on the left with
  -- something in front of you.
  if mode is 0 then
    stop
    set timer = timer - 1
    if timer < 1 then
      if leftGap > 45 and onWall is 1 then
        set dir = dir - 90
        set mode = 1
        set timer = 26
      else
        if frontGap > 45 then
          set markX = me.x
          set markY = me.y
          set gone = 0
          set mode = 2
        else
          set dir = dir + 90
          set mode = 1
          set timer = 26
        end
      end
      -- Kept inside a half turn either way so it stays a compass bearing
      -- rather than a running total of every corner ever taken.
      if dir > 180 then
        set dir = dir - 360
      end
      if dir < -180 then
        set dir = dir + 360
      end
    end
  end

  -- Turning, on the spot. Only a tank can do this, which is why Mouse is one:
  -- a car would need a corridor wider than the corner it is trying to take.
  if mode is 1 then
    stop
    turn body to dir
    set timer = timer - 1
    if timer < 1 then
      set markX = me.x
      set markY = me.y
      set gone = 0
      set mode = 2
    end
  end

  -- Walking, one square. It ends either when that square has been covered or
  -- when a wall turns up early, whichever comes first.
  if mode is 2 then
    drive forward 100
    if abs(me.speed) < 6 then
      set wedged = wedged + 1
    else
      set wedged = 0
    end
    if wedged > 18 then
      -- Caught on something the whisker never saw. Turn away and carry on:
      -- being somewhere slightly wrong beats being nowhere at all.
      set wedged = 0
      set dir = dir + 90
      set mode = 1
      set timer = 26
      if dir > 180 then
        set dir = dir - 360
      end
    else
      if frontGap < 25 then
        set mode = 0
        set timer = 14
      else
        if gone > stride then
          set mode = 0
          set timer = 14
        end
      end
    end
  end
end

on ping wall
  -- While measuring, the two readings are kept apart; afterwards every ping is
  -- the left whisker.
  if mode is 9 then
    if timer > 20 then
      set rightGap = event.distance
    else
      set leftGap = event.distance
    end
  else
    set leftGap = event.distance
    if event.distance < 45 then
      set onWall = 1
    end
  end
end

on sense wall
  set frontGap = event.distance
end

-- The radar is busy being a whisker, so anything Mouse shoots at is something
-- that wandered into the cone in front of it. It does not go looking, and it
-- does not stop walking to take the shot.
on sense robot
  turret.aim at event.bearing
  fire 2
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
    id: "goat",
    title: "Goat",
    teaches: "me.slope and me.uphill: reading the ground and taking the high ground",
    source: GOAT,
  },
  {
    id: "apex",
    title: "Apex",
    teaches: "the one to beat: fighting and foraging, budgeted against the cost table",
    source: APEX,
  },
  {
    id: "mouse",
    title: "Mouse",
    teaches: "following a wall: the radar as a whisker, and solving a labyrinth",
    source: MOUSE,
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
  GOAT,
  APEX,
  MOUSE,
};
