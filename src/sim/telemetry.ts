/**
 * Turning a finished match into numbers worth keeping.
 *
 * Everything here is read-only over the world. Telemetry is deliberately not
 * part of `hashWorld` — it is derived from state that is already hashed, so
 * including it would add no integrity and one more reason for the golden test
 * to churn.
 */

import { summarise } from "./match.js";
import type { World } from "./types.js";
import type { RobotTelemetry } from "../store/types.js";

export function collectTelemetry(world: World): RobotTelemetry[] {
  const placings = new Map(summarise(world).standings.map((s) => [s.id, s.place]));

  return world.robots.map((r) => ({
    robotId: r.id,
    name: r.declaredName,
    place: placings.get(r.id) ?? world.robots.length,
    survived: r.alive,
    // A survivor's clock runs to the end of the match.
    survivedTicks: r.diedAtTick >= 0 ? r.diedAtTick : world.tick,

    health: Math.round(r.health * 10) / 10,
    kills: r.kills,
    damageDealt: Math.round(r.damageDealt * 10) / 10,
    damageTaken: Math.round(r.damageTaken * 10) / 10,
    shotsFired: r.shotsFired,
    shotsHit: r.shotsHit,

    instructions: r.vm.instructionsExecuted,
    suspensions: r.vm.suspensions,
    eventsDropped: r.vm.eventsDropped,
    errors: r.vm.errors,
    lastError: r.scriptError
      ? `line ${r.scriptError.line}: ${r.scriptError.message}`
      : null,
  }));
}

/** Shots that found a target, as a percentage. Zero shots reads as zero. */
export function accuracy(t: RobotTelemetry): number {
  return t.shotsFired === 0 ? 0 : (t.shotsHit / t.shotsFired) * 100;
}

/**
 * A one-line diagnosis of a robot's script performance, or null if it ran
 * cleanly. This is the bit that turns raw counters into something actionable.
 */
export function executionWarning(t: RobotTelemetry): string | null {
  if (t.errors > 0) {
    return `Hit ${t.errors} runtime error${t.errors === 1 ? "" : "s"}${
      t.lastError ? ` — ${t.lastError}` : ""
    }`;
  }
  if (t.eventsDropped > 20) {
    return `Missed ${t.eventsDropped} events because it couldn't keep up. Try doing less work per event.`;
  }
  if (t.suspensions > 30) {
    return `Ran out of thinking time ${t.suspensions} times, so it reacted late. Look for a long loop.`;
  }
  return null;
}
