---
title: Thinking time
titleBio: Thinking time
teaches: why a correct {robot} can still be slow, and what to do about it
teachesBio: why a correct cell can still be slow, and what to do about it
section: The language
order: 12
---

This is the lesson that explains the strange results. Your {robot} looks right,
does the right things when you read it, and still loses to something simpler.
Usually the reason is here.

## Everyone gets the same slice

The match runs at thirty ticks a second, and on every tick each {robot} gets the
**same fixed amount of thinking time** — about two thousand small steps. Nobody
gets more for writing longer code, and nobody is slowed down by anyone else.

If you run out mid-thought, you are not stopped and you are not skipped. You are
*paused exactly where you are* and resumed on the next tick.

That is why an endless loop cannot hang the match. But it has a cost that
matters much more than most people expect.

## The cost

Suppose an `on sense` block takes four ticks' worth of thinking to finish. Then:

- your aim is based on where the target was four ticks ago
- and events that arrive while you are still thinking queue up behind you

You are reacting to the past and falling further behind. Meanwhile something
with three lines of code reacted immediately and hit you.

**Fast and roughly right beats slow and perfect.** That is true here for the
same reason it is true in a real fight.

## Watching for it

Every trial reports an execution warning if you routinely run out of thinking
time. Take it seriously — it is the difference between a {robot} that works and
one that only works on paper.

You can also see it directly, because the label updates live:

```try opponents=spinner cones=true
name "Busy"
body ciliate

var count = 0

on start
  turret.sweep 60
  drive forward 50
end

on tick
  set count = count + 1
  set name = "tick " + count
end
```

The counter should climb smoothly, thirty a second. If a {robot} of yours ever
shows a counter that stutters or lags, it is spending too long thinking.

## Keeping it cheap

Three habits cover almost everything:

**Do not search when you can remember.** Work something out once, keep it in a
variable, and reuse it. Recomputing the same thing every tick is the usual
culprit.

**Put continuous things in `on tick` and rare things in their own blocks.** An
`on tick` block runs thirty times a second; anything expensive in there is
expensive thirty times a second.

**Leave loops with `break`.** A loop that always runs to its natural end is
fine if it is short. A loop searching for something should stop the moment it
finds it.

```robo
loop
  turret.turn by 5
  break if me.gunHeat is 0
end
```

## The honest trade

There is a real design decision here, and it is yours to make.

A simple {robot} reacts instantly and does something adequate. A clever {robot}
does something better, late. Which wins depends entirely on how much better and
how late, and the only way to find out is to run trials — which is what the
Workshop is for.

:::bot
Real control systems live with exactly this tension. A slow, sophisticated
controller that lags its input is often beaten by a crude one inside the loop.
:::

:::bio
Cells are under the same pressure, and they have settled it in a way you might
recognise. A bacterium cannot compute a path to food; it has no memory worth the
name and no way to see where it is going. What it does instead is compare *now*
with a few seconds ago, and if things are improving it keeps going a little
longer.

That is almost nothing as a strategy, and it is executed in milliseconds by a
handful of proteins. It also works extremely well. Cheap and immediate has been
beating expensive and thoughtful for about three billion years.
:::
