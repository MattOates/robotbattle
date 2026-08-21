/**
 * RoboScript parser — hand-written recursive descent.
 *
 * Hand-written rather than generated so that error messages can be genuinely
 * helpful: we know which block we are inside and where it opened, so an
 * unclosed `on sense robot` can say so by name and line.
 */

import { RoboScriptError, type SourcePos } from "./errors.js";
import type { Token } from "./lexer.js";
import { tokenize } from "./lexer.js";
import {
  EVENT_NAMES,
  type ActionKind,
  type CountClause,
  type EventName,
  type Expr,
  type Handler,
  type Locomotion,
  type Param,
  type Program,
  type Routine,
  type Stmt,
  type Stmt_Var,
} from "./ast.js";
import { canonicalizeProperty } from "./vocab.js";

/**
 * Words that may never be used as a variable name.
 *
 * Exported because the editor's highlighter has its own tables, and a word the
 * language reserves but the highlighter has never heard of renders as an
 * ordinary variable — which is how a new instruction ships looking like a typo.
 */
export const RESERVED = new Set([
  "on",
  "end",
  "var",
  "set",
  "if",
  "else",
  "then",
  "loop",
  "for",
  "to",
  "repeat",
  "times",
  "break",
  "continue",
  "wait",
  "ticks",
  "tick",
  "drive",
  "forward",
  "back",
  "backward",
  "stop",
  "turn",
  "chassis",
  "by",
  "fire",
  "turret",
  "aim",
  "at",
  "sweep",
  "is",
  "isnt",
  "not",
  "and",
  "or",
  "mod",
  "true",
  "false",
  "none",
  "me",
  "arena",
  "event",
  "name",
  "color",
  "colour",
  "skid",
  "steered",
  "start",
  "sense",
  "hit",
  "bullet",
  "robot",
  "wall",
  "missed",
  "destroyed",
  "radar",
  "ping",
  "can",
  "do",
  "with",
  "given",
  "every",
  "after",
  "before",
]);


/** Event phrases sorted longest-first so `hit by bullet` wins over `hit`. */
const EVENT_PHRASES: readonly string[][] = [...EVENT_NAMES]
  .map((n) => n.split(" "))
  .sort((a, b) => b.length - a.length);

class Parser {
  private tokens: Token[];
  private i = 0;
  /** Nesting depth of loops, so `break` outside a loop is a clear error. */
  private loopDepth = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // ---- token helpers ----------------------------------------------------

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)]!;
  }

  private pos(): SourcePos {
    const t = this.peek();
    return { line: t.line, col: t.col };
  }

  private advance(): Token {
    const t = this.peek();
    if (this.i < this.tokens.length - 1) this.i++;
    return t;
  }

  private isWord(text: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === "word" && t.text === text;
  }

  private isOp(text: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === "op" && t.text === text;
  }

  private matchWord(text: string): boolean {
    if (this.isWord(text)) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchOp(text: string): boolean {
    if (this.isOp(text)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expectWord(text: string, hint?: string): Token {
    if (!this.isWord(text)) {
      throw new RoboScriptError(
        `I expected \`${text}\` here, but found \`${this.describe(this.peek())}\``,
        this.pos(),
        hint,
      );
    }
    return this.advance();
  }

  private describe(t: Token): string {
    if (t.kind === "eof") return "the end of the script";
    if (t.kind === "newline") return "the end of the line";
    return t.raw;
  }

  /** Consume the end of a statement. */
  private expectEndOfLine(what: string): void {
    if (this.peek().kind === "newline") {
      this.advance();
      return;
    }
    if (this.peek().kind === "eof") return;
    throw new RoboScriptError(
      `I found \`${this.describe(this.peek())}\` after ${what}, and I don't know what it means`,
      this.pos(),
      "each instruction goes on its own line",
    );
  }

  private skipNewlines(): void {
    while (this.peek().kind === "newline") this.advance();
  }

  // ---- program ----------------------------------------------------------

  parseProgram(): Program {
    let name = "Unnamed";
    let locomotion: Locomotion = "skid";
    let color = "#7fd1e0";
    let sawLocomotion = false;
    const globals: Stmt_Var[] = [];
    const handlers: Handler[] = [];
    const routines: Routine[] = [];
    const seen = new Set<EventName>();

    this.skipNewlines();

    while (this.peek().kind !== "eof") {
      const pos = this.pos();

      if (this.matchWord("name")) {
        const t = this.peek();
        if (t.kind !== "string") {
          throw new RoboScriptError(
            "a robot's name has to be text in quotes",
            this.pos(),
            'try `name "Sparky"`',
          );
        }
        this.advance();
        name = t.text;
        this.expectEndOfLine("the name");
      } else if (this.matchWord("chassis")) {
        if (this.isWord("skid") || this.isWord("steered")) {
          locomotion = this.advance().text as Locomotion;
          sawLocomotion = true;
        } else {
          throw new RoboScriptError(
            `\`${this.describe(this.peek())}\` isn't a body I know about`,
            this.pos(),
            "pick `tank` or `car` (or `ciliate` / `flagellate` if you're playing biology)",
          );
        }
        this.expectEndOfLine("the body type");
      } else if (this.matchWord("color") || this.matchWord("colour")) {
        const t = this.peek();
        if (t.kind !== "color") {
          throw new RoboScriptError(
            "a colour has to look like #ff8800",
            this.pos(),
            "the six characters after # are how much red, green and blue to mix",
          );
        }
        this.advance();
        color = expandColor(t.text);
        this.expectEndOfLine("the colour");
      } else if (this.isWord("var")) {
        globals.push(this.parseVarDecl());
      } else if (this.matchWord("on")) {
        const handler = this.parseHandler(pos);
        if (seen.has(handler.event)) {
          throw new RoboScriptError(
            `you already have an \`on ${handler.event}\` block`,
            pos,
            "put all the instructions for one event in a single block",
          );
        }
        seen.add(handler.event);
        handlers.push(handler);
      } else if (this.matchWord("can")) {
        const routine = this.parseRoutine(pos);
        if (routines.some((r) => r.name.toLowerCase() === routine.name.toLowerCase())) {
          throw new RoboScriptError(
            `you already have a \`can ${routine.name}\` block`,
            pos,
            "two blocks with the same name would be impossible to tell apart in a `do`",
          );
        }
        routines.push(routine);
      } else {
        throw new RoboScriptError(
          `I don't know what \`${this.describe(this.peek())}\` means out here`,
          this.pos(),
          "outside a block you can set `name`, `chassis`, `color`, declare a `var`, start an `on ...` block, or teach yourself something new with `can ...`",
        );
      }
      this.skipNewlines();
    }

    if (!sawLocomotion && handlers.length > 0) {
      // Not fatal — defaulting to a tank is the friendlier behaviour for a
      // first script — but the roster surfaces it as a warning.
    }

    return { name, locomotion, color, globals, handlers, routines };
  }

  /**
   * `can NAME [with p1, p2=default] [given EVENT]` … `end`
   *
   * The two clauses are optional and always in this order, so the first word
   * after the name says which one is coming — which keeps the error messages
   * specific rather than "I expected something here".
   */
  private parseRoutine(pos: SourcePos): Routine {
    const name = this.parseVarName();
    const params: Param[] = [];

    if (this.matchWord("with")) {
      for (;;) {
        const paramPos = this.pos();
        const paramName = this.parseVarName();
        if (params.some((p) => p.name.toLowerCase() === paramName.toLowerCase())) {
          throw new RoboScriptError(
            `\`${name}\` is already given something called \`${paramName}\``,
            paramPos,
            "each thing a block is given needs its own name",
          );
        }
        const fallback = this.matchOp("=") ? this.parseExpr() : null;
        // Defaults have to come last, or leaving one out at a `do` would be
        // ambiguous: `do shove with 2` could mean either of two things.
        if (fallback === null && params.some((p) => p.default !== null)) {
          throw new RoboScriptError(
            `\`${paramName}\` has to come before the ones with a starting value`,
            paramPos,
            "put the ones you always have to supply first, so leaving the rest out is never ambiguous",
          );
        }
        params.push({ name: paramName, default: fallback, pos: paramPos });
        if (!this.matchOp(",")) break;
      }
    }

    const given = this.matchWord("given") ? this.parseEventName() : null;
    const counts = this.parseCountClauses(`can ${name}`);
    this.expectEndOfLine(`\`can ${name}\``);
    const body = this.parseBlock(`the \`can ${name}\` block`, pos);
    return { name, params, given, counts, body, pos };
  }

  private parseHandler(pos: SourcePos): Handler {
    const event = this.parseEventName();
    const counts = this.parseCountClauses(`on ${event}`);
    this.expectEndOfLine(`\`on ${event}\``);
    const body = this.parseBlock(`the \`on ${event}\` block`, pos);
    return { event, body, counts, pos };
  }

  /**
   * `every 30 after 90 before 900` — how often, in any order.
   *
   * They are filters on one count, so order carries no meaning and the parser
   * accepts whichever way round it reads best to the person writing it.
   */
  private parseCountClauses(what: string): CountClause[] {
    const counts: CountClause[] = [];

    for (;;) {
      const pos = this.pos();
      let kind: CountClause["kind"] | null = null;
      for (const word of ["every", "after", "before", "at"] as const) {
        if (this.matchWord(word)) {
          kind = word;
          break;
        }
      }
      if (kind === null) break;

      const already = counts.find((c) => c.kind === kind);
      if (already) {
        throw new RoboScriptError(
          `\`${what}\` already says \`${kind} ${already.value}\``,
          pos,
          "one `every`, one `after`, one `before` — saying it twice would only contradict itself",
        );
      }

      const t = this.peek();
      if (t.kind !== "number") {
        throw new RoboScriptError(
          `\`${kind}\` needs a plain number after it`,
          this.pos(),
          `\`${kind} 30\` counts how many times this has happened — it cannot be worked out as you go`,
        );
      }
      const value = Number(t.text);
      if (!Number.isInteger(value) || value < 1) {
        throw new RoboScriptError(
          `\`${kind} ${t.text}\` needs a whole number of times, 1 or more`,
          this.pos(),
          "counting starts at 1, on the first time the block is reached",
        );
      }
      this.advance();
      counts.push({ kind, value, pos });
    }

    // `at 2` is already "the count is exactly 2", so nothing else has anything
    // left to narrow — a second clause beside it can only be a misunderstanding.
    const at = counts.find((c) => c.kind === "at");
    if (at && counts.length > 1) {
      const other = counts.find((c) => c.kind !== "at")!;
      throw new RoboScriptError(
        `\`at ${at.value}\` and \`${other.kind} ${other.value}\` cannot both be true`,
        other.pos,
        "`at` pins the count exactly, so it goes on its own — use `every`, `after` and `before` together instead",
      );
    }

    const every = counts.find((c) => c.kind === "every");
    const after = counts.find((c) => c.kind === "after");
    const before = counts.find((c) => c.kind === "before");
    if (after && before && after.value >= before.value - 1) {
      throw new RoboScriptError(
        `\`after ${after.value} before ${before.value}\` leaves no times in between`,
        before.pos,
        "`after` and `before` are both exclusive, so there has to be room between them",
      );
    }
    // `after` starts the cadence counting, so the first run is that many on
    // from there — which is what decides whether `before` leaves room for it.
    if (every && before) {
      const first = (after?.value ?? 0) + every.value;
      if (first >= before.value) {
        throw new RoboScriptError(
          `\`every ${every.value}\` never comes round before ${before.value}`,
          every.pos,
          after
            ? `counting starts again after ${after.value}, so the first run would be number ${first}`
            : `the first run would be number ${first}`,
        );
      }
    }

    // Sorted into one canonical order before they leave here. The clauses are
    // independent tests on the same count, so the order they were written in
    // carries no meaning — and this way `every 10 after 25` and
    // `after 25 every 10` are not merely equivalent but the identical program,
    // which matters to everything downstream that compares two scripts.
    const RANK = { every: 0, after: 1, before: 2, at: 3 } as const;
    counts.sort((a, b) => RANK[a.kind] - RANK[b.kind]);

    return counts;
  }

  private parseEventName(): EventName {
    for (const phrase of EVENT_PHRASES) {
      let ok = true;
      for (let k = 0; k < phrase.length; k++) {
        if (!this.isWord(phrase[k]!, k)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        for (let k = 0; k < phrase.length; k++) this.advance();
        return phrase.join(" ") as EventName;
      }
    }
    throw new RoboScriptError(
      `\`${this.describe(this.peek())}\` isn't an event I can tell you about`,
      this.pos(),
      `events are: ${EVENT_NAMES.join(", ")}`,
    );
  }

  /**
   * Parse statements until the block closes. When `allowElse` is set the block
   * may also close on `else`, which is left unconsumed for the caller; the
   * return value says which happened so `end` is never consumed twice.
   */
  private parseBlockUntil(
    what: string,
    openedAt: SourcePos,
    allowElse: boolean,
  ): { body: Stmt[]; stoppedAtElse: boolean } {
    const body: Stmt[] = [];
    for (;;) {
      this.skipNewlines();
      if (this.peek().kind === "eof") {
        throw new RoboScriptError(
          `${what} never finishes`,
          openedAt,
          "every block needs a matching `end` on its own line",
        );
      }
      if (this.isWord("end")) {
        this.advance();
        this.expectEndOfLine("`end`");
        return { body, stoppedAtElse: false };
      }
      if (allowElse && this.isWord("else")) {
        return { body, stoppedAtElse: true };
      }
      body.push(this.parseStatement());
    }
  }

  /** Parse a block that can only be closed by `end`. */
  private parseBlock(what: string, openedAt: SourcePos): Stmt[] {
    return this.parseBlockUntil(what, openedAt, false).body;
  }

  // ---- statements -------------------------------------------------------

  private parseVarDecl(): Stmt_Var {
    const pos = this.pos();
    this.expectWord("var");
    const name = this.parseVarName();
    if (!this.matchOp("=")) {
      throw new RoboScriptError(
        `\`var ${name}\` needs a starting value`,
        this.pos(),
        `try \`var ${name} = 0\``,
      );
    }
    const expr = this.parseExpr();
    this.expectEndOfLine("the value");
    return { type: "varDecl", name, expr, pos };
  }

  private parseVarName(): string {
    const t = this.peek();
    if (t.kind !== "word") {
      throw new RoboScriptError(
        `\`${this.describe(t)}\` can't be used as a name`,
        this.pos(),
        "names start with a letter, like `target` or `spin_speed`",
      );
    }
    if (RESERVED.has(t.text)) {
      throw new RoboScriptError(
        `\`${t.raw}\` is a word RoboScript already uses, so it can't be a variable name`,
        this.pos(),
        `try something like \`my_${t.raw}\``,
      );
    }
    this.advance();
    return t.raw;
  }

  private parseStatement(): Stmt {
    const pos = this.pos();

    if (this.isWord("var")) return this.parseVarDecl();

    if (this.matchWord("do")) {
      const name = this.parseVarName();
      const args: Expr[] = [];
      if (this.matchWord("with")) {
        do {
          args.push(this.parseExpr());
        } while (this.matchOp(","));
      }
      this.expectEndOfLine(`\`do ${name}\``);
      return { type: "do", name, args, pos };
    }

    if (this.isWord("can")) {
      throw new RoboScriptError(
        "`can` blocks go outside everything else",
        pos,
        "move it out to the left margin, then use `do` in here to run it",
      );
    }

    if (this.matchWord("set")) {
      // `set name = ...` writes the display label; otherwise a normal variable.
      const t = this.peek();
      let target: string;
      if (t.kind === "word" && t.text === "name") {
        this.advance();
        target = "name";
      } else {
        target = this.parseVarName();
      }
      if (!this.matchOp("=")) {
        throw new RoboScriptError(
          `\`set ${target}\` needs an \`=\` and a value`,
          this.pos(),
          `try \`set ${target} = 0\``,
        );
      }
      const expr = this.parseExpr();
      this.expectEndOfLine("the value");
      return { type: "assign", name: target, expr, pos };
    }

    if (this.matchWord("if")) {
      const cond = this.parseExpr();
      this.matchWord("then"); // optional sugar
      this.expectEndOfLine("the condition");
      const { body: then, stoppedAtElse } = this.parseBlockUntil("the `if` block", pos, true);
      let otherwise: Stmt[] = [];
      if (stoppedAtElse) {
        this.expectWord("else");
        // `else if` chains without needing a separate `elseif` keyword: the
        // nested `if` consumes the single shared `end`.
        if (this.isWord("if")) {
          otherwise = [this.parseStatement()];
        } else {
          this.expectEndOfLine("`else`");
          otherwise = this.parseBlock("the `else` block", pos);
        }
      }
      return { type: "if", cond, then, otherwise, pos };
    }

    if (this.matchWord("loop")) {
      this.expectEndOfLine("`loop`");
      this.loopDepth++;
      const body = this.parseBlock("the `loop` block", pos);
      this.loopDepth--;
      return { type: "loop", body, pos };
    }

    if (this.matchWord("for")) {
      const varName = this.parseVarName();
      if (!this.matchOp("=")) {
        throw new RoboScriptError(
          "a `for` needs a starting number",
          this.pos(),
          `try \`for ${varName} = 1 to 10\``,
        );
      }
      const from = this.parseExpr();
      this.expectWord("to", `try \`for ${varName} = 1 to 10\``);
      const to = this.parseExpr();
      this.expectEndOfLine("the `for` range");
      this.loopDepth++;
      const body = this.parseBlock("the `for` block", pos);
      this.loopDepth--;
      return { type: "for", varName, from, to, body, pos };
    }

    if (this.matchWord("repeat")) {
      const count = this.parseExpr();
      this.matchWord("times"); // optional sugar
      this.expectEndOfLine("the repeat count");
      this.loopDepth++;
      const body = this.parseBlock("the `repeat` block", pos);
      this.loopDepth--;
      return { type: "repeat", count, body, pos };
    }

    if (this.matchWord("break") || this.isWord("continue")) {
      const isContinue = this.isWord("continue");
      if (isContinue) this.advance();
      if (this.loopDepth === 0) {
        throw new RoboScriptError(
          `\`${isContinue ? "continue" : "break"}\` only works inside a loop`,
          pos,
          "put it inside a `loop`, `for` or `repeat` block",
        );
      }
      let cond: Expr | undefined;
      if (this.matchWord("if")) cond = this.parseExpr();
      this.expectEndOfLine(isContinue ? "`continue`" : "`break`");
      return isContinue ? { type: "continue", cond, pos } : { type: "break", cond, pos };
    }

    if (this.matchWord("wait")) {
      const ticks = this.parseExpr();
      this.matchWord("ticks") || this.matchWord("tick");
      this.expectEndOfLine("the wait");
      return { type: "wait", ticks, pos };
    }

    return this.parseAction(pos);
  }

  // ---- actions ----------------------------------------------------------

  private parseAction(pos: SourcePos): Stmt {
    const make = (action: ActionKind, args: Expr[]): Stmt => {
      this.expectEndOfLine("that instruction");
      return { type: "action", action, args, pos };
    };

    if (this.matchWord("stop")) return make("stop", []);

    if (this.matchWord("drive")) {
      let sign = 1;
      if (this.matchWord("forward")) sign = 1;
      else if (this.matchWord("back") || this.matchWord("backward")) sign = -1;
      const speed = this.parseExpr();
      const arg: Expr = sign === 1 ? speed : { type: "unary", op: "-", expr: speed, pos };
      return make("drive", [arg]);
    }

    if (this.matchWord("turn")) {
      // `turn chassis to|by X` — `body` was aliased to `chassis` in the lexer.
      this.matchWord("chassis");
      if (this.matchWord("to")) return make("turnBodyTo", [this.parseExpr()]);
      if (this.matchWord("by")) return make("turnBodyBy", [this.parseExpr()]);
      throw new RoboScriptError(
        "`turn` needs `to` (an exact heading) or `by` (an amount)",
        this.pos(),
        "try `turn body to 90` or `turn body by 45`",
      );
    }

    if (this.matchWord("fire")) {
      // Power is optional; a bare `fire` uses the default.
      const args =
        this.peek().kind === "newline" || this.peek().kind === "eof" ? [] : [this.parseExpr()];
      return make("fire", args);
    }

    if (this.matchWord("ping")) {
      // Power is optional, exactly as it is for `fire`. A bare `ping` is the
      // cheap one; a harder ping costs more fuel and sees over higher ground.
      const args =
        this.peek().kind === "newline" || this.peek().kind === "eof" ? [] : [this.parseExpr()];
      return make("ping", args);
    }

    if (this.matchWord("radar")) {
      if (!this.matchOp(".")) {
        throw new RoboScriptError(
          "`radar` needs a `.` and then what to do with it",
          this.pos(),
          "try `radar.aim at 0`, `radar.turn to 90` or `radar.sweep 45`",
        );
      }
      if (this.matchWord("turn")) {
        if (this.matchWord("to")) return make("radarTurnTo", [this.parseExpr()]);
        if (this.matchWord("by")) return make("radarTurnBy", [this.parseExpr()]);
        throw new RoboScriptError(
          "`radar.turn` needs `to` or `by`",
          this.pos(),
          "try `radar.turn to 90` or `radar.turn by 10`",
        );
      }
      if (this.matchWord("aim")) {
        this.matchWord("at"); // optional sugar
        return make("radarAim", [this.parseExpr()]);
      }
      if (this.matchWord("sweep")) return make("radarSweep", [this.parseExpr()]);
      if (this.matchWord("ping")) return make("ping", []);
      throw new RoboScriptError(
        `I don't know how to \`${this.describe(this.peek())}\` a radar`,
        this.pos(),
        "the radar can `turn`, `aim`, `sweep` or `ping`",
      );
    }

    if (this.matchWord("turret")) {
      if (!this.matchOp(".")) {
        throw new RoboScriptError(
          "`turret` needs a `.` and then what to do with it",
          this.pos(),
          "try `turret.aim at 0`, `turret.turn to 90` or `turret.sweep 45`",
        );
      }
      if (this.matchWord("turn")) {
        if (this.matchWord("to")) return make("turretTurnTo", [this.parseExpr()]);
        if (this.matchWord("by")) return make("turretTurnBy", [this.parseExpr()]);
        throw new RoboScriptError(
          "`turret.turn` needs `to` or `by`",
          this.pos(),
          "try `turret.turn to 90` or `turret.turn by 10`",
        );
      }
      if (this.matchWord("aim")) {
        this.matchWord("at"); // optional sugar
        return make("turretAim", [this.parseExpr()]);
      }
      if (this.matchWord("sweep")) return make("turretSweep", [this.parseExpr()]);
      if (this.matchWord("fire")) return make("fire", []);
      throw new RoboScriptError(
        `I don't know how to \`${this.describe(this.peek())}\` a turret`,
        this.pos(),
        "the turret can `turn`, `aim` or `sweep`",
      );
    }

    throw new RoboScriptError(
      `I don't know how to \`${this.describe(this.peek())}\``,
      this.pos(),
      "instructions start with words like `drive`, `turn`, `fire`, `set`, `if` or `wait`",
    );
  }

  // ---- expressions ------------------------------------------------------
  // Precedence, loosest first: or / and / not / comparison / +- / */mod / unary

  private parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.isWord("or")) {
      const pos = this.pos();
      this.advance();
      left = { type: "binary", op: "or", left, right: this.parseAnd(), pos };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.isWord("and")) {
      const pos = this.pos();
      this.advance();
      left = { type: "binary", op: "and", left, right: this.parseNot(), pos };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.isWord("not")) {
      const pos = this.pos();
      this.advance();
      return { type: "unary", op: "not", expr: this.parseNot(), pos };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    let left = this.parseAdditive();
    for (;;) {
      const t = this.peek();
      let op: "is" | "isnt" | "<" | ">" | "<=" | ">=" | undefined;
      if (t.kind === "word" && (t.text === "is" || t.text === "isnt")) {
        op = t.text;
      } else if (
        t.kind === "op" &&
        (t.text === "<" ||
          t.text === ">" ||
          t.text === "<=" ||
          t.text === ">=" ||
          t.text === "isnt")
      ) {
        op = t.text as "<" | ">" | "<=" | ">=" | "isnt";
      } else if (t.kind === "op" && t.text === "=") {
        // A lone `=` in a condition almost always means `is`.
        op = "is";
      }
      if (!op) return left;
      const pos = this.pos();
      this.advance();
      // `is not X` reads better than `isnt X`, so accept both.
      if (op === "is" && this.isWord("not")) {
        this.advance();
        op = "isnt";
      }
      left = { type: "binary", op, left, right: this.parseAdditive(), pos };
    }
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      if (t.kind === "op" && (t.text === "+" || t.text === "-")) {
        const pos = this.pos();
        this.advance();
        left = { type: "binary", op: t.text, left, right: this.parseMultiplicative(), pos };
      } else return left;
    }
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.kind === "op" && (t.text === "*" || t.text === "/")) {
        const pos = this.pos();
        this.advance();
        left = { type: "binary", op: t.text, left, right: this.parseUnary(), pos };
      } else if (t.kind === "word" && t.text === "mod") {
        const pos = this.pos();
        this.advance();
        left = { type: "binary", op: "mod", left, right: this.parseUnary(), pos };
      } else return left;
    }
  }

  private parseUnary(): Expr {
    if (this.isOp("-")) {
      const pos = this.pos();
      this.advance();
      return { type: "unary", op: "-", expr: this.parseUnary(), pos };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    const pos = this.pos();

    if (t.kind === "number") {
      this.advance();
      return { type: "num", value: t.value ?? 0, pos };
    }
    if (t.kind === "string") {
      this.advance();
      return { type: "str", value: t.text, pos };
    }
    if (this.matchOp("(")) {
      const inner = this.parseExpr();
      if (!this.matchOp(")")) {
        throw new RoboScriptError(
          "this bracket never closes",
          pos,
          "every `(` needs a matching `)`",
        );
      }
      return inner;
    }
    if (t.kind === "word") {
      if (t.text === "true" || t.text === "false") {
        this.advance();
        return { type: "bool", value: t.text === "true", pos };
      }
      if (t.text === "none") {
        this.advance();
        return { type: "none", pos };
      }
      if (t.text === "me" || t.text === "arena" || t.text === "event") {
        this.advance();
        if (!this.matchOp(".")) {
          throw new RoboScriptError(
            `\`${t.text}\` on its own isn't a value`,
            pos,
            `try \`${t.text}.${t.text === "event" ? "bearing" : t.text === "arena" ? "width" : "heading"}\``,
          );
        }
        const p = this.peek();
        if (p.kind !== "word") {
          throw new RoboScriptError(
            `\`${t.text}.\` needs the name of something to look at`,
            this.pos(),
          );
        }
        this.advance();
        return {
          type: "prop",
          obj: t.text as "me" | "arena" | "event",
          prop: canonicalizeProperty(p.text),
          pos,
        };
      }
      // Function call or plain variable.
      const lower = t.text.toLowerCase();
      // Anything followed by `(` is a call. Which calls exist is the
      // compiler's business, not the parser's — it keeps the list, and it can
      // say "I don't know a function called `wobble`" and name the ones that
      // do exist. Gating here on a second copy of that list meant an unknown
      // call fell through to being a variable, and the `(` after it became a
      // stray bracket: "I found `(` after the value, and I don't know what it
      // means". The good message was written and unreachable.
      if (this.isOp("(", 1)) {
        this.advance();
        this.advance();
        const args: Expr[] = [];
        if (!this.isOp(")")) {
          do {
            args.push(this.parseExpr());
          } while (this.matchOp(","));
        }
        if (!this.matchOp(")")) {
          throw new RoboScriptError(
            `\`${t.raw}(\` never closes`,
            pos,
            "every `(` needs a matching `)`",
          );
        }
        return { type: "call", name: lower, args, pos };
      }
      if (RESERVED.has(t.text)) {
        throw new RoboScriptError(`I didn't expect \`${t.raw}\` in the middle of a value`, pos);
      }
      this.advance();
      return { type: "var", name: t.raw, pos };
    }

    throw new RoboScriptError(
      `I expected a value here, but found \`${this.describe(t)}\``,
      pos,
      "values are numbers, text in quotes, variables, or things like `me.heading`",
    );
  }
}

/** `#f80` -> `#ff8800`. */
function expandColor(hex: string): string {
  if (hex.length === 4) {
    return "#" + hex[1]! + hex[1]! + hex[2]! + hex[2]! + hex[3]! + hex[3]!;
  }
  return hex;
}

export function parse(source: string): Program {
  return new Parser(tokenize(source)).parseProgram();
}
