/**
 * Choosing what a match is fought on.
 *
 * Two mutually exclusive answers, which is the whole design of this control:
 * either the ground is GENERATED from one of the three preset words, or a saved
 * arena is BROUGHT and it carries its own ground plus its walls.
 *
 * They are alternatives rather than layers on purpose. A saved arena already
 * holds a terrain config, so letting the host also pick "hilly" would leave two
 * sources of truth for the same four numbers, and the arena somebody drew and
 * tested would not be the arena that got played. So picking one disables the
 * other, visibly, rather than silently winning.
 *
 * Shared between the Arena lobby and the Tournament setup because the choice is
 * identical in both and a robot tuned against a map in one should be meeting the
 * same map in the other — the same argument that put the preset words in
 * `matchSettings.ts` in the first place.
 */

import type { Theme } from "../lang/vocab.js";
import { THEMES } from "../lang/vocab.js";
import type { ArenaSpec } from "../sim/types.js";
import type { StoredArena } from "../store/types.js";
import {
  TERRAIN_LEVELS,
  arenaForLevel,
  terrainBlurb,
  terrainHeading,
  terrainIntro,
  terrainLevelWord,
  type TerrainLevel,
} from "./matchSettings.js";

/** "Generate one" or the id of a saved arena. */
export type ArenaChoiceValue = { kind: "generated" } | { kind: "saved"; id: string };

export const GENERATE = { kind: "generated" } as const;

/**
 * Resolve a choice into the map a match will actually use.
 *
 * Falls back to the generated map when the chosen arena has since been deleted,
 * rather than refusing to start: a lobby full of people is the worst possible
 * place to discover that a map is missing.
 */
export function resolveArena(
  choice: ArenaChoiceValue,
  level: TerrainLevel,
  arenas: readonly StoredArena[],
): ArenaSpec {
  if (choice.kind === "saved") {
    const found = arenas.find((a) => a.id === choice.id);
    if (found) return found.spec;
  }
  return arenaForLevel(level);
}

export function ArenaChoicePanel({
  theme,
  arenas,
  choice,
  onChoice,
  level,
  onLevel,
}: {
  theme: Theme;
  arenas: readonly StoredArena[];
  choice: ArenaChoiceValue;
  onChoice: (value: ArenaChoiceValue) => void;
  level: TerrainLevel;
  onLevel: (level: TerrainLevel) => void;
}) {
  const words = THEMES[theme];
  const brought = choice.kind === "saved" ? arenas.find((a) => a.id === choice.id) : undefined;

  return (
    <>
      <div className="panel-head">
        <span className="silkscreen">{terrainHeading(theme)}</span>
      </div>
      <div className="panel-body">
        {arenas.length > 0 ? (
          <div className="row">
            <select
              className="btn small"
              aria-label={`Bring a saved ${words.arena}`}
              value={choice.kind === "saved" ? choice.id : ""}
              onChange={(e) =>
                onChoice(e.target.value ? { kind: "saved", id: e.target.value } : GENERATE)
              }
            >
              <option value="">Generate a new {words.arena}</option>
              {arenas.map((arena) => (
                <option key={arena.id} value={arena.id}>
                  {arena.name}
                  {arena.spec.walls.length > 0 ? ` — ${arena.spec.walls.length} walls` : ""}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {brought ? (
          // The preset buttons are not merely ignored here, they are gone. A
          // disabled row of words that no longer describe the match would be
          // worse than no row at all.
          <p className="empty small">
            Fighting in <strong>{brought.name}</strong> — it brings its own {words.ground}
            {brought.spec.walls.length > 0
              ? ` and ${brought.spec.walls.length} walls`
              : ", and no walls"}
            .
          </p>
        ) : (
          <>
            <p className="empty small">{terrainIntro(theme)}</p>
            <div className="row">
              {TERRAIN_LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`btn small${level === l ? " primary" : ""}`}
                  onClick={() => onLevel(l)}
                >
                  {terrainLevelWord(l, theme)}
                </button>
              ))}
            </div>
            <p className="empty small">{terrainBlurb(level, theme)}</p>
          </>
        )}
      </div>
    </>
  );
}
