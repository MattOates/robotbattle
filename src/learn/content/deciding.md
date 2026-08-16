---
title: Deciding
titleBio: Deciding
teaches: doing different things in different situations
teachesBio: doing different things in different situations
section: The language
order: 9
---

A {robot} that always does the same thing is easy to beat, because after ten
seconds your opponent knows exactly what happens next.

```robo
if event.distance > 150
  drive forward 100
else
  drive forward 30
end
```

`if` runs the lines inside only when something is true. `else` covers the rest.
Both close with `end`, like every other block.

## Comparing

| | |
|---|---|
| `is` | the same as |
| `isnt` | not the same as |
| `>` `<` | bigger, smaller |
| `>=` `<=` | bigger or equal, smaller or equal |
| `and` `or` | join two tests |
| `not` | the opposite |

It reads close to English on purpose: `if me.health < 30 and event.distance > 200`.

An `if` always needs one of these. It wants a *question* — something that comes
back yes or no — not a value:

```robo
-- No. `arena.time mod 60` is a number, not a question.
if arena.time mod 60

-- Yes. "is the remainder zero?" is a question.
if arena.time mod 60 is 0
```

That first one is worth understanding, because it is the mistake everybody
makes once. `mod` gives you the remainder — 1, 2, 3, all the way to 59, and
then 0. Written on its own it would count every one of those as true except the
0, so a script meant to do something *every 60 ticks* would do it on the other
59 instead. The compiler stops you rather than let you go looking for that.

The same goes for a name on its own: write `if ready is true`, not `if ready`.

## Closing carefully

Distance changes how you should behave. Far away, close the gap. Close up, stop
charging and concentrate on aiming.

```try opponents=spinner cones=true
name "Careful"
body ciliate

on start
  turret.sweep 45
  drive forward 60
end

on sense robot
  turret.aim at event.bearing
  turn body by event.bearing

  if event.distance > 150
    drive forward 100
    fire 1
  else
    drive forward 20
    fire 3
  end
end
```

Notice the power changes too. Far away, a fast weak shot arrives before the
target has moved. Close up, a heavy slow shot cannot miss by much.

## Choosing between several things

`else if` chains as many tests as you like, and only the first true one runs:

```robo
if me.health > 70
  drive forward 100
else if me.health > 30
  drive forward 60
else
  drive forward 100
  turn body by 90
end
```

Healthy, press on. Hurt, be careful. Nearly finished, run.

## Knowing about yourself

`me` is how you look at your own state, and it is what makes decisions like
that possible:

| | |
|---|---|
| `me.health` | how much you have left, out of 100 |
| `me.speed` | how fast you are going |
| `me.heading` | which way you are facing |
| `me.turret` | where your {turret} points, relative to your front |
| `me.gunHeat` | above zero means you cannot fire yet |
| `arena.robots` | how many are still alive |

`me.gunHeat` is worth using. There is no point turning to face something if you
could not shoot it anyway — you might rather spend that moment escaping.

```try opponents=hunter cones=true
name "Patient"
body flagellate

on start
  drive forward 70
  turret.sweep 50
end

on sense robot
  turret.aim at event.bearing
  if me.gunHeat is 0
    fire 2
  else
    drive forward 100
  end
end
```
