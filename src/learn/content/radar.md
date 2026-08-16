---
title: The radar
titleBio: The eyespot
teaches: aiming a second sense, and pinging for what you cannot see yet
teachesBio: aiming a light-sensitive organelle, and looking on purpose
section: The language
order: 5
---

Your sense cone tells you about things that come close. That is useful, and it
is also completely passive: you find out about somebody at the moment they are
already near enough to shoot you.

The {radar} is the other half. It is a **third thing you can point** — not your
body, not your {turret}, but its own heading that stays where you put it. And
it does not report anything on its own. It looks only when you tell it to.

:::bot
Think of a dish on a mast. The sense cone is what the hull notices; the radar is
an instrument you swing round and fire a beam from. It reaches much further,
because all its power goes down a narrow line instead of spreading across a
wide wedge.
:::

:::bio
Many single-celled organisms have an **eyespot**: a patch of light-sensitive
pigment with a cup of shading pigment behind it. The cup is the clever part. It
blocks light from every direction except one, so the cell cannot see a picture —
but it can tell, very precisely, whether the light is coming from *that* way.

A wide receptor senses a lot vaguely. A shaded one senses a little exactly. That
is the same trade the eyespot makes here.
:::

## The bargain

| | sense cone | {radar} beam |
|---|---|---|
| how far | 195 steps | 585 steps — three times as far |
| how wide | 30° either side | 6° either side — a fifth as wide |
| when | on its own, every tick | only when you {ping} |
| points where | straight ahead | wherever you last aimed it |

It is not a better sense cone. It is a different one. It will find somebody
right across the {arena} — and it will walk straight past somebody standing
twenty degrees off the beam that your cone would have spotted easily.

## Pointing it

The {radar} takes exactly the same three instructions as your {turret}:

```robo
radar.turn to 0
radar.turn by 45
radar.aim at 90
radar.sweep 80
```

`radar.sweep` is the one to start with. It swings the beam back and forth while
you get on with driving, exactly like `turret.sweep`, and because the beam is
narrow you want a wide sweep.

You can read where it is pointing with `me.radar`, the same way you can read
`me.turret`. Both are measured from straight ahead.

## Looking

Pointing the beam does not look down it. `{ping}` does that:

```robo
on tick
  if me.pingHeat is 0 then
    ping
  end
end
```

That is the first `on tick` you have seen. A tick is one step of the match, and
there are thirty of them a second — so `on tick` is the block for anything that
should be going on continuously. There is a lesson later on how to say "not
quite so continuously".

A {ping} is instant, and there is a short wait before you can send another.
`me.pingHeat` counts down to zero, and zero means ready — the same idea as
`me.gunHeat` for the {turret}.

Then one of two things happens.

```robo
on ping robot
  set name = "contact"
end

on ping wall
  set name = "nothing there"
end
```

`on ping robot` runs when the beam found somebody, and carries all the usual
fields — `event.bearing`, `event.distance`, `event.health` and the rest.

`on ping wall` runs when it did not, and tells you how far away the wall is in
that direction. That is not a failure: it is a tape measure. Pointed sideways it
tells you how much room you have to dodge into.

## Which sense saw it?

This is why they are separate blocks. `on sense robot` means *something is close
to me*. `on ping robot` means *something is far away, over there, and I went
looking for it*. Those deserve different reactions, and keeping them apart means
you never have to ask which one you are handling.

The classic pattern is to let them take turns: the beam finds someone at long
range and turns the gun toward them, and the cone takes over when they arrive.

```try opponents=hunter,spinner cones=true
name "Watchtower"
chassis tank
color #6ad98a

on start
  drive forward 40
  radar.sweep 90
end

on tick
  if me.pingHeat is 0 then
    ping
  end
end

on ping robot
  -- Far away. Hold the beam on them and get the gun pointing the right way.
  set name = "contact"
  radar.aim at event.bearing
  turret.aim at event.bearing
  turn body by event.bearing
end

on sense robot
  -- Close now, and already aimed.
  set name = "in range"
  turret.aim at event.bearing
  fire 3
end

on hit wall
  turn body by 150
end
```

Watch the thin line sweeping out from it. Every flash is one {ping}, and it
stops at whatever it found.

## Things worth trying

- Sweep narrowly (`radar.sweep 20`) and you cover a small arc very thoroughly.
  Sweep widely (`radar.sweep 120`) and you cover the whole front, but the beam
  spends most of its time somewhere useless. There is no right answer.
- After `on ping robot`, try `radar.aim at event.bearing` to lock on rather than
  carrying on sweeping. The next {ping} then tells you whether they are still
  there, and which way they have moved.
- Point the beam behind you with `radar.turn by 180` now and again. Nothing else
  you own can look that way.
- A {ping} costs you nothing but time. Two {robots} with the same gun and the
  same chassis are separated by which one knew where the other was first.
