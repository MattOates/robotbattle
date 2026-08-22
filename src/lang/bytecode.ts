/**
 * RoboScript bytecode.
 *
 * A tiny stack machine. Two things drive this design:
 *
 *  1. **Safety.** Scripts arrive from strangers over WebRTC, so they are never
 *     JavaScript and never see a JS scope. The VM's entire world is this
 *     instruction set plus a fixed table of properties and actions.
 *  2. **Suspendability.** Each robot gets a fixed quantum of instructions per
 *     tick and is preempted when it runs out. Because
 *     execution state is just a program counter plus a value stack, pausing a
 *     half-finished handler and resuming it next tick is trivial — an infinite
 *     `loop` makes a robot sluggish rather than hanging the game.
 *
 * Code is stored as parallel numeric arrays rather than objects so that
 * "identical bytecode" is a literal, cheap comparison — which is how the theme
 * tests prove a biological script compiles to the same program as its
 * mechanical translation.
 */

export const enum Op {
  PUSH, // arg: const index
  POP,
  DUP,
  LOAD, // arg: global slot
  STORE, // arg: global slot
  LOAD_PROP, // arg: property table index
  SET_NAME, // pops a value, becomes the robot's label
  CALL, // arg: builtin index (arity is fixed per builtin)
  ACTION, // arg: action table index
  ADD,
  SUB,
  MUL,
  DIV,
  MOD,
  NEG,
  NOT,
  IS,
  ISNT,
  LT,
  GT,
  LE,
  GE,
  JUMP, // arg: absolute address
  JUMP_IF_FALSE, // arg: absolute address; pops
  JUMP_IF_TRUE, // arg: absolute address; pops
  WAIT, // pops tick count, suspends the handler
  HALT,
}

export type Value = number | string | boolean | null;

/** A property readable from a script, e.g. `me.heading`. */
export interface PropRef {
  obj: "me" | "arena" | "event";
  prop: string;
}

// The functions a script can call live in `builtins.ts`, with their arguments
// and what each one is for. Re-exported here because this is where everything
// that compiles or runs bytecode already looks for them.
export { BUILTIN_NAMES, BUILTIN_SIGNATURES } from "./builtins.js";

/** Compiled program, ready to run. */
export interface Chunk {
  ops: number[];
  args: number[];
  /** Source line per instruction, for runtime error reporting. Not part of program identity. */
  lines: number[];
  consts: Value[];
  props: PropRef[];
  /** Action kind strings, indexed by ACTION's arg. */
  actions: string[];
  /** Argument count for each entry in `actions`. */
  actionArity: number[];
  /** Global variable names, indexed by slot. */
  globals: string[];
  /** Entry address per event name. */
  handlers: Record<string, number>;
  /** Entry address for the global-initialiser prelude. */
  initEntry: number;
}

/**
 * Program identity: everything that affects behaviour, and nothing that
 * doesn't (source lines are excluded). Two scripts with the same identity are
 * the same robot, whatever words they were written in.
 */
export function programIdentity(chunk: Chunk): string {
  return JSON.stringify({
    ops: chunk.ops,
    args: chunk.args,
    consts: chunk.consts,
    props: chunk.props,
    actions: chunk.actions,
    actionArity: chunk.actionArity,
    handlers: chunk.handlers,
    initEntry: chunk.initEntry,
  });
}
