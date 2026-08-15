---
title: Turning
titleBio: Changing direction
teaches: turning on the spot, and turning circles
teachesBio: how cells steer, and why it depends on the body
section: The language
order: 2
---

Driving forward is easy. Choosing *where* forward points is the interesting
part, and it is the first place the two bodies stop behaving the same way.

There are two ways to turn.

```robo
turn body by 90
turn body to 0
```

`by` is relative: turn ninety degrees from wherever you are pointing now.
`to` is absolute: turn until you are pointing at compass direction zero,
whichever way you happen to be facing at the moment.

Both are goals, not commands. You say where you want to point, and it turns
that way as fast as it can while it carries on doing everything else.

## Turning on the spot

:::bot
A **tank** runs on tracks, and the two tracks can turn in opposite directions.
Run the left one forward and the right one back and the whole machine spins
where it stands, going nowhere. That is why a tank can turn without moving at
all.
:::

:::bio
A **ciliate** is covered in thousands of cilia that beat in travelling waves —
*metachronal waves*, so called because each row beats slightly after its
neighbour, like wind crossing a field of wheat.

The clever part is that each row can reverse its power stroke independently.
Beat harder along one side than the other and the cell pivots on the spot,
going nowhere. A *Paramecium* really does this: it can spin in place, and it
can back up by flipping the direction of the stroke entirely.
:::

Press Play and watch it turn without going anywhere.

```try
body ciliate

on start
  turn body by 90
end
```

## Turning while moving

Now try exactly the same thing with the other body.

```try
body flagellate

on start
  turn body by 90
end
```

Nothing happens. It does not creep round slowly — it does not turn *at all*.

:::bot
A **car** steers with its front wheels. Turning the wheel while the car is
parked scrubs the tyres and gets you nowhere; the car only changes direction
because it is rolling and the wheels point it somewhere new. No movement, no
turn.

That also means a car has a **turning circle** it cannot beat. Even with the
wheel fully over there is a tightest arc it can manage, and going faster makes
that arc wider, not tighter.
:::

:::bio
A **flagellate** has one long flagellum, and all of its thrust points along the
body axis. It has nothing that pushes sideways. So it changes direction the way
a swimmer does: by curving its path while it is already moving. If it is not
swimming, there is nothing to curve.

That also means it has a tightest possible arc. A cell that is racing along
sweeps a wider curve than one moving gently — speed buys you distance and costs
you agility.
:::

So the fix is to move first:

```try opponents=sitting-duck
body flagellate

on start
  drive forward 100
  turn body by 90
end
```

## Which should you pick?

Neither is better. They are a trade, and the whole shape of your {robot}
follows from it.

| | {skid} | {steered} |
|---|---|---|
| Top speed | slower | much faster |
| Turn while still | yes | no |
| Turning circle | none | it has one |

Something that wants to sit still and spin to face whatever appears wants the
first. Something that wants to close distance fast and keep moving wants the
second — and has to plan its turns before it needs them.
