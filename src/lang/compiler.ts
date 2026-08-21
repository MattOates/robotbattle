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
  CountClause,
  EventName,
  Expr,
  Program,
  Routine,
  Stmt,
  Stmt_Do,
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
  radarTurnTo: 1,
  radarTurnBy: 1,
  radarAim: 1,
  radarSweep: 1,
  ping: 1,
};

/** Properties a script may read, per object. */
/**
 * Properties a script may read, spelled the way they are written.
 *
 * Lists rather than sets, because the names are shown to people as well as
 * checked against. The lexer lowercases before anything gets here, so matching
 * is done on a lowered copy — but the hint that lists them was printing that
 * lowered copy, telling somebody who wrote `me.wobble` that they could have
 * `gunheat` and `pingheat`. Those are not the names: the editor suggests
 * `gunHeat`, the lessons write `gunHeat`, and only this one error said
 * otherwise.
 */
/**
 * The properties `me.` and `arena.` offer, in the order they are suggested.
 *
 * Exported because the completion popup used to keep its own copy with the
 * prose attached, and a property that existed in one list and not the other
 * either never got suggested or got suggested and then refused.
 */
export const ME_PROP_NAMES = [
  "x",
  "y",
  "heading",
  "speed",
  "health",
  "turret",
  "gunHeat",
  "ammo",
  "score",
  "radar",
  "pingHeat",
  "fuel",
  "aiming",
  "slope",
  "uphill",
  "downhill",
] as const;
export const ARENA_PROP_NAMES = ["width", "height", "time", "robots"] as const;

const ME_PROPS = new Set<string>(ME_PROP_NAMES.map((n) => n.toLowerCase()));
const ARENA_PROPS = new Set<string>(ARENA_PROP_NAMES.map((n) => n.toLowerCase()));
// `event` has no fixed shape: what it carries depends on which handler you are
// in, so it is validated against EVENT_DOCS rather than one flat list.

/** Default firing power when a script writes a bare `fire`. */
const DEFAULT_FIRE_POWER = 2;

/**
 * Default ping power when a script writes a bare `ping`.
 *
 * The cheapest one, unlike `fire`. Every script written before pings had a
 * power says a bare `ping`, and those must keep costing and seeing exactly what
 * they always did.
 */
const DEFAULT_PING_POWER = 1;

/**
 * Ceiling on the size of a compiled script.
 *
 * `can` blocks are copied out wherever they are used, so a big one used inside
 * another big one multiplies. This is a blowup guard and nothing else: a robot
 * would have to be writing thousands of instructions to reach it, and by then
 * it is already thinking far too slowly to react.
 */
const MAX_OPS = 8192;

/** Comparisons: the operators whose answer is yes or no. */
const COMPARISONS: ReadonlySet<string> = new Set(["is", "isnt", "<", ">", "<=", ">="]);

/**
 * Is this expression a question with a yes-or-no answer?
 *
 * `and`, `or` and `not` are tests only if what they join are tests, so
 * `if seen and health > 20` is refused for the same reason `if seen` is: one
 * half of it is a value, not a question.
 */
function isTest(e: Expr): boolean {
  switch (e.type) {
    case "bool":
      return true;
    case "unary":
      return e.op === "not" && isTest(e.expr);
    case "binary":
      if (COMPARISONS.has(e.op)) return true;
      return (e.op === "and" || e.op === "or") && isTest(e.left) && isTest(e.right);
    default:
      return false;
  }
}

/** What the reader wrote, named in words they can match to their own line. */
function describe(e: Expr): string {
  switch (e.type) {
    case "num":
      return `\`${e.value}\` is a number`;
    case "str":
      return "a piece of text";
    case "none":
      return "`none`";
    case "var":
      return `\`${e.name}\` on its own`;
    case "prop":
      return `\`${e.obj}.${e.prop}\` on its own`;
    case "call":
      return `\`${e.name}(…)\` gives back a number, which`;
    case "unary":
      return e.op === "-" ? "a number" : `\`not …\` around something that`;
    case "binary":
      return `\`${e.op}\` gives back a number, which`;
    default:
      return "that";
  }
}

/**
 * The fix, spelled out. Guessing what someone meant is usually a bad idea, but
 * `mod` has exactly one common use in a condition — "every N ticks" — and
 * naming it turns a refusal into the answer.
 */
function suggestTest(e: Expr): string {
  if (e.type === "binary" && e.op === "mod") {
    return "did you mean `... mod 60 is 0`? On its own, `mod` answers with the remainder, and every remainder except 0 counts as true — so the test would pass on every tick but the one you wanted";
  }
  if (e.type === "var" || e.type === "prop") {
    const name = e.type === "var" ? e.name : `${e.obj}.${e.prop}`;
    return `compare it to something: \`${name} is true\`, \`${name} > 0\`, \`${name} isnt none\``;
  }
  return "a condition compares two things: `is`, `isnt`, `>`, `<`, `>=`, `<=`, joined with `and`, `or`, `not`";
}

/** How deep `can` blocks may be nested before it stops being comprehensible. */
const MAX_EXPANSION_DEPTH = 4;

/**
 * Can this block run without being handed anything?
 *
 * Only such a block can become a handler on its own — there would be nobody to
 * supply the missing value. One that needs something is library code: perfectly
 * good, but it has to be started with a `do`.
 */
function canRunAlone(routine: Routine): boolean {
  return routine.params.every((p) => p.default !== null);
}

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
  /** Every `can` block, by lowercased name. */
  private routines = new Map<string, Routine>();
  /**
   * The routines currently being expanded, outermost first.
   *
   * Doubles as the cycle check and the depth guard: a routine already on this
   * list is calling itself, however many steps round the houses it went.
   */
  private expanding: string[] = [];
  /**
   * Parameter names in scope, innermost last.
   *
   * A parameter is an ordinary global slot under a name nobody can type, and
   * this is what makes it *local*: name lookup consults these first, so a
   * parameter called `power` hides `var power` for the length of the body and
   * gives it back afterwards.
   */
  private paramScopes: Array<Map<string, number>> = [];
  /** One hidden counter per block that says how often it runs, by owner key. */
  private countSlots = new Map<string, number>();

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
        "`event` only means something when something has happened",
        pos,
        "put this in an `on ...` block, or say which event the block is for: `can dodge given hit by bullet`",
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

  /** A parameter of the routine being expanded, if this name is one. */
  private lookupParam(name: string): number | undefined {
    const key = name.toLowerCase();
    for (let i = this.paramScopes.length - 1; i >= 0; i--) {
      const slot = this.paramScopes[i]!.get(key);
      if (slot !== undefined) return slot;
    }
    return undefined;
  }

  private lookupGlobal(name: string, pos: SourcePos): number {
    const param = this.lookupParam(name);
    if (param !== undefined) return param;
    const slot = this.globalIndex.get(name.toLowerCase());
    if (slot === undefined) {
      // Hidden slots — loop counters, and the ones holding what a `can` block
      // was given — are ours, not the player's, and listing them as things
      // they made would be a lie.
      const mine = this.globals.filter((g) => !g.startsWith("__"));
      const known = mine.length
        ? `you've made: ${mine.join(", ")}`
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
    for (const r of program.routines) this.routines.set(r.name.toLowerCase(), r);

    // Blocks that will run without being asked. A `can` block with a `given`
    // becomes the handler for that event when the script does not write one
    // out — so pasting in a dodge and a reposition gives you both, in the
    // order they appear. Writing `on hit by bullet` yourself takes that back.
    const written = new Set(program.handlers.map((h) => h.event));
    const registered = new Map<EventName, Routine[]>();
    for (const r of program.routines) {
      if (r.given === null || written.has(r.given)) continue;
      if (!canRunAlone(r)) continue;
      const list = registered.get(r.given);
      if (list) list.push(r);
      else registered.set(r.given, [r]);
    }

    // Handlers in source order, with each synthesised one standing where its
    // first contributing block was written — so "paste it in" and "write it
    // out" compile to the same program.
    const blocks: Array<{
      event: EventName;
      body: Stmt[];
      counts: CountClause[];
      pos: SourcePos;
    }> = [
      ...program.handlers.map((h) => ({
        event: h.event,
        body: h.body,
        counts: h.counts,
        pos: h.pos,
      })),
      // A synthesised handler has no counts of its own: each block it calls
      // carries its own, which is what lets two blocks on one event run at two
      // different cadences.
      ...[...registered].map(([event, list]) => ({
        event,
        body: list.map((r): Stmt => ({ type: "do", name: r.name, args: [], pos: r.pos })),
        counts: [] as CountClause[],
        pos: list[0]!.pos,
      })),
    ].sort((a, b) => a.pos.line - b.pos.line);

    // Pre-declare every global so a handler can use a variable declared later
    // in the file. Order of declaration fixes slot numbers.
    for (const g of program.globals) this.declareGlobal(g.name);
    for (const b of blocks) this.predeclare(b.body);

    // Prelude: initialise globals once, before `on start` runs.
    const initEntry = this.here();
    for (const g of program.globals) {
      this.expr(g.expr);
      this.emit(Op.STORE, this.lookupGlobal(g.name, g.pos), g.pos);
    }
    this.emit(Op.HALT, 0, { line: 1, col: 1 });

    const handlers: Record<string, number> = {};
    for (const b of blocks) {
      handlers[b.event] = this.here();
      this.currentEvent = b.event;
      const skips = this.emitCountGate(`on:${b.event}`, b.counts, b.pos);
      for (const s of b.body) this.stmt(s);
      for (const skip of skips) this.patch(skip, this.here());
      this.currentEvent = null;
      this.emit(Op.HALT, 0, b.pos);
      if (this.here() > MAX_OPS) {
        throw new RoboScriptError(
          "this script has grown too big to run",
          b.pos,
          "a `can` block is copied out wherever it is used, so using big ones inside big ones adds up quickly — try doing less, or using fewer of them",
        );
      }
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

  /**
   * Run a `can` block here, by copying its instructions in.
   *
   * There is no call and no return: by the time the VM sees this, the block's
   * instructions are simply part of the handler, which is why a `wait` or a
   * suspended tick inside one needs no machinery at all.
   */
  private expand(s: Stmt_Do): void {
    const key = s.name.toLowerCase();
    const routine = this.routines.get(key);
    if (!routine) {
      const known = [...this.routines.values()].map((r) => r.name);
      throw new RoboScriptError(
        `I don't know how to \`do ${s.name}\``,
        s.pos,
        known.length
          ? `you can do: ${known.join(", ")}`
          : "teach yourself first with a `can ... end` block outside your handlers",
      );
    }

    if (this.expanding.includes(key)) {
      throw new RoboScriptError(
        `\`${routine.name}\` ends up doing itself`,
        s.pos,
        `${[...this.expanding, routine.name].join(" → ")} — a block is copied out where it is used, so this would never finish`,
      );
    }
    if (this.expanding.length >= MAX_EXPANSION_DEPTH) {
      throw new RoboScriptError(
        `\`${routine.name}\` is nested too deeply inside other blocks`,
        s.pos,
        `blocks may go ${MAX_EXPANSION_DEPTH} deep; past that nobody can follow what runs`,
      );
    }

    // The contract. A block that reads `event.*` says which event it is for,
    // and that is the only place it fits.
    if (routine.given !== null && routine.given !== this.currentEvent) {
      throw new RoboScriptError(
        `\`${routine.name}\` needs a \`${routine.given}\` to work with`,
        s.pos,
        this.currentEvent
          ? `you are inside \`on ${this.currentEvent}\`, which is a different thing happening — use it in an \`on ${routine.given}\` block, or in a \`can ... given ${routine.given}\``
          : `use it inside an \`on ${routine.given}\` block, or a \`can ... given ${routine.given}\``,
      );
    }

    const required = routine.params.filter((p) => p.default === null).length;
    if (s.args.length < required || s.args.length > routine.params.length) {
      const wanted =
        required === routine.params.length
          ? `${routine.params.length}`
          : `${required} to ${routine.params.length}`;
      throw new RoboScriptError(
        `\`do ${routine.name}\` needs ${wanted} thing${wanted === "1" ? "" : "s"}, and you gave it ${s.args.length}`,
        s.pos,
        routine.params.length
          ? `it takes: ${routine.params.map((p) => p.name).join(", ")}`
          : "it doesn't take anything — just `do ${routine.name}`",
      );
    }

    // Each parameter is a slot of its own, filled here and read inside. The
    // argument is worked out once, at this call, so a `random()` handed in
    // does not change value halfway through the block.
    const scope = new Map<string, number>();
    routine.params.forEach((param, i) => {
      const slot = this.declareGlobal(`__given${this.globals.length}`);
      const value = s.args[i] ?? param.default!;
      this.expr(value);
      this.emit(Op.STORE, slot, s.pos);
      scope.set(param.name.toLowerCase(), slot);
    });

    // The count gate sits inside the block, after its parameters are filled:
    // an argument is worked out whenever you ask for the block, and the block
    // then decides whether this is one of the times it runs.
    const skips = this.emitCountGate(`can:${key}`, routine.counts, s.pos);

    this.expanding.push(key);
    this.paramScopes.push(scope);
    for (const inner of routine.body) this.stmt(inner);
    this.paramScopes.pop();
    this.expanding.pop();

    for (const skip of skips) this.patch(skip, this.here());
  }

  /**
   * Count this arrival, and skip the body unless the clauses are satisfied.
   *
   * The counter is one hidden global per block, so two blocks on the same event
   * keep their own tallies and a block used from several places keeps one — it
   * counts how many times *it* has been reached, which is the thing anybody
   * writing `every 30` has in mind.
   *
   * Returns the jumps waiting for the end of the body.
   */
  private emitCountGate(owner: string, counts: CountClause[], pos: SourcePos): number[] {
    if (counts.length === 0) return [];

    let slot = this.countSlots.get(owner);
    if (slot === undefined) {
      slot = this.declareGlobal(`__count${this.globals.length}`);
      this.countSlots.set(owner, slot);
    }

    // Every arrival counts, whether or not it goes on to run the body.
    this.emit(Op.LOAD, slot, pos);
    this.emit(Op.PUSH, this.constIndex(1), pos);
    this.emit(Op.ADD, 0, pos);
    this.emit(Op.STORE, slot, pos);

    // `after` starts the clock. `after 2 every 3` on a wall bump means "two
    // bumps, then every third one after that" — the third, sixth, ninth from
    // there — which is what anybody counting hits expects. Counting the
    // cadence from the beginning of the match instead would fire on the fourth
    // and sixth for no reason a reader could see.
    const from = counts.find((c) => c.kind === "after")?.value ?? 0;

    const skips: number[] = [];
    for (const clause of counts) {
      this.emit(Op.LOAD, slot, pos);
      if (clause.kind === "every" && from > 0) {
        this.emit(Op.PUSH, this.constIndex(from), pos);
        this.emit(Op.SUB, 0, pos);
      }
      this.emit(Op.PUSH, this.constIndex(clause.value), pos);
      switch (clause.kind) {
        case "every":
          // `count mod N is 0` — written out, so nobody has to. The `after`
          // clause has already insisted the count is past its own mark, so
          // this never has to worry about the negative side of zero.
          this.emit(Op.MOD, 0, pos);
          this.emit(Op.PUSH, this.constIndex(0), pos);
          this.emit(Op.IS, 0, pos);
          break;
        case "after":
          this.emit(Op.GT, 0, pos);
          break;
        case "before":
          this.emit(Op.LT, 0, pos);
          break;
        case "at":
          this.emit(Op.IS, 0, pos);
          break;
      }
      skips.push(this.emit(Op.JUMP_IF_FALSE, 0, pos));
    }
    return skips;
  }

  /** Walk a block declaring any `var`/`for` names, without emitting code. */
  private predeclare(body: Stmt[], seen: Set<string> = new Set()): void {
    for (const s of body) {
      switch (s.type) {
        case "varDecl":
          this.declareGlobal(s.name);
          break;
        case "do": {
          // Only through blocks that actually run. Walking every `can` in the
          // file would give a block nobody uses a slot of its own, shifting
          // every later slot number — and slot numbers are part of what makes
          // two scripts the same program.
          const routine = this.routines.get(s.name.toLowerCase());
          if (!routine || seen.has(s.name.toLowerCase())) break;
          seen.add(s.name.toLowerCase());
          this.predeclare(routine.body, seen);
          seen.delete(s.name.toLowerCase());
          break;
        }
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

  /**
   * A condition has to be a question with a yes-or-no answer.
   *
   * RoboScript could treat any value as true-or-false — the VM still does, and
   * `truthy` in `vm.ts` decides it — but a beginner writing `if tick mod 60`
   * means "every 60 ticks" and gets the exact opposite, on 59 ticks out of 60,
   * with no error and no crash. That is the worst kind of bug to hand someone
   * learning: it compiles, it runs, it looks alive, and it is wrong.
   *
   * So the compiler insists on an actual test. Nothing in the language produces
   * a true-or-false value except a comparison, `and`/`or`/`not`, and the words
   * `true` and `false` — there are no boolean properties and no builtins that
   * return one — which makes this rule easy to state and easy to obey.
   */
  private requireTest(cond: Expr, keyword: string): void {
    if (isTest(cond)) return;
    throw new RoboScriptError(
      `\`${keyword}\` needs a question that answers yes or no, and ${describe(cond)} is not one`,
      cond.pos,
      suggestTest(cond),
    );
  }

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
          s.type === "varDecl" ? this.declareGlobal(s.name) : this.lookupGlobal(s.name, s.pos);
        this.emit(Op.STORE, slot, s.pos);
        return;
      }

      case "if": {
        this.requireTest(s.cond, "if");
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
          this.requireTest(s.cond, s.type);
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

      case "do": {
        this.expand(s);
        return;
      }

      case "action": {
        const arity = ACTION_ARITY[s.action];
        const given = [...s.args];
        // A bare `fire` or `ping` gains its default power, so every action has
        // fixed arity by the time it reaches the bytecode.
        if (s.action === "fire" && given.length === 0) {
          given.push({ type: "num", value: DEFAULT_FIRE_POWER, pos: s.pos });
        }
        if (s.action === "ping" && given.length === 0) {
          given.push({ type: "num", value: DEFAULT_PING_POWER, pos: s.pos });
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
          const names = e.obj === "me" ? ME_PROP_NAMES : ARENA_PROP_NAMES;
          throw new RoboScriptError(
            `\`${e.obj}\` doesn't have anything called \`${e.prop}\``,
            e.pos,
            `${e.obj} has: ${names.join(", ")}`,
          );
        }
        this.emit(Op.LOAD_PROP, this.propIndex({ obj: e.obj, prop: e.prop.toLowerCase() }), e.pos);
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
          const jump = this.emit(e.op === "and" ? Op.JUMP_IF_FALSE : Op.JUMP_IF_TRUE, 0, e.pos);
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
