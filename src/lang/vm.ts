/**
 * The RoboScript virtual machine.
 *
 * One instance per robot. It owns the robot's variables and its currently
 * running event handler, and it can only reach the outside world through the
 * `VmHost` interface — there is no path from a script to the page.
 *
 * Scheduling: each robot is given a fixed quantum of instructions per
 * simulation tick and is preempted when it runs out. Suspension is free because
 * the program counter and stack are ordinary data, so a handler picks up
 * exactly where it left off next tick. A runaway `loop` therefore makes a robot
 * slow to react, never freezes the match. That property is what makes it safe
 * to run a stranger's script.
 */

import { DebugMark, Op, type Chunk, type PropRef, type Value } from "./bytecode.js";
import { BUILTIN_NAMES } from "./bytecode.js";
import { PACK_SEPARATOR } from "./builtins.js";
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

export type VmTraceEntry =
  | { kind: "queued"; tick: number; event: string }
  | { kind: "dropped"; tick: number; event: string }
  | { kind: "line"; tick: number; line: number; event: string }
  | {
      kind: "handler";
      tick: number;
      line: number;
      event: string;
      eventValues: EventPayload;
      variables: Readonly<Record<string, Value>>;
    }
  | {
      kind: "condition";
      tick: number;
      line: number;
      event: string;
      result: boolean;
      eventValues: EventPayload;
      variables: Readonly<Record<string, Value>>;
    }
  | {
      kind: "action";
      tick: number;
      line: number;
      event: string;
      action: string;
      args: Value[];
      eventValues: EventPayload;
      variables: Readonly<Record<string, Value>>;
    }
  | { kind: "wait"; tick: number; line: number; event: string; ticks: number }
  | { kind: "suspend"; tick: number; line: number; event: string }
  | { kind: "error"; tick: number; line: number; event: string; message: string };

export type VmTraceSink = (entry: VmTraceEntry) => void;

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
  private traceSink: VmTraceSink | null = null;
  private traceTick = 0;
  private lastTraceLine = 0;

  /** Set when a handler aborts; surfaced in the UI, never fatal to the match. */
  lastError: RuntimeError | null = null;

  // ---- telemetry -------------------------------------------------------
  // Counters only. Nothing in the VM or the simulation reads these back, so
  // they cannot affect a match — which is why they are safe to keep out of the
  // world hash.

  /** Total instructions executed, a rough measure of how hard this robot thinks. */
  instructionsExecuted = 0;
  /** Handlers preempted mid-tick, having used their whole quantum. High means slow reactions. */
  suspensions = 0;
  /** Events discarded because the queue was already full. */
  eventsDropped = 0;
  /** Runtime errors that aborted a handler. */
  errors = 0;
  /** True while a handler is mid-flight, so `on tick` isn't queued twice. */
  get busy(): boolean {
    return this.fiber !== null;
  }

  constructor(chunk: Chunk, host: VmHost) {
    this.chunk = chunk;
    this.host = host;
    this.globals = new Array<Value>(chunk.globals.length).fill(null);
  }

  /** Attach or remove an observer. It can see execution but cannot affect it. */
  setTraceSink(sink: VmTraceSink | null): void {
    this.traceSink = sink;
  }

  private variables(): Readonly<Record<string, Value>> {
    const out: Record<string, Value> = {};
    this.chunk.globals.forEach((name, index) => {
      if (!name.startsWith("__")) out[name] = this.globals[index] ?? null;
    });
    return out;
  }

  private context(fiber: Fiber) {
    return {
      eventValues: fiber.payload ?? {},
      variables: this.variables(),
    };
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

  /**
   * Hand this robot an event to deal with.
   *
   * `lowPriority` is for the radio, and only for the radio. Everything else in
   * the arena is something that happened TO this robot — it was shot, it hit a
   * wall, something came into its cone — and under overload the newest of those
   * is the useful kind, so a full queue drops its oldest to make room. A
   * broadcast is different in kind: it is somebody else talking, there may be
   * one from every robot alive in the same tick, and it must never be able to
   * push `hit by bullet` out of the queue. A chatty enemy would otherwise be
   * able to deafen you to being shot, which is a weapon nobody designed.
   *
   * So a low-priority event takes a free slot if there is one and is *refused*
   * if there is not. Refused, not dropped: the caller is told so by the return
   * value and keeps the message, which is how a broadcast comes back on a later
   * tick instead of vanishing. See `deliverRadio`.
   *
   * @returns whether the event was taken.
   */
  enqueue(name: string, payload: EventPayload, lowPriority = false): boolean {
    if (!this.handles(name)) return false;
    if (this.queue.length >= MAX_QUEUE) {
      if (lowPriority) return false;
      // Drop the oldest: under overload, recent information is the useful kind.
      const dropped = this.queue.shift();
      this.eventsDropped++;
      if (dropped) this.traceSink?.({ kind: "dropped", tick: this.traceTick, event: dropped.name });
    }
    this.queue.push({ name, payload });
    this.traceSink?.({ kind: "queued", tick: this.traceTick, event: name });
    return true;
  }

  /**
   * Run for up to `ops` instructions. Called once per simulation tick.
   */
  run(ops: number, tick = 0): void {
    this.traceTick = tick;
    let budget = ops;

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
        const line = this.chunk.handlerLines[next.name] ?? this.chunk.lines[entry] ?? 0;
        this.lastTraceLine = 0;
        this.traceSink?.({
          kind: "handler",
          tick,
          line,
          event: next.name,
          ...this.context(this.fiber),
        });
      }

      if (this.fiber.waiting > 0) {
        // `wait` blocks this handler for whole ticks; nothing else runs for
        // this robot meanwhile, which keeps the mental model simple.
        this.fiber.waiting--;
        return;
      }

      budget = this.step(this.fiber, budget);
    }

    // Falling out of the loop means the quantum ran out. If a handler is still
    // mid-flight it has been suspended and will resume next tick — which is
    // exactly the thing a player wants to know about when their robot feels
    // sluggish.
    if (this.fiber !== null && this.fiber.waiting === 0) {
      this.suspensions++;
      this.traceSink?.({
        kind: "suspend",
        tick,
        line: this.chunk.lines[this.fiber.pc] ?? 0,
        event: this.fiber.event,
      });
    }
  }

  /** Execute instructions until the fiber ends, waits, or exhausts the quantum. */
  private step(fiber: Fiber, budgetIn: number): number {
    let budget = budgetIn;
    const { ops, args, consts, lines } = this.chunk;
    const stack = fiber.stack;

    while (budget > 0) {
      budget--;
      this.instructionsExecuted++;
      const pc = fiber.pc;
      if (pc < 0 || pc >= ops.length) {
        this.fiber = null;
        return budget;
      }
      const op = ops[pc]!;
      const arg = args[pc]!;
      const line = lines[pc] ?? 0;
      fiber.pc = pc + 1;

      if (this.traceSink && line > 0 && line !== this.lastTraceLine) {
        this.lastTraceLine = line;
        this.traceSink({ kind: "line", tick: this.traceTick, line, event: fiber.event });
      }

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
              ref.obj === "event" ? (fiber.payload?.[ref.prop] ?? null) : this.host.readProp(ref),
            );
            break;
          }
          case Op.SET_NAME:
            this.host.setName(toText(stack.pop() ?? null));
            break;
          case Op.ACTION: {
            const arity = this.chunk.actionArity[arg]!;
            const actionArgs = arity === 0 ? [] : stack.splice(stack.length - arity, arity);
            const action = this.chunk.actions[arg]!;
            this.traceSink?.({
              kind: "action",
              tick: this.traceTick,
              line,
              event: fiber.event,
              action,
              args: [...actionArgs],
              ...this.context(fiber),
            });
            this.host.doAction(action, actionArgs);
            break;
          }
          case Op.CALL:
            this.callBuiltin(BUILTIN_NAMES[arg]!, stack);
            break;

          case Op.CALL_N: {
            // The count was pushed last, so it comes off first; what remains on
            // top of the stack is exactly the arguments, in source order.
            const count = Math.max(0, Math.floor(toNum(stack.pop() ?? null)));
            const args = stack.splice(stack.length - count, count);
            this.callVariadic(BUILTIN_NAMES[arg]!, args, stack);
            break;
          }

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
            {
              const result = truthy(stack.pop() ?? null);
              if (this.chunk.debug[pc] === DebugMark.CONDITION) {
                this.traceSink?.({
                  kind: "condition",
                  tick: this.traceTick,
                  line,
                  event: fiber.event,
                  result,
                  ...this.context(fiber),
                });
              }
              if (!result) fiber.pc = arg;
            }
            break;
          case Op.JUMP_IF_TRUE:
            if (truthy(stack.pop() ?? null)) fiber.pc = arg;
            break;

          case Op.WAIT: {
            const n = Math.floor(toNum(stack.pop() ?? null));
            this.traceSink?.({
              kind: "wait",
              tick: this.traceTick,
              line,
              event: fiber.event,
              ticks: Math.max(0, n),
            });
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
        this.errors++;
        this.lastError = {
          message: err instanceof Error ? err.message : String(err),
          line: lines[pc] ?? 0,
          event: fiber.event,
        };
        this.traceSink?.({
          kind: "error",
          tick: this.traceTick,
          line: lines[pc] ?? 0,
          event: fiber.event,
          message: this.lastError.message,
        });
        this.fiber = null;
        return budget;
      }

      // A stack that keeps growing means a compiler bug; fail this handler
      // loudly rather than eating memory.
      if (stack.length > 256) {
        this.errors++;
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

  /**
   * The one call shape whose argument count is decided by the caller.
   *
   * Kept apart from `callBuiltin` rather than folded into it, because every
   * other builtin knowing its own arity is what makes that switch readable —
   * each case pops exactly what it needs and nothing has to consult a table.
   */
  private callVariadic(name: string, args: Value[], stack: Value[]): void {
    switch (name) {
      case "pack":
        stack.push(args.map(toText).join(PACK_SEPARATOR));
        return;
      default:
        stack.push(null);
        return;
    }
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
      case "field": {
        const slot = Math.floor(toNum(stack.pop() ?? null));
        const message = toText(stack.pop() ?? null);
        // Counting from 1, because this is read by people who have not
        // programmed before and "the first one" is 1 to everybody else alive.
        // Out of range is empty text rather than an error: a message from
        // somebody else is not something a script can be sure of the shape of,
        // and dying because an enemy sent you a short one would be absurd.
        const parts = message === "" ? [] : message.split(PACK_SEPARATOR);
        stack.push(parts[slot - 1] ?? "");
        return;
      }
      case "fieldcount": {
        const message = toText(stack.pop() ?? null);
        stack.push(message === "" ? 0 : message.split(PACK_SEPARATOR).length);
        return;
      }
      case "number":
        stack.push(toNum(stack.pop() ?? null));
        return;
      case "text":
        stack.push(toText(stack.pop() ?? null));
        return;
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
