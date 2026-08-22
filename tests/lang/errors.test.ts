/**
 * Every error the language can show a player, frozen word for word.
 *
 * This is a characterisation test, not a specification. It says what the parser
 * and compiler do *today*, including the places where what they do is not what
 * anybody would choose — those are marked. The point is to be able to change how
 * the grammar is expressed without changing what a child reads when they get it
 * wrong.
 *
 * That matters more here than it would in most languages. `parser.ts` opens by
 * saying it is hand-written recursive descent "so that error messages can be
 * genuinely helpful", and it delivers: `turn` without a direction does not say
 * "parse error", it says which two words are missing and what each one means.
 * Any future grammar — a table, a PEG, anything — has to reproduce all of this
 * exactly, and until it does there is no way to tell that it has not.
 *
 * Before this file there were 55 `RoboScriptError` sites and 28 assertions
 * touching messages or hints in all of `tests/lang/`, several of them substring
 * checks on the same few errors. Roughly half of these could have degraded to
 * "something went wrong" without a single test going red.
 */

import { describe, expect, it } from "vitest";
import { checkScript } from "../../src/sim/world.js";

/** The two lines every script needs before it can be wrong about anything else. */
const H = 'name "x"\nchassis tank\n';

interface Case {
  /** What the player did. */
  what: string;
  source: string;
  message: string;
  /** Null where the error genuinely offers no hint. */
  hint: string | null;
}

const PARSER: Case[] = [
  {
    what: "leaves a word out of a `for`",
    source: `${H}on tick\n  for i = 1 5\n    stop\n  end\nend\n`,
    message: "I expected `to` here, but found `5`",
    hint: "try `for i = 1 to 10`",
  },
  {
    what: "puts two instructions on one line",
    source: `${H}on tick\n  stop stop\nend\n`,
    message: "I found `stop` after that instruction, and I don't know what it means",
    hint: "each instruction goes on its own line",
  },
  {
    what: "forgets the quotes round a name",
    source: "name Sparky\n",
    message: "a robot's name has to be text in quotes",
    hint: 'try `name "Sparky"`',
  },
  {
    what: "invents a chassis",
    source: 'name "x"\nchassis wobbly\n',
    message: "`wobbly` isn't a body I know about",
    hint: "pick `tank` or `car` (or `ciliate` / `flagellate` if you're playing biology)",
  },
  {
    what: "names a colour instead of mixing one",
    source: `${H}color blue\n`,
    message: "a colour has to look like #ff8800",
    hint: "the six characters after # are how much red, green and blue to mix",
  },
  {
    what: "writes the same handler twice",
    source: `${H}on tick\n  stop\nend\non tick\n  stop\nend\n`,
    message: "you already have an `on tick` block",
    hint: "put all the instructions for one event in a single block",
  },
  {
    what: "writes the same `can` block twice",
    source: `${H}can f\n  stop\nend\ncan f\n  stop\nend\n`,
    message: "you already have a `can f` block",
    hint: "two blocks with the same name would be impossible to tell apart in a `do`",
  },
  {
    what: "writes an instruction outside any block",
    source: `${H}wibble\n`,
    message: "I don't know what `wibble` means out here",
    hint: "outside a block you can set `name`, `chassis`, `color`, declare a `var`, start an `on ...` block, or teach yourself something new with `can ...`",
  },
  {
    what: "gives a block two things with the same name",
    source: `${H}can f with a, a\n  stop\nend\n`,
    message: "`f` is already given something called `a`",
    hint: "each thing a block is given needs its own name",
  },
  {
    what: "puts an optional parameter before a required one",
    source: `${H}can f with a=1, b\n  stop\nend\n`,
    message: "`b` has to come before the ones with a starting value",
    hint: "put the ones you always have to supply first, so leaving the rest out is never ambiguous",
  },
  {
    what: "says `every` twice",
    source: `${H}on tick every 2 every 3\n  stop\nend\n`,
    message: "`on tick` already says `every 2`",
    hint: "one `every`, one `after`, one `before` — saying it twice would only contradict itself",
  },
  {
    what: "counts with something that is not a number",
    source: `${H}on tick every x\n  stop\nend\n`,
    message: "`every` needs a plain number after it",
    hint: "`every 30` counts how many times this has happened — it cannot be worked out as you go",
  },
  {
    what: "counts from zero",
    source: `${H}on tick every 0\n  stop\nend\n`,
    message: "`every 0` needs a whole number of times, 1 or more",
    hint: "counting starts at 1, on the first time the block is reached",
  },
  {
    what: "combines `at` with another count",
    source: `${H}on tick at 3 every 2\n  stop\nend\n`,
    message: "`at 3` and `every 2` cannot both be true",
    hint: "`at` pins the count exactly, so it goes on its own — use `every`, `after` and `before` together instead",
  },
  {
    what: "leaves no room between `after` and `before`",
    source: `${H}on tick after 5 before 5\n  stop\nend\n`,
    message: "`after 5 before 5` leaves no times in between",
    hint: "`after` and `before` are both exclusive, so there has to be room between them",
  },
  {
    what: "asks for an `every` that never arrives",
    source: `${H}on tick every 10 before 5\n  stop\nend\n`,
    message: "`every 10` never comes round before 5",
    hint: "the first run would be number 10",
  },
  {
    what: "invents an event",
    source: `${H}on wobble\n  stop\nend\n`,
    message: "`wobble` isn't an event I can tell you about",
    hint: "events are: start, tick, sense robot, sense bullet, sense wall, sense fuel, ping robot, ping fuel, ping wall, ping slope, ping ridge, hit wall, hit robot, hit by bullet, bullet hit, bullet missed, robot destroyed",
  },
  {
    what: "forgets the `end`",
    source: `${H}on tick\n  stop\n`,
    message: "the `on tick` block never finishes",
    hint: "every block needs a matching `end` on its own line",
  },
  {
    what: "declares a variable with no value",
    source: `${H}var x\n`,
    message: "`var x` needs a starting value",
    hint: "try `var x = 0`",
  },
  {
    what: "names a variable with a number",
    source: `${H}var 5 = 1\n`,
    message: "`5` can't be used as a name",
    hint: "names start with a letter, like `target` or `spin_speed`",
  },
  {
    what: "names a variable after an instruction",
    source: `${H}var fire = 1\n`,
    message: "`fire` is a word RoboScript already uses, so it can't be a variable name",
    hint: "try something like `my_fire`",
  },
  {
    what: "nests a `can` block inside a handler",
    source: `${H}on tick\n  can f\n    stop\n  end\nend\n`,
    message: "`can` blocks go outside everything else",
    hint: "move it out to the left margin, then use `do` in here to run it",
  },
  {
    what: "forgets the `=` in a `set`",
    source: `${H}var x = 0\non tick\n  set x 5\nend\n`,
    message: "`set x` needs an `=` and a value",
    hint: "try `set x = 0`",
  },
  {
    what: "forgets the `=` in a `for`",
    source: `${H}on tick\n  for i 1 to 10\n    stop\n  end\nend\n`,
    message: "a `for` needs a starting number",
    hint: "try `for i = 1 to 10`",
  },
  {
    what: "breaks outside a loop",
    source: `${H}on tick\n  break\nend\n`,
    message: "`break` only works inside a loop",
    hint: "put it inside a `loop`, `for` or `repeat` block",
  },
  {
    what: "turns without saying how",
    source: `${H}on tick\n  turn 90\nend\n`,
    message: "`turn` needs `to` (an exact heading) or `by` (an amount)",
    hint: "try `turn body to 90` or `turn body by 45`",
  },
  {
    what: "uses the radar without a `.`",
    source: `${H}on tick\n  radar 90\nend\n`,
    message: "`radar` needs a `.` and then what to do with it",
    hint: "try `radar.aim at 0`, `radar.turn to 90` or `radar.sweep 45`",
  },
  {
    what: "turns the radar without saying how",
    source: `${H}on tick\n  radar.turn 90\nend\n`,
    message: "`radar.turn` needs `to` or `by`",
    hint: "try `radar.turn to 90` or `radar.turn by 10`",
  },
  {
    what: "asks the radar to do something it cannot",
    source: `${H}on tick\n  radar.wobble 1\nend\n`,
    message: "I don't know how to `wobble` a radar",
    hint: "the radar can `turn`, `aim`, `sweep` or `ping`",
  },
  {
    what: "uses the turret without a `.`",
    source: `${H}on tick\n  turret 90\nend\n`,
    message: "`turret` needs a `.` and then what to do with it",
    hint: "try `turret.aim at 0`, `turret.turn to 90` or `turret.sweep 45`",
  },
  {
    what: "turns the turret without saying how",
    source: `${H}on tick\n  turret.turn 90\nend\n`,
    message: "`turret.turn` needs `to` or `by`",
    hint: "try `turret.turn to 90` or `turret.turn by 10`",
  },
  {
    what: "asks the turret to do something it cannot",
    source: `${H}on tick\n  turret.wobble 1\nend\n`,
    message: "I don't know how to `wobble` a turret",
    hint: "the turret can `turn`, `aim` or `sweep`",
  },
  {
    what: "invents an instruction",
    source: `${H}on tick\n  wibble 1\nend\n`,
    message: "I don't know how to `wibble`",
    hint: "instructions start with words like `drive`, `turn`, `fire`, `set`, `if` or `wait`",
  },
  {
    what: "leaves a bracket open",
    source: `${H}var x = 0\non tick\n  set x = (1\nend\n`,
    message: "this bracket never closes",
    hint: "every `(` needs a matching `)`",
  },
  {
    what: "uses an object without saying which part",
    source: `${H}var x = 0\non tick\n  set x = me\nend\n`,
    message: "`me` on its own isn't a value",
    hint: "try `me.heading`",
  },
  {
    what: "stops after the dot",
    source: `${H}var x = 0\non tick\n  set x = me.\nend\n`,
    message: "`me.` needs the name of something to look at",
    hint: null,
  },
  {
    what: "leaves a function call open",
    source: `${H}var x = 0\non tick\n  set x = min(1\nend\n`,
    message: "`min(` never closes",
    hint: "every `(` needs a matching `)`",
  },
  {
    what: "puts a stray word inside a value",
    source: `${H}on tick\n  for i = to 10\n    stop\n  end\nend\n`,
    message: "I didn't expect `to` in the middle of a value",
    hint: null,
  },
  {
    what: "stops before writing the value",
    source: `${H}var x = 0\non tick\n  set x =\nend\n`,
    message: "I expected a value here, but found `the end of the line`",
    hint: "values are numbers, text in quotes, variables, or things like `me.heading`",
  },
];

const COMPILER: Case[] = [
  {
    what: "reads `event` where nothing has happened",
    source: `${H}var x = event.bearing\n`,
    message: "`event` only means something when something has happened",
    hint: "put this in an `on ...` block, or say which event the block is for: `can dodge given hit by bullet`",
  },
  {
    what: "reads `event` in a handler that carries none",
    source: `${H}var x = 0\non tick\n  set x = event.bearing\nend\n`,
    message: "`on tick` doesn't come with any event information",
    hint: "Runs over and over, 30 times a second, for the whole match.",
  },
  {
    what: "reads a field this event does not carry",
    source: `${H}var x = 0\non sense wall\n  set x = event.name\nend\n`,
    message: "`on sense wall` doesn't tell you `name`",
    hint: "inside this block, event has: bearing, distance",
  },
  {
    what: "sets a variable that was never made",
    source: `${H}on tick\n  set nope = 1\nend\n`,
    message: "I don't know a variable called `nope`",
    hint: "make it first with `var nope = 0` — you haven't made any variables yet",
  },
  {
    what: "does a block that does not exist",
    source: `${H}on tick\n  do wobble\nend\n`,
    message: "I don't know how to `do wobble`",
    hint: "teach yourself first with a `can ... end` block outside your handlers",
  },
  {
    what: "writes a block that does itself",
    source: `${H}can f\n  do f\nend\non tick\n  do f\nend\n`,
    message: "`f` ends up doing itself",
    hint: "f → f — a block is copied out where it is used, so this would never finish",
  },
  {
    what: "nests blocks too deeply",
    source:
      H +
      Array.from({ length: 12 }, (_, i) => `can f${i}\n  do f${i + 1}\nend\n`).join("") +
      "can f12\n  stop\nend\non tick\n  do f0\nend\n",
    message: "`f4` is nested too deeply inside other blocks",
    hint: "blocks may go 4 deep; past that nobody can follow what runs",
  },
  {
    what: "uses a `given` block from the wrong event",
    source: `${H}can f given sense robot\n  fire 2\nend\non tick\n  do f\nend\n`,
    message: "`f` needs a `sense robot` to work with",
    hint: "you are inside `on tick`, which is a different thing happening — use it in an `on sense robot` block, or in a `can ... given sense robot`",
  },
  {
    what: "does a block without what it needs",
    source: `${H}can f with a\n  stop\nend\non tick\n  do f\nend\n`,
    message: "`do f` needs 1 thing, and you gave it 0",
    hint: "it takes: a",
  },
  {
    what: "tests something that is not a question",
    source: `${H}on tick\n  if 5\n    stop\n  end\nend\n`,
    message: "`if` needs a question that answers yes or no, and `5` is a number is not one",
    hint: "a condition compares two things: `is`, `isnt`, `>`, `<`, `>=`, `<=`, joined with `and`, `or`, `not`",
  },
  {
    what: "reads a property that does not exist",
    source: `${H}var x = 0\non tick\n  set x = me.wobble\nend\n`,
    message: "`me` doesn't have anything called `wobble`",
    hint: "me has: x, y, heading, speed, health, turret, gunHeat, ammo, score, radar, pingHeat, fuel, aiming, slope, uphill, downhill",
  },
  {
    what: "calls a function that does not exist",
    source: `${H}var x = 0\non tick\n  set x = wobble(1)\nend\n`,
    message: "I don't know a function called `wobble`",
    hint: "you can use: abs, min, max, random, randomint, sin, cos, sqrt, round, floor, ceil, distance, bearing",
  },
  {
    what: "gives a function the wrong number of values",
    source: `${H}var x = 0\non tick\n  set x = sqrt(1, 2)\nend\n`,
    message: "`sqrt` needs 1 value, but got 2",
    hint: null,
  },
];

describe.each([
  ["the parser", PARSER],
  ["the compiler", COMPILER],
])("%s tells you what you did", (_name, cases) => {
  it.each(cases.map((c) => [c.what, c] as const))("when somebody %s", (_what, c) => {
    const result = checkScript(c.source);
    if (result.ok) throw new Error("expected this to be rejected, and it was accepted");
    expect(result.error?.message).toBe(c.message);
    expect(result.error?.hint ?? null).toBe(c.hint);
  });
});

/**
 * Errors that exist in the source and cannot currently be reached.
 *
 * Not dead code exactly — they are the belt to somebody else's braces — but
 * nothing a player can type gets to them, so they are recorded here rather than
 * left looking untested. If a refactor makes one reachable, the case above it
 * changes and this list should shrink.
 *
 * `compiler.ts` line 868 ("I don't know a function called ...") is the
 * interesting one: `parser.ts` keeps its own `BUILTINS` set and rejects an
 * unknown call first, with a much worse message. The good error is written and
 * unreachable because of a duplicated list. See the test below.
 */
describe("errors that cannot be reached", () => {
  /**
   * Not dead code exactly — the belt to somebody else's braces — but nothing a
   * player can type gets to them, so they are recorded here rather than left
   * looking untested. If a refactor makes one reachable, its message becomes a
   * case above and this list shrinks.
   *
   * It has already shrunk once: "I don't know a function called ..." lived here
   * until the parser stopped keeping its own copy of the builtin list.
   */
  it("catches `break` outside a loop while parsing, never while compiling", () => {
    const result = checkScript(`${H}can f\n  break\nend\n`);
    expect(result.error?.message).toBe("`break` only works inside a loop");
    expect(result.error?.hint).toBe("put it inside a `loop`, `for` or `repeat` block");
  });
});
