/**
 * The adapter between our lexer and Chevrotain's token stream.
 *
 * The reason the parser can move without the lexer moving with it: everything
 * hard about reading RoboScript — themed synonyms, significant newlines, the
 * original spelling kept for error messages — is already solved here, and this
 * only changes the shape of the answer.
 */

import { describe, expect, it } from "vitest";
import { toTokens, kw, op, Ident, NumLit, Newline } from "../../src/lang/tokens.js";

const names = (src: string): string[] => toTokens(src).map((t) => t.tokenType.name);

describe("recognising words", () => {
  it("gives a reserved word its own type", () => {
    // The lexer closes every source with a newline, so the last statement ends
    // the same way every other one does and the grammar needs no special case.
    expect(names("drive forward 80")).toEqual(["Drive", "Forward", "NumLit", "Newline"]);
  });

  it("treats anything else as a name", () => {
    expect(toTokens("target")[0]!.tokenType).toBe(Ident);
  });

  it("keeps newlines, because they end statements", () => {
    expect(toTokens("stop\nstop")[1]!.tokenType).toBe(Newline);
  });
});

describe("the two worlds", () => {
  /**
   * The lexer canonicalises before the parser sees anything, so the grammar is
   * written once and never learns there are two vocabularies.
   */
  it.each([
    ["tank", "ciliate"],
    ["turret.sweep 45", "stinger.sweep 45"],
    ["fire 2", "sting 2"],
    ["drive forward 80", "swim forward 80"],
  ])("reads %s and %s the same way", (mechanical, biological) => {
    expect(names(mechanical)).toEqual(names(biological));
  });

  it("still remembers which word was typed", () => {
    // What an error message needs in order to quote the author back to
    // themselves rather than lecturing them in a vocabulary they did not pick.
    const token = toTokens("stinger.sweep 45")[0]!;
    expect(token.image).toBe("turret");
    expect(token.raw).toBe("stinger");
  });
});

describe("what the grammar asks for", () => {
  it("hands back a type per keyword and operator", () => {
    expect(kw("end").name).toBe("End");
    expect(op(".").name).toBe("Dot");
  });

  it("refuses a word it does not have, rather than never matching", () => {
    // A typo in a grammar rule should be loud. A missing token type would
    // otherwise be a rule that simply never fires.
    expect(() => op("%")).toThrow(/no token type/);
  });
});

describe("positions", () => {
  it("carries line and column from the lexer", () => {
    const second = toTokens("stop\n  fire 2").find((t) => t.tokenType.name === "Fire")!;
    expect(second.startLine).toBe(2);
    expect(second.startColumn).toBe(3);
  });

  it("carries the numeric value of a number", () => {
    expect(toTokens("fire 2")[1]!.tokenType).toBe(NumLit);
    expect(toTokens("fire 2")[1]!.value).toBe(2);
  });
});
