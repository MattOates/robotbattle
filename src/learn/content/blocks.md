---
title: Having a can do attitude
titleBio: Having a can do attitude
teaches: writing a piece of behaviour once and using it wherever you need it
teachesBio: naming a behaviour, and letting it fire on its own
section: The language
order: 11
---

By now your scripts have some repetition in them. The same three lines to line
up a shot appear in two handlers; the same "get out of the way" is written twice
with one number changed. That is worth fixing, because a script you cannot read
is a script you stop improving.

`can` names a piece of behaviour. `do` runs it.

```robo
can line_up
  turret.turn by 10
  fire 2
end

on tick
  do line_up
end
```

`can` blocks go at the outside edge of your script, next to your `on` blocks —
never inside one. That is deliberate: a named thing should be findable, and
things buried inside other things are not.

## Handing something over

A block can be given something to work with:

```robo
can shove with power
  fire power
end

on tick
  do shove with 3
end
```

Inside the block, `power` is the block's own. If you also have a `var power`
somewhere, the block does not touch it — it borrows the name for as long as it
runs and gives it straight back.

You can give it a starting value, which makes it optional:

```robo
can shove with power=2
  fire power
end
```

Now `do shove` fires at 2, and `do shove with 3` fires at 3.

## Which event a block is for

A block that wants to use `event.` has to say what it is for. That is `given`:

```robo
can flinch given hit by bullet
  turn body by event.bearing + 90
  drive forward 90
end
```

Now the block can read everything a `hit by bullet` carries — and the editor
will offer those fields to you inside it, because the block has said what it
works on.

It also means the block only fits where that event is. `do flinch` inside
`on tick` is refused, because nothing has hit you and there is no bearing to
turn away from. That is not the language being fussy: it is the reason you can
send a block to a friend and have it make sense on arrival.

## How often it runs

Everything you learned about `every`, `after`, `before` and `at` in the last
lesson goes on a `can` line too, after the event:

```robo
can scan given tick every 30
  radar.turn by 20
  ping
end
```

Each block counts for itself, and that is the part worth noticing. Two blocks
on the same event can run at completely different rates, and neither one has to
know the other exists — which would be impossible if they were sharing a
counter you had to keep by hand.

## Blocks that run on their own

Here is the part worth knowing.

If your script has **no `on` block** for an event, then the `can` blocks for
that event *are* the handler. They run in the order you wrote them.

```robo
can flinch given hit by bullet
  turn body by event.bearing + 90
end

can shout given hit by bullet
  set name = "ow"
end
```

No `on hit by bullet` anywhere — so when something hits you, `flinch` runs and
then `shout` runs. Paste in a third block and it joins the end of the queue.
Delete one and the others carry on without it.

The editor tells you which is happening. At the end of every `can` line it
prints what will become of that block — whether it runs on its own, whether you
have to `do` it, or whether a handler you wrote out is running instead.

That last one is the rule in reverse. **If you write the `on` block, you are in
charge.** Nothing registers itself behind your back; your blocks become a
library that you `do` in the order you choose.

```robo
can flinch given hit by bullet
  turn body by event.bearing + 90
end

on hit by bullet
  -- you decide what happens, and when
  drive forward 100
  do flinch
end
```

A block that needs something handed to it can never run on its own — there
would be nobody to hand it the value — so it stays library code until you `do`
it. Give every parameter a starting value and it can run by itself again.

:::bot
This is close to how real robot software is put together: small named
behaviours, each subscribed to the kind of event it cares about, running in a
defined order. Swapping one out is a matter of deleting a block, not of
unpicking a function from the middle of a loop.
:::

:::bio
A cell does not have a control loop deciding what to do next. It has a great
many independent responses, each triggered by its own signal, all running at
once. Behaviour is what emerges from the set of them — and evolution edits that
set by adding and losing whole responses, not by rewriting a plan.

A script written as `can` blocks works the same way, which is why you can hand
somebody a single behaviour and have it mean something on its own.
:::

## Try it

Nothing below writes a single `on` block. Delete one of the `can` blocks and
watch what changes; add another `given sense robot` block and watch it join in.

```try opponents=spinner,racer cones=true
name "Blocks"
chassis tank
color #ffd166

var target = 0

can look given start
  turret.sweep 40
  drive forward 50
end

can engage with power=3 given sense robot
  set name = "seen"
  set target = event.bearing
  turret.aim at event.bearing
  fire power
end

can close given sense robot
  turn body by target
  if event.distance > 150 then
    drive forward 80
  else
    drive forward 30
  end
end

can flinch given hit by bullet
  set name = "ow"
  turn body by event.bearing + 90
  drive forward 90
end

can bounce given hit wall
  turn body by 150
  drive forward 60
end
```

## Things worth trying

- Take one block out of that script, put it into another of your {robots}, and
  see it work unchanged. That is what `given` buys you. The Workshop keeps a
  shelf of every block you have written, grouped by the event it works on —
  drag one from there into any script and it lands where it is allowed to go.
- Write two blocks `given sense robot` and reorder them. The order you write
  them in is the order they run.
- Give a block a number it needs — `can push with speed` — and watch the note
  at the end of the line change to say it cannot run on its own any more.
- A block can `do` another block. Just don't ask one to do itself: the compiler
  will tell you it would never finish.
