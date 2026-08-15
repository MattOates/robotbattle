/**
 * The RoboScript virtual machine.
 *
 * One instance per robot. It owns the robot's variables and its currently
 * running event handler, and it can only reach the outside world through the
 * `VmHost` interface — there is no path from a script to the page.
 *
 * Fuel: each robot gets a fixed instruction budget per simulation tick. When it
 * runs out mid-handler we simply stop; the program counter and stack are
 * ordinary data, so the handler picks up exactly where it left off next tick.
 * A runaway `loop` therefore makes a robot slow to react, never freezes the
 * match. That property is what makes it safe to run a stranger's script.
 */

import { Op, type Chunk, type PropRef, type Value } from "./bytecode.js";
import { BUILTIN_NAMES } from "./bytecode.js";
import { atan2Deg, cosDeg, hypot, sinDeg } from "../sim/math.js";

/** Payload delivered with an event, read via `event.<prop>`. */
export type EventPayload = Readonly<Record<string, Value>>;

export interface PendingEvent {
  name: string;
  payload: EventPayload;
}

/** Everything the VM is allowed to touch outside itself. */
export interface VmHost {
  /** Read `me.*` and `arena.*`. `event.*` is handled by the VM itself. */
  readProp(ref: PropRef): Value;
  /** Perform an action. Arguments arrive in source order. */
  doAction(kind: string, args: Value[]): void;
  /** Update the robot's on-screen label. */
  setName(name: string): void;
  /** Deterministic random in [0, 1). */
  random(): number;
  /** Deterministic integer in [min, max]. */
  randomInt(min: number, max: number): number;
}

interface Fiber {
  pc: number;
  stack: Value[];
  payload: EventPayload | null;
  /** Ticks still to wait before resuming, from a `wait` statement. */
  waiting: number;
  /** Name of the event being handled, for diagnostics. */
  event: string;
}

export interface RuntimeError {
  message: string;
  line: number;
  event: string;
}

/** How many queued events a robot may accumulate before the oldest is dropped. */
const MAX_QUEUE = 8;

export class Vm {
  private chunk: Chunk;
  private host: VmHost;
  private globals: Value[];
  private fiber: Fiber | null = null;
  private queue: PendingEvent[] = [];
  /** True once the global initialiser has run. */
  private initialised = false;

  /** Set when a handler aborts; surfaced in the UI, never fatal to the match. */
  lastError: RuntimeError | null = null;
  /** True while a handler is mid-flight, so `on tick` isn't queued twice. */
  get busy(): boolean {
    return this.fiber !== null;
  }

  constructor(chunk: Chunk, host: VmHost) {
    this.chunk = chunk;
    this.host = host;
    this.globals = new Array<Value>(chunk.globals.length).fill(null);
  }

  /** Does the script care about this event at all? Lets the sim skip work. */
  handles(event: string): boolean {
    return this.chunk.handlers[event] !== undefined;
  }

  /** True if this exact event name is already waiting to run. */
  hasQueued(event: string): boolean {
    if (this.fiber?.event === event) return true;
    return this.queue.some((e) => e.name === event);
  }

  enqueue(name: string, payload: EventPayload): void {
    if (!this.handles(name)) return;
    if (this.queue.length >= MAX_QUEUE) {
      // Drop the oldest: under overload, recent information is the useful kind.
      this.queue.shift();
    }
    this.queue.push({ name, payload });
  }

  /**
   * Run for up to `fuel` instructions. Called once per simulation tick.
   */
  run(fuel: number): void {
    let budget = fuel;

    if (!this.initialised) {
      this.initialised = true;
      this.fiber = {
        pc: this.chunk.initEntry,
        stack: [],
        payload: null,
        waiting: 0,
        event: "(setup)",
      };
    }

    while (budget > 0) {
      if (this.fiber === null) {
        const next = this.queue.shift();
        if (!next) return;
        const entry = this.chunk.handlers[next.name];
        if (entry === undefined) continue;
        this.fiber = {
          pc: entry,
          stack: [],
          payload: next.payload,
          waiting: 0,
          event: next.name,
        };
      }

      if (this.fiber.waiting > 0) {
        // `wait` blocks this handler for whole ticks; nothing else runs for
        // this robot meanwhile, which keeps the mental model simple.
        this.fiber.waiting--;
        return;
      }

      budget = this.step(this.fiber, budget);
    }
  }

  /** Execute instructions until the fiber ends, waits, or runs out of fuel. */
  private step(fiber: Fiber, budgetIn: number): number {
    let budget = budgetIn;
    const { ops, args, consts, lines } = this.chunk;
    const stack = fiber.stack;

    while (budget > 0) {
      budget--;
      const pc = fiber.pc;
      if (pc < 0 || pc >= ops.length) {
        this.fiber = null;
        return budget;
      }
      const op = ops[pc]!;
      const arg = args[pc]!;
      fiber.pc = pc + 1;

      try {
        switch (op) {
          case Op.PUSH:
            stack.push(consts[arg]!);
            break;
          case Op.POP:
            stack.pop();
            break;
          case Op.DUP:
            stack.push(stack[stack.length - 1] ?? null);
            break;
          case Op.LOAD:
            stack.push(this.globals[arg] ?? null);
            break;
          case Op.STORE:
            this.globals[arg] = stack.pop() ?? null;
            break;
          case Op.LOAD_PROP: {
            const ref = this.chunk.props[arg]!;
            stack.push(
              ref.obj === "event"
                ? (fiber.payload?.[ref.prop] ?? null)
                : this.host.readProp(ref),
            );
            break;
          }
          case Op.SET_NAME:
            this.host.setName(toText(stack.pop() ?? null));
            break;
          case Op.ACTION: {
            const arity = this.chunk.actionArity[arg]!;
            const actionArgs = arity === 0 ? [] : stack.splice(stack.length - arity, arity);
            this.host.doAction(this.chunk.actions[arg]!, actionArgs);
            break;
          }
          case Op.CALL:
            this.callBuiltin(BUILTIN_NAMES[arg]!, stack);
            break;

          case Op.ADD: {
            const b = stack.pop() ?? null;
            const a = stack.pop() ?? null;
            // `+` doubles as text join so `set name = "hp " + me.health` works.
            stack.push(
              typeof a === "string" || typeof b === "string"
                ? toText(a) + toText(b)
                : toNum(a) + toNum(b),
            );
            break;
          }
          case Op.SUB: {
            const b = toNum(stack.pop() ?? null);
            stack.push(toNum(stack.pop() ?? null) - b);
            break;
          }
          case Op.MUL: {
            const b = toNum(stack.pop() ?? null);
            stack.push(toNum(stack.pop() ?? null) * b);
            break;
          }
          case Op.DIV: {
            const b = toNum(stack.pop() ?? null);
            const a = toNum(stack.pop() ?? null);
            // Dividing by zero yields 0 rather than Infinity: a stray Infinity
            // would poison positions and desync every peer downstream.
            stack.push(b === 0 ? 0 : a / b);
            break;
          }
          case Op.MOD: {
            const b = toNum(stack.pop() ?? null);
            const a = toNum(stack.pop() ?? null);
            stack.push(b === 0 ? 0 : a % b);
            break;
          }
          case Op.NEG:
            stack.push(-toNum(stack.pop() ?? null));
            break;
          case Op.NOT:
            stack.push(!truthy(stack.pop() ?? null));
            break;

          case Op.IS: {
            const b = stack.pop() ?? null;
            stack.push(equals(stack.pop() ?? null, b));
            break;
          }
          case Op.ISNT: {
            const b = stack.pop() ?? null;
            stack.push(!equals(stack.pop() ?? null, b));
            break;
          }
          case Op.LT: {
            const b = toNum(stack.pop() ?? null);
            stack.push(toNum(stack.pop() ?? null) < b);
            break;
          }
          case Op.GT: {
            const b = toNum(stack.pop() ?? null);
            stack.push(toNum(stack.pop() ?? null) > b);
            break;
          }
          case Op.LE: {
            const b = toNum(stack.pop() ?? null);
            stack.push(toNum(stack.pop() ?? null) <= b);
            break;
          }
          case Op.GE: {
            const b = toNum(stack.pop() ?? null);
            stack.push(toNum(stack.pop() ?? null) >= b);
            break;
          }

          case Op.JUMP:
            fiber.pc = arg;
            break;
          case Op.JUMP_IF_FALSE:
            if (!truthy(stack.pop() ?? null)) fiber.pc = arg;
            break;
          case Op.JUMP_IF_TRUE:
            if (truthy(stack.pop() ?? null)) fiber.pc = arg;
            break;

          case Op.WAIT: {
            const n = Math.floor(toNum(stack.pop() ?? null));
            if (n > 0) {
              fiber.waiting = n;
              return budget;
            }
            break;
          }

          case Op.HALT:
            this.fiber = null;
            return budget;

          default:
            this.fiber = null;
            return budget;
        }
      } catch (err) {
        // A script must never take the match down with it.
        this.lastError = {
          message: err instanceof Error ? err.message : String(err),
          line: lines[pc] ?? 0,
          event: fiber.event,
        };
        this.fiber = null;
        return budget;
      }

      // A stack that keeps growing means a compiler bug; fail this handler
      // loudly rather than eating memory.
      if (stack.length > 256) {
        this.lastError = {
          message: "this instruction got too complicated to work out",
          line: lines[pc] ?? 0,
          event: fiber.event,
        };
        this.fiber = null;
        return budget;
      }
    }

    return budget;
  }

  private callBuiltin(name: string, stack: Value[]): void {
    switch (name) {
      case "abs":
        stack.push(Math.abs(toNum(stack.pop() ?? null)));
        return;
      case "min": {
        const b = toNum(stack.pop() ?? null);
        const a = toNum(stack.pop() ?? null);
        stack.push(a < b ? a : b);
        return;
      }
      case "max": {
        const b = toNum(stack.pop() ?? null);
        const a = toNum(stack.pop() ?? null);
        stack.push(a > b ? a : b);
        return;
      }
      case "random":
        stack.push(this.host.random());
        return;
      case "randomint": {
        const b = Math.floor(toNum(stack.pop() ?? null));
        const a = Math.floor(toNum(stack.pop() ?? null));
        stack.push(this.host.randomInt(Math.min(a, b), Math.max(a, b)));
        return;
      }
      case "sin":
        stack.push(sinDeg(toNum(stack.pop() ?? null)));
        return;
      case "cos":
        stack.push(cosDeg(toNum(stack.pop() ?? null)));
        return;
      case "sqrt": {
        const v = toNum(stack.pop() ?? null);
        stack.push(v <= 0 ? 0 : Math.sqrt(v));
        return;
      }
      case "round":
        stack.push(Math.round(toNum(stack.pop() ?? null)));
        return;
      case "floor":
        stack.push(Math.floor(toNum(stack.pop() ?? null)));
        return;
      case "ceil":
        stack.push(Math.ceil(toNum(stack.pop() ?? null)));
        return;
      case "distance": {
        const y2 = toNum(stack.pop() ?? null);
        const x2 = toNum(stack.pop() ?? null);
        const y1 = toNum(stack.pop() ?? null);
        const x1 = toNum(stack.pop() ?? null);
        stack.push(hypot(x2 - x1, y2 - y1));
        return;
      }
      case "bearing": {
        const y = toNum(stack.pop() ?? null);
        const x = toNum(stack.pop() ?? null);
        stack.push(atan2Deg(y, x));
        return;
      }
      default:
        stack.push(null);
    }
  }
}

// ---- value semantics ----------------------------------------------------
// Deliberately forgiving: a beginner language should coerce quietly rather
// than stop the robot over a type mismatch.

export function truthy(v: Value): boolean {
  if (v === null || v === false) return false;
  if (v === 0) return false;
  if (v === "") return false;
  return true;
}

export function toNum(v: Value): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function toText(v: Value): string {
  if (v === null) return "none";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    // Trim float noise so labels read cleanly on screen.
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }
  return v;
}

function equals(a: Value, b: Value): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === typeof b) return a === b;
  return toNum(a) === toNum(b);
}
