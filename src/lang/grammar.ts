/**
 * The RoboScript grammar.
 *
 * One definition, read by four things that used to keep their own copies: this
 * parser, the completion popup, the editor's highlighter, and the reference
 * page. `parser.getGAstProductions()` hands the whole grammar back as data, so
 * none of them has to be told twice what the language is.
 *
 * Rules are ordinary functions, which is why this works for a language whose
 * grammar is lumpy. `for` is a name, an `=`, an expression, a mandatory `to`,
 * another expression and a block; no declarative table expresses that without
 * growing a combinator language, and a PEG only expresses it by giving up on
 * error messages. Here it is written the same way it was written by hand.
 *
 * Errors live in `diagnostics.ts` and arrive through Chevrotain's own
 * `IParserErrorMessageProvider`, keyed by the rule that failed.
 */

import { CstParser } from "chevrotain";
import { ALL_TOKENS, ColorLit, Ident, kw, Newline, NumLit, op, StrLit } from "./tokens.js";
import { errorMessageProvider } from "./diagnostics.js";

class RoboScriptParser extends CstParser {
  constructor() {
    super(ALL_TOKENS, {
      errorMessageProvider,
      // Recovery invents nodes to keep going. A robot that half-compiles is
      // worse than one that does not: the player would be told it was fine.
      recoveryEnabled: false,
      // `hit by bullet` and `robot destroyed` are three and two words, and a
      // statement has to be told apart from the `end` that closes its block.
      maxLookahead: 4,
    });
    this.performSelfAnalysis();
  }

  // --- the shape of a program ---------------------------------------------

  program = this.RULE("program", () => {
    this.MANY(() => this.CONSUME(Newline));
    this.MANY1(() => {
      this.SUBRULE(this.topLevel);
      this.MANY2(() => this.CONSUME1(Newline));
    });
  });

  topLevel = this.RULE("topLevel", () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.nameDecl) },
      { ALT: () => this.SUBRULE(this.chassisDecl) },
      { ALT: () => this.SUBRULE(this.colorDecl) },
      { ALT: () => this.SUBRULE(this.varDecl) },
      { ALT: () => this.SUBRULE(this.handler) },
      { ALT: () => this.SUBRULE(this.routine) },
    ]);
  });

  nameDecl = this.RULE("nameDecl", () => {
    this.CONSUME(kw("name"));
    this.CONSUME(StrLit);
  });

  chassisDecl = this.RULE("chassisDecl", () => {
    this.CONSUME(kw("chassis"));
    this.OR([{ ALT: () => this.CONSUME(kw("skid")) }, { ALT: () => this.CONSUME(kw("steered")) }]);
  });

  colorDecl = this.RULE("colorDecl", () => {
    this.CONSUME(kw("color"));
    this.CONSUME(ColorLit);
  });

  varDecl = this.RULE("varDecl", () => {
    this.CONSUME(kw("var"));
    this.CONSUME(Ident);
    this.CONSUME(op("="));
    this.SUBRULE(this.expr);
  });

  handler = this.RULE("handler", () => {
    this.CONSUME(kw("on"));
    this.SUBRULE(this.eventName);
    this.SUBRULE(this.countClauses);
    this.AT_LEAST_ONE(() => this.CONSUME(Newline));
    this.SUBRULE(this.block);
    this.CONSUME(kw("end"));
  });

  routine = this.RULE("routine", () => {
    this.CONSUME(kw("can"));
    this.CONSUME(Ident);
    this.OPTION(() => {
      this.CONSUME(kw("with"));
      this.SUBRULE(this.params);
    });
    this.OPTION1(() => {
      this.CONSUME(kw("given"));
      this.SUBRULE(this.eventName);
    });
    this.SUBRULE(this.countClauses);
    this.AT_LEAST_ONE(() => this.CONSUME(Newline));
    this.SUBRULE(this.block);
    this.CONSUME(kw("end"));
  });

  params = this.RULE("params", () => {
    this.AT_LEAST_ONE_SEP({ SEP: op(","), DEF: () => this.SUBRULE(this.param) });
  });

  /**
   * One parameter is its own rule so that its default stays attached to it.
   * Flattened into `params`, `with a, b = 1` and `with a = 1, b` produce the
   * same three children in the same order, and only their positions tell them
   * apart — a distinction the CST is under no obligation to preserve.
   */
  param = this.RULE("param", () => {
    this.CONSUME(Ident);
    this.OPTION(() => {
      this.CONSUME(op("="));
      this.SUBRULE(this.expr);
    });
  });

  /**
   * How often a block runs, said on the `on` or `can` line.
   *
   * The unusual thing about this language: scheduling belongs to the handler,
   * not to control flow. Whether the combination makes sense — `at` is
   * exclusive, `after` must leave room before `before` — is checked after
   * parsing, where the numbers are known and the error can name them.
   */
  countClauses = this.RULE("countClauses", () => {
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(kw("every")) },
        { ALT: () => this.CONSUME(kw("after")) },
        { ALT: () => this.CONSUME(kw("before")) },
        { ALT: () => this.CONSUME(kw("at")) },
      ]);
      this.SUBRULE(this.countValue);
    });
  });

  /** Deliberately anything, so "needs a plain number" is our error to give. */
  countValue = this.RULE("countValue", () => {
    this.OR([
      { ALT: () => this.CONSUME(NumLit) },
      { ALT: () => this.CONSUME(Ident) },
      { ALT: () => this.CONSUME(kw("me")) },
    ]);
  });

  /**
   * An event is one to three words, matched loosely and checked afterwards.
   *
   * `fuel`, `slope` and `ridge` are not reserved — `var fuel = 0` is legal —
   * so they arrive as ordinary names. Matching the phrase by its words and
   * validating against `EVENT_NAMES` afterwards is what the hand-written
   * parser does, and it is what keeps "`wobble` isn't an event I can tell you
   * about" as the error rather than a shrug about token types.
   */
  eventName = this.RULE("eventName", () => {
    this.AT_LEAST_ONE(() => this.SUBRULE(this.eventWord));
  });

  eventWord = this.RULE("eventWord", () => {
    this.OR([
      { ALT: () => this.CONSUME(kw("start")) },
      { ALT: () => this.CONSUME(kw("tick")) },
      { ALT: () => this.CONSUME(kw("sense")) },
      { ALT: () => this.CONSUME(kw("ping")) },
      { ALT: () => this.CONSUME(kw("hit")) },
      { ALT: () => this.CONSUME(kw("by")) },
      { ALT: () => this.CONSUME(kw("bullet")) },
      { ALT: () => this.CONSUME(kw("robot")) },
      { ALT: () => this.CONSUME(kw("wall")) },
      { ALT: () => this.CONSUME(kw("missed")) },
      { ALT: () => this.CONSUME(kw("destroyed")) },
      { ALT: () => this.CONSUME(Ident) },
    ]);
  });

  block = this.RULE("block", () => {
    this.MANY(() => {
      this.SUBRULE(this.statement);
      this.AT_LEAST_ONE(() => this.CONSUME(Newline));
    });
  });

  // --- statements ----------------------------------------------------------

  statement = this.RULE("statement", () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.varDecl) },
      { ALT: () => this.SUBRULE(this.setStmt) },
      { ALT: () => this.SUBRULE(this.ifStmt) },
      { ALT: () => this.SUBRULE(this.loopStmt) },
      { ALT: () => this.SUBRULE(this.forStmt) },
      { ALT: () => this.SUBRULE(this.repeatStmt) },
      { ALT: () => this.SUBRULE(this.breakStmt) },
      { ALT: () => this.SUBRULE(this.continueStmt) },
      { ALT: () => this.SUBRULE(this.waitStmt) },
      { ALT: () => this.SUBRULE(this.doStmt) },
      { ALT: () => this.SUBRULE(this.action) },
    ]);
  });

  setStmt = this.RULE("setStmt", () => {
    this.CONSUME(kw("set"));
    // `set name = "..."` changes the label mid-match, so the target is either a
    // variable or that one keyword.
    this.OR([{ ALT: () => this.CONSUME(Ident) }, { ALT: () => this.CONSUME(kw("name")) }]);
    this.CONSUME(op("="));
    this.SUBRULE(this.expr);
  });

  ifStmt = this.RULE("ifStmt", () => {
    this.CONSUME(kw("if"));
    this.SUBRULE(this.expr);
    this.OPTION(() => this.CONSUME(kw("then")));
    this.AT_LEAST_ONE(() => this.CONSUME(Newline));
    this.SUBRULE(this.block);
    this.OPTION1(() => {
      this.CONSUME(kw("else"));
      this.OR([
        // `else if` chains by nesting, and the nested `if` eats the shared
        // `end` — which is why this alternative does not consume one.
        { ALT: () => this.SUBRULE(this.elseIf) },
        {
          ALT: () => {
            this.AT_LEAST_ONE1(() => this.CONSUME1(Newline));
            this.SUBRULE1(this.block);
          },
        },
      ]);
    });
    this.OPTION2(() => this.CONSUME(kw("end")));
  });

  elseIf = this.RULE("elseIf", () => {
    this.SUBRULE(this.ifStmt);
  });

  loopStmt = this.RULE("loopStmt", () => {
    this.CONSUME(kw("loop"));
    this.AT_LEAST_ONE(() => this.CONSUME(Newline));
    this.SUBRULE(this.block);
    this.CONSUME(kw("end"));
  });

  forStmt = this.RULE("forStmt", () => {
    this.CONSUME(kw("for"));
    this.CONSUME(Ident);
    this.CONSUME(op("="));
    this.SUBRULE(this.expr);
    this.CONSUME(kw("to"));
    this.SUBRULE1(this.expr);
    this.AT_LEAST_ONE(() => this.CONSUME(Newline));
    this.SUBRULE(this.block);
    this.CONSUME(kw("end"));
  });

  repeatStmt = this.RULE("repeatStmt", () => {
    this.CONSUME(kw("repeat"));
    this.SUBRULE(this.expr);
    this.OPTION(() => this.CONSUME(kw("times")));
    this.AT_LEAST_ONE(() => this.CONSUME(Newline));
    this.SUBRULE(this.block);
    this.CONSUME(kw("end"));
  });

  breakStmt = this.RULE("breakStmt", () => {
    this.CONSUME(kw("break"));
    this.OPTION(() => {
      this.CONSUME(kw("if"));
      this.SUBRULE(this.expr);
    });
  });

  continueStmt = this.RULE("continueStmt", () => {
    this.CONSUME(kw("continue"));
    this.OPTION(() => {
      this.CONSUME(kw("if"));
      this.SUBRULE(this.expr);
    });
  });

  waitStmt = this.RULE("waitStmt", () => {
    this.CONSUME(kw("wait"));
    this.SUBRULE(this.expr);
    this.OPTION(() =>
      this.OR([{ ALT: () => this.CONSUME(kw("ticks")) }, { ALT: () => this.CONSUME(kw("tick")) }]),
    );
  });

  doStmt = this.RULE("doStmt", () => {
    this.CONSUME(kw("do"));
    this.CONSUME(Ident);
    this.OPTION(() => {
      this.CONSUME(kw("with"));
      this.AT_LEAST_ONE_SEP({ SEP: op(","), DEF: () => this.SUBRULE(this.expr) });
    });
  });

  // --- actions -------------------------------------------------------------

  action = this.RULE("action", () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.driveStmt) },
      { ALT: () => this.CONSUME(kw("stop")) },
      { ALT: () => this.SUBRULE(this.turnStmt) },
      { ALT: () => this.SUBRULE(this.turretStmt) },
      { ALT: () => this.SUBRULE(this.radarStmt) },
      { ALT: () => this.SUBRULE(this.fireStmt) },
      { ALT: () => this.SUBRULE(this.pingStmt) },
    ]);
  });

  driveStmt = this.RULE("driveStmt", () => {
    this.CONSUME(kw("drive"));
    this.OPTION(() =>
      this.OR([
        { ALT: () => this.CONSUME(kw("forward")) },
        { ALT: () => this.CONSUME(kw("back")) },
        { ALT: () => this.CONSUME(kw("backward")) },
      ]),
    );
    this.SUBRULE(this.expr);
  });

  turnStmt = this.RULE("turnStmt", () => {
    this.CONSUME(kw("turn"));
    this.OPTION(() => this.CONSUME(kw("chassis")));
    this.SUBRULE(this.toOrBy);
    this.SUBRULE(this.expr);
  });

  toOrBy = this.RULE("toOrBy", () => {
    this.OR([{ ALT: () => this.CONSUME(kw("to")) }, { ALT: () => this.CONSUME(kw("by")) }]);
  });

  turretStmt = this.RULE("turretStmt", () => {
    this.CONSUME(kw("turret"));
    this.CONSUME(op("."));
    this.SUBRULE(this.turretMember);
  });

  turretMember = this.RULE("turretMember", () => {
    this.OR([
      {
        ALT: () => {
          this.CONSUME(kw("turn"));
          this.SUBRULE(this.toOrBy);
          this.SUBRULE(this.expr);
        },
      },
      {
        ALT: () => {
          this.CONSUME(kw("aim"));
          this.OPTION(() => this.CONSUME(kw("at")));
          this.SUBRULE1(this.expr);
        },
      },
      {
        ALT: () => {
          this.CONSUME(kw("sweep"));
          this.SUBRULE2(this.expr);
        },
      },
      // `turret.fire` takes nothing. Power belongs to the bare `fire`, and
      // accepting it here would quietly allow a line the language rejects.
      { ALT: () => this.CONSUME(kw("fire")) },
    ]);
  });

  radarStmt = this.RULE("radarStmt", () => {
    this.CONSUME(kw("radar"));
    this.CONSUME(op("."));
    this.SUBRULE(this.radarMember);
  });

  radarMember = this.RULE("radarMember", () => {
    this.OR([
      {
        ALT: () => {
          this.CONSUME(kw("turn"));
          this.SUBRULE(this.toOrBy);
          this.SUBRULE(this.expr);
        },
      },
      {
        ALT: () => {
          this.CONSUME(kw("aim"));
          this.OPTION(() => this.CONSUME(kw("at")));
          this.SUBRULE1(this.expr);
        },
      },
      {
        ALT: () => {
          this.CONSUME(kw("sweep"));
          this.SUBRULE2(this.expr);
        },
      },
      {
        ALT: () => {
          this.CONSUME(kw("ping"));
          this.OPTION1(() => this.SUBRULE3(this.expr));
        },
      },
    ]);
  });

  fireStmt = this.RULE("fireStmt", () => {
    this.CONSUME(kw("fire"));
    this.OPTION(() => this.SUBRULE(this.expr));
  });

  pingStmt = this.RULE("pingStmt", () => {
    this.CONSUME(kw("ping"));
    this.OPTION(() => this.SUBRULE(this.expr));
  });

  // --- expressions ---------------------------------------------------------
  //
  // Loosest first. Each level consumes the one below it, so the nesting of
  // these rules IS the precedence — and `getGAstProductions()` hands that back
  // as data, which is what lets the reference page print a precedence table
  // nobody has to keep in step by hand.

  expr = this.RULE("expr", () => this.SUBRULE(this.orExpr));

  orExpr = this.RULE("orExpr", () => {
    this.SUBRULE(this.andExpr);
    this.MANY(() => {
      this.CONSUME(kw("or"));
      this.SUBRULE1(this.andExpr);
    });
  });

  andExpr = this.RULE("andExpr", () => {
    this.SUBRULE(this.notExpr);
    this.MANY(() => {
      this.CONSUME(kw("and"));
      this.SUBRULE1(this.notExpr);
    });
  });

  notExpr = this.RULE("notExpr", () => {
    this.OR([
      {
        ALT: () => {
          this.CONSUME(kw("not"));
          this.SUBRULE(this.notExpr);
        },
      },
      { ALT: () => this.SUBRULE(this.compareExpr) },
    ]);
  });

  compareExpr = this.RULE("compareExpr", () => {
    this.SUBRULE(this.addExpr);
    this.OPTION(() => {
      this.SUBRULE(this.compareOp);
      this.SUBRULE1(this.addExpr);
    });
  });

  compareOp = this.RULE("compareOp", () => {
    this.OR([
      // `is not` folds to `isnt`, and a lone `=` in a condition is read as
      // `is` — both are things people write and mean.
      {
        ALT: () => {
          this.CONSUME(kw("is"));
          this.OPTION(() => this.CONSUME(kw("not")));
        },
      },
      { ALT: () => this.CONSUME(kw("isnt")) },
      { ALT: () => this.CONSUME(op("=")) },
      { ALT: () => this.CONSUME(op("==")) },
      { ALT: () => this.CONSUME(op("<>")) },
      { ALT: () => this.CONSUME(op("!=")) },
      { ALT: () => this.CONSUME(op("<=")) },
      { ALT: () => this.CONSUME(op(">=")) },
      { ALT: () => this.CONSUME(op("<")) },
      { ALT: () => this.CONSUME(op(">")) },
    ]);
  });

  addExpr = this.RULE("addExpr", () => {
    this.SUBRULE(this.mulExpr);
    this.MANY(() => {
      this.OR([{ ALT: () => this.CONSUME(op("+")) }, { ALT: () => this.CONSUME(op("-")) }]);
      this.SUBRULE1(this.mulExpr);
    });
  });

  mulExpr = this.RULE("mulExpr", () => {
    this.SUBRULE(this.unaryExpr);
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(op("*")) },
        { ALT: () => this.CONSUME(op("/")) },
        { ALT: () => this.CONSUME(kw("mod")) },
      ]);
      this.SUBRULE1(this.unaryExpr);
    });
  });

  unaryExpr = this.RULE("unaryExpr", () => {
    this.OR([
      {
        ALT: () => {
          this.CONSUME(op("-"));
          this.SUBRULE(this.unaryExpr);
        },
      },
      { ALT: () => this.SUBRULE(this.primary) },
    ]);
  });

  primary = this.RULE("primary", () => {
    this.OR([
      { ALT: () => this.CONSUME(NumLit) },
      { ALT: () => this.CONSUME(StrLit) },
      { ALT: () => this.CONSUME(ColorLit) },
      { ALT: () => this.CONSUME(kw("true")) },
      { ALT: () => this.CONSUME(kw("false")) },
      { ALT: () => this.CONSUME(kw("none")) },
      {
        ALT: () => {
          this.CONSUME(op("("));
          this.SUBRULE(this.expr);
          this.CONSUME(op(")"));
        },
      },
      { ALT: () => this.SUBRULE(this.propRef) },
      { ALT: () => this.SUBRULE(this.callOrVar) },
    ]);
  });

  /** `me.heading`, `arena.width`, `event.bearing`. */
  propRef = this.RULE("propRef", () => {
    this.OR([
      { ALT: () => this.CONSUME(kw("me")) },
      { ALT: () => this.CONSUME(kw("arena")) },
      { ALT: () => this.CONSUME(kw("event")) },
    ]);
    this.CONSUME(op("."));
    this.SUBRULE(this.propName);
  });

  /**
   * A property name can be a reserved word — `me.turret`, `me.fuel` — so this
   * accepts the handful that collide as well as ordinary names.
   */
  propName = this.RULE("propName", () => {
    this.OR([
      { ALT: () => this.CONSUME(Ident) },
      { ALT: () => this.CONSUME(kw("turret")) },
      { ALT: () => this.CONSUME(kw("radar")) },
      { ALT: () => this.CONSUME(kw("name")) },
    ]);
  });

  /**
   * Anything followed by `(` is a call. Which calls exist is the compiler's
   * business — it keeps the list and can name the ones that do, which is how
   * `wobble(1)` gets a sentence about functions instead of one about brackets.
   */
  callOrVar = this.RULE("callOrVar", () => {
    this.CONSUME(Ident);
    this.OPTION(() => {
      this.CONSUME(op("("));
      this.OPTION1(() => this.AT_LEAST_ONE_SEP({ SEP: op(","), DEF: () => this.SUBRULE(this.expr) }));
      this.CONSUME(op(")"));
    });
  });
}

export const parser = new RoboScriptParser();
