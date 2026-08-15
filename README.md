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

| | |
|---|---|
| **Learn** | A dozen short lessons — sensing, turning, shooting, deciding, remembering, thinking time — each with a live playground you can edit and run in place, in whichever vocabulary you chose. |
| **Workshop** | Write, version, and test a robot. Save named versions, pin them as sparring partners, run trials against the sample bots, and read the telemetry. |
| **Arena** | Everyone's robot in one arena at once, over WebRTC or between tabs on one machine. |
| **Trade** | Put robots on a shared table, read each other's scripts, and swap copies — with permission, never without. |
| **Tournament** | One against one until a single robot is left. The bracket and seeding are built and tested; the screen that draws them is not finished yet. |

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

- Fixed 30Hz timestep. Real time only decides *how many* ticks to run; the
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
`hit wall`, `hit robot`, `hit by bullet`, `bullet hit`, `bullet missed`,
`robot destroyed`. Every event carries `event.bearing` (relative to your chassis,
so it drops straight into `turret.aim at` or `turn body by`) and
`event.distance`, plus extras like `event.power` and `event.name`.

**Statements** — `var` / `set`, `if … else … end`, `loop … end`,
`for i = 1 to N … end`, `repeat N times … end`, `break`, `break if …`,
`continue`, `wait N ticks`.

**Actions** — none of them block; they set a goal the robot moves toward:
`drive forward|back 0-100`, `stop`, `turn body to|by …`,
`turret.turn to|by …`, `turret.aim at …`, `turret.sweep …`, `fire 1-3`.

**Readable state** — `me.x/y/heading/speed/health/turret/gunHeat`,
`arena.width/height/time/robots`.

## The editor teaches the language

You cannot guess `event.bearing`, so the editor tells you. It is CodeMirror 6
with a RoboScript language definition built from the *same tables the compiler
uses*, which is the point: the dropdown can never offer a word the compiler
would then reject.

- Typing `on ` lists all eleven events with a plain-English description of each
  and the fields it carries. `on sense ` narrows to `robot`, `bullet`, `wall`.
- `event.` offers exactly what the enclosing handler really provides — inside
  `on sense wall` that is `bearing` and `distance`, and nothing else, because a
  wall genuinely has no health to report.
- `turret.` offers `aim`, `turn`, `sweep`; `drive ` offers `forward`/`back`;
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

| | tracks / cilia (`tank`) | wheels / flagellum (`car`) |
|---|---|---|
| steering | skid steer | Ackermann |
| rotate on the spot | yes | **no** — needs forward speed |
| turning circle | none | `wheelbase / tan(maxSteer)` ≈ 42px |
| top speed | 95 px/s | 165 px/s |

The car's turning circle is emergent from the bicycle model
(`ω = v·tan(steer)/wheelbase`) rather than a special-cased rule, which is why it
simply cannot rotate at a standstill.

## Themes

Mechanical and biological are **wording and art, never balance**. Synonyms are
rewritten to canonical words in the lexer, so a biological script compiles to
byte-identical bytecode and fights identically — `tests/lang/vocab.test.ts`
asserts exactly that. Both vocabularies parse in either arena, and can be mixed.

| mechanical | biological |
|---|---|
| `chassis tank` / `car` | `body ciliate` / `flagellate` |
| `drive forward` | `swim forward` |
| `turret` / `fire` | `stinger` / `sting` |
| `on sense robot` | `on sense organism` |
| `on hit by bullet` | `on stung` |
| `me.health` | `me.vitality` |

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
