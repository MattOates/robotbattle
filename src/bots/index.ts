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


/**
 * Wingman — fighting as a side, and talking about it.
 *
 * The one sample that needs two of itself in the arena to make any sense. It
 * shows the three things teams add, in the order they matter:
 *
 *  - `event.friend`, so it does not shoot its own side;
 *  - `broadcast`, to call out what it has found;
 *  - `pack` and `field`, because a call-out is several things at once.
 *
 * The interesting part is the tag. `broadcast` reaches every robot alive,
 * enemies included, and says nothing about who sent it — so the first slot of
 * every message is a word both Wingmen know and nobody else does. That is not
 * security, and it is not meant to be: anyone who watches a match can read the
 * word and start sending it too. Working out what to do about that is the whole
 * game, and this robot is where a player meets the problem.
 */
const WINGMAN = `
name "Wingman"
chassis tank
color #4ea8ff

-- Both copies of this robot share the word. Change it and they stop
-- understanding each other, which is the quickest way to see what it is for.
var codeword = "vulpes"

-- Where our side last saw an enemy, so we can go and help.
var help_x = 0
var help_y = 0
var helping = 0

on start
  radar.sweep 60
  turret.sweep 45
end

-- Anything the beam finds gets called out, so the other one knows without
-- having to look. The message is four things packed into one: the word that
-- says it is us, what kind of news it is, and where.
on ping robot
  if event.friend is false then
    broadcast pack(codeword, "contact", event.x, event.y)
  end
end

on radio
  -- Everybody heard this, including whoever we are fighting. If it does not
  -- start with our word, it was not one of ours, and we want nothing to do
  -- with it.
  if field(event.data, 1) is codeword and field(event.data, 2) is "contact" then
    set help_x = number(field(event.data, 3))
    set help_y = number(field(event.data, 4))
    set helping = 1
  end
end

-- Head for wherever our side last called out.
on tick every 5
  if helping is 1 then
    turn to bearing(help_x - me.x, help_y - me.y)
    drive 70
  end
end

-- The cone found somebody. Check whose side they are on BEFORE shooting: with
-- friendly fire on, the alternative is shooting the only ally we have.
on sense robot
  if event.friend is false then
    turret.aim at event.bearing
    fire 2
    broadcast pack(codeword, "contact", event.x, event.y)
  end
end

on hit by bullet
  if event.friend is true then
    -- One of ours. Say so rather than shooting back.
    broadcast pack(codeword, "sorry", me.x, me.y)
  else
    turn body by event.bearing + 90
    drive 80
  end
end
`;

/**
 * Boid — Reynolds' flocking, with the radio standing in for eyesight.
 *
 * The three rules of a boid are all statements about your neighbours:
 * **separation** (do not crowd them), **alignment** (head the way they head)
 * and **cohesion** (drift towards the middle of them). Every one of them needs
 * to know where the neighbours ARE, and in the arena a robot can only see a
 * 30-degree cone in front of itself. A flock that had to look at each other
 * would spend the whole match turning round to check.
 *
 * So this one tells instead of looking. Each Boid broadcasts its own position
 * and heading every sixth tick, and builds its picture of the flock entirely
 * out of what it hears. Nobody ever senses a flockmate; the cone and the gun
 * are left free for whoever it is fighting. That is the point of the robot: the
 * radio is not a chat channel bolted on to a robot that already worked, it is
 * the sense organ the algorithm needs and the arena does not otherwise provide.
 *
 * ## Reading a flock out of a message queue
 *
 * There are no lists in RoboScript, so the flock is never assembled anywhere.
 * Each message adds one neighbour into a set of running totals — a count, a sum
 * of positions, a sum of heading vectors, a sum of separation pushes — and every
 * sixth tick the totals are turned into one steering direction and cleared. The
 * window is the radio's own cooldown, so each flockmate contributes exactly once
 * to each decision.
 *
 * ## Written as `can` blocks, and why the cadences are offset
 *
 * There is not one `on` block in it. Every behaviour is a named `can ... given`
 * block, which is also the most useful thing this robot demonstrates after the
 * flocking itself: each block keeps its OWN count, so `announce` and
 * `flock_together` can both say `every 6` without treading on each other, and
 * either can be lifted out and read on its own.
 *
 * `announce` says `every 6 after 3`, and the `after` is doing real work.
 * `after` starts the cadence counting, so that block fires on ticks 9, 15, 21
 * while the steering fires on 6, 12, 18 — talking lands halfway between
 * decisions rather than on top of them, which gives every message a clear run
 * at the totals before they are used and cleared. Putting them on the same beat
 * costs about a third of the flock's alignment and most of its win rate.
 *
 * Headings are summed as `cos`/`sin` and read back with `bearing`, because the
 * average of 350 degrees and 10 degrees is 0, not 180. Averaging the numbers
 * themselves points the flock backwards twice a turn.
 *
 * ## Two things it learned the hard way
 *
 * **Food is shared, because a flock cannot see it.** The radar reports a robot
 * in preference to fuel, and a Boid's radar is looking at flockmates every time
 * it sweeps — so `ping fuel` almost never fires for a robot in a flock. Instead
 * the first Boid whose cone happens to catch a cell broadcasts where it is, and
 * the whole flock knows. That is the honest version of a waggle dance, and it
 * is also why the messages carry a kind: `p` for position, `f` for food.
 *
 * **It flies slower when it is hungry.** A flock is fuel-expensive in a way a
 * lone robot is not: five of them clump together and then compete for the same
 * cells, so they run low sooner than five robots that spread out. Cruising at a
 * speed set by the tank means a hungry flock slows down instead of grinding
 * itself to bits at walking pace — which is worth about four survivors out of
 * five at two minutes, against three without it.
 *
 * The tag is `flock` plus `me.team`, so two flocks in the same arena do not
 * merge. Note what that is not: it is not a secret. Anybody can read a match
 * and work out what to send. `Wingman` is where that problem is spelled out.
 */
const BOID = `
-- Boid: Reynolds' three rules of flocking, with the radio doing the seeing.
--
-- There are no "on" blocks here at all. Every "can ... given <event>" block IS
-- the handler for that event, and each one keeps its own count -- which is why
-- two of them can both say "every 6" and neither treads on the other.
name "Boid"
chassis tank
color #6ad98a

-- The word this flock answers to. me.team is on the end so that two flocks in
-- the same arena do not merge into one. It is not a secret: anybody watching a
-- match can read it off and start sending it. See the Wingman for that problem.
var flock = "starling"
var tag = ""

-- What the flock looks like, totalled up as the messages come in. There are no
-- lists in RoboScript, so the flock is never assembled anywhere -- each message
-- adds itself into these running totals, and every sixth tick they become one
-- direction and are cleared.
var mates = 0
var sum_x = 0
var sum_y = 0
var dir_x = 0
var dir_y = 0
var push_x = 0
var push_y = 0

-- The last food anybody in the flock saw, and whether it is our turn to pass
-- the news on.
var food_x = 0
var food_y = 0
var found = 0
var news = 0

can wake given start
  set tag = flock + me.team
  -- No radar sweep. In a flock the beam only ever finds a flockmate -- it
  -- reports a robot in preference to food -- so sweeping it is pure cost.
  turret.sweep 45
  drive 55
end

-- ---------------------------------------------------------------- talking --

-- One transmission every six ticks, which is as often as the radio allows.
-- Food news jumps the queue: a flock that cannot see food is worth more to
-- than one more position update.
can announce given tick every 6 after 3
  if news is 1 then
    broadcast pack(tag, "f", round(food_x), round(food_y))
    set news = 0
  else
    broadcast pack(tag, "p", round(me.x), round(me.y), round(me.heading))
  end
end

-- Everything the flock knows about itself arrives here. Nobody ever senses a
-- flockmate: the cone and the gun stay free for whoever we are fighting.
can listen given radio
  if field(event.data, 1) is tag then
    var kind = field(event.data, 2)
    var mx = number(field(event.data, 3))
    var my = number(field(event.data, 4))
    if kind is "f" then
      set food_x = mx
      set food_y = my
      set found = 1
    end
    if kind is "p" then
      do fold with mx, my, number(field(event.data, 5))
    end
  end
end

-- One flockmate, folded into the totals. The three rules of a boid are all
-- statements about your neighbours, so this is where all three are gathered.
can fold with mx, my, mh
  set mates = mates + 1

  -- Cohesion: where the flock is, on average.
  set sum_x = sum_x + mx
  set sum_y = sum_y + my

  -- Alignment: which way it is heading, on average. Summed as components and
  -- read back with bearing(), because the average of 350 and 10 is 0, not 180.
  set dir_x = dir_x + cos(mh)
  set dir_y = dir_y + sin(mh)

  -- Separation: push away from anyone close, harder the closer they are.
  var gap = distance(me.x, me.y, mx, my)
  if gap < 120 and gap > 0 then
    var strength = (120 - gap) / 120
    set push_x = push_x + (me.x - mx) / gap * strength
    set push_y = push_y + (me.y - my) / gap * strength
  end
end

-- ---------------------------------------------------------------- feeding --

can remember with fx, fy
  set food_x = fx
  set food_y = fy
  set found = 1
  -- Tell the others. One pair of eyes finding food feeds the whole flock.
  set news = 1
end

can spot given sense fuel
  do remember with event.x, event.y
end

can glimpse given ping fuel
  do remember with event.x, event.y
end

-- ---------------------------------------------------------------- steering --

-- The three rules, the food, a little wander and the walls, added up as one
-- direction. Every sixth tick, because that is how often a full set of
-- flockmates has been heard from.
can flock_together given tick every 6
  var vx = 0
  var vy = 0

  if mates > 0 then
    -- Separation dominates: a flock that touches itself grinds itself down,
    -- since a collision costs both robots their speed and a little health.
    set vx = push_x * 4.5 + dir_x / mates + (sum_x / mates - me.x) / 260
    set vy = push_y * 4.5 + dir_y / mates + (sum_y / mates - me.y) / 260
  end

  -- Head for food, harder the emptier the tank.
  var want = (100 - me.fuel) / 100
  if found is 1 and want > 0 then
    var away = distance(me.x, me.y, food_x, food_y)
    if away < 25 then
      set found = 0
    else
      set vx = vx + (food_x - me.x) / away * want * 4
      set vy = vy + (food_y - me.y) / away * want * 4
    end
  end

  -- A little noise, so the flock roams instead of settling into one spot and
  -- starving in it.
  set vx = vx + (random() - 0.5) * 0.4
  set vy = vy + (random() - 0.5) * 0.4

  -- Turn back before the wall rather than after it. Written out here rather
  -- than tucked into a block of its own: it works on vx and vy, and a block
  -- that quietly reached into whoever called it would be the kind of thing
  -- that reads fine until somebody moves it.
  if me.x < 130 then
    set vx = vx + 2
  end
  if me.x > arena.width - 130 then
    set vx = vx - 2
  end
  if me.y < 130 then
    set vy = vy + 2
  end
  if me.y > arena.height - 130 then
    set vy = vy - 2
  end

  if abs(vx) + abs(vy) > 0.05 then
    do fly with bearing(vx, vy)
  end

  set name = "flock " + mates
  do forget
end

-- Turn towards a heading, slowing down for a sharp turn and for an empty tank.
-- A hungry flock that keeps sprinting arrives everywhere too slowly to steer
-- and spends the rest of the match bumping into itself.
can fly with goal
  var err = goal - me.heading
  if err > 180 then
    set err = err - 360
  end
  if err < -180 then
    set err = err + 360
  end
  turn to goal
  var cruise = 25 + me.fuel * 0.3
  if abs(err) > 60 then
    drive cruise * 0.5
  else
    drive cruise
  end
end

can forget
  set mates = 0
  set sum_x = 0
  set sum_y = 0
  set dir_x = 0
  set dir_y = 0
  set push_x = 0
  set push_y = 0
end

-- ---------------------------------------------------------------- fighting --

can shoot given sense robot
  if event.friend is false then
    turret.aim at event.bearing
    fire 2
  end
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
    id: "wingman",
    title: "Wingman",
    teaches: "teams: event.friend, broadcast, and packing a message your side can read",
    source: WINGMAN,
  },
  {
    id: "boid",
    title: "Boid",
    teaches: "flocking: using the radio as a sense organ, and averaging a flock out of messages",
    source: BOID,
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
