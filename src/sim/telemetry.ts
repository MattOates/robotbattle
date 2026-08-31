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
    lastError: r.scriptError ? `line ${r.scriptError.line}: ${r.scriptError.message}` : null,
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

export interface BattleExplanation {
  tone: "good" | "mixed" | "poor";
  headline: string;
  points: string[];
}

/**
 * Turn one robot's counters into a short, actionable debrief.
 *
 * These deliberately describe evidence rather than pretending to understand
 * the player's strategy. Three useful observations beat a wall of statistics,
 * especially immediately after somebody has just watched the same fight.
 */
export function explainBattle(
  mine: RobotTelemetry,
  field: readonly RobotTelemetry[],
  winnerId?: number | null,
): BattleExplanation {
  const drawn = winnerId === null;
  const won = winnerId === undefined ? mine.place === 1 : winnerId === mine.robotId;
  const opponents = field.filter((robot) => robot.robotId !== mine.robotId);
  const bestOpponentDamage = Math.max(0, ...opponents.map((robot) => robot.damageDealt));
  const points: string[] = [];
  const warning = executionWarning(mine);

  if (warning) points.push(warning);

  if (mine.shotsFired === 0) {
    points.push("It never fired. Check that a sensing or ping event can reach a fire instruction.");
  } else {
    const shotAccuracy = accuracy(mine);
    if (mine.shotsFired >= 4 && shotAccuracy < 20) {
      points.push(
        `Only ${mine.shotsHit} of ${mine.shotsFired} shots landed. Keep tracking the target and aim using its latest bearing.`,
      );
    } else if (mine.shotsHit >= 3 && shotAccuracy >= 60) {
      points.push(
        `${mine.shotsHit} of ${mine.shotsFired} shots landed — its targeting was a strength.`,
      );
    }
  }

  if (mine.damageDealt === 0 && mine.damageTaken > 0) {
    points.push("It took damage without dealing any. Getting a reliable first shot is the clearest next step.");
  } else if (mine.damageDealt > bestOpponentDamage && mine.damageDealt > 0) {
    points.push(`It dealt the most damage in the fight: ${Math.round(mine.damageDealt)}.`);
  } else if (mine.damageTaken >= 70 && !mine.survived) {
    points.push("It absorbed heavy damage. Add movement after being sensed or hit to make it harder to track.");
  }

  if (mine.kills > 0) {
    points.push(`It destroyed ${mine.kills} opponent${mine.kills === 1 ? "" : "s"}.`);
  } else if (mine.survived && !won) {
    points.push("It survived to the end, but did not secure the win. More reliable damage may break the stalemate.");
  }

  const unique = [...new Set(points)].slice(0, 3);
  if (unique.length === 0) {
    unique.push(
      won
        ? "It combined enough survival and damage to finish ahead of the field."
        : "No single fault dominated this fight. Run it again before changing the script.",
    );
  }

  return {
    tone: won ? "good" : drawn ? "mixed" : warning || mine.damageDealt === 0 ? "poor" : "mixed",
    headline: drawn
      ? `Finished #${mine.place} out of ${field.length}; nobody won before time ran out.`
      : won
        ? `Finished first out of ${field.length}.`
        : `Finished #${mine.place} out of ${field.length}.`,
    points: unique,
  };
}
