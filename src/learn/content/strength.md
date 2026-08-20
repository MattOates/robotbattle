---
title: Keep your strength up
titleBio: Keep your strength up
teaches: what moving costs, and how to go and find more
teachesBio: what swimming costs, and how to go and find more
section: The world
order: 1
---

Everything your {robot} does in the world costs it something. Moving costs
{fuel}. Turning costs {fuel}. So does every shot and every {ping}.

**Thinking is free.** You can work out whatever you like — count things, compare
things, change your mind — and it costs nothing at all. It is only the things
that happen *out there* that are charged for.

:::bot
A tank does not run on good intentions. The engine, the traverse motor, the
gun and the radar transmitter all draw on the same tank of fuel, and the
onboard computer draws so little by comparison that nobody bothers counting it.
:::

:::bio
A cell spends its energy on doing, not on deciding. Beating cilia, firing a
nematocyst and running a sensory organelle all cost real ATP. The chemistry
that decides *whether* to do those things is almost free next to actually
doing them.
:::

## Watching the tank

`me.fuel` is how much you have, out of 100. You start full.

The gauge under your {robot} shows the same number, so you can watch it drain
while you decide what to do about it.

## Running out

Here is the important part: **running out does not kill you.** It makes you
slow and clumsy. You keep going, at about a tenth of your usual speed, until
you find something to eat.

That matters because it means you can be greedy and get away with it, up to a
point. But a {robot} crawling at a tenth speed is not going to win anything, so
"up to a point" is where the game is.

The fall is not a straight line either. Down from a full tank you barely notice
it. It is the last stretch that hurts — which is exactly why it is worth
topping up *before* you are desperate, rather than after.

## Finding more

{fuel} appears around the arena on its own. Drive over it and it is yours.

There are two ways to notice it. Your sense cone finds it for nothing, if it
wanders into the wide wedge in front of you:

```robo
on sense fuel
  turn body by event.bearing
  drive forward 100
end
```

And your {radar} finds it much further away, if you spend a {ping} looking:

```robo
on ping fuel
  turn body by event.bearing
  drive forward 100
end
```

Notice the trade there. The cone is free but short. The beam reaches three
times as far, but the {ping} itself costs {fuel} — so you can quite easily
spend more looking for {fuel} than the {fuel} was worth.

## Try it

This one eats when it sees something and fights when it has to. Watch the
gauge. Then try taking the `on sense fuel` block out and see how long it lasts.

```try opponents=hungry-hippo fuel=true
name "Forager"
chassis tank
color #6ad98a

on start
  turret.sweep 60
  drive forward 70
end

on sense fuel
  set name = "food"
  turn body by event.bearing
  drive forward 100
end

on sense robot
  turret.aim at event.bearing
  fire 2
end

on tick
  if me.fuel < 30 then
    set name = "getting low"
  end
end

on hit wall
  turn body by 140
  drive forward 70
end
```

Hungry Hippo, over there, is worth reading afterwards. It never fires at
anybody. It decided that {fuel} was the whole game, and it is not completely
wrong.
