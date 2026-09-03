/**
 * Why the fight went the way it did, in one sentence and a picture.
 *
 * A match ends and the Workshop reports it as a table: shots fired, shots hit,
 * damage dealt, damage taken, accuracy, instructions, suspensions. Every one of
 * those numbers is true and worth having, and none of them answers the question
 * a seven-year-old is actually asking, which is *why did that happen*. Worse,
 * the answer is usually not in the numbers at all — it is in what the {robot}
 * never did. "Shots fired: 0" is a fact; "you never fired" is the lesson, and
 * "add a Shoot card inside When I see somebody" is what to do about it.
 *
 * So this reads the same telemetry and coverage the Behaviour Inspector reads
 * and picks out the two or three things worth saying, most useful first. It
 * changes no data and adds no instrumentation.
 *
 * Pure, so `tests/workshop/verdict.test.ts` can put a match in and read the
 * findings out without a browser or a simulation.
 */

import type { ScriptCoverage } from "../sim/inspection.js";
import type { RobotTelemetry } from "../store/types.js";

export interface Finding {
  id: string;
  /** One glyph, read before the words are. */
  icon: string;
  /** What happened, in both registers. */
  say: { full: string; simple: string };
  /** What to do about it. Absent when there is nothing to do. */
  fix?: { say: { full: string; simple: string }; cardId?: string };
  /**
   * How much this matters, high first.
   *
   * Not a severity — a *usefulness*. Losing is not the most interesting thing
   * about a match where the {robot} never fired a shot, and winning is not the
   * most interesting thing about one where it never moved.
   */
  weight: number;
}

export interface MatchFacts {
  /** The player's own robot. */
  mine: RobotTelemetry;
  /** Everybody, including the player. */
  field: readonly RobotTelemetry[];
  /** Which lines and events actually ran, when the trial recorded it. */
  coverage?: ScriptCoverage | undefined;
  /** How long the match ran, in ticks. */
  ticks: number;
}

/** Was this event ever raised, and did the script ever handle it? */
function seen(coverage: ScriptCoverage | undefined, event: string): {
  queued: number;
  handled: number;
} {
  const found = coverage?.events?.[event];
  return { queued: found?.queued ?? 0, handled: found?.handled ?? 0 };
}

/**
 * What to say about a finished match.
 *
 * Ordered by usefulness and capped by the caller — three cards is a debrief, a
 * dozen is the table this exists to replace.
 */
export function verdict(facts: MatchFacts): Finding[] {
  const { mine, field, coverage, ticks } = facts;
  const found: Finding[] = [];
  const won = mine.place === 1;
  const others = field.filter((t) => t.robotId !== mine.robotId);

  // --- the things that did not happen ------------------------------------
  //
  // These come first and score highest, because a thing a robot never did is
  // invisible in a table of what it did.

  if (mine.shotsFired === 0) {
    const sawSomething = seen(coverage, "sense robot").queued > 0;
    found.push({
      id: "never-fired",
      icon: "🎯",
      say: {
        full: "Your {robot} never fired a shot.",
        simple: "You never shot at anybody.",
      },
      fix: {
        say: sawSomething
          ? {
              full: "It saw somebody but did nothing about it. Add a {fire} inside `on sense robot`.",
              simple: "You saw them! Put a Shoot inside When I see somebody.",
            }
          : {
              full: "It never saw anybody either. Sweep the {turret} so it notices things.",
              simple: "You never saw anybody. Add a Look around so you notice them.",
            },
        cardId: sawSomething ? "fire" : "turret-sweep",
      },
      weight: 100,
    });
  }

  const sightings = seen(coverage, "sense robot");
  if (sightings.queued > 0 && sightings.handled === 0) {
    found.push({
      id: "saw-nothing-done",
      icon: "👀",
      say: {
        // Interpolated rather than left as a placeholder: `fillVocab` knows
        // `{robot}` and would print `{n}` at a child verbatim.
        full: `Something came into view ${sightings.queued} times and your {robot} had no answer for it.`,
        simple: "You saw somebody, but nothing happened.",
      },
      fix: {
        say: {
          full: "Add an `on sense robot` block.",
          simple: "Add a When I see somebody.",
        },
      },
      weight: 95,
    });
  }

  // A robot that never moved is a robot whose `on start` did nothing, and it
  // reads as a broken game rather than as a mistake unless it is said.
  if (coverage && seen(coverage, "start").handled === 0 && ticks > 0) {
    found.push({
      id: "never-started",
      icon: "😴",
      say: {
        full: "Nothing ran at the start of the fight.",
        simple: "Your {robot} never woke up.",
      },
      fix: {
        say: {
          full: "Add an `on start` block to set it going.",
          simple: "Add a When the fight starts.",
        },
      },
      weight: 110,
    });
  }

  // --- the things that went wrong ----------------------------------------

  if (mine.errors > 0) {
    found.push({
      id: "errors",
      icon: "⚠️",
      say: {
        full: `Your {robot} hit a problem while it ran${mine.lastError ? ` — ${mine.lastError}` : ""}.`,
        simple: "Your {robot} got stuck on something.",
      },
      weight: 120,
    });
  }

  const wallBumps = seen(coverage, "hit wall").queued;
  if (wallBumps > 20) {
    found.push({
      id: "walls",
      icon: "🧱",
      say: {
        full: `You drove into a wall ${wallBumps} times.`,
        simple: `You bumped into the wall ${wallBumps} times.`,
      },
      fix: {
        say: {
          full: "Turn away when you hit one — `on hit wall`.",
          simple: "Add a When I bump a wall, and turn.",
        },
      },
      weight: 60,
    });
  }

  if (mine.shotsFired >= 5 && mine.shotsHit === 0) {
    found.push({
      id: "all-missed",
      icon: "💨",
      say: {
        full: `All ${mine.shotsFired} of your shots missed.`,
        simple: "You shot lots of times and never hit.",
      },
      fix: {
        say: {
          full: "Point the {turret} at them before you {fire} — `turret.aim at event.bearing`.",
          simple: "Point at them first, then shoot.",
        },
        cardId: "turret-aim",
      },
      weight: 80,
    });
  }

  // --- how it actually went ----------------------------------------------

  found.push(
    won
      ? {
          id: "won",
          icon: "🏆",
          say: { full: "You won.", simple: "You won!" },
          weight: 10,
        }
      : {
          id: "lost",
          icon: "💥",
          say: {
            full: `You came ${ordinal(mine.place)} of ${field.length}.`,
            simple: mine.survived ? "You did not win this one." : "You were knocked out.",
          },
          weight: 10,
        },
  );

  if (mine.shotsHit > 0 || mine.damageTaken > 0) {
    const theirHits = others.reduce((n, t) => n + t.shotsHit, 0);
    found.push({
      id: "trading",
      icon: "🥊",
      say: {
        full: `You hit ${mine.shotsHit} times and were hit ${theirHits}.`,
        simple: `You hit them ${mine.shotsHit} times. They hit you ${theirHits} times.`,
      },
      weight: 20,
    });
  }

  return found.sort((a, b) => b.weight - a.weight);
}

function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? "st"
    : n % 10 === 2 && n % 100 !== 12 ? "nd"
    : n % 10 === 3 && n % 100 !== 13 ? "rd"
    : "th";
  return `${n}${suffix}`;
}
