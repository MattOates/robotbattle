/**
 * The theme guarantee.
 *
 * Mechanical and biological are wording and art, never balance. These tests are
 * what hold that line: if anyone ever makes a themed word behave differently,
 * the bytecode comparison here fails immediately.
 */

import { describe, expect, it } from "vitest";
import { parse } from "../../src/lang/parser.js";
import { compile } from "../../src/lang/compiler.js";
import { programIdentity } from "../../src/lang/bytecode.js";
import { HUNTER, HUNTER_BIO } from "../../src/bots/index.js";
import { makeManifest } from "../../src/sim/world.js";
import { runMatchWithHashes } from "../../src/sim/match.js";

function identity(source: string): string {
  return programIdentity(compile(parse(source)));
}

describe("themed vocabulary", () => {
  it("compiles the Hunter to identical bytecode in both vocabularies", () => {
    expect(identity(HUNTER_BIO)).toBe(identity(HUNTER));
  });

  it("treats each synonym pair as the same program", () => {
    const pairs: Array<[string, string]> = [
      ["chassis tank\n", "body ciliate\n"],
      ["chassis car\n", "body flagellate\n"],
      ["on tick\n  drive forward 50\nend\n", "on tick\n  swim forward 50\nend\n"],
      ["on tick\n  fire 2\nend\n", "on tick\n  sting 2\nend\n"],
      ["on tick\n  turret.sweep 30\nend\n", "on tick\n  stinger.sweep 30\nend\n"],
      ["on sense robot\n  fire\nend\n", "on sense organism\n  sting\nend\n"],
      ["on hit by bullet\n  stop\nend\n", "on stung\n  stop\nend\n"],
      ["on sense bullet\n  stop\nend\n", "on sense dart\n  stop\nend\n"],
      ["on tick\n  fire me.health\nend\n", "on tick\n  sting me.vitality\nend\n"],
      // The radar, in both worlds: same instrument, same bytecode.
      ["on tick\n  radar.sweep 60\nend\n", "on tick\n  eyespot.sweep 60\nend\n"],
      ["on tick\n  ping\nend\n", "on tick\n  peek\nend\n"],
      ["on tick\n  radar.aim at 30\nend\n", "on tick\n  eyespot.aim at 30\nend\n"],
      ["on ping robot\n  fire\nend\n", "on peek organism\n  sting\nend\n"],
      ["on ping wall\n  stop\nend\n", "on peek wall\n  stop\nend\n"],
      ["on tick\n  fire me.radar\nend\n", "on tick\n  sting me.eyespot\nend\n"],
      ["on tick\n  fire me.pingHeat\nend\n", "on tick\n  sting me.peekHeat\nend\n"],
    ];
    for (const [mech, bio] of pairs) {
      expect(identity(bio), `${bio.trim()} should match ${mech.trim()}`).toBe(
        identity(mech),
      );
    }
  });

  it("lets both vocabularies be mixed in one script", () => {
    const mixed = `chassis tank\non sense organism\n  turret.aim at event.bearing\n  sting 2\nend\n`;
    const plain = `chassis tank\non sense robot\n  turret.aim at event.bearing\n  fire 2\nend\n`;
    expect(identity(mixed)).toBe(identity(plain));
  });

  it("produces an identical match whichever vocabulary is used", () => {
    // Same fight, same seed, only the words change. Every tick must agree.
    const mech = runMatchWithHashes(makeManifest([{ source: HUNTER }, { source: HUNTER }]));
    const bio = runMatchWithHashes(makeManifest([{ source: HUNTER_BIO }, { source: HUNTER_BIO }]));
    expect(bio.hashes).toEqual(mech.hashes);
    expect(bio.result.finalHash).toBe(mech.result.finalHash);
  });
});
