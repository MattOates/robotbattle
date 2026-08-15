/**
 * The load-bearing suite.
 *
 * Every peer runs the whole match locally from a shared manifest; nothing but
 * the manifest crosses the network. That only works if the simulation is
 * bit-identical everywhere, so these tests guard the discipline that makes it
 * so — no Math.sin/cos/atan2/random, no Date, no unordered iteration.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runMatch, runMatchWithHashes } from "../../src/sim/match.js";
import { makeManifest } from "../../src/sim/world.js";
import { DODGER, HUNTER, RACER, SPINNER } from "../../src/bots/index.js";
import { atan2Deg, cosDeg, normalizeAngle, sinDeg, tanDeg } from "../../src/sim/math.js";
import { Rng } from "../../src/sim/rng.js";

const FIELD = [
  { source: HUNTER },
  { source: RACER },
  { source: SPINNER },
  { source: DODGER },
];

describe("match reproducibility", () => {
  it("produces the identical tick-by-tick hash stream on a rerun", () => {
    const manifest = makeManifest(FIELD, { seed: 987654 });
    const a = runMatchWithHashes(manifest);
    const b = runMatchWithHashes(manifest);
    expect(b.hashes).toEqual(a.hashes);
    expect(a.hashes.length).toBeGreaterThan(50);
  });

  it("gives the same result from a fresh manifest object", () => {
    const a = runMatch(makeManifest(FIELD, { seed: 4242 }));
    const b = runMatch(makeManifest(FIELD, { seed: 4242 }));
    expect(b.finalHash).toBe(a.finalHash);
    expect(b.standings).toEqual(a.standings);
  });

  it("diverges when the seed changes", () => {
    // Sanity check on the check: if every seed gave the same hash, the tests
    // above would pass for the wrong reason.
    const a = runMatch(makeManifest(FIELD, { seed: 1 }));
    const b = runMatch(makeManifest(FIELD, { seed: 2 }));
    expect(b.finalHash).not.toBe(a.finalHash);
  });
});

describe("no forbidden non-determinism in the simulation", () => {
  // A second line of defence behind code review: these APIs are either
  // implementation-defined across JS engines or unseeded, and either way they
  // silently desync peers.
  const BANNED = [
    /\bMath\.sin\b/,
    /\bMath\.cos\b/,
    /\bMath\.tan\b/,
    /\bMath\.atan2?\b/,
    /\bMath\.pow\b/,
    /\bMath\.exp\b/,
    /\bMath\.log\b/,
    /\bMath\.hypot\b/,
    /\bMath\.random\b/,
    /\bDate\.now\b/,
    /\bperformance\.now\b/,
  ];

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sourceFiles(path));
      else if (entry.name.endsWith(".ts")) out.push(path);
    }
    return out.sort();
  }

  const roots = ["src/sim", "src/lang"];
  const files = roots.flatMap((r) => sourceFiles(r));

  it("scans a non-trivial number of files", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(files)("%s uses no engine-dependent math", (file) => {
    const text = readFileSync(file, "utf8");
    for (const pattern of BANNED) {
      // math.ts documents the banned list in prose; only code lines count.
      const offending = text
        .split("\n")
        .filter((line: string) => {
          const t = line.trim();
          return !t.startsWith("*") && !t.startsWith("//");
        })
        .filter((line: string) => pattern.test(line));
      expect(offending, `${file} matches ${pattern}`).toEqual([]);
    }
  });
});

describe("deterministic trig", () => {
  it("agrees with the platform to a usable tolerance", () => {
    // We do not need to MATCH the platform — we need to be reproducible. But
    // being close confirms the polynomials are actually right.
    for (let deg = -360; deg <= 360; deg += 7) {
      const rad = (deg * Math.PI) / 180;
      expect(sinDeg(deg)).toBeCloseTo(Math.sin(rad), 8);
      expect(cosDeg(deg)).toBeCloseTo(Math.cos(rad), 8);
    }
  });

  it("computes atan2 across all four quadrants", () => {
    const pts: Array<[number, number]> = [
      [1, 1], [1, -1], [-1, 1], [-1, -1], [0, 1], [0, -1], [1, 0], [-1, 0],
      [3, 4], [-7, 2], [0.001, 900],
    ];
    for (const [y, x] of pts) {
      const expected = normalizeAngle((Math.atan2(y, x) * 180) / Math.PI);
      expect(normalizeAngle(atan2Deg(y, x))).toBeCloseTo(expected, 6);
    }
  });

  it("keeps tan finite at the asymptote", () => {
    expect(Number.isFinite(tanDeg(90))).toBe(true);
    expect(Number.isFinite(tanDeg(-90))).toBe(true);
  });

  it("normalises angles into [-180, 180)", () => {
    for (const a of [0, 180, -180, 181, 359, 360, 720, -721, 1e6]) {
      const n = normalizeAngle(a);
      expect(n).toBeGreaterThanOrEqual(-180);
      expect(n).toBeLessThan(180);
    }
  });
});

describe("seeded rng", () => {
  it("repeats exactly for a given seed", () => {
    const a = new Rng(2024);
    const b = new Rng(2024);
    for (let i = 0; i < 1000; i++) expect(b.nextUint32()).toBe(a.nextUint32());
  });

  it("differs between seeds", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const sameCount = Array.from({ length: 100 }, () =>
      a.nextUint32() === b.nextUint32() ? 1 : 0,
    ).reduce<number>((x, y) => x + y, 0);
    expect(sameCount).toBeLessThan(3);
  });

  it("stays inside its stated ranges", () => {
    const r = new Rng(99);
    for (let i = 0; i < 5000; i++) {
      const f = r.nextFloat();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = r.int(3, 9);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(9);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it("restores from a snapshot, so a world can be resumed", () => {
    const r = new Rng(7);
    for (let i = 0; i < 50; i++) r.nextUint32();
    const [hi, lo] = r.getState();
    const expected = Array.from({ length: 10 }, () => r.nextUint32());

    const restored = new Rng(0);
    restored.setState(hi, lo);
    expect(Array.from({ length: 10 }, () => restored.nextUint32())).toEqual(expected);
  });
});
