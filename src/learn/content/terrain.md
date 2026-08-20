---
title: There and back again
titleBio: There and back again
teaches: reading the shape of the {ground}, and why the high bit is worth having
teachesBio: reading the shape of the goop, and why the thick bit is worth having
section: The world
order: 2
---

Some matches are fought on a flat floor. Some are not.

When the {ground} has a shape, **where you go matters as much as how much you
move**. Heading into the hard going is slow and expensive. Coming back out of
it is quick and nearly free. And cutting straight across — neither into it nor
out of it — costs exactly what flat going costs.

That last one is the whole trick, and it is easy to miss.

:::bot
Hills. Going up one, the engine works against gravity the whole way and you
crawl. Coming down, gravity does the work. Going *along* the side of one, you
are neither climbing nor descending, and it is as easy as the flat.
:::

:::bio
Thick and thin patches of goop. Pushing into the thick stuff is hard work and
you slow right down. Slipping out into the thin stuff is easy. And moving along
the edge between them, without going deeper in or further out, costs no more
than open water.
:::

## Three things to read

- `me.slope` — how bad it is right here, from 0 to 100.
- `me.uphill` — which way it gets worse, turned so that 0 means straight ahead.
- `me.downhill` — which way it gets easier. The opposite.

All three are free. You can always feel what you are standing on.

On a flat map `me.slope` is always 0 — so anything you write for it simply
does nothing there, rather than going wrong.

## Two {robots}, the same {ground}, opposite ideas

**Racer** treats it like a race track. It never fights the {ground}: it takes
the drop when the drop is ahead, and otherwise holds the line across
it,
which is the cheap way through. A quarter turn from straight-up is the flattest
route there is.

```robo
if me.uphill > 0 then
  turn body by me.uphill - 90
else
  turn body by me.uphill + 90
end
```

**Goat** does the exact opposite. It walks straight up, and stops when the
{ground} runs out of up.

How does it know it has arrived? The top is level — the same as the
bottom is. So when the {slope} falls to nearly nothing *after* a climb, that is
the summit.

```robo
if me.slope > 2 then
  turn body by me.uphill
  drive forward 60
else
  stop
end
```

## Why the top is worth the climb

Two reasons, and the second one is the good one.

First, anybody coming at you is climbing. They arrive slowly and out of
{fuel}, while you have been sitting still paying almost nothing.

Second: **your {radar} beam is stopped by anything worse than what you are
standing on.** From the top it reaches everywhere. From the bottom of a hollow
you are nearly blind, and `on ping ridge` is all you get — the beam telling you
what is in the way.

You can push a {ping} harder to see over more, and it costs more to match. But
the cheapest way to see a long way is to be somewhere high in the first place.

## Try it

Watch the labels. Racer says "on the line" while it holds a contour; Goat says
"climbing" and then something else once it arrives.

```try opponents=racer,goat terrain=true fuel=true
name "Climber"
chassis tank
color #b085f5

on start
  turret.sweep 90
  drive forward 70
end

on tick
  if me.slope > 2 then
    set name = "climbing"
    turn body by me.uphill
    drive forward 60
  else
    set name = "on top"
    stop
  end
end

on sense robot
  turret.aim at event.bearing
  fire 3
end

on hit wall
  turn body by 140
  drive forward 60
end
```

Now change one line. Make it `turn body by me.downhill` and watch it go the
other way — into the bottom, where it is cheap to move and impossible to see.
Neither is right. That is the interesting part.
