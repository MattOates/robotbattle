---
title: Your first robot
titleBio: Your first organism
teaches: name, body, and getting it moving
teachesBio: naming a cell and getting it swimming
section: The language
order: 1
---

Every {robot} is a list of things to do **when something happens**. Nothing runs
on its own — you write blocks that wake up for an event, and the rest of the
time your {robot} just carries on doing whatever you last told it.

The smallest useful {robot} needs three things: a name, a body, and something to
do when the match starts.

```try
name "My First"
chassis tank
color #ff8800

on start
  drive forward 60
end
```

Press **Play**. It sets off, hits the far wall, and stops there — because
nothing told it what to do next.

## The three lines at the top

`name` is what appears under it on screen. `color` is how it is painted. Both
are just labels.

`chassis` is the real choice, and there are two.

:::bot
A **tank** runs on tracks. It is slower, but it can spin on the spot, because
the tracks can turn in opposite directions.

A **car** runs on wheels. It is much faster in a straight line, but it steers
like a car: it cannot turn at all unless it is already moving.
:::

:::bio
A **ciliate** is covered in cilia — thousands of tiny hairs that beat in
travelling waves called *metachronal waves*, like wind crossing a wheat field.
Because each row can reverse its power stroke independently, a ciliate such as
*Paramecium* can pivot on the spot without going anywhere.

A **flagellate** has one long flagellum that it whips to drive itself forward.
All the thrust points along its body, so it steers by curving its path — and if
it is not swimming, it cannot turn at all.
:::

Try changing `tank` to `car` and pressing Play again. Watch how much further it
gets before it hits the wall.

## Doing something when it starts

`on start` runs **once**, at the very beginning.

```robo
on start
  drive forward 60
end
```

`drive forward 60` is not a distance — it is *how hard to push*, from 0 to 100.
There is no "drive forward for three seconds"; you set it going and it keeps
going until you say otherwise. That is the single most important idea in this
language, and everything else builds on it.

So `drive forward 60` means "from now on, move forward at 60% power". It is
still true a minute later.

## Try this

Change the number and press Play:

```try
name "My First"
chassis tank

on start
  drive forward 100
end
```

Then try `drive back 40`, and try `stop` on its own. Nothing you do here is
saved, so break it as much as you like — **Reset** puts it back.
