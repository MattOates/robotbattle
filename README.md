<div align="center">

# BotBattle / BioBattle

**Write a robot in a small, safe language. Watch it fight. Everyone watching sees the identical match.**

[![CI](https://github.com/MattOates/robotbattle/actions/workflows/ci.yml/badge.svg)](https://github.com/MattOates/robotbattle/actions/workflows/ci.yml)
[![Pages](https://github.com/MattOates/robotbattle/actions/workflows/pages.yml/badge.svg)](https://github.com/MattOates/robotbattle/actions/workflows/pages.yml)
[![Play](https://img.shields.io/badge/play-in%20your%20browser-7fd1e0)](https://mattoates.github.io/robotbattle/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](tsconfig.json)
[![No backend](https://img.shields.io/badge/backend-none-8a8f98)](#publishing)
[![License](https://img.shields.io/badge/license-ISC-blue)](package.json)

### ▶ [Play it now](https://mattoates.github.io/robotbattle/)

</div>

A spiritual successor to **Robot Battle** (1993, custom scripting language) and
**Robocode** (2000, event-driven Java), with one addition: two locomotion types
that actually handle differently, and two vocabularies — robotics or biology —
over one identical simulation.

It runs entirely in the browser. There is no account, no server, and nothing to
install: your robots live in your own browser storage, and multiplayer is peer
to peer.

```
make install
make dev         # the game at http://localhost:5173
make test        # the whole suite, including the determinism golden match
make build       # typecheck + tests + production bundle into dist/
make help        # everything else
```

## What's in it

|                |                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Learn**      | A baker's dozen of short lessons — sensing, turning, shooting, deciding, remembering, thinking time — each with a live playground you can edit and run in place, in whichever vocabulary you chose.                       |
| **Workshop**   | Write, version, and test a robot. Save named versions, pin them as sparring partners, run trials against the sample bots, and read the telemetry.                                                                         |
| **Arena**      | Everyone's robot in one arena at once, over WebRTC or between tabs on one machine.                                                                                                                                        |
| **Trade**      | Put robots on a shared table, read each other's scripts, and swap copies — with permission, never without.                                                                                                                |
| **Tournament** | A random draw from everything the room puts forward, with a qualifying round robin deciding who is seeded through a round that cannot pair off. Every tie is settled over eleven matches, and any of them can be watched. |

Two people can also open one robot together: a Workshop session shares the
editor live (Yjs CRDT, cursors and all), plus the chat, the trial and the battle
history for the robot being worked on — while your library, your storage and
everything else stay yours.

## Why it is built this way

During a match there is **no human input**. A match is therefore fully
determined by its manifest — the scripts, the seed, and the arena — so peers
never need per-tick netcode. The host shares one manifest, every peer simulates
the whole match locally, and they exchange a periodic state hash purely to
notice if they ever disagree. The same manifest is also a replay file.

That only works if the simulation is bit-identical everywhere, which drives
three rules enforced by tests in `tests/determinism/`:

- Fixed 30Hz timestep. Real time only decides _how many_ ticks to run; the
  renderer interpolates to 60fps so it still looks smooth.
- No `Math.sin`/`cos`/`tan`/`atan2`/`pow`/`random`, no `Date.now`. Those are
  implementation-defined or unseeded and silently desync peers. `src/sim/math.ts`
  provides reproducible replacements; `src/sim/rng.ts` is a seeded PCG32.
- Stable ordering everywhere. Robots are visited by id; no Set or Map iteration.

A golden match is pinned in `tests/determinism/golden.test.ts` — if the
simulation ever changes, that test says so.

## RoboScript

Scripts are never JavaScript. They compile to bytecode for a small stack VM
(`src/lang/`) whose entire world is a fixed table of properties and actions, so
running a script from a stranger is safe by construction. Each robot gets an
instruction budget per tick; a handler that overruns is suspended and resumed
next tick, so an infinite `loop` makes a robot sluggish rather than freezing the
game.

```
name "Hunter"          -- also a variable: `set name = ...` changes the label on screen
chassis tank           -- tank (tracks) or car (wheels)
color #ff8800

var seen = 0

on start
  turret.sweep 45
  drive forward 70
end

on sense robot
  set seen = seen + 1
  set name = "hunting"
  turret.aim at event.bearing     -- bearings are relative to your chassis
  fire 3
  turn body by event.bearing
  if event.distance > 120 then
    drive forward 90
  else
    drive forward 30
  end
end

on hit by bullet
  turn body by event.bearing + 90  -- event.bearing points back at the shooter
  drive forward 100
end
```

**Events** — `start`, `tick`, `sense robot`, `sense bullet`, `sense wall`,
`sense fuel`, `ping robot`, `ping fuel`, `ping wall`, `hit wall`, `hit robot`,
`hit by bullet`, `bullet hit`, `bullet missed`, `robot destroyed`. Every event carries
`event.bearing` (relative to your chassis, so it drops straight into
`turret.aim at` or `turn body by`) and `event.distance`, plus extras like
`event.power` and `event.name`.

**Statements** — `var` / `set`, `if … else … end`, `loop … end`,
`for i = 1 to N … end`, `repeat N times … end`, `break`, `break if …`,
`continue`, `wait N ticks`, `do NAME [with …]`.

**Conditions** — `is`, `isnt`, `<`, `>`, `<=`, `>=`, joined with `and`, `or`,
`not`. Arithmetic is `+ - * /` and `mod`. An `if` (or `break if`) must be given
one of those comparisons, not a bare value: `if arena.time mod 60` is refused,
because a remainder is a number and every number but 0 would count as true —
turning "every 60 ticks" into "every tick except every 60th". Write
`if arena.time mod 60 is 0`. There is no truthiness to learn and no such bug to
find by staring at it.

**Blocks** — `can NAME [with p, q=2] [given EVENT] … end` names a piece of
behaviour at the top level. See below.

**How often** — `every N`, `after N`, `before N`, `at N`, on any `on` or `can`
header: `can scan given tick every 30` runs once a second rather than thirty
times. Each block keeps its own tally of how many times it has been reached, so
two blocks on one event can run at two different cadences without a shared
counter between them. They combine freely and in any order:
`after 2 every 3` on `hit wall` means two bumps, then every third one from
there — the fifth, eighth, eleventh — because `after` starts the cadence
counting rather than merely gating a clock that was already running. `at N`
pins the count exactly and goes alone. It compiles to a hidden counter and a jump —
the same thing you would have written by hand, minus the chance of getting the
`mod` test backwards.

**Actions** — none of them block; they set a goal the robot moves toward:
`drive forward|back 0-100`, `stop`, `turn body to|by …`,
`turret.turn to|by …`, `turret.aim at …`, `turret.sweep …`, `fire 1-3`,
`radar.turn to|by …`, `radar.aim at …`, `radar.sweep …`, `ping`.

**Readable state** — `me.x/y/heading/speed/health/fuel/turret/gunHeat/radar/pingHeat`,
`arena.width/height/time/robots`.

## Behaviour you can name, and pass around

`can` names a block of instructions; `do` runs it. The compiler copies the
block out wherever it is used, so there is no call stack anywhere in the
machine — using a block costs a robot exactly what writing it out longhand
would have cost, and a `wait` inside one suspends like any other line. Blocks
may take arguments (`with power=2`, defaults optional), and a parameter is the
block's own for as long as it runs, so it never disturbs a variable of the same
name.

```
can flinch given hit by bullet
  turn body by event.bearing + 90
  drive forward 90
end
```

`given` is the interesting half. It says which event the block works on, which
means the block may read `event.*`, that the editor can offer exactly those
fields inside it, and that the compiler refuses the block anywhere it would not
make sense. A block therefore carries its own contract — which is what makes it
worth sending to somebody, rather than sending them a whole robot.

And when a script has **no `on` block for that event**, the blocks for it _are_
the handler, running in the order they were written. Paste a friend's `flinch`
into your robot and it takes effect; paste two and both run, in order. Write
`on hit by bullet` out yourself and you take control back — the blocks become a
library you `do` in whatever order you choose. The editor prints which of those
is happening at the end of every `can` line, since nothing in the source says
so. `src/bots/index.ts` ships a sample robot, Toolkit, with no `on` blocks at
all.

## Two ways of seeing

A robot has three independent headings — where its body points, where its gun
points, and where its **radar** points — and two quite different senses hanging
off the last two.

|       | sense cone            | radar beam                          |
| ----- | --------------------- | ----------------------------------- |
| reach | 195px                 | 585px — three times as far          |
| width | 30° either side       | 6° either side — a fifth as wide    |
| when  | by itself, every tick | only when the script sends a `ping` |
| aimed | locked to the chassis | wherever you last pointed it        |

The beam is not a better cone, it is a different instrument: it finds a robot
right across the arena and walks straight past one twenty degrees off the line
that the cone would have caught easily. Which one saw something is answered by
which handler runs — `on sense robot` means _near me_, `on ping robot` means
_far away, and I went looking_ — so a script never has to ask.

In the biological vocabulary the radar is an **eyespot** and a ping is a
**peek**, which is not a stretch: an eyespot is a patch of light-sensitive
pigment behind a shading cup, and the cup is exactly what trades a wide vague
view for a narrow precise one.

## Fuel, and what it is not

Two budgets, deliberately unrelated.

The first is the **ops budget**: 2000 instructions per robot per tick, refilled
in full, identical for everybody. It is a scheduling quantum, not a resource —
it exists so a runaway `loop` cannot hang the sim, and so the point at which a
handler gets suspended is the same on every peer. Nothing in the game can raise
or lower it. Thinking is free, and it is free in equal measure for the beginner
and for the robot with a thousand lines of tactics.

The second is **fuel** — `food` in the biological vocabulary — and it is a real
resource. Only *actuated* work spends it: driving, turning, slewing the turret
and radar, firing, pinging. The passive sense cone is free, because it is not
actuated and every robot has it always on, so charging for it would only be a
tax everybody pays equally. Charges land on what actually happened rather than
on the instruction that asked, so a robot pinned against a wall at full throttle
is not billed for movement it did not achieve.

Running dry is a **brownout, never a death**. Capability falls toward a tenth
of normal and stops there: an empty robot is slow and vague, still driving,
still shooting, still able to crawl to the next cell — but it has effectively
lost the fight until it finds one.

The fall is not a straight line. The penalty grows with the square of how empty
the tank is, so it is barely there until the tank is genuinely low and then
bites hard:

| tank    | 100% | 75% | 50% | 25% | 10% | empty |
| ------- | ---- | --- | --- | --- | --- | ----- |
| you get | 100% | 94% | 78% | 49% | 27% | 10%   |

Running *low* is meant to be an emergency; running *down* is not. Under a
straight line, half a tank cost nearly half the robot, which punished the
ordinary state of not having topped up recently. That also makes the economy
self-limiting, since a slower robot spends less to move — an empty tank
approaches the floor asymptotically instead of falling off a cliff. It is why a
robot written before fuel existed still finishes its matches.

Cells spawn on a fixed cadence from the seeded RNG, so they are part of the
manifest like everything else and a replay puts them in the same places. How
plentiful they are is the host's call in the Arena lobby and in the tournament
setup, and it travels inside the manifest — a guest is never told separately,
and so can never simulate the same match under different terms.

**The whole mechanic switches off**, and off means off in both directions:
nothing spawns, and nothing is spent either. Stopping only the spawns would be
the cruellest setting in the game, since robots would still drain and brown out
with nothing to refuel from. A match with fuel off is the match the game had
before fuel existed — `tests/determinism/golden.test.ts` pins that against the
pre-fuel golden numbers, so any drain or spawn leaking into the disabled path
fails the build. A robot written to forage still runs there; it simply never
hears `on sense fuel`.

Lesson playgrounds have it off unless the lesson asks for it with `fuel=true`,
the same way they opt into sense cones. A lesson teaches one idea, and cells
appearing during the lesson on sense cones are an unexplained second one.

```
on sense fuel
  turn body by event.bearing        -- it is close; go and get it
  drive forward 80
end

on ping fuel
  turn body by event.bearing        -- it is far away, and I went looking
end

on tick every 30
  if me.fuel < 30 then
    radar.sweep 90                  -- start hunting for a refill
  end
end
```

## The editor teaches the language

You cannot guess `event.bearing`, so the editor tells you. It is CodeMirror 6
with a RoboScript language definition built from the _same tables the compiler
uses_, which is the point: the dropdown can never offer a word the compiler
would then reject.

- Typing `on ` lists every event with a plain-English description of each and
  the fields it carries. `on sense ` narrows to `robot`, `bullet`, `wall`.
- `event.` offers exactly what the enclosing handler really provides — inside
  `on sense wall` that is `bearing` and `distance`, and nothing else, because a
  wall genuinely has no health to report.
- `turret.` offers `aim`, `turn`, `sweep`, and `radar.` the same plus `ping`;
  `drive ` offers `forward`/`back`;
  `chassis ` offers the two locomotion kinds; `color ` offers a palette.
- Errors are underlined where they happen, with the compiler's own message.
- All of it follows the theme: in biological mode the same menu reads
  `sense organism`, `sense dart`, `stung`, and the help text says organisms and
  darts rather than robots and bullets.

The language-facing half lives in `src/lang/complete.ts` and knows nothing about
CodeMirror, so it is unit-tested directly — including a test that every offered
suggestion actually compiles, and one that asserts the `event.*` documentation
matches what `step.ts` really emits during live matches.

## The two chassis

Identical hitbox (one circle radius, shared), identical turret, identical sense
cone. They differ in exactly one thing — how steering becomes rotation:

|                    | tracks / cilia (`tank`) | wheels / flagellum (`car`)         |
| ------------------ | ----------------------- | ---------------------------------- |
| steering           | skid steer              | Ackermann                          |
| rotate on the spot | yes                     | **no** — needs forward speed       |
| turning circle     | none                    | `wheelbase / tan(maxSteer)` ≈ 42px |
| top speed          | 95 px/s                 | 165 px/s                           |

The car's turning circle is emergent from the bicycle model
(`ω = v·tan(steer)/wheelbase`) rather than a special-cased rule, which is why it
simply cannot rotate at a standstill.

## Themes

Mechanical and biological are **wording and art, never balance**. Synonyms are
rewritten to canonical words in the lexer, so a biological script compiles to
byte-identical bytecode and fights identically — `tests/lang/vocab.test.ts`
asserts exactly that. Both vocabularies parse in either arena, and can be mixed.

| mechanical             | biological                    |
| ---------------------- | ----------------------------- |
| `chassis tank` / `car` | `body ciliate` / `flagellate` |
| `drive forward`        | `swim forward`                |
| `turret` / `fire`      | `stinger` / `sting`           |
| `on sense robot`       | `on sense organism`           |
| `on hit by bullet`     | `on stung`                    |
| `me.health`            | `me.vitality`                 |
| `on sense fuel`        | `on sense food`               |

## Multiplayer

Rooms are a star: guests hold one link to the host, and the host relays. That is
enough because every mode is host-authoritative, and it avoids the n-squared
mesh a peer-to-peer graph would need. Two transports implement one interface:

- **Over the internet** — WebRTC via the public PeerJS broker, which is used for
  introductions only. No game data touches it.
- **This computer** — `BroadcastChannel` between tabs. Not a toy: it is how the
  networked modes work with no internet at all, and how two people at one
  machine can play.

A third implementation, an in-process loopback transport, is why the whole
networked half is testable in CI — lobbies, matches, brackets, pair sessions and
trades all run headless with simulated peers and no broker. Messages are chunked
at 15 kB in the shared layer rather than in the WebRTC transport, so the loopback
tests exercise the same splitting and reassembly the network will.

**Trading is consent-based in both directions.** Nothing about your library is
published until you drag a robot onto the shared table, and a table entry is a
name, a colour and a chassis — never a script. Reading someone's script opens it
in a locked editor that cannot be selected or copied out, so the only route into
your library is asking and being given, or being offered something and accepting
it. What lands is a new robot whose first saved version is stamped with who
handed it over and when, and that stays in the version history however far the
script is edited afterwards.

## Layout

```
src/lang/      lexer -> parser -> compiler -> bytecode VM, plus the synonym table,
               the per-event documentation, and the completion engine
src/sim/       deterministic math and rng, chassis models, world, tick loop, hashing
src/render/    PixiJS arena, frame interpolation, the two art packs
src/net/       transports (WebRTC, BroadcastChannel, loopback), rooms, protocol,
               tournament brackets, the Yjs provider for shared editing
src/store/     the robot library, versions, battle records, chat — over localStorage
src/workshop/  trials and the test bench, run off the main thread in a worker
src/learn/     lesson content in Markdown, and the live playground that runs it
src/ui/        React screens: menu, learn, workshop, arena, trade, settings
src/bots/      sample robots, which double as the test corpus
```

## Publishing

Two independent routes, neither of which needs a server to run the game — it is
entirely client-side, and routing is hash-based, so there is nothing to rewrite.

**GitHub Pages.** Pushing to `main` triggers `.github/workflows/pages.yml`,
which typechecks, tests, builds, and publishes `docs/index.html` as the landing
page with the game at `/play/`. The built site is never committed: it is
regenerated from source every time, so what is published cannot drift from what
is in the repo. `make pages` assembles the same thing locally to look at.
Everything else — branches and pull requests — is covered by
`.github/workflows/ci.yml`, which runs the same typecheck, tests and build.

**Your own server.** `make deploy` builds and rsyncs `dist/` over SSH. Settings
are personal and stay out of the repo — copy `.envrc.example` to `.envrc` (it is
gitignored) and `direnv allow`, or pass them inline:

```
make deploy RB_DEPLOY_HOST=myserver RB_DEPLOY_DIR=/var/www/robobattle
```

The deploy uses `rsync --delete`, because chunk filenames are content-hashed and
without it every deploy would leave its predecessors behind forever.

Assets are referenced relatively (`base: "./"` in `vite.config.ts`), so the same
build works at any URL prefix — a Pages project subpath, a subdirectory on your
own host, or opened straight off disk — with no configuration.

## Status

The local sandbox, the language, the lessons and the networked modes are in
place. Still to come:

- **The tournament screen.** The bracket, seeding and match progression are
  built and tested; only the screen that draws them is missing.
- **Polish.** More liveries, richer effects, replay sharing.
- **Environment.** Fuel/food to sense and collect; procedural terrain from
  seeded noise — hills for the mechanical theme, viscosity and cellular
  obstacles for the biological one. `world.terrain` is already the seam for it.
