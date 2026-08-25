/**
 * Watching a match closely enough to have something to say about it.
 *
 * The simulation already knows when somebody is shot, killed, or reduced to
 * limping; none of it reaches the player except as pixels and a scoreboard. In
 * a four-robot free-for-all that makes the fight hard to follow at all, and in
 * a tournament it means nobody announces the winner.
 *
 * Two things shape this file.
 *
 * It is **strictly read-only over the world**. It never writes, and above all
 * it never draws from `world.rng` — a commentator that consumed randomness
 * would change the match by watching it, and every peer would then disagree
 * about what happened. Variation comes from the seed and the tick instead, so
 * a replay is narrated word for word the same way twice.
 *
 * And it **ranks rather than maps**. Reacting to every event would be a machine
 * gun: a busy tick can hold half a dozen impacts. Each candidate gets a
 * significance, only the best one in each window is offered, and the rest are
 * thrown away — which is what makes it sound like somebody watching rather than
 * a log being read aloud.
 */

import type { World } from "./types.js";

export type Beat =
  | { kind: "start"; names: readonly string[] }
  | { kind: "firstBlood"; by: string; on: string }
  | { kind: "hit"; by: string; on: string; damage: number }
  | { kind: "kill"; by: string; on: string; remaining: number }
  /** Drove into a wall once too often. A different sentence from being shot. */
  | { kind: "selfDestruct"; who: string }
  | { kind: "limping"; who: string; health: number }
  | { kind: "end"; winner: string | null; ticks: number };

export interface Candidate {
  beat: Beat;
  /** Higher speaks first. See `SIGNIFICANCE`. */
  weight: number;
}

/**
 * What is worth interrupting for.
 *
 * The ordering is the editorial judgement of the whole feature: the end of a
 * match outranks a kill, a kill outranks the first blood of the match, and any
 * of them outrank the fifth exchange of shots. Ordinary hits sit at the bottom
 * because there are so many of them.
 */
const SIGNIFICANCE = {
  end: 100,
  start: 90,
  kill: 70,
  firstBlood: 50,
  selfDestruct: 45,
  limping: 30,
  hit: 10,
} as const satisfies Record<Beat["kind"], number>;

/** Ticks between remarks. At 30 Hz this is a beat every two seconds or so. */
export const QUIET_TICKS = 60;

/** Health below which a robot is worth remarking on. */
const LIMPING_AT = 25;

interface Seen {
  alive: boolean;
  health: number;
}

export class Commentator {
  private previous = new Map<number, Seen>();
  private pending: Candidate[] = [];
  private lastSpokeAt = -Infinity;
  private started = false;
  private drawnBlood = false;
  private ended = false;
  /** Robots already remarked on for being nearly dead, so it is said once. */
  private limped = new Set<number>();

  /**
   * Take a look at the world as it is now.
   *
   * Called once per tick, from the same place the renderer is. Reads
   * `world.effects` — which is why it has to be called before the next `step`
   * throws them away — and diffs the robots against how they were last tick.
   */
  observe(world: World): void {
    const name = (id: number | undefined): string | null => {
      if (id === undefined) return null;
      const robot = world.robots.find((r) => r.id === id);
      return robot ? robot.declaredName : null;
    };

    if (!this.started) {
      this.started = true;
      this.pending.push({
        beat: { kind: "start", names: world.robots.map((r) => r.declaredName) },
        weight: SIGNIFICANCE.start,
      });
    }

    for (const effect of world.effects) {
      if (effect.type === "impact") {
        const by = name(effect.actorId);
        const on = name(effect.targetId);
        if (by === null || on === null) continue;
        if (!this.drawnBlood) {
          this.drawnBlood = true;
          this.pending.push({ beat: { kind: "firstBlood", by, on }, weight: SIGNIFICANCE.firstBlood });
        } else {
          this.pending.push({
            beat: { kind: "hit", by, on, damage: effect.damage ?? 0 },
            // A harder shot is worth a little more than a glancing one, but
            // never enough to outrank somebody dying.
            weight: SIGNIFICANCE.hit + Math.min(9, effect.damage ?? 0),
          });
        }
      }

      if (effect.type === "explosion") {
        const on = name(effect.targetId);
        if (on === null) continue;
        const by = name(effect.actorId);
        const remaining = world.robots.filter((r) => r.alive).length;
        this.pending.push(
          by === null
            ? { beat: { kind: "selfDestruct", who: on }, weight: SIGNIFICANCE.selfDestruct }
            : { beat: { kind: "kill", by, on, remaining }, weight: SIGNIFICANCE.kill },
        );
      }
    }

    // Limping is a state rather than an event, so it comes from the diff.
    for (const robot of world.robots) {
      const before = this.previous.get(robot.id);
      if (
        robot.alive &&
        robot.health > 0 &&
        robot.health <= LIMPING_AT &&
        !this.limped.has(robot.id) &&
        (before === undefined || before.health > LIMPING_AT)
      ) {
        this.limped.add(robot.id);
        this.pending.push({
          beat: { kind: "limping", who: robot.declaredName, health: Math.round(robot.health) },
          weight: SIGNIFICANCE.limping,
        });
      }
      this.previous.set(robot.id, { alive: robot.alive, health: robot.health });
    }

    if (world.over && !this.ended) {
      this.ended = true;
      const winner = world.winnerId === null ? null : name(world.winnerId);
      this.pending.push({
        beat: { kind: "end", winner, ticks: world.tick },
        weight: SIGNIFICANCE.end,
      });
    }
  }

  /**
   * The one thing worth saying now, or nothing.
   *
   * Everything else that happened since the last remark is discarded rather
   * than queued: a commentator who is still describing the second exchange
   * while the fourth is happening is worse than one who missed it.
   *
   * The end of a match ignores the quiet period, because the result is the one
   * line that must never be swallowed.
   *
   * Once the match is over, keep calling until it returns null: the death that
   * ended it and the result itself are two separate lines, and a caller whose
   * loop stops the moment `world.over` goes true will hear the first and never
   * the second.
   */
  take(tick: number): Beat | null {
    if (this.pending.length === 0) return null;

    let best = 0;
    for (let i = 1; i < this.pending.length; i++) {
      if (this.pending[i]!.weight > this.pending[best]!.weight) best = i;
    }
    let chosen = this.pending[best]!;

    // The death that ends a match lands on the same tick as the result, and
    // the result outranks it — so in a duel the most dramatic moment of the
    // whole fight was being swallowed by the announcement that it was over.
    // The death goes first and the result waits for the next call, one tick
    // later, which reads as the two halves of the same sentence.
    //
    // Either kind of death: being shot and driving into a wall once too often
    // are different sentences, but both are the end of somebody.
    if (chosen.beat.kind === "end") {
      const death = this.pending.find(
        (c) => c.beat.kind === "kill" || c.beat.kind === "selfDestruct",
      );
      if (death) {
        this.pending = this.pending.filter((c) => c.beat.kind === "end");
        this.lastSpokeAt = tick;
        return death.beat;
      }
    }

    const urgent = chosen.beat.kind === "end" || chosen.beat.kind === "start";
    if (!urgent && tick - this.lastSpokeAt < QUIET_TICKS) return null;

    this.pending = [];
    this.lastSpokeAt = tick;
    return chosen.beat;
  }
}
