---
title: Seeing things
titleBio: Sensing the water
teaches: the sense cone, and reacting to what you find
teachesBio: chemoreception, and reading a direction from a gradient
section: The language
order: 4
---

Everything so far has been blind. Your {robot} drives and aims, but it has no
idea anything else exists. This lesson fixes that, and it is where {robots}
start to look alive.

You have a **sense cone**: a wedge in front of you, thirty degrees to either
side, reaching a couple of hundred steps ahead. It points wherever your body
points, so it swings as you turn. Anything inside it, you notice.

That is not very far — roughly a fifth of the way across the {arena}. Seeing
further is what the {radar} is for, a few lessons from here.

:::bot
Think of it as a radar dish bolted to the hull. It sees a slice of the world in
front, not a full circle — so what is behind you is genuinely invisible, and
turning to look is a real cost.
:::

:::bio
Real cells do not have eyes. They have **chemoreception**: receptor proteins
scattered over the membrane that bind to particular molecules drifting past. A
cell cannot see a point in space, but by comparing how strongly its receptors
are firing on one side against the other, it can work out a *direction* — which
way the concentration is getting stronger.

That is what the sense cone stands in for. Not vision — a gradient, read across
the front of the cell, telling it which way something interesting lies.
:::

## Being told about it

When something enters the cone, a block wakes up:

```robo
on sense robot
  turret.aim at event.bearing
end
```

`event` is what you have just been told. Its most useful field is `bearing`:
which way the thing is, **measured from straight ahead**. Zero is directly in
front, positive to your right, negative to your left.

That is the same measurement `turret.aim at` wants, which is not a coincidence.
Pointing at what you just noticed is one line, with no arithmetic.

```try opponents=spinner,racer cones=true
body ciliate

on start
  turret.sweep 45
  drive forward 40
end

on sense robot
  turret.aim at event.bearing
end
```

The sense cones are drawn here so you can see what is happening. Watch the
{turret} snap round the moment something crosses the wedge.

## What else you are told

`bearing` is not all of it:

| | |
|---|---|
| `event.bearing` | which way to turn to face it |
| `event.distance` | how far away, in steps |
| `event.speed` | how fast it is going |
| `event.heading` | which way it is facing |
| `event.health` | how much it has left |
| `event.name` | the label it is showing |

Different events carry different things — a wall cannot tell you its {health} —
and the editor knows which. Type `event.` inside any block and it will offer
exactly what that block really has.

## Turning to face it

Since `bearing` is relative to you, it works just as well for the body:

```try opponents=spinner cones=true
body ciliate

on start
  turret.sweep 45
  drive forward 50
end

on sense robot
  turret.aim at event.bearing
  turn body by event.bearing
end
```

Now it turns to face whatever it noticed, and because the cone follows the
body, facing something keeps it in view. That is the beginning of hunting.
