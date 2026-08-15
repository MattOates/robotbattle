---
title: Remembering
titleBio: Remembering
teaches: variables, and watching what your {robot} is thinking
teachesBio: variables, and watching what your cell is thinking
section: The language
order: 7
---

Every block so far has started from nothing. It wakes up, does its work, and
forgets. To behave differently the second time something happens, you need to
keep something.

```robo
var target = none
var seen = 0
```

`var` makes a new variable and gives it a starting value. `set` changes it
later.

```robo
set seen = seen + 1
```

Variables belong to the whole {robot}, not to one block, which is exactly what
you want: something noticed in one block can be used in another.

```try opponents=spinner,racer cones=true
name "Counter"
body ciliate

var seen = 0

on start
  turret.sweep 45
  drive forward 40
end

on sense robot
  set seen = seen + 1
  set name = "seen " + seen
  turret.aim at event.bearing
  fire 2
end
```

## The label is a window

`set name` is special, and it is the most useful debugging tool you have. It
changes the text under your {robot} on screen, live, while the match runs.

You cannot step through a {robot} in a debugger — it is running thirty times a
second in the middle of a fight. But you can make it *tell* you what it is
thinking:

```robo
on sense robot
  set name = "hunting " + event.distance
end

on hit by bullet
  set name = "ouch"
end
```

Run that and you can read your {robot}'s mind from across the room. When
something behaves strangely and you cannot see why, put a `set name` in the
block you suspect and watch whether it ever fires at all.

`+` joins text as well as adding numbers, so `"seen " + seen` gives `seen 3`.

## Remembering where something was

Here is a variable earning its keep. Your sense cone only sees in front of you,
so a target you turned away from vanishes. Remembering the last bearing lets you
keep working on it after it is out of sight:

```try opponents=spinner cones=true
name "Persistent"
body ciliate

var last_seen = none

on start
  turret.sweep 60
  drive forward 40
end

on sense robot
  set last_seen = event.bearing
  set name = "got you"
  turret.aim at event.bearing
  fire 2
end
```

`none` means "nothing yet" — a useful starting value when the honest answer is
that you have not seen anything.

## Names

Variables can be called almost anything, so call them something that reads
well. `last_seen` will still mean something to you tomorrow; `x` will not. The
words the language already uses are off limits, and it will tell you so if you
try.
