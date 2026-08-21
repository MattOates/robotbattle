/**
 * What a cadence clause is allowed to say, in one place.
 *
 * `every`, `after`, `before` and `at` are filters on the same count, so the
 * order they are written in carries no meaning and several of the combinations
 * carry no meaning either — `at 2 every 3` cannot be true, `after 9 before 10`
 * leaves nothing in between. Those are facts about the language rather than
 * about any one parser, and they used to live inside `parseCountClauses` where
 * only that parser could reach them.
 *
 * Both front ends call this, so both give the same answer, and the reference
 * page can describe the rules from the same source that enforces them.
 */

import type { CountClause } from "./ast.js";
import { RoboScriptError, type SourcePos } from "./errors.js";

/**
 * The one canonical order. Independent filters sort into it before they leave
 * the parser, so `every 10 after 25` and `after 25 every 10` are not merely
 * equivalent but the identical program — which is what everything comparing two
 * scripts, the golden hash included, relies on.
 */
const RANK = { every: 0, after: 1, before: 2, at: 3 } as const;

/** Said once a kind is known but before its number has been read. */
export function checkNotRepeated(
  seen: readonly CountClause[],
  kind: CountClause["kind"],
  pos: SourcePos,
  what: string,
): void {
  const already = seen.find((c) => c.kind === kind);
  if (already) {
    throw new RoboScriptError(
      `\`${what}\` already says \`${kind} ${already.value}\``,
      pos,
      "one `every`, one `after`, one `before` — saying it twice would only contradict itself",
    );
  }
}

/** Said once every clause has been read, and returns them in canonical order. */
export function checkCounts(counts: CountClause[]): CountClause[] {
  // `at 2` is already "the count is exactly 2", so nothing else has anything
  // left to narrow — a second clause beside it can only be a misunderstanding.
  const at = counts.find((c) => c.kind === "at");
  if (at && counts.length > 1) {
    const other = counts.find((c) => c.kind !== "at")!;
    throw new RoboScriptError(
      `\`at ${at.value}\` and \`${other.kind} ${other.value}\` cannot both be true`,
      other.pos,
      "`at` pins the count exactly, so it goes on its own — use `every`, `after` and `before` together instead",
    );
  }

  const every = counts.find((c) => c.kind === "every");
  const after = counts.find((c) => c.kind === "after");
  const before = counts.find((c) => c.kind === "before");
  if (after && before && after.value >= before.value - 1) {
    throw new RoboScriptError(
      `\`after ${after.value} before ${before.value}\` leaves no times in between`,
      before.pos,
      "`after` and `before` are both exclusive, so there has to be room between them",
    );
  }
  // `after` starts the cadence counting, so the first run is that many on from
  // there — which is what decides whether `before` leaves room for it.
  if (every && before) {
    const first = (after?.value ?? 0) + every.value;
    if (first >= before.value) {
      throw new RoboScriptError(
        `\`every ${every.value}\` never comes round before ${before.value}`,
        every.pos,
        after
          ? `counting starts again after ${after.value}, so the first run would be number ${first}`
          : `the first run would be number ${first}`,
      );
    }
  }

  return counts.sort((a, b) => RANK[a.kind] - RANK[b.kind]);
}
