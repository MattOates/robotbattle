# RoboScript

RoboScript programs a battle robot for [RoboBattle](https://mattoates.github.io/robotbattle),
which runs in a browser with no account and nothing to install. A match is
decided entirely by the scripts; there is no input once it starts.

## Writing a robot

RoboScript is line-based. No semicolons, no braces, no parentheses round a
condition. A block opens with a keyword and closes with `end`. Comments start
with `--`.

Things that are true here and are not true in most languages:

- **Nothing runs top to bottom.** A script is a set of blocks that wait. Only
  `on start` runs once at the beginning; everything else runs when its event
  happens. There is no `main`.
- **A condition must compare two things.** `if event.friend then` is rejected —
  write `if event.friend is false then`. There is no truthiness.
- **`break` only works inside a loop.** It is not an early return; there is no
  early return, so shape the block with `if` instead.
- **You cannot write two `on tick` blocks.** You can write as many
  `can <name> given tick` blocks as you like, and each keeps its own count —
  which is how one robot runs several behaviours at different cadences.
- **A `can` block returns nothing.** It reads and writes the script's variables;
  it does not hand a value back. `var x = my_block()` is not a thing.
- **Actions set a goal, they do not block.** `turn to 90` asks the chassis to
  come round over the following ticks and returns immediately. Nothing waits
  except `wait`.
- **Aiming takes time.** `fire` commits a shot that leaves when the turret has
  come round to where it was aimed, so leading a moving target is real work.
- **There are no lists, arrays or records.** A value is a number, a piece of
  text, true/false, or none. Several things travel in one message by way of
  `pack` and come back out with `field`.
- **Thinking is free; doing costs fuel.** Moving, turning, firing and pinging
  spend it. Running dry makes a robot slow, never dead.

Start every robot with `name` and `chassis` at the top, outside every block.
Both have defaults — an unnamed robot compiles and drives a tank — but a robot
with no name is a blank label in the arena and nobody can tell it from anyone
else's.

## A whole robot, to show the shape

```roboscript
-- Sweeps for a target, then chases it down and keeps shooting.
-- Shows how event.bearing points straight at whatever you just noticed.
name "Hunter"
chassis tank
color #ff8800

var seen = 0

on start
  turret.sweep 45
  drive forward 70
end

on sense robot
  set seen = seen + 1
  set name = "hunting"
  turret.aim at event.bearing
  fire 3
  -- Turn the whole robot toward the target as well as the turret.
  turn body by event.bearing
  if event.distance > 120 then
    drive forward 90
  else
    drive forward 30
  end
end

on hit by bullet
  -- Shot from behind? Turn side-on and run.
  set name = "ouch!"
  turn body by event.bearing + 90
  drive forward 100
end

on hit wall
  turn body by 150
  drive forward 70
end
```

## Where the rest is

- `reference.md` — every rule of the grammar, every event and what it
  carries, every function, and the numbers the world actually runs on.
  Read it before claiming something exists.
- `examples.md` — fourteen complete robots that run in the game today,
  from a two-line one to a flock that co-ordinates over the radio.

When you are unsure whether something is in the language, it is not. The
grammar in `reference.md` is complete, and anything absent from it will be
rejected by the compiler rather than ignored.


# RoboScript reference

Generated from the game's own grammar and constants. If this disagrees with
the game, the game is right and this is a bug.

# The shape of the language

## The shape of a program

A script is a list of blocks. Nothing happens out at the top level: you say what your robot is called and what it is built from, and everything else goes inside a block that waits for something to happen.

### A whole script

```
[ <new line> ... ] [ declaration [ <new line> ... ] ... ]
```

Blank lines do not matter. Everything else is either a setting or a block.

### What goes at the outermost level

```
( name | chassis | colour | var | on block | can block )
```

Only these six things can go out here, and none of them are instructions. An instruction on its own out here has nothing to run it.

### name

```
name <text>
```

The label shown under your robot. You can change it during a match with `set name`.

Example: `name "Sparky"`

### chassis

```
chassis ( tank | car )
```

There are two to pick from. The first can spin on the spot and set off in any direction, but it is slower. The second is much faster in a straight line, but it steers like a car and cannot turn at all unless it is already moving.

Example: `chassis skid`

### color

```
color <colour>
```

The colour of your robot. Six letters and numbers after the `#`, or three as a shortcut. You can spell it `colour` if you prefer.

Example: `color #ff8800`

### var

```
var <name> = value
```

Makes a variable, which is somewhere to remember a number. Out at the top level it lasts the whole match. Inside a block it is forgotten as soon as the block finishes.

Example: `var target = 0`

### can

```
can <name> [ with given names ] [ given event ] how often ( <new line> ... ) instructions end
```

Gives a set of instructions a name, so you can `do` them from anywhere. Add `given` and the block can read `event.` as well.

Example: `can shove with power = 2
  fire power
end`

### What a block is given

```
( given name , ... )
```

The names your block wants to be given, separated by commas. Any with a starting value have to come last.

## Events

An `on` block runs when its event happens, and only then. Your robot does not work through the script from top to bottom. It waits, and things that happen wake up the blocks that match them. `on tick` is the closest thing to doing something all the time: it runs once every tick, then stops until the next one.

### on

```
on event how often ( <new line> ... ) instructions end
```

Runs the instructions inside it whenever that event happens.

Example: `on sense robot
  fire 2
end`

### The event

```
( event word ... )
```

Which event the block is for.

## How often a block runs

Sometimes you want a block to run now and again rather than every single time. `every`, `after`, `before` and `at` count how many times the event has happened, and let the block run only on the times you pick.

### every, after, before, at

```
[ ( every | after | before | at ) count ... ]
```

Counts how many times the event has happened and decides whether to run this time. You can use more than one together. `at` picks one exact time, so it goes on its own.

Example: `on tick every 30 after 60`

### The number

```
( <number> | <name> | me )
```

A whole number, 1 or more. You have to write it in — it cannot be worked out while the match is running.

## Instructions

What goes inside a block, one instruction to a line.

### One instruction

```
( var | set | if | loop | for | repeat | break | continue | wait | do | action )
```

Everything you can put on a line inside a block.

### set

```
set ( <name> | name ) = value
```

Changes a variable you already made. `set name` changes your label.

Example: `set target = event.bearing`

### if

```
if value [ then ] ( <new line> ... ) instructions [ else ( else if | ( <new line> ... ) instructions ) ] [ end ]
```

Runs the instructions only if the test is true. You can write `then` if it reads better.

Example: `if me.health < 30
  drive back 60
end`

### loop

```
loop ( <new line> ... ) instructions end
```

Goes round and round until something breaks out of it. It all happens inside one tick, so a loop with no `break` uses up your thinking time.

Example: `loop
  break if me.gunHeat is 0
end`

### for

```
for <name> = value to value ( <new line> ... ) instructions end
```

Counts from one number up to another, including both ends.

Example: `for i = 1 to 4
  turret.sweep 90
end`

### repeat

```
repeat value [ times ] ( <new line> ... ) instructions end
```

Does the same thing a set number of times. You can write `times` if it reads better.

Example: `repeat 3 times
  fire 1
end`

### break

```
break [ if value ]
```

Leaves the loop. `break if` only leaves when the test is true.

Example: `break if me.speed is 0`

### continue

```
continue [ if value ]
```

Skips the rest of this time round the loop and starts the next one.

### wait

```
wait value [ ( ticks | tick ) ]
```

Stops here and carries on in a later tick. It is the only instruction that waits.

Example: `wait 15 ticks`

### do

```
do <name> [ with ( value , ... ) ]
```

Runs a `can` block, giving it any values it asks for.

Example: `do shove with 3`

## Things your robot can do

Actions are the instructions that change something in the arena. Most of them cost time or fuel. If a block asks for two different things in the same tick, the last one is the one that happens.

### An action

```
( drive | stop | turn | turret | radar | fire | ping | broadcast )
```

The instructions that make your robot actually do something.

### drive

```
drive [ ( forward | back ) ] value
```

How hard to push, from -100 to 100. `back` is the same as a minus number, and `stop` is the same as 0.

Example: `drive forward 80`

### turn

```
turn [ chassis ] to or by value
```

`to` turns to a compass direction. `by` turns that many degrees from wherever you are now. Turning takes time, and rough ground slows it down.

Example: `turn to 90`

### turret

```
turret . turret action
```

Points the turret. You can write `at` after `aim` if it reads better.

Example: `turret.aim at event.bearing`

### What a turret can do

```
( turn to or by value | aim [ at ] value | sweep value | fire )
```

`turn` moves it round from where your body is pointing. `aim` points it at a compass direction whichever way you are facing. `sweep` swings it by an amount.

### radar

```
radar . radar action
```

Points the radar, or sends a ping with it.

Example: `radar.sweep 45`

### What a radar can do

```
( turn to or by value | aim [ at ] value | sweep value | ping [ value ] )
```

The same three as the turret, and `ping` as well.

### fire

```
fire [ value ]
```

Fires a shot. The power is 1, 2 or 3, and it is 2 if you do not say.

Example: `fire 3`

### ping

```
ping [ value ]
```

Sends out a pulse. Whatever it finds comes back to you as `on ping`. Everyone else can hear it too.

Example: `ping`

### broadcast

```
broadcast value
```

Says one thing to every robot in the arena at once. They all get it as `on radio`, and none of them are told it was you — so if your side needs to know, say so in the message. You can speak again every 6 ticks.

Example: `broadcast "help"`

## Values

Anywhere a number goes, you can put one of these: a plain number, a variable, something your robot can sense about itself or the arena, or a sum made out of them.

### A value

```
or
```

Anything that works out to a number.

### or

```
and [ or and ... ]
```

True if either side is true.

### and

```
not [ and not ... ]
```

True only if both sides are true.

### not

```
( not not | comparison )
```

Swaps true for false, and false for true.

### Comparisons

```
sum [ compare with sum ]
```

`is` and `=` mean the same thing. So do `isnt` and `is not`.

Example: `me.fuel < 20`

### + and -

```
product [ ( + | - ) product ... ]
```

Worked out from left to right.

### *, / and mod

```
negation [ ( * | / | mod ) negation ... ]
```

These happen before `+` and `-`. `mod` is the remainder left over after dividing.

### Negation

```
( - negation | simple value )
```

A minus sign in front of a value.

### The smallest values

```
( <number> | <text> | <colour> | true | false | none | ( value ) | sensed value | variable or call )
```

Numbers, words in quotes, colours, `true` and `false`, brackets, and everything below.

### me, arena and event

```
( me | arena | event ) . part
```

What your robot can tell about itself and about the match. `me.` always works. `arena.` is about the match. `event.` only works inside a block that has an event, and carries different things depending on which event it is.

Example: `me.heading`

### Variables and functions

```
<name> [ ( [ ( value , ... ) ] ) ]
```

A name on its own is a variable. A name with brackets after it is a function.

Example: `distance(me.x, me.y, 0, 0)`

# Events

A robot does nothing on its own. Every instruction lives inside a block that
waits for one of these, and `event.<field>` is how the block reads what
happened. A field that is not listed here does not exist on that event, and
the compiler will say so.

## on start

Runs once, at the very beginning of the match. Set things up here.

Carries nothing.

## on tick

Runs over and over, 30 times a second, for the whole match.

Carries nothing.

## on sense robot

Another robot has come into your sense cone.

- `event.bearing` — Which way to turn to face it, in degrees, measured from straight ahead. Negative is left, positive is right.
- `event.distance` — How far away it is, in steps.
- `event.heading` — The direction it is facing.
- `event.speed` — How fast it is going.
- `event.health` — How much integrity it has left, out of 100.
- `event.name` — The label it is showing.
- `event.friend` — True when it is on your side. Always false when everyone is fighting for themselves.
- `event.x` — Its position across the arena.
- `event.y` — Its position down the arena.

## on sense bullet

A bullet is flying through your sense cone. Time to dodge.

- `event.bearing` — Which way to turn to face it, in degrees, measured from straight ahead. Negative is left, positive is right.
- `event.distance` — How far away it is, in steps.
- `event.heading` — The direction it is facing.
- `event.speed` — How fast it is going.
- `event.power` — How strong the shot was, from 1 to 3.
- `event.x` — Its position across the arena.
- `event.y` — Its position down the arena.

## on sense wall

There is a wall ahead of you.

- `event.bearing` — Which way to turn to face it, in degrees, measured from straight ahead. Negative is left, positive is right.
- `event.distance` — How far away it is, in steps.

## on sense fuel

There is fuel in your sense cone. Driving over it fills your tank; moving, turning, fire and ping are what empty it.

- `event.bearing` — Which way to turn to face it, in degrees, measured from straight ahead. Negative is left, positive is right.
- `event.distance` — How far away it is, in steps.
- `event.amount` — How much fuel you get for driving over it.
- `event.x` — Its position across the arena.
- `event.y` — Its position down the arena.

## on ping robot

Your radar beam found a robot. The beam is narrow and reaches much further than the cone, so this is a robot you could not otherwise see — as long as nothing higher than you was in the way.

- `event.bearing` — Which way to turn to face it, in degrees, measured from straight ahead. Negative is left, positive is right.
- `event.distance` — How far away it is, in steps.
- `event.heading` — The direction it is facing.
- `event.speed` — How fast it is going.
- `event.health` — How much integrity it has left, out of 100.
- `event.name` — The label it is showing.
- `event.friend` — True when it is on your side. Always false when everyone is fighting for themselves.
- `event.x` — Its position across the arena.
- `event.y` — Its position down the arena.

## on ping fuel

Your radar beam found fuel far away. The beam only reports this when it found no robot, since a robot is always the more urgent news.

- `event.bearing` — Which way to turn to face it, in degrees, measured from straight ahead. Negative is left, positive is right.
- `event.distance` — How far away it is, in steps.
- `event.amount` — How much fuel you get for driving over it.
- `event.x` — Its position across the arena.
- `event.y` — Its position down the arena.

## on ping wall

Your radar beam went all the way to a wall and found nothing on the way. Nothing higher than you was in the way either, or you would have heard about that instead.

- `event.bearing` — Which way to turn to face it, in degrees, measured from straight ahead. Negative is left, positive is right.
- `event.distance` — How far away it is, in steps.

## on ping slope

Your radar beam read the ground between you and wherever it is pointing. This one arrives as well as anything else the beam found, not instead of it — the ground is everywhere, so it never has to take its turn.

- `event.bearing` — Which way to turn to face it, in degrees, measured from straight ahead. Negative is left, positive is right.
- `event.distance` — How far away it is, in steps.
- `event.rise` — How much harder the ground is out there than right here, from -100 to 100. Positive means it gets worse that way.
- `event.height` — How bad the ground is out there on its own, 0 for the easiest and 100 for the worst.

## on ping ridge

Your radar beam ran into ground higher than you are standing on, and stopped there. You cannot see past it — so either go round, climb it, or ping harder, which costs more but sees over more.

- `event.bearing` — Which way to turn to face it, in degrees, measured from straight ahead. Negative is left, positive is right.
- `event.distance` — How far away it is, in steps.
- `event.rise` — How much harder the ground is out there than right here, from -100 to 100. Positive means it gets worse that way.
- `event.height` — How bad the ground is out there on its own, 0 for the easiest and 100 for the worst.

## on hit wall

You drove into a wall. It costs you a little health.

- `event.bearing` — Which way to turn to face it, in degrees, measured from straight ahead. Negative is left, positive is right.
- `event.distance` — How far away it is, in steps.

## on hit robot

You bumped into another robot.

- `event.bearing` — Which way to turn to face it, in degrees, measured from straight ahead. Negative is left, positive is right.
- `event.distance` — How far away it is, in steps.
- `event.name` — The label it is showing.
- `event.health` — How much integrity it has left, out of 100.
- `event.friend` — True when it is on your side. Always false when everyone is fighting for themselves.
- `event.x` — Its position across the arena.
- `event.y` — Its position down the arena.

## on hit by bullet

Someone shot you. The bearing points back at where it came from.

- `event.bearing` — Which way to turn to face it, in degrees, measured from straight ahead. Negative is left, positive is right.
- `event.distance` — How far away it is, in steps.
- `event.power` — How strong the shot was, from 1 to 3.
- `event.health` — How much integrity it has left, out of 100.
- `event.friend` — True when it is on your side. Always false when everyone is fighting for themselves.
- `event.x` — Its position across the arena.
- `event.y` — Its position down the arena.

## on bullet hit

One of your shots hit someone.

- `event.bearing` — Which way to turn to face it, in degrees, measured from straight ahead. Negative is left, positive is right.
- `event.distance` — How far away it is, in steps.
- `event.name` — The label it is showing.
- `event.health` — How much integrity it has left, out of 100.
- `event.power` — How strong the shot was, from 1 to 3.
- `event.friend` — True when it is on your side. Always false when everyone is fighting for themselves.
- `event.x` — Its position across the arena.
- `event.y` — Its position down the arena.

## on bullet missed

One of your shots flew off the edge of the arena without hitting anything.

- `event.power` — How strong the shot was, from 1 to 3.
- `event.x` — Its position across the arena.
- `event.y` — Its position down the arena.

## on robot destroyed

Any robot has been destroyed — possibly by you, possibly not.

- `event.bearing` — Which way to turn to face it, in degrees, measured from straight ahead. Negative is left, positive is right.
- `event.distance` — How far away it is, in steps.
- `event.name` — The label it is showing.
- `event.friend` — True when it is on your side. Always false when everyone is fighting for themselves.
- `event.x` — Its position across the arena.
- `event.y` — Its position down the arena.

## on radio

Somebody broadcast something, and every robot alive heard it. It does not say who sent it or where they are — so if you want your own side to know it was you, put that in the message, knowing the other side is reading it too.

- `event.data` — Whatever was broadcast, exactly as it was sent.

# Functions

The whole list. There are no others, and there is no way to define one —
a reusable piece of behaviour is a `can` block, which is not a function and
returns nothing.

## `abs(number)`

Makes a number positive. Both -5 and 5 come out as 5.

- `number` — The number to take the sign off.

Example: `abs(event.bearing)`

## `min(first, second)`

The smaller of two numbers. Useful for putting a ceiling on something.

- `first` — Any number.
- `second` — Any number.

Example: `min(me.fuel, 50)`

## `max(first, second)`

The larger of two numbers. Useful for putting a floor under something.

- `first` — Any number.
- `second` — Any number.

Example: `max(event.distance - 50, 0)`

## `random()`

A random number from 0 up to 1. Never quite 1, and different every time.


Example: `random() * 360`

## `randomint(lowest, highest)`

A random whole number between two values. Both ends can come up.

- `lowest` — The smallest it may be.
- `highest` — The largest it may be.

Example: `randomint(1, 3)`

## `sin(degrees)`

The sine of an angle in degrees. Says how far a heading reaches sideways.

- `degrees` — An angle in degrees, not radians.

Example: `sin(me.heading) * 100`

## `cos(degrees)`

The cosine of an angle in degrees. Says how far a heading reaches forwards.

- `degrees` — An angle in degrees, not radians.

Example: `cos(me.heading) * 100`

## `sqrt(number)`

The square root of a number. Anything at or below 0 gives 0.

- `number` — The number to take the root of.

Example: `sqrt(400)`

## `round(number)`

Rounds to the nearest whole number. Halves go up.

- `number` — Any number.

Example: `round(me.speed)`

## `floor(number)`

Rounds down to a whole number. However close to the next it was.

- `number` — Any number.

Example: `floor(arena.time / 30)`

## `ceil(number)`

Rounds up to a whole number. However little there was to round.

- `number` — Any number.

Example: `ceil(me.health / 10)`

## `distance(x1, y1, x2, y2)`

How far apart two points are. The arena's corners are about 1090 apart.

- `x1` — How far across the first point is.
- `y1` — How far down the first point is.
- `x2` — How far across the second point is.
- `y2` — How far down the second point is.

Example: `distance(me.x, me.y, arena.width / 2, arena.height / 2)`

## `bearing(across, down)`

Turns a step across and a step down into a heading. Subtract two positions to get the way from one to the other, then `turn to` it.

- `across` — How far to the right, negative for left.
- `down` — How far down, negative for up.

Example: `bearing(arena.width / 2 - me.x, arena.height / 2 - me.y)`

## `pack(first, ...)`

Joins several things into one message, with a `|` between them. Take them back out with `field`.

- `first` — The first thing to put in.
- `rest` — As many more as you like, up to seven in all.

Example: `pack("red", me.x, me.y)`

## `field(message, slot)`

Pulls one thing back out of a packed message. The first one is 1. A slot that is not there comes out as empty text.

- `message` — A message made by `pack`.
- `slot` — Which one you want, counting from 1.

Example: `field(pack("red", me.x), 1)`

## `fieldcount(message)`

How many things a packed message has in it. An empty message has none.

- `message` — A message made by `pack`.

Example: `fieldcount(pack("red", me.x))`

## `number(text)`

Turns a piece of text into a number. Useful for doing sums with something that arrived in a message; anything that is not a number comes out as 0.

- `text` — A piece of text, usually out of `field`.

Example: `number(field(pack("red", me.x), 2))`

## `text(value)`

Turns a number into a piece of text. Useful for building a message by hand.

- `value` — Anything at all.

Example: `text(me.health)`

# How the world behaves

Every number here is read out of the simulation itself, so it is what the
game actually does rather than what somebody wrote down once.

## Time

Everything in the arena happens on a tick. Each tick, your blocks run in the order the events arrived, and whatever they decide takes effect once they have all finished.

- **Ticks per second** — 30. So `wait 15 ticks` waits half a second.
- **Thinking time** — 2000 steps a tick. Thinking is free, and everybody gets the same amount. It is not unlimited though: a loop that never finishes uses up the whole tick, and your robot gets nothing else done before the next one.

## The arena

Every match uses the same arena. The walls hurt if you drive into them.

- **Size** — 900 × 620. `arena.width` and `arena.height` tell you, so you never have to type the numbers into your script.
- **Your chassis** — 36 across. Both chassis are exactly the same size, so neither one is harder to hit.
- **Starting health** — 100. `me.health` counts down from here.

## Seeing

You have two ways of finding other robots, and they are good at different things. The cone is always watching. The radar only looks where you point it.

- **Sense cone** — 60° wide, 195 far. It works by itself and costs nothing. When something comes into it, your `on sense` block runs.
- **radar beam** — 12° wide, 585 far. Three times as far as the cone and a fifth as wide, so it finds things much further away, but only exactly where you aim it.
- **ping cooldown** — 12 ticks. `me.pingHeat` counts down to 0, and you can go again when it gets there. Everyone else can hear you do it.
- **radar slew** — 260°/s. It takes time to swing round, so point it before you need it.

## Talking

The one thing you can do that reaches the whole arena at once. Every robot still alive hears every broadcast, and none of them are told who sent it — so saying who you are, without also telling the other side, is left to you.

- **broadcast cooldown** — 6 ticks. Asking sooner is simply ignored, exactly like firing a gun that has not cooled. It costs nothing to try.
- **Message length** — 48 characters. Anything longer is cut. `pack` puts several things into one message and `field` takes them back out.
- **Delivery** — 4 a tick. Nothing is lost by arriving at a busy moment: what does not fit waits in your own inbox and comes on a later tick, in the order it was sent. You will hold 32 before the oldest starts falling off the end.
- **Cost** — 0.25 fuel to speak. Listening is free, on purpose. If hearing cost anything, shouting at somebody would be a way to drain their tank rather than a way to tell them something.

## Shooting

A stronger shot hurts more, but it travels more slowly and the gun takes longer to cool down afterwards.

- **Power** — 1 to 3. A bare `fire` on its own means 2.
- **Damage** — 5 per power. A full power shot takes 15 off 100.
- **Speed** — 460 less 40 per power. Stronger shots are slower, which makes them easier to drive out of the way of.
- **turret slew** — 200°/s. When you fire, the shot waits until the gun has turned to where you aimed it. `me.aiming` is 1 for as long as it is waiting.

## Fuel

Moving, turning, fire and ping all use fuel. Thinking and watching are free.

- **Tank** — 100. `me.fuel` tells you how much is left. Driving over fuel refills it.
- **At empty** — 10% of normal. Running out will not finish you off. You just get very slow until you find some more.

# The other vocabulary

The same game can be played as robotics or as biology, and the biological
spellings are not a different language — the lexer rewrites them into the
words above, so a script written either way compiles to byte-identical
bytecode and fights exactly the same match.

**Write the mechanical words.** This table is for reading somebody else's
script, not for choosing between them.

| mechanical | biological |
| --- | --- |
| `chassis` | `body` |
| `tank` | `ciliate` |
| `car` | `flagellate` |
| `drive` | `swim` |
| `turret` | `stinger` |
| `fire` | `sting` |
| `radar` | `eyespot` |
| `ping` | `peek` |
| `fuel` | `food` |
| `slope` | `thickness` |
| `ridge` | `murk` |
| `uphill` | `thickest` |
| `downhill` | `thinnest` |
| `bullet` | `dart` |
| `robot` | `organism` |
| `broadcast` | `release` |
| `radio` | `signal` |

# Worked examples

Every one of these is a robot that runs in the real game today. They are the
best guide to what idiomatic RoboScript looks like — read the shape of them
before writing one.

## Sitting Duck

Teaches: the smallest possible robot, and the name label

```roboscript
-- The simplest robot there is: it just sits and waits.
-- Good for target practice while you test another robot.
name "Sitting Duck"
chassis tank
color #8a8f98

on start
  set name = "please don't"
end
```

## Spinner

Teaches: on tick, turret sweeping, and turning on the spot

```roboscript
-- Spins on the spot and sweeps its turret, firing at anything it sees.
-- Only a tank can turn like this while standing still.
name "Spinner"
chassis tank
color #7fd1e0

on start
  turret.sweep 90
end

on tick
  turn body by 10
end

on sense robot
  turret.aim at event.bearing
  fire 2
  set name = "spotted!"
end
```

## Hunter

Teaches: event.bearing, chasing a target, reacting to being hit

```roboscript
-- Sweeps for a target, then chases it down and keeps shooting.
-- Shows how event.bearing points straight at whatever you just noticed.
name "Hunter"
chassis tank
color #ff8800

var seen = 0

on start
  turret.sweep 45
  drive forward 70
end

on sense robot
  set seen = seen + 1
  set name = "hunting"
  turret.aim at event.bearing
  fire 3
  -- Turn the whole robot toward the target as well as the turret.
  turn body by event.bearing
  if event.distance > 120 then
    drive forward 90
  else
    drive forward 30
  end
end

on hit by bullet
  -- Shot from behind? Turn side-on and run.
  set name = "ouch!"
  turn body by event.bearing + 90
  drive forward 100
end

on hit wall
  turn body by 150
  drive forward 70
end
```

## Scout

Teaches: the radar: aiming a third instrument, pinging, and on ping robot

```roboscript
-- Sees people long before they can see it, using the radar.
--
-- The radar is a third thing you can point, alongside your body and your
-- turret. It reaches three times as far as your sense cone but is only a
-- fifth as wide, and it looks only when you ping — so it has to be aimed on
-- purpose. The trade is worth it: by the time somebody walks into your cone,
-- your gun is already pointing at them.
name "Scout"
chassis tank
color #6ad98a

on start
  drive forward 45
  -- The turret watches the near ground, the radar searches the far ground.
  turret.sweep 30
  radar.sweep 90
end

on tick
  -- Ping whenever the beam has recovered. me.pingHeat counts down to zero.
  if me.pingHeat is 0 then
    ping
  end
end

on ping robot
  -- A contact far outside the cone. Hold the beam on it so the next ping says
  -- whether it is still there, point the gun the same way, and turn to face it.
  set name = "contact"
  radar.aim at event.bearing
  turret.aim at event.bearing
  turn body by event.bearing
end

on ping wall
  -- Nothing down that line, only the edge of the arena.
  set name = "searching"
end

on ping ridge
  -- The beam stopped at ground higher than we are, so there could be anything
  -- behind it and we would not know. Sweep on rather than keep looking at it.
  set name = "blocked"
  radar.sweep 90
end

on sense robot
  -- Close enough for the cone, and the gun is already looking the right way.
  set name = "in range"
  turret.aim at event.bearing
  fire 3
end

on hit by bullet
  -- Shot by someone the beam has not found: get off the line of fire.
  turn body by event.bearing + 90
  drive forward 80
end

on hit wall
  turn body by 150
  drive forward 50
end
```

## Toolkit

Teaches: can blocks: naming behaviour, and letting it run itself

```roboscript
-- A robot with no "on" blocks at all.
--
-- Each "can" block says which event it is for, and because nothing here
-- writes "on sense robot" out longhand, the blocks for an event *are* that
-- handler — running in the order they appear. Paste another one in and it
-- joins the end; delete one and the rest carry on.
--
-- That is the point of writing behaviour this way: each block is a whole
-- thought you can lift out and give to somebody else.
name "Toolkit"
chassis tank
color #ffd166

var target = 0

can look given start
  turret.sweep 40
  radar.sweep 90
  drive forward 55
end

can search given tick
  if me.pingHeat is 0 then
    ping
  end
end

-- A block can be handed something. With a starting value it still runs on its
-- own; without one it would be a block you could only "do" by hand.
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

can point given ping robot
  set name = "far contact"
  radar.aim at event.bearing
  turret.aim at event.bearing
  turn body by event.bearing
end

can flinch given hit by bullet
  set name = "hit"
  turn body by event.bearing + 90
  drive forward 90
end

can bounce given hit wall
  turn body by 150
  drive forward 60
end
```

## Racer

Teaches: a car's turning circle, variables, and if/else

```roboscript
-- A car: much faster than a tank, but it cannot turn on the spot,
-- so it has to drive its way around a corner.
--
-- It drives the ground like a race track. Going uphill is slow and burns fuel,
-- going downhill is quick and costs almost nothing, and going ACROSS a slope
-- costs exactly what flat ground does. So the line across a hill is the track,
-- and a drop is the straight where you open it up.
--
-- me.slope says how steep the ground is here, 0 to 100. me.uphill and
-- me.downhill say which way is up and which way is down, turned so that 0
-- means straight ahead. On a flat map slope is 0, so the racing bit never
-- runs and this is simply a fast car.
--
-- It also watches for the wall and starts the corner early. A car turns in a
-- circle it cannot tighten, so by the time a wall is close there is no room
-- left to miss it — the turn has to begin while it is still a long way off.
name "Racer"
chassis car
color #ffd166

var bumps = 0
-- Ticks left of a corner. While this is counting down the racing line is
-- ignored: finishing the turn matters more than taking the cheap route, and
-- two bits of code steering the same wheel would just fight each other.
var corner = 0

on start
  drive forward 100
  turret.sweep 60
end

on sense robot
  turret.aim at event.bearing
  fire 1
end

on sense wall
  -- 150 steps is about four car lengths, which is what it takes to come round
  -- at speed. event.bearing points at the wall, so turning by a bit less than a
  -- half turn from it sends us away without doubling back on ourselves.
  if event.distance < 150 and corner is 0 then
    set name = "corner"
    set corner = 26
    turn body by event.bearing + 140
  end
end

on hit wall
  set bumps = bumps + 1
  set name = "bumps: " + bumps
  turn body by 120
end

on tick
  -- A car that has stopped cannot steer, so always keep rolling.
  if me.speed < 20 then
    drive forward 100
  end

  if corner > 0 then
    -- Mid-corner. Leave the wheel where it was put and let the turn finish.
    -- Easing off does not tighten the circle, but it does buy room.
    set corner = corner - 1
    drive forward 70
  else
    if me.slope > 12 then
      if me.downhill < 50 and me.downhill > -50 then
        -- The drop is more or less ahead. That is free speed: take it.
        set name = "flat out"
        turn body by me.downhill
        drive forward 100
      else
        -- No drop worth having, so hold the line across the slope. A quarter
        -- turn from straight up the hill is the flattest way through.
        --
        -- Turning the short way matters for a car. If the hill is on the right
        -- we take the line to its left, and the other way round — either way
        -- the wheel only ever moves a little, which keeps the speed up.
        set name = "on the line"
        if me.uphill > 0 then
          turn body by me.uphill - 90
        else
          turn body by me.uphill + 90
        end
        drive forward 90
      end
    end
  end
end
```

## Dodger

Teaches: sensing bullets, evading, and wait

```roboscript
-- Watches for incoming fire and gets out of the way.
-- Uses a loop with break, and wait to pause between moves.
name "Dodger"
chassis car
color #b085f5

on start
  drive forward 80
  turret.sweep 70
end

on sense bullet
  set name = "incoming!"
  turn body by event.bearing + 90
  drive forward 100
end

on sense robot
  turret.aim at event.bearing
  fire 2
end

on hit wall
  turn body by 135
  wait 5 ticks
  drive forward 80
end
```

## Hungry Hippo

Teaches: fuel: sensing it near and far, and spending nothing you don't have to

```roboscript
-- Never fights. Just eats.
--
-- Moving, turning, shooting and pinging all use up fuel. Thinking is free, and
-- so is the sense cone, which notices things all on its own.
--
-- So this robot does as little as it can. It never shoots, because shooting
-- does not find food. It never sweeps its turret, for the same reason. The one
-- thing it pays for is the ping, because the cone only sees a little way ahead
-- and the beam sees three times as far.
--
-- Finding food near or far leads to the same move: turn to face it, then drive.
name "Hungry Hippo"
chassis tank
color #ff6b6b

on start
  radar.sweep 90
  drive forward 60
end

on tick
  -- Ping as often as you are allowed. me.pingHeat counts down to zero after
  -- each one, and asking early does nothing at all.
  if me.pingHeat is 0 then
    ping
  end
end

on sense fuel
  -- The cone found food, so it is close. Turn to it and drive over it.
  set name = "nom"
  turn body by event.bearing
  drive forward 100
end

on ping fuel
  -- The beam found food a long way off. Keep the beam on it so the next ping
  -- checks it is still there, then set off.
  set name = "on my way"
  radar.aim at event.bearing
  turn body by event.bearing
  drive forward 100
end

on ping wall
  -- The beam hit the wall, so there is nothing that way. Aiming the beam
  -- stopped it sweeping, so start it sweeping again.
  set name = "hungry"
  radar.sweep 90
end

on ping ridge
  -- Same idea, different reason: high ground stopped the beam short. Look
  -- somewhere else rather than staring at the hill.
  set name = "hungry"
  radar.sweep 90
end

on hit wall
  turn body by 150
  drive forward 40
end

on hit by bullet
  -- Someone is shooting at it. It does not shoot back, but driving sideways
  -- makes it harder to hit.
  set name = "rude"
  turn body by event.bearing + 90
  drive forward 100
end
```

## Goat

Teaches: me.slope and me.uphill: reading the ground and taking the high ground

```roboscript
-- Goat: gets to the high ground and holds it.
--
-- Height is worth something here. Anyone coming up at you is slowed to a
-- crawl and paying three times the fuel for it, while you sit still at the
-- top and pay almost nothing. So the whole plan is: walk up, stop, shoot down.
--
-- me.slope says how steep the ground is right here, 0 to 100. me.uphill says
-- which way is up, turned so that 0 means straight ahead.
--
-- The clever bit is how it knows it has arrived. The top of a hill is level,
-- the same as the bottom is — so when the slope runs out after a climb, that
-- is the summit. On a flat map the slope never turns up at all, and then there
-- is nothing to climb and the goat just goes hunting instead.
--
-- The other reason to be up here: your radar beam is stopped by ground higher
-- than you are standing on. Down in a dip you can barely see out. On the top
-- of the hill nothing is above you, so the beam goes all the way, in every
-- direction. That is why the goat only switches its radar on once it arrives.
name "Goat"
chassis tank
color #6ad98a

var climbed = 0

on start
  turret.sweep 90
  radar.sweep 90
  drive forward 70
end

on tick
  -- 2 is nearly level. Almost all of the ground is steeper than that, so any
  -- reading this low really is a top rather than a merely gentle patch. The
  -- first version used 8 and the goat kept stopping on the first easy stretch
  -- it found, pleased with itself, having climbed nothing.
  if me.slope > 2 then
    set climbed = 1
    set name = "climbing"
    turn body by me.uphill
    -- Ease off as the ground levels out, so it settles on the top instead of
    -- charging over it and having to come back. A slow climb is cheaper too.
    if me.slope > 20 then
      drive forward 70
    else
      drive forward 35
    end
  else
    if climbed = 1 then
      -- Level ground, after a climb. This is the top: hold it.
      set name = "high ground"
      stop
      -- And look around, which is only worth doing from up here. Not below 30
      -- in the tank though: pinging every time the beam recovers costs about
      -- three times what simply sitting still does, and a robot whose whole
      -- plan is to sit still would rather still be able to move afterwards.
      if me.pingHeat is 0 and me.fuel > 30 then
        ping
      end
    else
      -- Never found a hill, so there is no high ground to take. Go and look
      -- for somebody instead.
      set name = "no hills here"
      drive forward 70
    end
  end
end

on sense robot
  turret.aim at event.bearing
  fire 3
end

on ping robot
  -- Found from the top, far outside the cone. Shoot, but stay put: the hill is
  -- worth more than the chase.
  set name = "in range"
  turret.aim at event.bearing
  fire 3
end

on ping ridge
  -- Ground higher than us stopped the beam, so we are not as high as we
  -- thought. Keep sweeping rather than staring at it.
  radar.sweep 90
end

on hit by bullet
  -- Somebody is shooting up at us. Point the gun back down at them, but do
  -- not chase: giving up the hill is how you lose it.
  set name = "get off"
  turret.aim at event.bearing
  fire 3
end

on hit wall
  turn body by 140
  drive forward 70
end
```

## Apex

Teaches: the one to beat: fighting and foraging, budgeted against the cost table

```roboscript
-- Apex: the robot to beat. It hunts, it eats, and it is careful.
--
-- It is always doing one of four things. The variable called mode remembers
-- which one, and the label under the robot says it out loud while you watch:
--
--   0  prowling  nothing found yet, so drive about and look
--   1  stalking  the beam can see someone the cone cannot
--   2  strike    they are in the cone, so stand still and shoot
--   3  feeding   going to get some fuel
--
-- Something has to bring it back to prowling, or it would wait forever for a
-- robot that has already gone. So cold counts the ticks since it last saw
-- anything at all. Twenty quiet ticks and it starts sweeping and driving again.
--
-- When it shoots it aims where you are GOING, not where you are. A shot waits
-- until the gun has turned to face where it was aimed, and you keep moving
-- while it turns. Bullets fly at 460 - 40 x power, and the event says which way
-- you are heading and how fast, which is enough to work out where to point.
--
-- Light bullets far away, heavy ones close up. Every bullet does the same
-- damage for the fuel it costs, but heavy ones fly slower and are easier to
-- drive out of the way of.
--
-- In strike it stops. Standing still is free, and it keeps the gun pointing
-- where it was put while the shot gets ready.
--
-- It picks up fuel it happens to see, but never goes looking for it.
name "Apex"
chassis tank
color #f5f0e6

var mode = 0
var cold = 0

-- Somewhere to keep the working out while it aims.
var flight = 0
var aimx = 0
var aimy = 0

on start
  turret.sweep 25
  radar.sweep 90
  drive forward 70
end

can clock given tick
  -- One tick older since the last time anything was seen.
  set cold = cold + 1
end

can prowl given tick every 6
  -- Quiet for a while now, so go back to searching: sweep the turret and the
  -- beam again, and get moving.
  if cold > 20 then
    if mode isnt 0 then
      set mode = 0
      set name = "prowling"
    end
    drive forward 70
    turret.sweep 25
    radar.sweep 90
  end
end

can search given tick
  if me.pingHeat is 0 then
    ping
  end
end

on sense robot
  set cold = 0
  if mode isnt 2 then
    set mode = 2
    set name = "strike"
  end
  -- Near, middle and far. Each part does the same sum, and only the speed of
  -- the bullet changes, because that is what decides how long it flies for.
  if event.distance < 90 then
    set flight = event.distance / 340 + 0.05
    set aimx = event.x + cos(event.heading) * event.speed * flight
    set aimy = event.y + sin(event.heading) * event.speed * flight
    turret.aim at bearing(aimx - me.x, aimy - me.y) - me.heading
    fire 3
  else
    if event.distance < 150 then
      set flight = event.distance / 380 + 0.05
      set aimx = event.x + cos(event.heading) * event.speed * flight
      set aimy = event.y + sin(event.heading) * event.speed * flight
      turret.aim at bearing(aimx - me.x, aimy - me.y) - me.heading
      fire 2
    else
      set flight = event.distance / 420 + 0.05
      set aimx = event.x + cos(event.heading) * event.speed * flight
      set aimy = event.y + sin(event.heading) * event.speed * flight
      turret.aim at bearing(aimx - me.x, aimy - me.y) - me.heading
      fire 1
    end
  end
  -- Face them, then plant your feet while the shot gets ready.
  turn body by event.bearing
  stop
end

on ping robot
  -- Too far away for the cone. Aim ahead of them anyway, so the gun is already
  -- most of the way round when they come close enough to shoot at.
  set cold = 0
  if mode is 0 then
    set mode = 1
    set name = "stalking"
  end
  radar.aim at event.bearing
  set flight = event.distance / 400
  set aimx = event.x + cos(event.heading) * event.speed * flight
  set aimy = event.y + sin(event.heading) * event.speed * flight
  turret.aim at bearing(aimx - me.x, aimy - me.y) - me.heading
  turn body by event.bearing
end

on ping wall
  -- The beam hit the wall, so nobody is that way. Aiming the beam stopped it
  -- sweeping, so start it sweeping again.
  radar.sweep 90
end

on ping ridge
  -- High ground cut the beam short. Nothing to learn from a hillside, and the
  -- aim it was holding is worthless now, so put the beam back to sweeping.
  radar.sweep 90
end

on sense fuel
  if mode isnt 2 then
    set mode = 3
    set name = "feeding"
  end
  turn body by event.bearing
  drive forward 90
end

on ping fuel
  if mode isnt 2 then
    turn body by event.bearing
    drive forward 90
  end
  radar.aim at event.bearing
end

on hit by bullet
  -- Being shot still means somebody is out there, so this counts as seeing
  -- them, even though neither the cone nor the beam found anything.
  set cold = 0
  turn body by event.bearing + 90
  drive forward 90
end

on hit wall
  turn body by 150
  drive forward 60
end
```

## Mouse

Teaches: following a wall: the radar as a whisker, and solving a labyrinth

```roboscript
-- Mouse does not fight for the room. It works out the shape of it.
--
-- The rule is the oldest one there is for a maze: keep your left hand on the
-- wall and walk. Never take your hand off, and you will trace the whole of it
-- and come back to where you started — no map, no memory, no idea where you
-- are. A wall is enough.
--
-- Turning that into a robot needs two things the others never do.
--
-- The first is something that looks SIDEWAYS. The sense cone only faces front,
-- so the radar is used here as a whisker rather than as a way to find people —
-- aimed at -90, hard left, and pinged over and over. `on ping wall` comes back
-- with how much room is out that way, and that one number is the hand on the
-- wall.
--
-- The second is knowing how big a square of the maze is. A robot that walks
-- too far overshoots the openings; one that walks too little never reaches
-- them. So the first thing Mouse does is stand still and MEASURE: one ping
-- right, one ping left, plus its own width, is the width of the passage it is
-- standing in — and in a maze built on a grid, that is one square. Everything
-- afterwards is a fraction of that measurement rather than a number somebody
-- guessed, which is why it works in a maze you drew as well as one the game
-- made.
--
-- It stops before every decision. That looks slow, and it is, but a ping can
-- only be sent so often and a reading taken mid-corner is a reading of
-- somewhere the robot no longer is. Standing still to look is what makes the
-- readings mean anything. Given long enough it gets round the whole labyrinth;
-- a single match is not long enough, so what you watch is an honest robot
-- part-way through a patient job.
name "Mouse"
chassis tank
color #f5f0e6

-- Which way it means to face: 0, 90, 180 or -90, and nothing in between. A
-- maze is built out of right angles, so a robot that only ever holds one of
-- four headings can never end up askew in a corridor.
var dir = 0

-- 9 measuring, 0 stopped and thinking, 1 turning, 2 walking.
var mode = 9
var timer = 40

-- The last things it was told, kept because an event is a moment and a
-- decision needs the moment to still be there when it is taken.
var leftGap = 0
var rightGap = 0
var frontGap = 999

-- Whether it has ever actually had a wall under its hand.
--
-- You cannot follow a wall you have not found yet. Without this, Mouse turned
-- left on every decision in an open arena — which is what the rule literally
-- says to do when the left is clear, and which walks a robot round and round a
-- box one stride wide. Made to find a wall first, it drives straight out until
-- it meets one and then goes round the outside.
var onWall = 0

-- Where the current walk began, so how far it has come is measured on the
-- ground rather than counted in ticks. Ticks were what this used to use, and
-- they are a lie the moment anything changes the speed — a hill, a low tank,
-- a scrape along a wall — because the same count of them covers a different
-- distance every time.
var markX = 0
var markY = 0
var gone = 0

-- How long it has been asking to move and not moving.
--
-- The same two numbers again, read a different way: if the throttle is open and
-- the ground is not going past, the robot is wedged on a corner rather than
-- walking. Without this it could sit there grinding for eight seconds at a
-- time, which is most of what "Mouse gets stuck" looked like from the outside.
var wedged = 0

-- One square of the maze, and how far to walk in one go.
var square = 74
var stride = 62

on start
  set dir = 0
  set mode = 9
  set timer = 40
end

on tick
  -- Measuring the passage, once, before anything else happens. Right first,
  -- then left, giving the radar time to come round between the two.
  if mode is 9 then
    stop
    set timer = timer - 1
    if timer > 20 then
      radar.aim at 90
      if me.pingHeat is 0 and timer < 36 then
        ping
      end
    else
      radar.aim at -90
      if me.pingHeat is 0 and timer < 16 then
        ping
      end
    end
    if timer < 1 then
      -- The gap either side, plus the robot in the middle of it. Held between
      -- sane bounds: at a junction a ping can run away down a corridor and
      -- report a room far bigger than the square really is.
      set square = max(46, min(160, leftGap + rightGap + 36))
      set stride = square * 0.85
      set mode = 0
      set timer = 14
    end
  else
    radar.aim at -90
    if me.pingHeat is 0 then
      ping
    end
    set gone = sqrt((me.x - markX) * (me.x - markX) + (me.y - markY) * (me.y - markY))
  end

  -- Stopped, and deciding. Left first, always: that IS the left-hand rule, and
  -- checking the wall ahead first instead would mean never taking a left turn
  -- at the exact place where every left turn is — a gap on the left with
  -- something in front of you.
  if mode is 0 then
    stop
    set timer = timer - 1
    if timer < 1 then
      if leftGap > 45 and onWall is 1 then
        set dir = dir - 90
        set mode = 1
        set timer = 26
      else
        if frontGap > 45 then
          set markX = me.x
          set markY = me.y
          set gone = 0
          set mode = 2
        else
          set dir = dir + 90
          set mode = 1
          set timer = 26
        end
      end
      -- Kept inside a half turn either way so it stays a compass bearing
      -- rather than a running total of every corner ever taken.
      if dir > 180 then
        set dir = dir - 360
      end
      if dir < -180 then
        set dir = dir + 360
      end
    end
  end

  -- Turning, on the spot. Only a tank can do this, which is why Mouse is one:
  -- a car would need a corridor wider than the corner it is trying to take.
  if mode is 1 then
    stop
    turn body to dir
    set timer = timer - 1
    if timer < 1 then
      set markX = me.x
      set markY = me.y
      set gone = 0
      set mode = 2
    end
  end

  -- Walking, one square. It ends either when that square has been covered or
  -- when a wall turns up early, whichever comes first.
  if mode is 2 then
    drive forward 100
    if abs(me.speed) < 6 then
      set wedged = wedged + 1
    else
      set wedged = 0
    end
    if wedged > 18 then
      -- Caught on something the whisker never saw. Turn away and carry on:
      -- being somewhere slightly wrong beats being nowhere at all.
      set wedged = 0
      set dir = dir + 90
      set mode = 1
      set timer = 26
      if dir > 180 then
        set dir = dir - 360
      end
    else
      if frontGap < 25 then
        set mode = 0
        set timer = 14
      else
        if gone > stride then
          set mode = 0
          set timer = 14
        end
      end
    end
  end
end

on ping wall
  -- While measuring, the two readings are kept apart; afterwards every ping is
  -- the left whisker.
  if mode is 9 then
    if timer > 20 then
      set rightGap = event.distance
    else
      set leftGap = event.distance
    end
  else
    set leftGap = event.distance
    if event.distance < 45 then
      set onWall = 1
    end
  end
end

on sense wall
  set frontGap = event.distance
end

-- The radar is busy being a whisker, so anything Mouse shoots at is something
-- that wandered into the cone in front of it. It does not go looking, and it
-- does not stop walking to take the shot.
on sense robot
  turret.aim at event.bearing
  fire 2
end
```

## Wingman

Teaches: teams: event.friend, broadcast, and packing a message your side can read

```roboscript
name "Wingman"
chassis tank
color #4ea8ff

-- Both copies of this robot share the word. Change it and they stop
-- understanding each other, which is the quickest way to see what it is for.
var codeword = "vulpes"

-- Where our side last saw an enemy, so we can go and help.
var help_x = 0
var help_y = 0
var helping = 0

on start
  radar.sweep 60
  turret.sweep 45
end

-- Anything the beam finds gets called out, so the other one knows without
-- having to look. The message is four things packed into one: the word that
-- says it is us, what kind of news it is, and where.
on ping robot
  if event.friend is false then
    broadcast pack(codeword, "contact", event.x, event.y)
  end
end

on radio
  -- Everybody heard this, including whoever we are fighting. If it does not
  -- start with our word, it was not one of ours, and we want nothing to do
  -- with it.
  if field(event.data, 1) is codeword and field(event.data, 2) is "contact" then
    set help_x = number(field(event.data, 3))
    set help_y = number(field(event.data, 4))
    set helping = 1
  end
end

-- Head for wherever our side last called out.
on tick every 5
  if helping is 1 then
    turn to bearing(help_x - me.x, help_y - me.y)
    drive 70
  end
end

-- The cone found somebody. Check whose side they are on BEFORE shooting: with
-- friendly fire on, the alternative is shooting the only ally we have.
on sense robot
  if event.friend is false then
    turret.aim at event.bearing
    fire 2
    broadcast pack(codeword, "contact", event.x, event.y)
  end
end

on hit by bullet
  if event.friend is true then
    -- One of ours. Say so rather than shooting back.
    broadcast pack(codeword, "sorry", me.x, me.y)
  else
    turn body by event.bearing + 90
    drive 80
  end
end
```

## Boid

Teaches: flocking: using the radio as a sense organ, and averaging a flock out of messages

```roboscript
-- Boid: Reynolds' three rules of flocking, with the radio doing the seeing.
--
-- There are no "on" blocks here at all. Every "can ... given <event>" block IS
-- the handler for that event, and each one keeps its own count -- which is why
-- two of them can both say "every 6" and neither treads on the other.
name "Boid"
chassis tank
color #6ad98a

-- The word this flock answers to. me.team is on the end so that two flocks in
-- the same arena do not merge into one. It is not a secret: anybody watching a
-- match can read it off and start sending it. See the Wingman for that problem.
var flock = "starling"
var tag = ""

-- What the flock looks like, totalled up as the messages come in. There are no
-- lists in RoboScript, so the flock is never assembled anywhere -- each message
-- adds itself into these running totals, and every sixth tick they become one
-- direction and are cleared.
var mates = 0
var sum_x = 0
var sum_y = 0
var dir_x = 0
var dir_y = 0
var push_x = 0
var push_y = 0

-- The last food anybody in the flock saw, and whether it is our turn to pass
-- the news on.
var food_x = 0
var food_y = 0
var found = 0
var news = 0

can wake given start
  set tag = flock + me.team
  -- No radar sweep. In a flock the beam only ever finds a flockmate -- it
  -- reports a robot in preference to food -- so sweeping it is pure cost.
  turret.sweep 45
  drive 55
end

-- ---------------------------------------------------------------- talking --

-- One transmission every six ticks, which is as often as the radio allows.
-- Food news jumps the queue: a flock that cannot see food is worth more to
-- than one more position update.
can announce given tick every 6 after 3
  if news is 1 then
    broadcast pack(tag, "f", round(food_x), round(food_y))
    set news = 0
  else
    broadcast pack(tag, "p", round(me.x), round(me.y), round(me.heading))
  end
end

-- Everything the flock knows about itself arrives here. Nobody ever senses a
-- flockmate: the cone and the gun stay free for whoever we are fighting.
can listen given radio
  if field(event.data, 1) is tag then
    var kind = field(event.data, 2)
    var mx = number(field(event.data, 3))
    var my = number(field(event.data, 4))
    if kind is "f" then
      set food_x = mx
      set food_y = my
      set found = 1
    end
    if kind is "p" then
      do fold with mx, my, number(field(event.data, 5))
    end
  end
end

-- One flockmate, folded into the totals. The three rules of a boid are all
-- statements about your neighbours, so this is where all three are gathered.
can fold with mx, my, mh
  set mates = mates + 1

  -- Cohesion: where the flock is, on average.
  set sum_x = sum_x + mx
  set sum_y = sum_y + my

  -- Alignment: which way it is heading, on average. Summed as components and
  -- read back with bearing(), because the average of 350 and 10 is 0, not 180.
  set dir_x = dir_x + cos(mh)
  set dir_y = dir_y + sin(mh)

  -- Separation: push away from anyone close, harder the closer they are.
  var gap = distance(me.x, me.y, mx, my)
  if gap < 120 and gap > 0 then
    var strength = (120 - gap) / 120
    set push_x = push_x + (me.x - mx) / gap * strength
    set push_y = push_y + (me.y - my) / gap * strength
  end
end

-- ---------------------------------------------------------------- feeding --

can remember with fx, fy
  set food_x = fx
  set food_y = fy
  set found = 1
  -- Tell the others. One pair of eyes finding food feeds the whole flock.
  set news = 1
end

can spot given sense fuel
  do remember with event.x, event.y
end

can glimpse given ping fuel
  do remember with event.x, event.y
end

-- ---------------------------------------------------------------- steering --

-- The three rules, the food, a little wander and the walls, added up as one
-- direction. Every sixth tick, because that is how often a full set of
-- flockmates has been heard from.
can flock_together given tick every 6
  var vx = 0
  var vy = 0

  if mates > 0 then
    -- Separation dominates: a flock that touches itself grinds itself down,
    -- since a collision costs both robots their speed and a little health.
    set vx = push_x * 4.5 + dir_x / mates + (sum_x / mates - me.x) / 260
    set vy = push_y * 4.5 + dir_y / mates + (sum_y / mates - me.y) / 260
  end

  -- Head for food, harder the emptier the tank.
  var want = (100 - me.fuel) / 100
  if found is 1 and want > 0 then
    var away = distance(me.x, me.y, food_x, food_y)
    if away < 25 then
      set found = 0
    else
      set vx = vx + (food_x - me.x) / away * want * 4
      set vy = vy + (food_y - me.y) / away * want * 4
    end
  end

  -- A little noise, so the flock roams instead of settling into one spot and
  -- starving in it.
  set vx = vx + (random() - 0.5) * 0.4
  set vy = vy + (random() - 0.5) * 0.4

  -- Turn back before the wall rather than after it. Written out here rather
  -- than tucked into a block of its own: it works on vx and vy, and a block
  -- that quietly reached into whoever called it would be the kind of thing
  -- that reads fine until somebody moves it.
  if me.x < 130 then
    set vx = vx + 2
  end
  if me.x > arena.width - 130 then
    set vx = vx - 2
  end
  if me.y < 130 then
    set vy = vy + 2
  end
  if me.y > arena.height - 130 then
    set vy = vy - 2
  end

  if abs(vx) + abs(vy) > 0.05 then
    do fly with bearing(vx, vy)
  end

  set name = "flock " + mates
  do forget
end

-- Turn towards a heading, slowing down for a sharp turn and for an empty tank.
-- A hungry flock that keeps sprinting arrives everywhere too slowly to steer
-- and spends the rest of the match bumping into itself.
can fly with goal
  var err = goal - me.heading
  if err > 180 then
    set err = err - 360
  end
  if err < -180 then
    set err = err + 360
  end
  turn to goal
  var cruise = 25 + me.fuel * 0.3
  if abs(err) > 60 then
    drive cruise * 0.5
  else
    drive cruise
  end
end

can forget
  set mates = 0
  set sum_x = 0
  set sum_y = 0
  set dir_x = 0
  set dir_y = 0
  set push_x = 0
  set push_y = 0
end

-- ---------------------------------------------------------------- fighting --

can shoot given sense robot
  if event.friend is false then
    turret.aim at event.bearing
    fire 2
  end
end
```

## Hunter (biology words)

Teaches: the same robot written in the biological vocabulary

```roboscript
-- The very same robot as Hunter, in biology words.
name "Hunter"
body ciliate
color #ff8800

var seen = 0

on start
  stinger.sweep 45
  swim forward 70
end

on sense organism
  set seen = seen + 1
  set name = "hunting"
  stinger.aim at event.bearing
  sting 3
  -- Turn the whole organism toward the target as well as the stinger.
  turn body by event.bearing
  if event.distance > 120 then
    swim forward 90
  else
    swim forward 30
  end
end

on stung
  -- Stung from behind? Turn side-on and flee.
  set name = "ouch!"
  turn body by event.bearing + 90
  swim forward 100
end

on hit wall
  turn body by 150
  swim forward 70
end
```