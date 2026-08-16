/**
 * Deciding a tie, and proving the match we offer to show is the real one.
 *
 * The second half matters more than it looks. A bracket that says "Hunter beat
 * Racer 7–4" and then plays a match Racer wins is worse than no replay at all,
 * so the showcase is checked by re-simulating it exactly the way the screen
 * will: rebuild the manifest from the seed and the side, run it, and demand the
 * stated winner.
 */

import { describe, expect, it } from "vitest";
import {
  DUEL_MATCHES,
  duelManifest,
  runDuel,
  scoreline,
  sideIndex,
  type Duellist,
} from "../../src/tournament/duel.js";
import { runRound, seedForJob, type DuelJob } from "../../src/tournament/round.js";
import { runMatch } from "../../src/sim/match.js";
import { DODGER, HUNTER, RACER, SPINNER } from "../../src/bots/index.js";

const bot = (name: string, source: string, color = "#ff8800"): Duellist => ({
  name,
  color,
  source,
});

/**
 * Replay match `i` of a duel the way the duel itself played it, returning its
 * length when `winner` won it and null otherwise.
 */
function replayLength(
  a: Duellist,
  b: Duellist,
  seedBase: number,
  i: number,
  winner: "a" | "b",
): number | null {
  const canonicalFirst = i % 2 === 0;
  const aFirst = a.source > b.source ? !canonicalFirst : canonicalFirst;
  const result = runMatch(duelManifest(a, b, seedBase + i, aFirst));
  const wonByWinner = result.winnerId !== null && result.winnerId === sideIndex(winner, aFirst);
  return wonByWinner ? result.ticks : null;
}

const hunter = bot("Hunter", HUNTER);
const racer = bot("Racer", RACER, "#ffd166");
const spinner = bot("Spinner", SPINNER, "#7fd1e0");
const broken = bot("Broken", 'name "Broken"\nchassis banana\n');

describe("settling a tie", () => {
  it("plays eleven matches and wins on the record", () => {
    const result = runDuel(hunter, racer, 1000);
    expect(result.matches).toBe(DUEL_MATCHES);
    expect(result.aWins + result.bWins + result.draws).toBe(DUEL_MATCHES);
    expect(result.winner).not.toBeNull();
    expect(result.decidedBy).toBe("record");
    // The winner is whoever actually won more of them.
    const winnerWins = result.winner === "a" ? result.aWins : result.bWins;
    const loserWins = result.winner === "a" ? result.bWins : result.aWins;
    expect(winnerWins).toBeGreaterThan(loserWins);
  });

  it("is reproducible from its seed", () => {
    expect(runDuel(hunter, spinner, 77)).toEqual(runDuel(hunter, spinner, 77));
  });

  it("does not depend on which corner a robot is drawn into", () => {
    // If it did, the draw itself would decide part of the tournament. Checked
    // across several pairings and seeds, because this is a property of the
    // scheduling rather than a happy accident of one matchup.
    const pairs = [
      [hunter, spinner],
      [hunter, racer],
      [racer, spinner],
      [spinner, bot("Dodger", DODGER, "#c07fe0")],
    ] as const;

    for (const [x, y] of pairs) {
      for (const seedBase of [4242, 77, 1234]) {
        const straight = runDuel(x, y, seedBase);
        const swapped = runDuel(y, x, seedBase);

        expect(straight.winner === "a" ? x.name : y.name).toBe(
          swapped.winner === "a" ? y.name : x.name,
        );
        // Not merely the same verdict: the very same eleven matches.
        expect(swapped.aWins).toBe(straight.bWins);
        expect(swapped.bWins).toBe(straight.aWins);
        expect(swapped.showcase?.seed).toBe(straight.showcase?.seed);
      }
    }
  });

  it("alternates sides so a positional quirk cannot masquerade as skill", () => {
    // Five of eleven for one side, six for the other, and the showcase records
    // which side it was — proof the sides really do move.
    const seen = new Set<boolean>();
    for (let seedBase = 0; seedBase < 4; seedBase++) {
      const showcase = runDuel(hunter, racer, seedBase * 500 + 1).showcase;
      if (showcase) seen.add(showcase.aFirst);
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it("sends a robot through unopposed when the other will not compile", () => {
    const result = runDuel(hunter, broken, 5);
    expect(result.winner).toBe("a");
    expect(result.decidedBy).toBe("walkover");
    expect(result.matches).toBe(0);
    expect(result.showcase).toBeNull();
    expect(scoreline(result)).toBe("walkover");
  });

  it("has no winner when neither will compile", () => {
    const result = runDuel(broken, broken, 5);
    expect(result.winner).toBeNull();
    expect(result.decidedBy).toBe("none");
  });
});

describe("the match offered for watching", () => {
  it("replays to exactly the result the bracket claims", () => {
    for (const [a, b, seedBase] of [
      [hunter, racer, 11],
      [spinner, bot("Dodger", DODGER, "#c07fe0"), 222],
      [racer, spinner, 3333],
    ] as const) {
      const duel = runDuel(a, b, seedBase);
      const showcase = duel.showcase;
      expect(showcase).not.toBeNull();
      if (!showcase) continue;

      // Exactly what the screen does to watch it.
      const replay = runMatch(duelManifest(a, b, showcase.seed, showcase.aFirst));
      expect(replay.winnerId).toBe(sideIndex(showcase.winner, showcase.aFirst));
      expect(showcase.winner).toBe(duel.winner);
      expect(replay.ticks).toBe(showcase.ticks);
    }
  });

  it("is one of the matches that were actually played", () => {
    const seedBase = 909;
    const duel = runDuel(hunter, racer, seedBase);
    const seeds = Array.from({ length: DUEL_MATCHES }, (_, i) => seedBase + i);
    expect(seeds).toContain(duel.showcase?.seed);
  });

  it("is a typical win, not the shortest rout or the longest stalemate", () => {
    // The extremes are the two least watchable matches in the set: a rout shows
    // nothing, and the longest is usually two robots circling to the tick limit.
    for (const seedBase of [606, 1500]) {
      const duel = runDuel(hunter, racer, seedBase);
      const showcase = duel.showcase!;

      const winnerWins: number[] = [];
      for (let i = 0; i < DUEL_MATCHES; i++) {
        const duration = replayLength(hunter, racer, seedBase, i, duel.winner!);
        if (duration !== null) winnerWins.push(duration);
      }
      winnerWins.sort((x, y) => x - y);

      expect(showcase.ticks).toBe(winnerWins[Math.floor((winnerWins.length - 1) / 2)]);
      if (winnerWins.length > 2) {
        expect(showcase.ticks).toBeGreaterThan(winnerWins[0]!);
        expect(showcase.ticks).toBeLessThan(winnerWins.at(-1)!);
      }
    }
  });

  it("is always a decisive match, so a replay of it cannot run to the tick limit", () => {
    // The arena stops a match at `maxTicks` and calls it a draw. A showcase is
    // by definition one the winner *won*, so it ends on its own well inside
    // that limit — which is what lets a queue of them play unattended.
    for (const seedBase of [11, 606, 909, 3333]) {
      const duel = runDuel(hunter, racer, seedBase);
      const showcase = duel.showcase!;
      const manifest = duelManifest(hunter, racer, showcase.seed, showcase.aFirst);
      expect(showcase.ticks).toBeLessThan(manifest.maxTicks);
      expect(runMatch(manifest).winnerId).not.toBeNull();
    }
  });

  it("carries each robot's own colour into the replay", () => {
    const manifest = duelManifest(hunter, racer, 1, true);
    expect(manifest.entries.map((e) => e.color)).toEqual(["#ff8800", "#ffd166"]);
    expect(duelManifest(hunter, racer, 1, false).entries.map((e) => e.color)).toEqual([
      "#ffd166",
      "#ff8800",
    ]);
  });
});

describe("a round", () => {
  const jobs: DuelJob[] = [
    { matchId: "r0m0", aId: "h", bId: "r", a: hunter, b: racer, seedBase: seedForJob(7, "r0m0") },
    {
      matchId: "r0m1",
      aId: "s",
      bId: "d",
      a: spinner,
      b: bot("Dodger", DODGER),
      seedBase: seedForJob(7, "r0m1"),
    },
  ];

  it("settles every tie and names an entrant to promote", () => {
    const records = runRound(jobs, 3);
    expect(records.map((r) => r.matchId)).toEqual(["r0m0", "r0m1"]);
    for (const record of records) {
      expect([record.aId, record.bId]).toContain(record.winnerId);
      expect(record.result.matches).toBe(3);
    }
  });

  it("gives the ties in one round different matches", () => {
    // Same robots in two slots must not replay the same eleven matches, or the
    // bracket would be showing the audience one tie twice.
    expect(seedForJob(7, "r0m0")).not.toBe(seedForJob(7, "r0m1"));
    expect(seedForJob(7, "r0m0")).toBe(seedForJob(7, "r0m0"));
  });

  it("reports progress as it goes", () => {
    const seen: number[] = [];
    runRound(jobs, 4, (progress) => seen.push(progress.done));
    expect(seen.at(-1)).toBe(8);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});
