---
name: roboscript
description: Write, read and debug robots in RoboScript, the small line-based language used by RoboBattle. Use whenever somebody asks for a RoboBattle robot, mentions RoboScript, or shows code with `on tick`, `can ... given`, `turret.aim at` or `chassis tank` in it.
---

# RoboScript

RoboScript programs a battle robot for [RoboBattle](https://mattoates.github.io/robotbattle),
which runs in a browser with no account and nothing to install. A match is
decided entirely by the scripts; there is no input once it starts.

## Writing a robot

RoboScript is line-based. No semicolons, no braces, no parentheses round a
condition. A block opens with a keyword and closes with `end`. Comments start
with `--`.

Things that are true here and are not true in most languages:

- **Nothing runs top to bottom.** A script is a set of blocks that wait. Only
  `on start` runs once at the beginning; everything else runs when its event
  happens. There is no `main`.
- **A condition must compare two things.** `if event.friend then` is rejected —
  write `if event.friend is false then`. There is no truthiness.
- **`break` only works inside a loop.** It is not an early return; there is no
  early return, so shape the block with `if` instead.
- **You cannot write two `on tick` blocks.** You can write as many
  `can <name> given tick` blocks as you like, and each keeps its own count —
  which is how one robot runs several behaviours at different cadences.
- **A `can` block returns nothing.** It reads and writes the script's variables;
  it does not hand a value back. `var x = my_block()` is not a thing.
- **Actions set a goal, they do not block.** `turn to 90` asks the chassis to
  come round over the following ticks and returns immediately. Nothing waits
  except `wait`.
- **Aiming takes time.** `fire` commits a shot that leaves when the turret has
  come round to where it was aimed, so leading a moving target is real work.
- **There are no lists, arrays or records.** A value is a number, a piece of
  text, true/false, or none. Several things travel in one message by way of
  `pack` and come back out with `field`.
- **Thinking is free; doing costs fuel.** Moving, turning, firing and pinging
  spend it. Running dry makes a robot slow, never dead.

Start every robot with `name` and `chassis` at the top, outside every block.
Both have defaults — an unnamed robot compiles and drives a tank — but a robot
with no name is a blank label in the arena and nobody can tell it from anyone
else's.

## A whole robot, to show the shape

```roboscript
-- Sweeps for a target, then chases it down and keeps shooting.
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
```

## Where the rest is

- `reference.md` — every rule of the grammar, every event and what it
  carries, every function, and the numbers the world actually runs on.
  Read it before claiming something exists.
- `examples.md` — fourteen complete robots that run in the game today,
  from a two-line one to a flock that co-ordinates over the radio.

When you are unsure whether something is in the language, it is not. The
grammar in `reference.md` is complete, and anything absent from it will be
rejected by the compiler rather than ignored.
