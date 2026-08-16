---
title: Repeating
titleBio: Repeating
teaches: loops, counting, and waiting
teachesBio: loops, counting, and waiting
section: The language
order: 10
---

There are five ways to do something more than once, and they suit different
jobs. Four of them repeat *inside* one moment of thinking. The last one repeats
across the whole match, and it is the one people reach for least and need most.

## A fixed number of times

```robo
repeat 4 times
  turn body by 90
  fire 1
end
```

Simple when you know the number in advance.

## Counting

```robo
for i = 1 to 4
  turret.turn by 45
end
```

`for` gives you the number as you go, which `repeat` does not. Useful when each
turn round the loop should be slightly different.

## Until something changes

```robo
loop
  turret.turn by 10
  break if me.gunHeat is 0
end
```

`loop` goes round forever, so it needs a way out. `break` leaves immediately;
`break if` leaves when something becomes true. `continue` skips the rest of this
time round and starts the next.

## Waiting

```robo
on hit wall
  turn body by 150
  wait 10 ticks
  drive forward 80
end
```

`wait` pauses **this block only** for a while. There are thirty ticks in a
second, so `wait 10 ticks` is about a third of one. The rest of your {robot}
carries on; only this block is asleep.

That makes it good for sequences that need to happen in order with a gap
between them, and bad for anything that needs to stay responsive — a block that
is waiting is not reacting.

## Every so often

The fifth way is not a loop at all. `on tick` runs thirty times a second, and a
tick is a thirtieth of a second — which is nobody's idea of a useful interval.
Almost nothing you want to do belongs on *every* one of them.

So say how often, on the header:

```robo
on tick every 30
  radar.turn by 20
  ping
end
```

That runs once a second instead of thirty times, and costs you a thirtieth of
the thinking. There are three more words like it:

| | |
|---|---|
| `every 30` | one time in every thirty |
| `after 60` | not until it has happened sixty times |
| `before 600` | only until it has happened six hundred times |
| `at 3` | the third time, once, and never again |

They count how many times *that block* has been reached — not how long the
match has been going — which is why they work just as well on something that
happens rarely:

```robo
on hit wall after 2 every 3
  turn body by 150
end
```

Two bumps, then every third bump after that: the fifth, the eighth, the
eleventh. `after` starts the counting again from where it finishes, so this
means what it sounds like it means.

`every`, `after` and `before` can be combined in any order. `at` goes on its
own, since it already says exactly which time.

## A pattern worth stealing

```try opponents=spinner,racer cones=true
name "Patroller"
body ciliate

var found = 0

on start
  drive forward 50
  turret.sweep 60
end

on tick
  if found is 0
    turn body by 3
  end
end

on sense robot
  set found = 1
  set name = "engaging"
  turret.aim at event.bearing
  fire 2
end
```

`on tick` runs constantly — thirty times a second, for the whole match. It is
where anything continuous belongs.

This one sweeps its {turret} while slowly rotating its whole body, so between
them they cover every direction. The moment it finds something, `found` changes
and the wandering stops.

## A warning about loops

An endless loop will not crash anything. Your {robot} gets a fixed amount of
thinking time each tick, and when it runs out it is paused mid-thought and
picked up again next tick.

So a runaway loop does not freeze the match — it makes your {robot} slow and
stupid, reacting late to everything while it grinds through a loop that never
finishes. That is the subject of the next lesson but one, and it is the most
common reason a {robot} that looks correct performs badly.
