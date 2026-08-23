/**
 * Live standings during a match.
 *
 * Shows both names a robot has: the one it declared, and the label its script
 * is currently displaying — watching that label change is often the fastest way
 * to understand what someone's robot is thinking.
 */

import { MAX_HEALTH } from "../sim/types.js";
import { THEMES, type Theme } from "../lang/vocab.js";
import { teamLabel } from "./matchSettings.js";
import type { MatchStatus } from "./MatchCanvas.js";

interface Props {
  status: MatchStatus | null;
  theme: Theme;
  /**
   * What each entry was picked as, indexed by entry. Two saved versions of one
   * robot declare the same name, so without this a comparison between them is
   * two identical rows. Optional: only the Trial knows what it lined up.
   */
  entryLabels?: ReadonlyArray<string>;
}

export function Standings({ status, theme, entryLabels }: Props) {
  const words = THEMES[theme];

  if (!status) {
    return (
      <div className="empty">
        No match running. Add a robot or two, then press Start match.
      </div>
    );
  }

  const ranked = [...status.robots].sort((a, b) => {
    // With sides, the winning one takes the top places rather than being
    // interleaved with whoever it outlived — the same rule `summarise` uses for
    // the final table, so the live board and the results agree.
    if (status.winnerTeam !== null) {
      const aWon = a.team === status.winnerTeam;
      const bWon = b.team === status.winnerTeam;
      if (aWon !== bWon) return aWon ? -1 : 1;
    }
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (b.health !== a.health) return b.health - a.health;
    return b.damageDealt - a.damageDealt;
  });

  // Health left on each side, so a team match can be read at a glance as a
  // contest between two bars rather than four rows.
  const sides = new Map<number, { health: number; alive: number }>();
  if (status.teamed) {
    for (const r of status.robots) {
      const side = sides.get(r.team) ?? { health: 0, alive: 0 };
      side.health += Math.max(0, r.health);
      side.alive += r.alive ? 1 : 0;
      sides.set(r.team, side);
    }
  }

  return (
    <>
      {status.teamed ? (
        <div className="team-tally">
          {[...sides.keys()]
            .sort((a, b) => a - b)
            .map((team) => {
              const side = sides.get(team)!;
              const out = side.alive === 0;
              return (
                <span key={team} className={`team-side${out ? " out" : ""}`}>
                  <span className={`team-badge t${team % 6}`}>{team + 1}</span>
                  {teamLabel(team, theme)} · {Math.round(side.health)}{" "}
                  {words.health.slice(0, 3)} · {side.alive} left
                </span>
              );
            })}
        </div>
      ) : null}
      <div className="standings">
        {ranked.map((r, i) => {
          const frac = Math.max(0, r.health / MAX_HEALTH);
          const level = frac > 0.5 ? "" : frac > 0.25 ? " low" : " critical";
          return (
            <div
              key={r.id}
              className={`standing${status.teamed ? " teamed" : ""}${i === 0 && r.alive ? " leader" : ""}${r.alive ? "" : " out"}`}
            >
              <span className="place">{i + 1}</span>
              {/* The side as a number, not only as a colour: two team colours
                  will always look close to somebody, and a number does not. */}
              {status.teamed ? (
                <span className={`team-badge t${r.team % 6}`} title={teamLabel(r.team, theme)}>
                  {r.team + 1}
                </span>
              ) : null}
              <span className="chip" style={{ background: r.color }} />
              <span className="who" title={r.error ?? undefined}>
                {r.declaredName}
                {entryLabels?.[r.id] && entryLabels[r.id] !== r.declaredName ? (
                  <span className="entry-label"> {entryLabels[r.id]}</span>
                ) : null}
                {r.name !== r.declaredName ? (
                  <span className="roster-meta"> · {r.name}</span>
                ) : null}
              </span>
              <span className={`meter${level}`}>
                <i style={{ width: `${frac * 100}%` }} />
              </span>
              <span className="tally">
                {Math.round(r.health)} {words.health.slice(0, 3)} · {r.kills}k
              </span>
            </div>
          );
        })}
      </div>
      {status.over ? (
        <div className="verdict">
          {/* A side that won with more than one robot standing is not described
              by any single name, so it is named as the side it is. */}
          {status.winnerTeam !== null && (sides.get(status.winnerTeam)?.alive ?? 0) > 1
            ? `${teamLabel(status.winnerTeam, theme)} wins`
            : status.winnerName
              ? `${status.winnerName} wins`
              : "No survivors"}
        </div>
      ) : null}
    </>
  );
}
