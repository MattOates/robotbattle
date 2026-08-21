/**
 * From Chevrotain's concrete syntax tree to the AST the compiler wants.
 *
 * Chevrotain records what it matched — every token, every rule, in order. The
 * compiler wants something smaller and more opinionated: `drive back 40` is not
 * an action with a direction, it is `drive` with a negated argument, and
 * `me.heading` is a property reference rather than three tokens. This is where
 * one becomes the other.
 *
 * Every choice here is pinned by `tests/determinism/golden.test.ts`, which
 * hashes a whole match. Building a negation a shade differently, or folding
 * `100 - 20 - 5` to the right instead of the left, is not a test failure in the
 * ordinary sense — it is peers on different builds desyncing mid-battle. The
 * differential test in `tests/lang/chevrotain.test.ts` compiles both ways and
 * compares bytecode for exactly that reason.
 */

import type { CstNode, IToken } from "chevrotain";
import { parser } from "./grammar.js";
import { toTokens, type RoboToken } from "./tokens.js";
import { checkCounts, checkNotRepeated } from "./counts.js";
import { RoboScriptError, type SourcePos } from "./errors.js";
import { hintFor } from "./diagnostics.js";
import {
  EVENT_NAMES,
  type CountClause,
  type EventName,
  type Expr,
  type Param,
  type Program,
  type Routine,
  type Stmt,
  type Stmt_Var,
} from "./ast.js";

const Base = parser.getBaseCstVisitorConstructor();

const at = (t: IToken): SourcePos => ({ line: t.startLine ?? 0, col: t.startColumn ?? 0 });

type Children = Record<string, (CstNode | IToken)[] | undefined>;
const one = (c: Children, key: string): CstNode | IToken | undefined => c[key]?.[0];
const all = (c: Children, key: string): (CstNode | IToken)[] => c[key] ?? [];
const has = (c: Children, key: string): boolean => (c[key]?.length ?? 0) > 0;
const tok = (c: Children, key: string): IToken => one(c, key) as IToken;
const node = (c: Children, key: string): CstNode => one(c, key) as CstNode;

/** Every token in a rule's children, back in the order they were written. */
function ordered(c: Children, keys: string[]): IToken[] {
  return keys
    .flatMap((k) => all(c, k) as IToken[])
    .sort((a, b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));
}

class AstBuilder extends Base {
  constructor() {
    super();
    this.validateVisitor();
  }

  // --- program -------------------------------------------------------------

  program(c: Children): Program {
    const out: Program = {
      name: "",
      locomotion: "skid",
      color: "",
      globals: [],
      handlers: [],
      routines: [],
    };
    for (const top of all(c, "topLevel") as CstNode[]) this.visit(top, out);
    return out;
  }

  topLevel(c: Children, out: Program): void {
    if (has(c, "nameDecl")) out.name = this.visit(node(c, "nameDecl")) as string;
    else if (has(c, "chassisDecl")) out.locomotion = this.visit(node(c, "chassisDecl"));
    else if (has(c, "colorDecl")) out.color = this.visit(node(c, "colorDecl")) as string;
    else if (has(c, "varDecl")) out.globals.push(this.visit(node(c, "varDecl")) as Stmt_Var);
    else if (has(c, "handler")) out.handlers.push(this.visit(node(c, "handler")));
    else if (has(c, "routine")) out.routines.push(this.visit(node(c, "routine")) as Routine);
  }

  nameDecl(c: Children): string {
    return tok(c, "StrLit").image;
  }

  chassisDecl(c: Children): "skid" | "steered" {
    // The lexer canonicalises, so `ciliate` and `tank` both arrive as `skid`.
    return has(c, "Steered") ? "steered" : "skid";
  }

  colorDecl(c: Children): string {
    return tok(c, "ColorLit").image;
  }

  varDecl(c: Children): Stmt_Var {
    const name = tok(c, "Ident");
    return {
      type: "varDecl",
      name: name.image,
      expr: this.visit(node(c, "expr")) as Expr,
      pos: at(tok(c, "Var")),
    };
  }

  handler(c: Children) {
    const on = tok(c, "On");
    const event = this.visit(node(c, "eventName"), on) as EventName;
    return {
      event,
      body: this.visit(node(c, "block")) as Stmt[],
      counts: this.visit(node(c, "countClauses"), `on ${event}`) as CountClause[],
      pos: at(on),
    };
  }

  routine(c: Children): Routine {
    const can = tok(c, "Can");
    const events = all(c, "eventName") as CstNode[];
    const name = tok(c, "Ident").image;
    return {
      name,
      params: has(c, "params") ? (this.visit(node(c, "params")) as Param[]) : [],
      given: events.length > 0 ? (this.visit(events[0]!, can) as EventName) : null,
      counts: this.visit(node(c, "countClauses"), `can ${name}`) as CountClause[],
      body: this.visit(node(c, "block")) as Stmt[],
      pos: at(can),
    };
  }

  params(c: Children): Param[] {
    return (all(c, "param") as CstNode[]).map((p) => this.visit(p) as Param);
  }

  param(c: Children): Param {
    const name = one(c, "Ident") as IToken;
    return {
      name: name.image,
      default: has(c, "expr") ? (this.visit(node(c, "expr")) as Expr) : null,
      pos: at(name),
    };
  }

  countClauses(c: Children, what: string): CountClause[] {
    const words = ordered(c, ["Every", "After", "Before", "At"]);
    const values = all(c, "countValue") as CstNode[];
    const counts: CountClause[] = [];
    for (const [i, word] of words.entries()) {
      const kind = word.image as CountClause["kind"];
      const pos = at(word);
      // Asked before the number is read, so `every 2 every nope` complains
      // about the repetition it can see rather than the number it cannot.
      checkNotRepeated(counts, kind, pos, what);
      counts.push({ kind, value: this.visit(values[i]!, word) as number, pos });
    }
    return checkCounts(counts);
  }

  countValue(c: Children, word: IToken): number {
    if (!has(c, "NumLit")) {
      throw new RoboScriptError(
        `\`${word.image}\` needs a plain number after it`,
        at((one(c, "Ident") ?? one(c, "Me")) as IToken),
        `\`${word.image} 30\` counts how many times this has happened — it cannot be worked out as you go`,
      );
    }
    const num = tok(c, "NumLit");
    const value = (num as RoboToken).value ?? Number(num.image);
    if (!Number.isInteger(value) || value < 1) {
      throw new RoboScriptError(
        `\`${word.image} ${num.image}\` needs a whole number of times, 1 or more`,
        at(num),
        "counting starts at 1, on the first time the block is reached",
      );
    }
    return value;
  }

  eventName(c: Children, on: IToken): EventName {
    const words = (all(c, "eventWord") as CstNode[]).map((w) => this.visit(w) as string);
    const phrase = words.join(" ");
    if (!(EVENT_NAMES as readonly string[]).includes(phrase)) {
      throw new RoboScriptError(
        `\`${words[0] ?? ""}\` isn't an event I can tell you about`,
        at(on),
        `events are: ${EVENT_NAMES.join(", ")}`,
      );
    }
    return phrase as EventName;
  }

  eventWord(c: Children): string {
    for (const key of Object.keys(c)) {
      const t = c[key]?.[0] as IToken | undefined;
      if (t?.image) return t.image;
    }
    return "";
  }

  block(c: Children): Stmt[] {
    return (all(c, "statement") as CstNode[]).map((s) => this.visit(s) as Stmt);
  }

  // --- statements ----------------------------------------------------------

  statement(c: Children): Stmt {
    for (const key of [
      "varDecl", "setStmt", "ifStmt", "loopStmt", "forStmt", "repeatStmt",
      "breakStmt", "continueStmt", "waitStmt", "doStmt", "action",
    ]) {
      if (has(c, key)) return this.visit(node(c, key)) as Stmt;
    }
    throw new Error("a statement with nothing in it");
  }

  setStmt(c: Children): Stmt {
    const target = (one(c, "Ident") ?? one(c, "Name")) as IToken;
    return {
      type: "assign",
      name: target.image,
      expr: this.visit(node(c, "expr")) as Expr,
      pos: at(tok(c, "Set")),
    };
  }

  ifStmt(c: Children): Stmt {
    const blocks = all(c, "block") as CstNode[];
    const otherwise = has(c, "elseIf")
      ? [this.visit(node(c, "elseIf")) as Stmt]
      : blocks.length > 1
        ? (this.visit(blocks[1]!) as Stmt[])
        : [];
    return {
      type: "if",
      cond: this.visit(node(c, "expr")) as Expr,
      then: this.visit(blocks[0]!) as Stmt[],
      otherwise,
      pos: at(tok(c, "If")),
    };
  }

  elseIf(c: Children): Stmt {
    return this.visit(node(c, "ifStmt")) as Stmt;
  }

  loopStmt(c: Children): Stmt {
    return {
      type: "loop",
      body: this.visit(node(c, "block")) as Stmt[],
      pos: at(tok(c, "Loop")),
    };
  }

  forStmt(c: Children): Stmt {
    const exprs = all(c, "expr") as CstNode[];
    return {
      type: "for",
      varName: tok(c, "Ident").image,
      from: this.visit(exprs[0]!) as Expr,
      to: this.visit(exprs[1]!) as Expr,
      body: this.visit(node(c, "block")) as Stmt[],
      pos: at(tok(c, "For")),
    };
  }

  repeatStmt(c: Children): Stmt {
    return {
      type: "repeat",
      count: this.visit(node(c, "expr")) as Expr,
      body: this.visit(node(c, "block")) as Stmt[],
      pos: at(tok(c, "Repeat")),
    };
  }

  breakStmt(c: Children): Stmt {
    return {
      type: "break",
      cond: has(c, "expr") ? (this.visit(node(c, "expr")) as Expr) : undefined,
      pos: at(tok(c, "Break")),
    };
  }

  continueStmt(c: Children): Stmt {
    return {
      type: "continue",
      cond: has(c, "expr") ? (this.visit(node(c, "expr")) as Expr) : undefined,
      pos: at(tok(c, "Continue")),
    };
  }

  waitStmt(c: Children): Stmt {
    return {
      type: "wait",
      ticks: this.visit(node(c, "expr")) as Expr,
      pos: at(tok(c, "Wait")),
    };
  }

  doStmt(c: Children): Stmt {
    return {
      type: "do",
      name: tok(c, "Ident").image,
      args: (all(c, "expr") as CstNode[]).map((e) => this.visit(e) as Expr),
      pos: at(tok(c, "Do")),
    };
  }

  // --- actions -------------------------------------------------------------

  action(c: Children): Stmt {
    for (const key of ["driveStmt", "turnStmt", "turretStmt", "radarStmt", "fireStmt", "pingStmt"]) {
      if (has(c, key)) return this.visit(node(c, key)) as Stmt;
    }
    return { type: "action", action: "stop", args: [], pos: at(tok(c, "Stop")) };
  }

  /**
   * `drive back 40` is `drive` with a negated argument, not a direction flag.
   * The golden hash depends on the negation being built exactly here.
   */
  driveStmt(c: Children): Stmt {
    const pos = at(tok(c, "Drive"));
    const speed = this.visit(node(c, "expr")) as Expr;
    const backwards = has(c, "Back") || has(c, "Backward");
    return {
      type: "action",
      action: "drive",
      args: [backwards ? { type: "unary", op: "-", expr: speed, pos } : speed],
      pos,
    };
  }

  turnStmt(c: Children): Stmt {
    const pos = at(tok(c, "Turn"));
    const to = this.visit(node(c, "toOrBy")) as boolean;
    return {
      type: "action",
      action: to ? "turnBodyTo" : "turnBodyBy",
      args: [this.visit(node(c, "expr")) as Expr],
      pos,
    };
  }

  /** True for `to`, false for `by`. */
  toOrBy(c: Children): boolean {
    return has(c, "To");
  }

  turretStmt(c: Children): Stmt {
    return this.visit(node(c, "turretMember"), at(tok(c, "Turret"))) as Stmt;
  }

  turretMember(c: Children, pos: SourcePos): Stmt {
    const args = (all(c, "expr") as CstNode[]).map((e) => this.visit(e) as Expr);
    if (has(c, "Turn")) {
      const to = this.visit(node(c, "toOrBy")) as boolean;
      return { type: "action", action: to ? "turretTurnTo" : "turretTurnBy", args, pos };
    }
    if (has(c, "Aim")) return { type: "action", action: "turretAim", args, pos };
    if (has(c, "Sweep")) return { type: "action", action: "turretSweep", args, pos };
    return { type: "action", action: "fire", args, pos };
  }

  radarStmt(c: Children): Stmt {
    return this.visit(node(c, "radarMember"), at(tok(c, "Radar"))) as Stmt;
  }

  radarMember(c: Children, pos: SourcePos): Stmt {
    const args = (all(c, "expr") as CstNode[]).map((e) => this.visit(e) as Expr);
    if (has(c, "Turn")) {
      const to = this.visit(node(c, "toOrBy")) as boolean;
      return { type: "action", action: to ? "radarTurnTo" : "radarTurnBy", args, pos };
    }
    if (has(c, "Aim")) return { type: "action", action: "radarAim", args, pos };
    if (has(c, "Sweep")) return { type: "action", action: "radarSweep", args, pos };
    return { type: "action", action: "ping", args, pos };
  }

  fireStmt(c: Children): Stmt {
    return {
      type: "action",
      action: "fire",
      args: (all(c, "expr") as CstNode[]).map((e) => this.visit(e) as Expr),
      pos: at(tok(c, "Fire")),
    };
  }

  pingStmt(c: Children): Stmt {
    return {
      type: "action",
      action: "ping",
      args: (all(c, "expr") as CstNode[]).map((e) => this.visit(e) as Expr),
      pos: at(tok(c, "Ping")),
    };
  }

  // --- expressions ---------------------------------------------------------

  expr(c: Children): Expr {
    return this.visit(node(c, "orExpr")) as Expr;
  }

  orExpr(c: Children): Expr {
    return this.fold(c, "andExpr", ordered(c, ["Or"]));
  }

  andExpr(c: Children): Expr {
    return this.fold(c, "notExpr", ordered(c, ["And"]));
  }

  notExpr(c: Children): Expr {
    if (has(c, "Not")) {
      const not = tok(c, "Not");
      return { type: "unary", op: "not", expr: this.visit(node(c, "notExpr")) as Expr, pos: at(not) };
    }
    return this.visit(node(c, "compareExpr")) as Expr;
  }

  compareExpr(c: Children): Expr {
    const sides = all(c, "addExpr") as CstNode[];
    const left = this.visit(sides[0]!) as Expr;
    if (sides.length === 1) return left;
    const { op, pos } = this.visit(node(c, "compareOp")) as { op: string; pos: SourcePos };
    return { type: "binary", op: op as never, left, right: this.visit(sides[1]!) as Expr, pos };
  }

  /**
   * `is not` folds to `isnt`, and a lone `=` reads as `is`.
   *
   * Both are things people write and mean, and both are older than this parser
   * — the spellings come straight across so nothing that compiled before stops
   * compiling now.
   */
  compareOp(c: Children): { op: string; pos: SourcePos } {
    if (has(c, "Is")) {
      const is = tok(c, "Is");
      return { op: has(c, "Not") ? "isnt" : "is", pos: at(is) };
    }
    if (has(c, "Isnt")) return { op: "isnt", pos: at(tok(c, "Isnt")) };
    for (const [key, op] of [
      ["Eq", "is"], ["EqEq", "is"], ["Ne", "isnt"], ["NeBang", "isnt"],
      ["Le", "<="], ["Ge", ">="], ["Lt", "<"], ["Gt", ">"],
    ] as const) {
      if (has(c, key)) return { op, pos: at(tok(c, key)) };
    }
    throw new Error("a comparison with no operator");
  }

  addExpr(c: Children): Expr {
    return this.fold(c, "mulExpr", ordered(c, ["Plus", "Minus"]));
  }

  mulExpr(c: Children): Expr {
    return this.fold(c, "unaryExpr", ordered(c, ["Star", "Slash", "Mod"]));
  }

  unaryExpr(c: Children): Expr {
    if (has(c, "Minus")) {
      const minus = tok(c, "Minus");
      return {
        type: "unary",
        op: "-",
        expr: this.visit(node(c, "unaryExpr")) as Expr,
        pos: at(minus),
      };
    }
    return this.visit(node(c, "primary")) as Expr;
  }

  /** Left-associative, so `100 - 20 - 5` is `(100 - 20) - 5`. */
  private fold(c: Children, operand: string, ops: IToken[]): Expr {
    const parts = all(c, operand) as CstNode[];
    let left = this.visit(parts[0]!) as Expr;
    for (let i = 0; i < ops.length; i++) {
      left = {
        type: "binary",
        op: ops[i]!.image as never,
        left,
        right: this.visit(parts[i + 1]!) as Expr,
        pos: at(ops[i]!),
      };
    }
    return left;
  }

  primary(c: Children): Expr {
    if (has(c, "NumLit")) {
      const t = tok(c, "NumLit");
      return { type: "num", value: (t as RoboToken).value ?? Number(t.image), pos: at(t) };
    }
    if (has(c, "StrLit")) {
      const t = tok(c, "StrLit");
      return { type: "str", value: t.image, pos: at(t) };
    }
    if (has(c, "ColorLit")) {
      const t = tok(c, "ColorLit");
      return { type: "str", value: t.image, pos: at(t) };
    }
    if (has(c, "True")) return { type: "bool", value: true, pos: at(tok(c, "True")) };
    if (has(c, "False")) return { type: "bool", value: false, pos: at(tok(c, "False")) };
    if (has(c, "None")) return { type: "none", pos: at(tok(c, "None")) };
    if (has(c, "propRef")) return this.visit(node(c, "propRef")) as Expr;
    if (has(c, "callOrVar")) return this.visit(node(c, "callOrVar")) as Expr;
    return this.visit(node(c, "expr")) as Expr;
  }

  propRef(c: Children): Expr {
    const obj = (one(c, "Me") ?? one(c, "Arena") ?? one(c, "Event")) as IToken;
    return {
      type: "prop",
      obj: obj.image as "me" | "arena" | "event",
      prop: this.visit(node(c, "propName")) as string,
      pos: at(obj),
    };
  }

  propName(c: Children): string {
    for (const key of ["Ident", "Turret", "Radar", "Name"]) {
      if (has(c, key)) return tok(c, key).image;
    }
    return "";
  }

  callOrVar(c: Children): Expr {
    const name = tok(c, "Ident");
    if (!has(c, "LParen")) return { type: "var", name: name.image, pos: at(name) };
    return {
      type: "call",
      name: name.image,
      args: (all(c, "expr") as CstNode[]).map((e) => this.visit(e) as Expr),
      pos: at(name),
    };
  }
}

const builder = new AstBuilder();

/**
 * Source in, AST out — the same contract `parser.ts` has always had.
 *
 * Errors arrive as `RoboScriptError` with the message and hint the language has
 * always given, so everything downstream is unchanged.
 */
export function parseWithChevrotain(source: string): Program {
  parser.input = toTokens(source);
  const cst = parser.program();
  const failure = parser.errors[0];
  if (failure) {
    const token = failure.token as RoboToken | undefined;
    throw new RoboScriptError(
      failure.message,
      { line: token?.startLine ?? 0, col: token?.startColumn ?? 0 },
      hintFor(failure),
    );
  }
  return builder.visit(cst) as Program;
}
