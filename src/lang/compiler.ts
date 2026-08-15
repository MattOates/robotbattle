/**
 * AST -> bytecode.
 *
 * Also the semantic checking pass: unknown variables, unknown properties and
 * wrong argument counts are all caught here, with source positions, so the
 * editor can point at them before a match ever starts.
 */

import { RoboScriptError, type SourcePos } from "./errors.js";
import type {
  ActionKind,
  EventName,
  Expr,
  Program,
  Stmt,
} from "./ast.js";
import { EVENT_DOCS, eventFields } from "./events.js";
import {
  BUILTIN_NAMES,
  BUILTIN_SIGNATURES,
  Op,
  type Chunk,
  type PropRef,
  type Value,
} from "./bytecode.js";

/** Fixed arity per action, after normalisation (a bare `fire` gains a default). */
const ACTION_ARITY: Readonly<Record<ActionKind, number>> = {
  drive: 1,
  stop: 0,
  turnBodyTo: 1,
  turnBodyBy: 1,
  turretTurnTo: 1,
  turretTurnBy: 1,
  turretAim: 1,
  turretSweep: 1,
  fire: 1,
};

/** Properties a script may read, per object. */
const ME_PROPS = new Set([
  "x", "y", "heading", "speed", "health", "turret", "gunheat", "ammo", "score",
]);
const ARENA_PROPS = new Set(["width", "height", "time", "robots"]);
// `event` has no fixed shape: what it carries depends on which handler you are
// in, so it is validated against EVENT_DOCS rather than one flat list.

/** Default firing power when a script writes a bare `fire`. */
const DEFAULT_FIRE_POWER = 2;

interface LoopContext {
  /** Addresses of JUMPs emitted by `break`, patched to the loop exit. */
  breaks: number[];
  /** Addresses of JUMPs emitted by `continue`, patched to the loop's step. */
  continues: number[];
}

class Compiler {
  private ops: number[] = [];
  private args: number[] = [];
  private lines: number[] = [];
  private consts: Value[] = [];
  private props: PropRef[] = [];
  private actions: string[] = [];
  private actionArity: number[] = [];
  private globals: string[] = [];
  private globalIndex = new Map<string, number>();
  private loops: LoopContext[] = [];
  /** Which handler is being compiled, so `event.*` can be checked against it. */
  private currentEvent: EventName | null = null;

  // ---- emit helpers -----------------------------------------------------

  private emit(op: Op, arg: number, pos: SourcePos): number {
    const at = this.ops.length;
    this.ops.push(op);
    this.args.push(arg);
    this.lines.push(pos.line);
    return at;
  }

  private patch(addr: number, target: number): void {
    this.args[addr] = target;
  }

  private here(): number {
    return this.ops.length;
  }

  private constIndex(v: Value): number {
    // Dedupe so identical literals share a slot, which keeps the constant pool
    // — and therefore program identity — stable and small.
    const found = this.consts.findIndex((c) => c === v && typeof c === typeof v);
    if (found >= 0) return found;
    this.consts.push(v);
    return this.consts.length - 1;
  }

  private propIndex(ref: PropRef): number {
    const found = this.props.findIndex((p) => p.obj === ref.obj && p.prop === ref.prop);
    if (found >= 0) return found;
    this.props.push(ref);
    return this.props.length - 1;
  }

  private actionIndex(kind: ActionKind): number {
    const found = this.actions.indexOf(kind);
    if (found >= 0) return found;
    this.actions.push(kind);
    this.actionArity.push(ACTION_ARITY[kind]);
    return this.actions.length - 1;
  }

  /**
   * Every variable is a robot-level global. A single flat scope is a
   * deliberate simplification for a beginner language: a `for` counter stays
   * readable after the loop, and there is no shadowing to explain.
   */
  private declareGlobal(name: string): number {
    const key = name.toLowerCase();
    const existing = this.globalIndex.get(key);
    if (existing !== undefined) return existing;
    const slot = this.globals.length;
    this.globals.push(name);
    this.globalIndex.set(key, slot);
    return slot;
  }

  /**
   * `event` carries different information in different handlers, so what is
   * legal depends on where you are. Saying so precisely is much more useful to
   * a beginner than a generic "unknown property".
   */
  private checkEventProp(prop: string, pos: SourcePos): void {
    if (!this.currentEvent) {
      throw new RoboScriptError(
        "`event` only means something inside an `on ...` block",
        pos,
        "there is no event to talk about out here — move this line into a handler",
      );
    }
    const fields = eventFields(this.currentEvent);
    if (fields.some((f) => f.name === prop)) return;

    if (fields.length === 0) {
      throw new RoboScriptError(
        `\`on ${this.currentEvent}\` doesn't come with any event information`,
        pos,
        EVENT_DOCS[this.currentEvent].summary,
      );
    }
    throw new RoboScriptError(
      `\`on ${this.currentEvent}\` doesn't tell you \`${prop}\``,
      pos,
      `inside this block, event has: ${fields.map((f) => f.name).join(", ")}`,
    );
  }

  private lookupGlobal(name: string, pos: SourcePos): number {
    const slot = this.globalIndex.get(name.toLowerCase());
    if (slot === undefined) {
      const known = this.globals.length
        ? `you've made: ${this.globals.join(", ")}`
        : "you haven't made any variables yet";
      throw new RoboScriptError(
        `I don't know a variable called \`${name}\``,
        pos,
        `make it first with \`var ${name} = 0\` — ${known}`,
      );
    }
    return slot;
  }

  // ---- program ----------------------------------------------------------

  compile(program: Program): Chunk {
    // Pre-declare every global so a handler can use a variable declared later
    // in the file. Order of declaration fixes slot numbers.
    for (const g of program.globals) this.declareGlobal(g.name);
    for (const h of program.handlers) this.predeclare(h.body);

    // Prelude: initialise globals once, before `on start` runs.
    const initEntry = this.here();
    for (const g of program.globals) {
      this.expr(g.expr);
      this.emit(Op.STORE, this.lookupGlobal(g.name, g.pos), g.pos);
    }
    this.emit(Op.HALT, 0, { line: 1, col: 1 });

    const handlers: Record<string, number> = {};
    for (const h of program.handlers) {
      handlers[h.event] = this.here();
      this.currentEvent = h.event;
      for (const s of h.body) this.stmt(s);
      this.currentEvent = null;
      this.emit(Op.HALT, 0, h.pos);
    }

    return {
      ops: this.ops,
      args: this.args,
      lines: this.lines,
      consts: this.consts,
      props: this.props,
      actions: this.actions,
      actionArity: this.actionArity,
      globals: this.globals,
      handlers,
      initEntry,
    };
  }

  /** Walk a block declaring any `var`/`for` names, without emitting code. */
  private predeclare(body: Stmt[]): void {
    for (const s of body) {
      switch (s.type) {
        case "varDecl":
          this.declareGlobal(s.name);
          break;
        case "for":
          this.declareGlobal(s.varName);
          this.predeclare(s.body);
          break;
        case "if":
          this.predeclare(s.then);
          this.predeclare(s.otherwise);
          break;
        case "loop":
        case "repeat":
          this.predeclare(s.body);
          break;
        default:
          break;
      }
    }
  }

  // ---- statements -------------------------------------------------------

  private stmt(s: Stmt): void {
    switch (s.type) {
      case "varDecl":
      case "assign": {
        if (s.type === "assign" && s.name === "name") {
          this.expr(s.expr);
          this.emit(Op.SET_NAME, 0, s.pos);
          return;
        }
        this.expr(s.expr);
        const slot =
          s.type === "varDecl"
            ? this.declareGlobal(s.name)
            : this.lookupGlobal(s.name, s.pos);
        this.emit(Op.STORE, slot, s.pos);
        return;
      }

      case "if": {
        this.expr(s.cond);
        const jumpElse = this.emit(Op.JUMP_IF_FALSE, 0, s.pos);
        for (const st of s.then) this.stmt(st);
        if (s.otherwise.length > 0) {
          const jumpEnd = this.emit(Op.JUMP, 0, s.pos);
          this.patch(jumpElse, this.here());
          for (const st of s.otherwise) this.stmt(st);
          this.patch(jumpEnd, this.here());
        } else {
          this.patch(jumpElse, this.here());
        }
        return;
      }

      case "loop": {
        const top = this.here();
        this.loops.push({ breaks: [], continues: [] });
        for (const st of s.body) this.stmt(st);
        const ctx = this.loops.pop()!;
        for (const c of ctx.continues) this.patch(c, this.here());
        this.emit(Op.JUMP, top, s.pos);
        for (const b of ctx.breaks) this.patch(b, this.here());
        return;
      }

      case "repeat": {
        // Desugars to a hidden counter. The count is evaluated once, so
        // `repeat me.health` doesn't change length mid-loop.
        const counter = this.declareGlobal(`__repeat${this.globals.length}`);
        this.expr(s.count);
        this.emit(Op.STORE, counter, s.pos);
        const top = this.here();
        this.emit(Op.LOAD, counter, s.pos);
        this.emit(Op.PUSH, this.constIndex(0), s.pos);
        this.emit(Op.GT, 0, s.pos);
        const exit = this.emit(Op.JUMP_IF_FALSE, 0, s.pos);

        this.loops.push({ breaks: [], continues: [] });
        for (const st of s.body) this.stmt(st);
        const ctx = this.loops.pop()!;
        for (const c of ctx.continues) this.patch(c, this.here());

        this.emit(Op.LOAD, counter, s.pos);
        this.emit(Op.PUSH, this.constIndex(1), s.pos);
        this.emit(Op.SUB, 0, s.pos);
        this.emit(Op.STORE, counter, s.pos);
        this.emit(Op.JUMP, top, s.pos);
        this.patch(exit, this.here());
        for (const b of ctx.breaks) this.patch(b, this.here());
        return;
      }

      case "for": {
        const slot = this.declareGlobal(s.varName);
        const limit = this.declareGlobal(`__limit${this.globals.length}`);
        this.expr(s.from);
        this.emit(Op.STORE, slot, s.pos);
        this.expr(s.to);
        this.emit(Op.STORE, limit, s.pos);

        const top = this.here();
        this.emit(Op.LOAD, slot, s.pos);
        this.emit(Op.LOAD, limit, s.pos);
        this.emit(Op.LE, 0, s.pos);
        const exit = this.emit(Op.JUMP_IF_FALSE, 0, s.pos);

        this.loops.push({ breaks: [], continues: [] });
        for (const st of s.body) this.stmt(st);
        const ctx = this.loops.pop()!;
        // `continue` jumps to the increment, not the test, so it can't spin.
        for (const c of ctx.continues) this.patch(c, this.here());

        this.emit(Op.LOAD, slot, s.pos);
        this.emit(Op.PUSH, this.constIndex(1), s.pos);
        this.emit(Op.ADD, 0, s.pos);
        this.emit(Op.STORE, slot, s.pos);
        this.emit(Op.JUMP, top, s.pos);
        this.patch(exit, this.here());
        for (const b of ctx.breaks) this.patch(b, this.here());
        return;
      }

      case "break":
      case "continue": {
        const ctx = this.loops[this.loops.length - 1];
        if (!ctx) {
          // The parser already guards this; belt and braces.
          throw new RoboScriptError(`\`${s.type}\` only works inside a loop`, s.pos);
        }
        if (s.cond) {
          // `break if x` — jump over the break when the condition is false.
          this.expr(s.cond);
          const skip = this.emit(Op.JUMP_IF_FALSE, 0, s.pos);
          const j = this.emit(Op.JUMP, 0, s.pos);
          (s.type === "break" ? ctx.breaks : ctx.continues).push(j);
          this.patch(skip, this.here());
        } else {
          const j = this.emit(Op.JUMP, 0, s.pos);
          (s.type === "break" ? ctx.breaks : ctx.continues).push(j);
        }
        return;
      }

      case "wait": {
        this.expr(s.ticks);
        this.emit(Op.WAIT, 0, s.pos);
        return;
      }

      case "action": {
        const arity = ACTION_ARITY[s.action];
        const given = [...s.args];
        // A bare `fire` gains the default power, so every action has fixed arity.
        if (s.action === "fire" && given.length === 0) {
          given.push({ type: "num", value: DEFAULT_FIRE_POWER, pos: s.pos });
        }
        if (given.length !== arity) {
          throw new RoboScriptError(
            `\`${s.action}\` needs ${arity} value${arity === 1 ? "" : "s"}, but got ${given.length}`,
            s.pos,
          );
        }
        for (const a of given) this.expr(a);
        this.emit(Op.ACTION, this.actionIndex(s.action), s.pos);
        return;
      }
    }
  }

  // ---- expressions ------------------------------------------------------

  private expr(e: Expr): void {
    switch (e.type) {
      case "num":
        this.emit(Op.PUSH, this.constIndex(e.value), e.pos);
        return;
      case "str":
        this.emit(Op.PUSH, this.constIndex(e.value), e.pos);
        return;
      case "bool":
        this.emit(Op.PUSH, this.constIndex(e.value), e.pos);
        return;
      case "none":
        this.emit(Op.PUSH, this.constIndex(null), e.pos);
        return;
      case "var":
        this.emit(Op.LOAD, this.lookupGlobal(e.name, e.pos), e.pos);
        return;
      case "prop": {
        if (e.obj === "event") {
          this.checkEventProp(e.prop.toLowerCase(), e.pos);
          this.emit(
            Op.LOAD_PROP,
            this.propIndex({ obj: "event", prop: e.prop.toLowerCase() }),
            e.pos,
          );
          return;
        }
        const valid = e.obj === "me" ? ME_PROPS : ARENA_PROPS;
        if (!valid.has(e.prop.toLowerCase())) {
          throw new RoboScriptError(
            `\`${e.obj}\` doesn't have anything called \`${e.prop}\``,
            e.pos,
            `${e.obj} has: ${[...valid].join(", ")}`,
          );
        }
        this.emit(
          Op.LOAD_PROP,
          this.propIndex({ obj: e.obj, prop: e.prop.toLowerCase() }),
          e.pos,
        );
        return;
      }
      case "unary":
        this.expr(e.expr);
        this.emit(e.op === "-" ? Op.NEG : Op.NOT, 0, e.pos);
        return;
      case "binary": {
        if (e.op === "and" || e.op === "or") {
          // Short-circuit: keep the left value if it already decides the result.
          this.expr(e.left);
          this.emit(Op.DUP, 0, e.pos);
          const jump = this.emit(
            e.op === "and" ? Op.JUMP_IF_FALSE : Op.JUMP_IF_TRUE,
            0,
            e.pos,
          );
          this.emit(Op.POP, 0, e.pos);
          this.expr(e.right);
          this.patch(jump, this.here());
          return;
        }
        this.expr(e.left);
        this.expr(e.right);
        const opcode = {
          "+": Op.ADD,
          "-": Op.SUB,
          "*": Op.MUL,
          "/": Op.DIV,
          mod: Op.MOD,
          is: Op.IS,
          isnt: Op.ISNT,
          "<": Op.LT,
          ">": Op.GT,
          "<=": Op.LE,
          ">=": Op.GE,
        }[e.op];
        this.emit(opcode, 0, e.pos);
        return;
      }
      case "call": {
        const arity = BUILTIN_SIGNATURES[e.name];
        if (arity === undefined) {
          throw new RoboScriptError(
            `I don't know a function called \`${e.name}\``,
            e.pos,
            `you can use: ${BUILTIN_NAMES.join(", ")}`,
          );
        }
        if (e.args.length !== arity) {
          throw new RoboScriptError(
            `\`${e.name}\` needs ${arity} value${arity === 1 ? "" : "s"}, but got ${e.args.length}`,
            e.pos,
          );
        }
        for (const a of e.args) this.expr(a);
        this.emit(Op.CALL, BUILTIN_NAMES.indexOf(e.name), e.pos);
        return;
      }
    }
  }
}

export function compile(program: Program): Chunk {
  return new Compiler().compile(program);
}
