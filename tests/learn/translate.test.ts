/**
 * Rendering lesson code in the reader's world.
 *
 * The guarantee worth protecting: a translated example is the *same program*.
 * If translation could change behaviour, the biological tutorial would be
 * teaching a language that quietly does something else.
 */

import { describe, expect, it } from "vitest";
import { translate } from "../../src/learn/translate.js";
import { compile } from "../../src/lang/compiler.js";
import { parse } from "../../src/lang/parser.js";
import { programIdentity } from "../../src/lang/bytecode.js";
import { HUNTER, RACER, DODGER, SPINNER } from "../../src/bots/index.js";

const identity = (source: string) => programIdentity(compile(parse(source)));

describe("the same program either way", () => {
  it.each([
    ["Hunter", HUNTER],
    ["Racer", RACER],
    ["Dodger", DODGER],
    ["Spinner", SPINNER],
  ])("%s compiles identically in both worlds", (_name, source) => {
    const bot = translate(source, "mechanical");
    const bio = translate(source, "biological");
    expect(bio).not.toBe(bot);
    expect(identity(bio)).toBe(identity(bot));
  });

  it("leaves a mechanical script untouched", () => {
    expect(translate(HUNTER, "mechanical")).toBe(HUNTER);
  });

  it("round-trips back to where it started", () => {
    const there = translate(HUNTER, "biological");
    expect(translate(there, "mechanical")).toBe(HUNTER);
  });
});

describe("what it changes", () => {
  it("swaps the vocabulary", () => {
    const bio = translate("chassis tank\non tick\n  drive forward 50\n  fire 2\nend\n", "biological");
    expect(bio).toContain("body ciliate");
    expect(bio).toContain("swim forward 50");
    expect(bio).toContain("sting 2");
  });

  it("collapses `hit by bullet` into `stung`, and expands it back", () => {
    const bio = translate("on hit by bullet\n  stop\nend\n", "biological");
    expect(bio).toContain("on stung");
    expect(bio).not.toContain("bullet");
    expect(translate(bio, "mechanical")).toContain("on hit by bullet");
  });

  it("translates the words inside comments", () => {
    const bio = translate("-- Shoot the nearest robot\nfire 2\n", "biological");
    expect(bio).toContain("Sting the nearest organism");
  });

  it("keeps capitalisation in comments", () => {
    expect(translate("-- Robot ahead\n", "biological")).toContain("-- Organism ahead");
  });
});

describe("what it must not touch", () => {
  it("leaves text in quotes alone", () => {
    // A robot called "Tank Buster" keeps its name.
    const bio = translate('name "Tank Buster"\nchassis tank\n', "biological");
    expect(bio).toContain('name "Tank Buster"');
    expect(bio).toContain("body ciliate");
  });

  it("leaves numbers and colours alone", () => {
    const bio = translate("color #ff8800\non tick\n  fire 3\nend\n", "biological");
    expect(bio).toContain("#ff8800");
    expect(bio).toContain("sting 3");
  });

  it("preserves indentation exactly", () => {
    const bio = translate("on tick\n    drive forward 10\nend\n", "biological");
    expect(bio.split("\n")[1]).toBe("    swim forward 10");
  });

  it("preserves blank lines and trailing newlines", () => {
    const source = "chassis tank\n\non tick\nend\n";
    const bio = translate(source, "biological");
    expect(bio.split("\n")).toHaveLength(source.split("\n").length);
    expect(bio.endsWith("\n")).toBe(true);
  });

  it("leaves variable names alone even when they look like keywords", () => {
    const source = "var robot_count = 0\non tick\n  set robot_count = robot_count + 1\nend\n";
    const bio = translate(source, "biological");
    expect(bio).toContain("robot_count");
    expect(identity(bio)).toBe(identity(source));
  });
});
