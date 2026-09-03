---
title: Working together
titleBio: Working as a colony
teaches: telling friend from foe, and saying something to everyone at once
teachesBio: telling kin from stranger, and releasing something everyone can smell
section: The world
order: 4
---

Everything so far has assumed you are on your own. In a {team} match you are not:
some of the {robots} out there are on your {team}, and the match is over when one
{team} is left rather than one {robot}.

That changes two things. You have to know who you are shooting at, and it helps
enormously to be able to say something to the others.

## Telling friend from foe

Every event that tells you about another {robot} now carries `event.friend`. It
is true when they are on your {team} and false when they are not — and in a
free-for-all it is false for everybody, because there everyone is a {team} of
their own.

So the very first thing a {team} {robot} does is check before it {fire}s:

```robo
on sense robot
  if event.friend is false then
    turret.aim at event.bearing
    fire 2
  end
end
```

Leave that check out and you will spend the match destroying the only ally
you have. `event.friend` is on `sense robot`, `ping robot`, `hit robot`,
`hit by bullet`, `bullet hit` and `robot destroyed`.

It is deliberately a yes-or-no rather than a {team} number. Whether somebody is on
*your* {team} is all the {arena} will tell you. With three {teams} in the match you
cannot tell one enemy from another — which is a real gap, and the rest of this
lesson is how you close it yourself.

## Saying something

`broadcast` sends one thing to **every {robot} alive**:

```robo
on ping robot
  broadcast "contact"
end
```

```try copies=2 opponents=wingman cones=true
name "Caller"
chassis tank

-- Two copies of this script are on the field, plus a Wingman on the other
-- {team}. Watch the labels: a Caller never shows its OWN call-out, because you
-- do not hear yourself -- it shows whatever the other two said. The Wingman's
-- messages look like gibberish because they are packed; see further down.

on start
  radar.sweep 60
  drive 40
end

-- Sweeping only aims the beam. Sending one is a separate thing you have to ask
-- for, so without this the block below would never run at all.
on tick every 10
  ping
end

on ping robot
  broadcast "contact"
end

on radio
  set name = event.data
end
```

Whoever hears it gets an `on radio` block, and `event.data` is what was sent.
There is a catch, and it is the whole point of the feature:

- **Everyone** hears it. Your {team}, the other {team}, everyone.
- It does not say **who sent it**. No name, no bearing, no distance.

:::bot
It is an open radio channel, not a private line. Anyone with a receiver hears
every word, and nothing in the signal proves who transmitted it.
:::

:::bio
It is a scent released into the water. Whatever is nearby smells it, whether it
is kin or not, and the molecule carries no return address. Real organisms live
with exactly this: quorum-sensing bacteria flood their surroundings with a
signal molecule, and some species have evolved to listen in on their
neighbours' chatter — or to release the molecule themselves and lie.
:::

## Saying who you are

Since nothing marks a message as yours, you have to mark it yourself. Agree a
word with the rest of your {team} and put it at the front:

```robo
var codeword = "vulpes"

on ping robot
  if event.friend is false then
    broadcast pack(codeword, "contact", event.x, event.y)
  end
end
```

`pack` joins several things into one message with a `|` between them, because
`broadcast` only carries one thing and a useful message is always several: who
it is from, what kind of news, and where.

At the other end, `field` pulls them back out. The first one is 1:

```robo
var codeword = "vulpes"

on radio
  if field(event.data, 1) is codeword then
    turn to bearing(number(field(event.data, 3)) - me.x, number(field(event.data, 4)) - me.y)
    drive 70
  end
end
```

`number` is needed because everything comes back out as text. There is also
`fieldcount`, for how many things are in a message, and `text`, for turning a
number into text so you can pack it.

## The interesting problem

Read that code again and notice what it does **not** do. Anybody watching the
match can see the word `vulpes` go past and start sending it too — and then your
{robots} will happily drive to wherever an enemy tells them to.

There is no answer to this in the language. That is on purpose: proving who you
are to your own {team} without also proving it to somebody reading over your
shoulder is one of the genuinely hard problems, and this is a safe place to meet
it.

Some things to try, none of which is a complete answer:

- Change the word as the match goes on — say, `codeword + round(arena.time / 300)`
  — so a word learned early stops working.
- Send a number that both {teams} can check but is awkward to fake, built out of
  something only your {team} knows.
- Ignore a call-out that does not agree with what you can see yourself.
- Send messages that are only useful to somebody already in the right place.

## Talking is not free

The {radio} has limits, and they exist so that one chatty script cannot decide how
everybody else's match goes:

- You can {broadcast} once every **6 ticks**. Asking more often is simply ignored,
  like firing a gun that has not cooled.
- A message is cut to **48 characters**.
- You are handed at most **4 messages a tick**. The rest are not lost — they
  wait in your own inbox and arrive on a later tick, in the order they were
  sent. A {robot} that reads its post every twelfth tick gets all of it, just
  later than one that reads every sixth.
- It costs the **sender** a little {fuel}. Speaking is work, like everything
  else that is not thinking. Listening costs nothing at all, on purpose: if
  hearing cost anything, shouting at somebody would be a way to drain their tank
  rather than a way to tell them something.

And you never hear yourself.

## Try it

Load **Wingman** from the samples and put two of it against two of something
else. Watch the labels: each one calls out what it finds, and the other goes to
help. Then change the codeword in one of them and watch them stop understanding
each other.

When that makes sense, **Boid** is the same idea taken as far as it goes: a
whole flock that never senses its own members and knows where all of them are
purely from what they say. There is a lesson on it in this section.
