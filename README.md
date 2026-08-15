# RoboBattle

Write a robot in a small, safe language. Watch it fight. Everyone watching sees
the identical match.

A spiritual successor to **Robot Battle** (1993, custom scripting language) and
**Robocode** (2000, event-driven Java), with one addition: two locomotion types
that actually handle differently, and two vocabularies — robotics or biology —
over one identical simulation.

```
npm install
npm run dev      # the workbench at http://localhost:5173
npm test         # 136 tests, including the determinism suite
npm run build    # typecheck + production bundle
```

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

## Layout

```
src/lang/    lexer -> parser -> compiler -> bytecode VM, plus the synonym table,
             the per-event documentation, and the completion engine
src/sim/     deterministic math and rng, chassis models, world, tick loop, hashing
src/render/  PixiJS arena, frame interpolation, the two art packs
src/ui/      React workbench: roster, CodeMirror editor, arena, readout, standings
src/bots/    sample robots, which double as the test corpus
```

## Status

Milestone 1 (local sandbox) is complete. Next:

- **M2 — WebRTC.** `src/net/`: PeerJS broker for signaling only, room codes,
  manifest sharing, hash exchange to flag divergence, tournament brackets.
- **M3 — polish.** More liveries, richer effects, replay sharing, a guided
  tutorial in both vocabularies.
- **M4 — environment.** Fuel/food to sense and collect; procedural terrain from
  seeded noise — hills for the mechanical theme, viscosity and cellular
  obstacles for the biological one. `world.terrain` is already the seam for it.
