---
title: Walls and edges
titleBio: Walls and edges
teaches: staying off the edge, and why corners are dangerous
teachesBio: staying off the edge, and why corners are dangerous
section: The language
order: 11
---

The {arena} has hard edges. Drive into one and you stop dead, take a little
damage, and sit there — which is the single most common way a new {robot}
loses without ever meeting an opponent.

```robo
on hit wall
  turn body by 135
  drive forward 60
end
```

`event.bearing` here points back towards open space, away from the wall you hit,
so this works too and is more precise:

```try opponents=sitting-duck cones=true
name "Bouncer"
body ciliate

on start
  drive forward 80
end

on hit wall
  turn body by event.bearing
  drive forward 80
end
```

Watch it closely along the edge, though. Turning takes several ticks, and it is
still driving forward the whole time — so it often scrapes the wall two or three
times before it gets away. Backing off first fixes that, and the last lesson
shows how.

## Turn by an odd number

Turn by exactly 90 or 180 and you will trace the same rectangle forever, which
is wonderfully easy for an opponent to predict. `135` is better. Better still is
something that varies:

```robo
on hit wall
  turn body by event.bearing + randomint(-40, 40)
  drive forward 80
end
```

`randomint` gives a different number each match but the *same* sequence for the
same match, so a replay still plays back identically for everyone watching.

## Not touching the wall at all

Reacting to a wall is repairing a mistake. Knowing where you are avoids it.

| | |
|---|---|
| `me.x` `me.y` | where you are |
| `arena.width` `arena.height` | how big the {arena} is |

```try opponents=racer cones=true
name "Boxed In"
body flagellate

var edge = 90

on start
  drive forward 70
  turret.sweep 45
end

on tick
  if me.x < edge or me.x > arena.width - edge
    turn body by 6
  else if me.y < edge or me.y > arena.height - edge
    turn body by 6
  end
end

on sense robot
  turret.aim at event.bearing
  fire 2
end
```

It curves away as it approaches an edge and never quite arrives. Not elegant,
but it works, and it costs almost nothing.

## Why corners kill

A corner takes away two of your escape directions at once. Anything hunting you
only has to cover the remaining quarter-circle, and every shot it takes has a
smaller area to miss into.

:::bot
It is the standard mistake in any pursuit: retreating into ground that reduces
your own options faster than your pursuer's.
:::

:::bio
Cells face a version of this constantly. A bacterium that wanders into a dead
end in soil, or a *Paramecium* that swims into the meniscus at the edge of a
drop, tends to get stuck there — its escape reaction keeps turning it back into
the same barrier. Some species solve it exactly as above, by reversing far more
strongly the second and third time they meet the same obstruction.
:::

The centre is worth defending. Drifting back towards the middle when nothing is
happening is nearly always the right idle behaviour:

```robo
on tick
  if arena.robots > 2
    turn body to bearing(arena.width / 2 - me.x, arena.height / 2 - me.y)
  end
end
```
