---
title: Reacting
titleBio: Reacting
teaches: noticing you are being hit, and getting out of the way
teachesBio: escape responses, and why cells swim off at an angle
section: The language
order: 6
---

So far your {robot} only reacts to what it can see in front of it. But things
happen *to* you as well, and each one wakes up a block.

```robo
on hit by bullet
  turn body by event.bearing + 90
  drive forward 100
end
```

There is a lovely detail here. When you are hit, `event.bearing` points **back
along the path the shot came from** — towards whoever fired it.

That single number lets you do three quite different things:

| | |
|---|---|
| `turn body by event.bearing` | face your attacker |
| `turn body by event.bearing + 180` | run directly away |
| `turn body by event.bearing + 90` | move sideways |

## Why sideways is the good one

Running straight away is the obvious answer and the wrong one: you stay exactly
on the line your attacker is already aiming along, and you present the same
easy shot for longer.

Turning side-on and moving takes you *across* their aim. Every shot they take
now has to lead a moving target, and the shot already in flight misses behind
you.

```try opponents=hunter cones=true
name "Dodger"
body flagellate

on start
  drive forward 80
  turret.sweep 60
end

on sense robot
  turret.aim at event.bearing
  fire 1
end

on hit by bullet
  turn body by event.bearing + 90
  drive forward 100
end
```

:::bot
This is the same logic anything under fire uses: never travel along the line
your opponent has already ranged.
:::

:::bio
Cells do exactly this, and it is one of the best studied behaviours in all of
microbiology. *Paramecium* has an **avoidance reaction**: bump into something
unpleasant and it reverses its cilia, backs up, swings to a new heading, and
sets off again.

Crucially it does not reverse straight back down its own track. The turn is
through a substantial angle, so the escape carries it somewhere genuinely new.
A cell that simply retreated would keep meeting the same problem.
:::

## Seeing it coming

Better still is not to be hit at all. You can sense shots in flight:

```try opponents=hunter cones=true
name "Watchful"
body flagellate

on start
  drive forward 80
  turret.sweep 60
end

on sense bullet
  turn body by event.bearing + 90
  drive forward 100
end

on sense robot
  turret.aim at event.bearing
  fire 1
end
```

`on sense bullet` fires when a shot crosses your sense cone — but only your
cone, so it will not save you from behind. Dodging is never free: time spent
watching for incoming fire is time not spent hunting.

## The other things that happen to you

There are more of these, and they all work the same way:

| | |
|---|---|
| `on hit by bullet` | someone hit you |
| `on hit wall` | you drove into the edge |
| `on hit robot` | you bumped into someone |
| `on bullet hit` | one of *your* shots connected |
| `on bullet missed` | one of your shots sailed off the edge |
| `on robot destroyed` | somebody was destroyed, anywhere |

`on bullet hit` is worth a thought — it tells you your aim is good, which is
information you can act on.
