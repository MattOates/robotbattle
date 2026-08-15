---
title: The turret
titleBio: The stinger
teaches: aiming without steering
teachesBio: aiming an organelle independently of the body
section: The language
order: 3
---

Here is the idea that makes this language worth learning: **where you point is
not where you go**.

Your {turret} turns on its own. You can be driving north while aiming east, and
carry on driving north while you aim. Everything you have learned so far
controls the body; this controls the aim, and the two are completely separate.

```robo
turret.turn to 0
turret.turn by 45
turret.aim at 90
turret.sweep 60
```

## Watch them come apart

This one drives in a circle while holding its aim on one fixed direction. Watch
the {turret} stay pointing the same way as the body swings underneath it.

```try
body ciliate

on start
  turret.turn to 0
  drive forward 40
  turn body by 180
end
```

`turret.turn to 0` is absolute, like `turn body to` — it points at a fixed
direction in the world and stays there no matter what the body does.

## Aiming relative to yourself

`turret.aim at` is the one you will use most, because it is measured **from
wherever your body is pointing**.

```robo
turret.aim at 0
turret.aim at 90
turret.aim at -90
```

`turret.aim at 0` means straight ahead. `90` is to your right, `-90` to your
left. This matters enormously in the next lesson: when something is spotted,
you are told which way it is *relative to you*, and that number goes straight
into `turret.aim at` with nothing to work out.

## Searching

Sitting with your aim fixed is a poor way to find anything. `sweep` swings the
{turret} steadily back and forth across the front of you, and keeps doing it
while you get on with driving.

```try opponents=spinner
body ciliate

on start
  turret.sweep 60
  drive forward 50
end
```

The number is how far to either side, in degrees. `sweep 60` covers a wide
arc slowly; `sweep 20` covers a narrow one and comes back round quickly.

:::bot
A real tank works this way for the same reason: the hull points where the
driver is going and the turret points where the gunner is looking, so the
machine never has to choose between moving and aiming.
:::

:::bio
Cells do this too, in their own way. A hunting *Didinium* keeps its feeding
apparatus oriented towards prey while its cilia carry the whole body along a
quite different path — the business end and the engine pointing separately.
:::

## Try this

Change `sweep 60` to `sweep 20`, then to `sweep 120`, and watch how the search
pattern changes.
