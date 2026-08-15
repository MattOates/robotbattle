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
  | "fire"; // [power 1..3]

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
  | Stmt_Action;

export interface Handler {
  event: EventName;
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
}
