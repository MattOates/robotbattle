---
title: Shooting
titleBio: Stinging
teaches: firing, power, and waiting to cool down
teachesBio: the nematocyst, and why it cannot fire continuously
section: The language
order: 6
---

Noticing something is not much use on its own.

```robo
fire 2
```

The number is the power, from 1 to 3, and it is a real trade rather than a
difficulty setting.

| Power | Damage | Speed |
|---|---|---|
| 1 | least | fastest |
| 2 | middling | middling |
| 3 | most | slowest |

A weak shot is quick and hard to dodge. A strong shot hurts far more but takes
noticeably longer to arrive, so a moving target may simply not be there when it
lands. Against something that sits still, use 3. Against something moving quickly
about, 1 lands more often.

## You cannot fire continuously

After a shot, your weapon needs to cool. `me.gunHeat` counts down to zero and
until it gets there, `fire` does nothing at all — not an error, just nothing.

:::bot
The barrel needs to clear and the next round needs loading. Firing a heavier
charge heats it more, so a power 3 shot leaves you waiting appreciably longer
than a power 1.
:::

:::bio
The {turret} here is a **nematocyst** — a real organelle, found in jellyfish and
their relatives. It is a capsule holding a coiled, barbed thread under enormous
osmotic pressure, and when it is triggered the thread everts and fires out in
well under a millisecond. It is one of the fastest movements in all of biology.

Rebuilding one is slow, chemically expensive work. That is what the cooling
period stands for: not a hot barrel, but the cost of assembling another loaded
capsule.
:::

## Putting it together

Everything from the last three lessons, in one {robot}:

```try opponents=sitting-duck,spinner cones=true
name "First Hunter"
body ciliate

on start
  turret.sweep 45
  drive forward 50
end

on sense robot
  turret.aim at event.bearing
  fire 2
end
```

That is a genuinely functional {robot}. It searches, it aims at what it finds,
and it shoots.

## Aiming better

There is a subtlety. `fire` happens immediately, but the {turret} takes time to
swing round — so the first shot after spotting something often leaves before
the aim has finished arriving.

One fix is to only shoot when the target is nearly in front of the {turret}
already:

```robo
on sense robot
  turret.aim at event.bearing
  if event.distance < 200
    fire 3
  end
end
```

`if` is the next lesson but one. For now, notice the problem: **aiming is not
instant**, and a {robot} that fires the moment it sees something wastes most of
its shots.

## Try this

In the example above, change `fire 2` to `fire 1` and then `fire 3`, and watch
how often each actually connects.
