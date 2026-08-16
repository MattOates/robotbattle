/**
 * RoboScript AST.
 *
 * Everything here is already canonical — themed synonyms were resolved in the
 * lexer, so a mechanical and a biological script reach this stage identical.
 */

import type { SourcePos } from "./errors.js";

/** Canonical event names. The parser matches phrases against this list. */
export const EVENT_NAMES = [
  "start",
  "tick",
  "sense robot",
  "sense bullet",
  "sense wall",
  // Returns from the narrow beam. Kept as their own events rather than as a
  // field on `sense`, because which instrument found something is the whole
  // point: the cone sees anything nearby, the beam sees only where it is
  // pointed, and a script almost always wants to react differently.
  "ping robot",
  "ping wall",
  "hit wall",
  "hit robot",
  "hit by bullet",
  "bullet hit",
  "bullet missed",
  "robot destroyed",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** Canonical locomotion classes. `tank`/`ciliate` -> skid, `car`/`flagellate` -> steered. */
export type Locomotion = "skid" | "steered";

/** Actions a script can take. These set actuator goals; none of them block. */
export type ActionKind =
  | "drive" // [speed -100..100], negative is reverse
  | "stop"
  | "turnBodyTo" // [absolute heading]
  | "turnBodyBy" // [relative degrees]
  | "turretTurnTo" // [absolute heading]
  | "turretTurnBy" // [relative degrees]
  | "turretAim" // [bearing relative to chassis heading]
  | "turretSweep" // [degrees to sweep back and forth]
  | "fire" // [power 1..3]
  | "radarTurnTo" // [absolute heading]
  | "radarTurnBy" // [relative degrees]
  | "radarAim" // [bearing relative to chassis heading]
  | "radarSweep" // [degrees to sweep back and forth]
  | "ping"; // [] — sends the beam where the radar points

export interface Expr_Num {
  type: "num";
  value: number;
  pos: SourcePos;
}
export interface Expr_Str {
  type: "str";
  value: string;
  pos: SourcePos;
}
export interface Expr_Bool {
  type: "bool";
  value: boolean;
  pos: SourcePos;
}
export interface Expr_None {
  type: "none";
  pos: SourcePos;
}
export interface Expr_Var {
  type: "var";
  name: string;
  pos: SourcePos;
}
export interface Expr_Prop {
  type: "prop";
  obj: "me" | "arena" | "event";
  prop: string;
  pos: SourcePos;
}
export interface Expr_Unary {
  type: "unary";
  op: "-" | "not";
  expr: Expr;
  pos: SourcePos;
}
export interface Expr_Binary {
  type: "binary";
  op: "+" | "-" | "*" | "/" | "mod" | "is" | "isnt" | "<" | ">" | "<=" | ">=" | "and" | "or";
  left: Expr;
  right: Expr;
  pos: SourcePos;
}
export interface Expr_Call {
  type: "call";
  name: string;
  args: Expr[];
  pos: SourcePos;
}

export type Expr =
  | Expr_Num
  | Expr_Str
  | Expr_Bool
  | Expr_None
  | Expr_Var
  | Expr_Prop
  | Expr_Unary
  | Expr_Binary
  | Expr_Call;

export interface Stmt_Var {
  type: "varDecl";
  name: string;
  expr: Expr;
  pos: SourcePos;
}
export interface Stmt_Assign {
  type: "assign";
  name: string;
  expr: Expr;
  pos: SourcePos;
}
export interface Stmt_If {
  type: "if";
  cond: Expr;
  then: Stmt[];
  otherwise: Stmt[];
  pos: SourcePos;
}
export interface Stmt_Loop {
  type: "loop";
  body: Stmt[];
  pos: SourcePos;
}
export interface Stmt_For {
  type: "for";
  varName: string;
  from: Expr;
  to: Expr;
  body: Stmt[];
  pos: SourcePos;
}
export interface Stmt_Repeat {
  type: "repeat";
  count: Expr;
  body: Stmt[];
  pos: SourcePos;
}
export interface Stmt_Break {
  type: "break";
  cond: Expr | undefined;
  pos: SourcePos;
}
export interface Stmt_Continue {
  type: "continue";
  cond: Expr | undefined;
  pos: SourcePos;
}
export interface Stmt_Wait {
  type: "wait";
  ticks: Expr;
  pos: SourcePos;
}
/**
 * `do chase with 3` — run a named routine here.
 *
 * The compiler expands the routine's body in place, so this node never reaches
 * the VM: there is no call instruction and no return address anywhere in the
 * machine.
 */
export interface Stmt_Do {
  type: "do";
  name: string;
  args: Expr[];
  pos: SourcePos;
}

export interface Stmt_Action {
  type: "action";
  action: ActionKind;
  args: Expr[];
  pos: SourcePos;
}

export type Stmt =
  | Stmt_Var
  | Stmt_Assign
  | Stmt_If
  | Stmt_Loop
  | Stmt_For
  | Stmt_Repeat
  | Stmt_Break
  | Stmt_Continue
  | Stmt_Wait
  | Stmt_Do
  | Stmt_Action;

/**
 * `every 30`, `after 90`, `before 900`, `at 2` — how often a block runs.
 *
 * A tick is not a unit of time anybody thinks in, and almost nobody wanting a
 * `tick` handler wants one *every* tick: they want a sweep twice a second, or
 * something that happens the second time they hit a wall. Written by hand that
 * is a counter variable, an increment, and a `mod` test whose polarity is easy
 * to get backwards — so the count is worth saying in the header, where it reads
 * as what it is.
 *
 * Each clause is a filter on the same count of how many times the block has
 * been reached, so they simply combine: `every 30 after 90` is both tests, and
 * nothing new has to be learned to put them together. `at` is on its own,
 * because pinning the count exactly leaves the others nothing to say.
 */
export interface CountClause {
  kind: "every" | "after" | "before" | "at";
  /** Always a plain number: a cadence that changes as you run is nobody's friend. */
  value: number;
  pos: SourcePos;
}

export interface Handler {
  event: EventName;
  body: Stmt[];
  counts: CountClause[];
  pos: SourcePos;
}

/** One parameter of a routine. A default makes it optional at the call site. */
export interface Param {
  name: string;
  default: Expr | null;
  pos: SourcePos;
}

/**
 * `can chase with power=2 given sense robot` — a named block of behaviour.
 *
 * `given` is the routine's contract. It says which event the body may read
 * through `event.*`, and therefore where the routine may be used — which is
 * what lets one be pasted into somebody else's robot and still make sense.
 * With no `on` block for that event, routines like this one *become* the
 * handler, in source order.
 */
export interface Routine {
  name: string;
  params: Param[];
  given: EventName | null;
  counts: CountClause[];
  body: Stmt[];
  pos: SourcePos;
}

export interface Program {
  /** Declared display name; may be overwritten at runtime via `set name = ...`. */
  name: string;
  locomotion: Locomotion;
  color: string;
  /** Top-level `var` declarations, initialised once before `on start`. */
  globals: Stmt_Var[];
  handlers: Handler[];
  routines: Routine[];
}
