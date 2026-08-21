---
title: Left hand on the wall
titleBio: Left hand on the wall
teaches: walls somebody placed, and the oldest rule for getting through a maze
teachesBio: walls somebody placed, and the oldest rule for getting through a maze
section: The world
order: 3
---

The shape of the {ground} is generated. A seed goes in, a landscape comes out,
and nobody chose where any of it went.

Walls are the other thing. Somebody drew them. An {arena} can be saved with its
walls and handed to you, which means the map can be the puzzle rather than the
scenery — and the puzzle people build most often is a labyrinth.

## What a wall does, and what it does not

A wall stops you moving. That is the whole of it.

- {bullet}s fly straight over.
- Your {radar} beam passes through. It will tell you the wall is there, and
  then carry on and find somebody standing on the far side of it.

So a labyrinth is somewhere you can **see across but not drive across**. You
can be shot from a place you have no route to, and you can watch a fight you
cannot reach. That is worth knowing before you go exploring.

:::bot
Walls are plates of steel bolted to the floor. They are opaque to a tank and
transparent to everything else, which is not physics — it is a rule chosen to
keep mazes about finding your way rather than about cover.
:::

:::bio
Walls are strands of algae grown across the way. They are drawn translucent on
purpose: you can see what is behind one, and light and darts pass through it.
What cannot pass through is you.
:::

## You already know how to handle them

Nothing new to learn here. `on sense wall` and `on hit wall` fire in exactly
the same way for a wall somebody placed as for the edge of the {arena}. A
script cannot tell the two apart and does not need to — everything you wrote
back in *Walls and edges* works unchanged inside a maze.

Which is why a {robot} that merely bounces will survive in a labyrinth. It
just will not get anywhere.

## The rule

Put your left hand on the wall. Walk. Never take your hand off.

That is it, and it is enough. In a maze with no loops in it — which is the kind
this game builds — following one wall takes you past every square and returns
you to where you began. No map. No memory. No idea where you are at any point.

## The catch: you have to feel sideways

The sense cone only faces forward. `on sense wall` tells you what is ahead of
you and never what is beside you, so on its own it cannot find the opening you
are meant to turn into.

The {radar} can point anywhere you like. Aim it hard left and {ping}:

```robo
radar.aim at -90
if me.pingHeat is 0 then
  ping
end
```

`on ping wall` comes back with the distance. A small number means the wall is
still under your hand. A big one means the wall has stopped — an opening — and
the rule says turn into it.

This is the same instrument as the {radar} chapter used to find people,
pointed at the scenery instead. A whisker, rather than a way of finding
somebody.

## Stop before you look

Aiming takes time, and a {ping} can only be sent so often. A reading that
arrives while you are moving describes somewhere you have already left, and in
a corridor a square wide that is the difference between an opening and a wall.

So the {robot} below stands still to decide, turns, walks one square, and stops
to look again. It spends a good part of its life stationary. That is not
laziness — it is what makes every reading worth acting on.

## Try it

Explorer keeps its left hand on the wall. Give it the full time and it will
work its way round the whole maze; in one run of the playground you will see a
good part of it.

Mouse is in there too, doing the same job with a bit more care.

```try opponents=mouse maze=true
name "Explorer"
chassis tank
color #b085f5

var dir = 0
var mode = 0
var timer = 14
var gap = 0
var ahead = 999
var found = 0
var stride = 30

on tick
  radar.aim at -90
  if me.pingHeat is 0 then
    ping
  end

  if mode is 0 then
    stop
    set timer = timer - 1
    if timer < 1 then
      if gap > 45 and found is 1 then
        set name = "left"
        set dir = dir - 90
        set mode = 1
        set timer = 26
      else
        if ahead > 45 then
          set name = "on"
          set mode = 2
          set timer = stride
        else
          set name = "right"
          set dir = dir + 90
          set mode = 1
          set timer = 26
        end
      end
      if dir > 180 then
        set dir = dir - 360
      end
      if dir < -180 then
        set dir = dir + 360
      end
    end
  end

  if mode is 1 then
    stop
    turn body to dir
    set timer = timer - 1
    if timer < 1 then
      set mode = 2
      set timer = stride
    end
  end

  if mode is 2 then
    drive forward 100
    set timer = timer - 1
    if ahead < 25 or timer < 1 then
      set mode = 0
      set timer = 14
    end
  end
end

on ping wall
  set gap = event.distance
  if event.distance < 45 then
    set found = 1
  end
end

on sense wall
  set ahead = event.distance
end
```

Watch the label. It says *left* when it has found an opening, *right* when it
has run into something, and *on* when it is simply walking.

## Change one number

`stride` is how long one step down a corridor lasts, and it is the only number
in there that describes the **maze** rather than the rule. It is set to about
one square of this one.

Make it 14 and Explorer comes up short of every corner, never quite reaching
the openings. Make it 50 and it sails straight past them. Both look like a
{robot} that is lost, and neither is: it is walking the wrong distance.

Which is the honest problem with this whole approach. The rule needs no map,
but it does need to know how big a square is. The way out is to measure it
rather than guess — stand still at the start, {ping} left, {ping} right, and
the two of them plus your own width is the width of the passage you are
standing in. That is what Mouse does before it takes a single step.

## The other hand

Swap the whisker to `radar.aim at 90` and swap both turns over, and you have
the right-hand rule. It works just as well and explores the maze in the mirror
image — a different route, the same guarantee.

There is no third option. Following a wall is a complete method or it is
nothing; what you cannot do is follow the left wall for a while and then the
right one, because the moment you change hands you can walk in a circle for
ever.
