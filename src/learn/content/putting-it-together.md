---
title: Putting it together
titleBio: Putting it together
teaches: a complete {robot}, and where to go next
teachesBio: a complete cell, and where to go next
section: The language
order: 13
---

Everything so far, in one {robot}. Read it once through before you run it —
there is nothing new here, only pieces you have already met.

```try opponents=hunter,spinner,dodger cones=true
name "Complete"
body ciliate
color #44cc88

var seen = 0
var hurt = 0

on start
  drive forward 60
  turret.sweep 50
end

on tick
  if seen is 0
    turn body by 2
  end
end

on sense robot
  set seen = 1
  set name = "target " + event.distance
  turret.aim at event.bearing

  if event.distance > 180
    turn body by event.bearing
    drive forward 90
    fire 1
  else
    drive forward 30
    fire 3
  end
end

on hit by bullet
  set hurt = hurt + 1
  set name = "hit " + hurt
  turn body by event.bearing + 90
  drive forward 100
end

on hit wall
  drive back 60
  wait 8 ticks
  turn body to bearing(arena.width / 2 - me.x, arena.height / 2 - me.y)
  drive forward 70
end

on bullet missed
  set seen = 0
end
```

Each block has one job:

| | |
|---|---|
| `on start` | get moving and start looking |
| `on tick` | wander while there is nothing to do |
| `on sense robot` | aim, close or hold, and shoot |
| `on hit by bullet` | get off the line of fire |
| `on hit wall` | back off properly and head for open ground |
| `on bullet missed` | admit the target is gone and go looking again |

## Why the wall block is that long

The obvious version — turn away and drive on — does not work, and it is worth
understanding why, because it is the failure that kills more {robots} than any
opponent does.

Turning is not instant. `turn body by` sets a target and the {robot} rotates
towards it over the next several ticks, all the while still driving forward into
the wall it is already touching. So it hits again, which fires `on hit wall`
again, which resets the turn from the new bearing. It grinds along the edge
taking damage the whole way and never gets free.

Backing off first breaks the cycle. `drive back 60` puts clear space between the
{robot} and the wall, `wait 8 ticks` gives the turn somewhere to happen, and only
then does it set off. Heading for the middle rather than simply away means it
commits to open ground instead of skimming the edge.

The difference is not subtle: over sixty matches against these three opponents,
the version that turns on the spot wins eight and finishes on about 9 health,
and the version above wins twenty-three and finishes on about 26.

## The quiet one

`on bullet missed` is the subtlest block in there. A miss that sails off the edge of the {arena}
means whatever you were aiming at is not there any more, so it clears `seen` and
the wandering starts again. Small, but it stops the {robot} confidently shooting
at nothing.

## Things to try

Take that {robot} and change **one thing at a time**, running trials after each:

- sweep the {turret} faster or slower
- change the distance it switches tactics at
- always fire 1, or always fire 3
- dodge towards `event.bearing + 60` instead of `+ 90`
- stop wandering and hold the centre instead

Some of those will help and some will hurt, and you will not reliably guess
which. That is the whole point of the Workshop's test bench: run enough matches
that the answer is not noise.

## Where to go next

Head for the **Workshop**. Paste this in as a starting point, save it, and run
it against the built-in {robots} until you can beat all of them.

Then change something, keep both versions, and run them against each other.
That is the loop this whole game is built around — not writing a perfect
{robot}, but being able to tell whether today's is better than yesterday's.

When it is, take it to the **Arena** and find out what other people have been
building.
