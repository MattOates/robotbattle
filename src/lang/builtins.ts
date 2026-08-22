/**
 * The functions a script can call, and what they are for.
 *
 * One table, holding the name, what each argument is called, what each argument
 * means, what the function does and a line you can copy. Everything else is
 * derived: how many arguments a function takes is `params.length`, so the
 * compiler's arity check and the documentation cannot disagree about it, and
 * the popup and the reference page read the same descriptions.
 *
 * Before this there were two tables. `BUILTIN_SIGNATURES` held name and arity,
 * and a separate list in `complete.ts` held one sentence each — so a function's
 * arguments were `a`, `b`, `c`, `d` wherever they were shown, which is exactly
 * no help for `distance(a, b, c, d)`.
 *
 * ## The order of these keys is bytecode
 *
 * The compiler emits `CALL` with `BUILTIN_NAMES.indexOf(name)` and the VM reads
 * the name back with `BUILTIN_NAMES[arg]`. Moving an entry therefore changes
 * what every already-compiled program does, and inserting one anywhere but the
 * end shifts every function after it. Add to the bottom.
 * `tests/lang/builtins.test.ts` pins the order for that reason.
 */

export interface BuiltinParam {
  /** What the argument is called, shown in the signature. */
  name: string;
  /** What it means. One line — it appears in the completion popup. */
  detail: string;
}

export interface Builtin {
  /** What the function does, in a sentence. */
  summary: string;
  params: readonly BuiltinParam[];
  /**
   * A whole expression using it, which a test compiles. Documentation that
   * does not run is worse than none.
   */
  example: string;
}

const NUMBER = "Any number.";

export const BUILTINS: Readonly<Record<string, Builtin>> = {
  abs: {
    summary: "Makes a number positive. Both -5 and 5 come out as 5.",
    params: [{ name: "number", detail: "The number to take the sign off." }],
    example: "abs(event.bearing)",
  },
  min: {
    summary: "The smaller of two numbers. Useful for putting a ceiling on something.",
    params: [
      { name: "first", detail: NUMBER },
      { name: "second", detail: NUMBER },
    ],
    example: "min(me.fuel, 50)",
  },
  max: {
    summary: "The larger of two numbers. Useful for putting a floor under something.",
    params: [
      { name: "first", detail: NUMBER },
      { name: "second", detail: NUMBER },
    ],
    example: "max(event.distance - 50, 0)",
  },
  random: {
    summary: "A random number from 0 up to 1. Never quite 1, and different every time.",
    params: [],
    example: "random() * 360",
  },
  randomint: {
    summary: "A random whole number between two values. Both ends can come up.",
    params: [
      { name: "lowest", detail: "The smallest it may be." },
      { name: "highest", detail: "The largest it may be." },
    ],
    example: "randomint(1, 3)",
  },
  sin: {
    summary: "The sine of an angle in degrees. Says how far a heading reaches sideways.",
    params: [{ name: "degrees", detail: "An angle in degrees, not radians." }],
    example: "sin(me.heading) * 100",
  },
  cos: {
    summary: "The cosine of an angle in degrees. Says how far a heading reaches forwards.",
    params: [{ name: "degrees", detail: "An angle in degrees, not radians." }],
    example: "cos(me.heading) * 100",
  },
  sqrt: {
    summary: "The square root of a number. Anything at or below 0 gives 0.",
    params: [{ name: "number", detail: "The number to take the root of." }],
    example: "sqrt(400)",
  },
  round: {
    summary: "Rounds to the nearest whole number. Halves go up.",
    params: [{ name: "number", detail: NUMBER }],
    example: "round(me.speed)",
  },
  floor: {
    summary: "Rounds down to a whole number. However close to the next it was.",
    params: [{ name: "number", detail: NUMBER }],
    example: "floor(arena.time / 30)",
  },
  ceil: {
    summary: "Rounds up to a whole number. However little there was to round.",
    params: [{ name: "number", detail: NUMBER }],
    example: "ceil(me.health / 10)",
  },
  distance: {
    summary: "How far apart two points are. The arena's corners are about 1090 apart.",
    params: [
      { name: "x1", detail: "How far across the first point is." },
      { name: "y1", detail: "How far down the first point is." },
      { name: "x2", detail: "How far across the second point is." },
      { name: "y2", detail: "How far down the second point is." },
    ],
    example: "distance(me.x, me.y, arena.width / 2, arena.height / 2)",
  },
  bearing: {
    summary:
      "Turns a step across and a step down into a heading. Subtract two positions to get the way from one to the other, then `turn to` it.",
    params: [
      { name: "across", detail: "How far to the right, negative for left." },
      { name: "down", detail: "How far down, negative for up." },
    ],
    example: "bearing(arena.width / 2 - me.x, arena.height / 2 - me.y)",
  },
};

/**
 * In the order the keys are written, which is the order the bytecode refers to
 * them by. See the note at the top of this file before changing it.
 */
export const BUILTIN_NAMES: readonly string[] = Object.keys(BUILTINS);

/** How many arguments each takes, counted rather than written down twice. */
export const BUILTIN_SIGNATURES: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(BUILTINS).map(([name, fn]) => [name, fn.params.length]),
);

/** `distance(x1, y1, x2, y2)` — the shape, for a heading or a popup. */
export function signatureOf(name: string): string {
  const fn = BUILTINS[name];
  if (!fn) return `${name}()`;
  return `${name}(${fn.params.map((p) => p.name).join(", ")})`;
}
