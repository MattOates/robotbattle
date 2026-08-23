---
title: Flocking
titleBio: Swarming
teaches: the boids algorithm, and building a flock out of messages
teachesBio: the boids algorithm, and building a swarm out of signals
section: The world
order: 5
---

In 1986 Craig Reynolds wanted to animate a flock of birds without animating a
flock of birds. Drawing every path by hand was hopeless, and a flock told where
to go as a single object looked like a single object — a blob with wings.

So he wrote the flock as individuals, and gave each one the same three rules.
Nobody is in charge. No bird knows what the flock is doing. Each one looks at
whoever is near it and obeys:

- **Separation** — do not crowd the ones next to you.
- **Alignment** — head roughly the way they are heading.
- **Cohesion** — drift towards the middle of them.

That is the whole algorithm. What comes out of it is a flock that splits round
obstacles and closes up again, that turns as one without anybody calling the
turn, and that nobody designed. Reynolds called the individuals *boids*, and the
word stuck.

:::bot
It is the standard example of **emergence**: complicated behaviour that is not
written down anywhere, but falls out of simple parts following simple rules. The
same three rules have flown bats through Gotham and stampeded wildebeest through
a canyon; once you have seen them you start noticing them in traffic.
:::

:::bio
Real flocks work like this, and we know because people counted. Starlings in a
murmuration track their **seven nearest neighbours** — not everything within a
distance, but a fixed number of them, which is what lets a turn cross a flock of
thousands in a fraction of a second. Fish schools, locust bands and the
collective crawl of *Dictyostelium* slime moulds all run on rules of this shape:
local, identical, and with nothing in charge.
:::

## The problem with doing it here

Every one of those rules is a statement about your neighbours, so a boid has to
know where its neighbours are. A bird has most of a sphere of vision. You have a
cone 60 degrees wide in front of you.

A {robot} that had to look at its flockmates would spend the whole match turning
round to count them, and its gun would be pointing at friends the entire time.

So this flock does not look. It **tells**. Every {robot} says where it is, and
builds its picture of the flock out of what it hears — which leaves the cone and
the gun free for whoever it is fighting. The {radio} is not something bolted on
to a {robot} that already worked; it is the sense organ the algorithm needs and
the arena does not otherwise provide.

## Piece one: saying where you are

Start with the message. It needs a word that says which flock it belongs to, and
then the three numbers a neighbour needs:

```robo
var flock = "starling"
var tag = ""

can wake given start
  set tag = flock + me.team
  drive 55
end

can announce given tick every 6
  broadcast pack(tag, round(me.x), round(me.y), round(me.heading))
end
```

`every 6` because that is exactly as often as the {radio} will let you speak.
`round` because a message is cut at 48 characters and nobody needs your position
to two decimal places.

The tag ends with `me.team` so that two flocks in one arena do not merge into
one. It is **not** a secret — anybody watching a match can read it off and start
sending it.

## Piece two: totting up the neighbours

There are no lists in this language, so the flock is never assembled anywhere.
Instead every message that arrives adds itself into a set of running totals:

```robo
var mates = 0
var sum_x = 0
var sum_y = 0

can listen given radio
  set mates = mates + 1
  set sum_x = sum_x + number(field(event.data, 2))
  set sum_y = sum_y + number(field(event.data, 3))
end
```

Divide `sum_x` by `mates` and you have the middle of the flock, which is
cohesion. Every sixth tick those totals are used and then set back to zero, so
each window holds exactly one message from each flockmate.

## Piece three: the average of two headings

Alignment wants the average heading of your neighbours, and averaging the
numbers does not work. The average of 350 and 10 is 180 — pointing exactly
backwards, twice per turn.

The fix is to add up the *directions* rather than the numbers, and read the
answer back at the end:

```robo
var dir_x = 0
var dir_y = 0
var mates = 0

can listen given radio
  var mh = number(field(event.data, 4))
  set dir_x = dir_x + cos(mh)
  set dir_y = dir_y + sin(mh)
  set mates = mates + 1
end

can show given tick every 30
  set name = bearing(dir_x, dir_y)
end
```

`cos` and `sin` turn a heading into how far it reaches across and down;
`bearing` turns a pair like that back into a heading. Averaging 350 and 10 this
way gives 0, which is the answer anybody would have given you.

## Piece four: the three rules, added up

Each rule produces a direction, and the three are simply added. The weights are
where the character of a flock lives:

```robo
var mates = 3
var sum_x = 0
var sum_y = 0
var dir_x = 0
var dir_y = 0
var push_x = 0
var push_y = 0

can flock_together given tick every 6
  var vx = push_x * 4.5 + dir_x / mates + (sum_x / mates - me.x) / 260
  var vy = push_y * 4.5 + dir_y / mates + (sum_y / mates - me.y) / 260
  if abs(vx) + abs(vy) > 0.05 then
    turn to bearing(vx, vy)
    drive 55
  end
end
```

Separation is weighted far above the other two, and that is not taste. Two
{robots} that touch each other both stop dead and both take damage, so a flock
that lets itself close up grinds itself down. The push is strongest when a
neighbour is closest:

```robo
var push_x = 0
var push_y = 0

can listen given radio
  var mx = number(field(event.data, 2))
  var my = number(field(event.data, 3))
  var gap = distance(me.x, me.y, mx, my)
  if gap < 120 and gap > 0 then
    var strength = (120 - gap) / 120
    set push_x = push_x + (me.x - mx) / gap * strength
    set push_y = push_y + (me.y - my) / gap * strength
  end
end
```

## Piece five: each block keeps its own count

Both `announce` and `flock_together` say `every 6`, and they do not interfere,
because **a `can` block counts for itself**. That is worth knowing on its own:
you cannot write two `on tick` blocks, but you can write as many
`can ... given tick` blocks as you like and give each one its own cadence.

The Boid offsets them on purpose:

```robo
can announce given tick every 6 after 3
  broadcast "here"
end

can flock_together given tick every 6
  drive 55
end
```

`after` starts the cadence counting, so `every 6 after 3` fires on the ninth
tick, the fifteenth, the twenty-first — halfway between the decisions instead of
on top of them. Every message then gets a clear run at the totals before they
are used and cleared. Put them on the same beat and the flock loses about a
third of its alignment.

## What the flock cannot see

There is a catch worth meeting, because it is the sort of thing that only turns
up when you run the thing. The {radar} reports a {robot} in preference to
{fuel} — and a boid's {radar} is looking at flockmates every time it sweeps. So
a {robot} in a flock almost never gets `on ping fuel` at all. The flock is
blind to the one thing it is competing for.

The answer is the same instrument that solved the first problem. Whoever's cone
happens to catch some {fuel} tells everybody:

```robo
var food_x = 0
var food_y = 0
var found = 0

can spot given sense fuel
  set food_x = event.x
  set food_y = event.y
  set found = 1
end
```

:::bio
Which is very nearly the waggle dance, and for the same reason: one forager
finding something is worth far more to a colony if the other foragers are told.
:::

:::bot
Which is a scouting report. One sensor finding something is worth far more to a
formation if the rest of the formation is told where.
:::

## Try it

The label under each one counts how many flockmates it can hear. Watch them
find each other first, then settle into formation:

```try copies=4 cones=true
name "Flocker"
chassis tank
color #6ad98a

-- Four copies of THIS script take the field, all on one side. Change anything
-- below and all four change together -- which is the only way to see whether a
-- flocking rule works, because a flock of one is just a robot.

var mates = 0
var sum_x = 0
var sum_y = 0
var dir_x = 0
var dir_y = 0
var push_x = 0
var push_y = 0

can wake given start
  drive 45
end

-- Say where you are. Offset from the steering below, so a message always lands
-- between decisions rather than on top of one.
can announce given tick every 6 after 3
  broadcast pack("flock", round(me.x), round(me.y), round(me.heading))
end

-- Every flockmate folds itself into the totals as it arrives.
can listen given radio
  if field(event.data, 1) is "flock" then
    var mx = number(field(event.data, 2))
    var my = number(field(event.data, 3))
    var mh = number(field(event.data, 4))
    set mates = mates + 1
    set sum_x = sum_x + mx
    set sum_y = sum_y + my
    set dir_x = dir_x + cos(mh)
    set dir_y = dir_y + sin(mh)
    var gap = distance(me.x, me.y, mx, my)
    if gap < 70 and gap > 0 then
      set push_x = push_x + (me.x - mx) / gap * ((70 - gap) / 70)
      set push_y = push_y + (me.y - my) / gap * ((70 - gap) / 70)
    end
  end
end

can flock_together given tick every 6
  var vx = 0
  var vy = 0
  if mates > 0 then
    -- separation           alignment          cohesion
    set vx = push_x * 3 + dir_x / mates + (sum_x / mates - me.x) / 120
    set vy = push_y * 3 + dir_y / mates + (sum_y / mates - me.y) / 120
  end

  if me.x < 70 then
    set vx = vx + 2
  end
  if me.x > arena.width - 70 then
    set vx = vx - 2
  end
  if me.y < 70 then
    set vy = vy + 2
  end
  if me.y > arena.height - 70 then
    set vy = vy - 2
  end

  if abs(vx) + abs(vy) > 0.05 then
    turn to bearing(vx, vy)
    drive 45
  end

  set name = "flock " + mates
  set mates = 0
  set sum_x = 0
  set sum_y = 0
  set dir_x = 0
  set dir_y = 0
  set push_x = 0
  set push_y = 0
end
```

Then open **Boid** from the samples and read it end to end — it is the pieces
above, in order, with the walls and the wandering added. Things worth trying to
break:

- Set the separation weight (`* 3`) to 0 and watch them pile into each other.
- Set the alignment term (`dir_x / mates`) to 0 — they stay together but stop
  agreeing on a direction.
- Set the cohesion term to 0 and watch the flock come apart.
- Drop `announce` to `every 30` and see how badly a flock degrades when its
  members only speak once a second.
- Change `"flock"` in `announce` but not in `listen`, and watch every one of
  them go solo — the label falls to `flock 0`.
