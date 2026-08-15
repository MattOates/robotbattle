/**
 * What is on the table.
 *
 * Trading starts with nothing shared. You put robots out deliberately, one at a
 * time, and only those are visible to the room — a library is a private working
 * space, and opening it wholesale the moment you join a room is not something
 * anybody asked for.
 *
 * The rule lives here rather than in the screen because it is the rule the
 * network has to obey, not a piece of presentation. Every incoming `peek` and
 * `copyRequest` names a robot id chosen by somebody else's browser, and an id
 * is easy to keep hold of: a peer who saw something on the table a minute ago,
 * or who guesses, must not be able to read a robot you have since taken back.
 * So the answer to "may they see this?" is asked of the table, never of the
 * library.
 */

import type { ShelfItem } from "../net/protocol.js";
import type { StoredRobot } from "../store/types.js";

/** How each offered robot looks, in the order it was put on the table. */
export function shelfFor(robots: StoredRobot[], offered: readonly string[]): ShelfItem[] {
  const out: ShelfItem[] = [];
  for (const id of offered) {
    const robot = robots.find((r) => r.id === id);
    if (robot) {
      out.push({
        id: robot.id,
        name: robot.name,
        color: robot.color,
        locomotion: robot.locomotion ?? "skid",
      });
    }
  }
  return out;
}

/**
 * The script of an offered robot, or null for anything else.
 *
 * Null covers three different situations on purpose — never offered, taken
 * back, and deleted — because the answer given to the room is the same in all
 * three, and saying which would leak the very thing being withheld.
 */
export function offeredSource(
  robots: StoredRobot[],
  offered: readonly string[],
  robotId: unknown,
): string | null {
  if (typeof robotId !== "string" || !offered.includes(robotId)) return null;
  return robots.find((r) => r.id === robotId)?.source ?? null;
}

/** Drop `id` from the table, or add it at the end if it is not there yet. */
export function toggleOffered(offered: readonly string[], id: string): string[] {
  return offered.includes(id) ? offered.filter((o) => o !== id) : [...offered, id];
}

/** Forget anything that has since been deleted from the library. */
export function pruneOffered(offered: readonly string[], robots: StoredRobot[]): string[] {
  return offered.filter((id) => robots.some((r) => r.id === id));
}
