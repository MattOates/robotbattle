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