/**
 * Live standings during a match.
 *
 * Shows both names a robot has: the one it declared, and the label its script
 * is currently displaying — watching that label change is often the fastest way
 * to understand what someone's robot is thinking.
 */

import { MAX_HEALTH } from "../sim/types.js";
import { THEMES, type Theme } from "../lang/vocab.js";
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
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (b.health !== a.health) return b.health - a.health;
    return b.damageDealt - a.damageDealt;
  });

  return (
    <>
      <div className="standings">
        {ranked.map((r, i) => {
          const frac = Math.max(0, r.health / MAX_HEALTH);
          const level = frac > 0.5 ? "" : frac > 0.25 ? " low" : " critical";
          return (
            <div
              key={r.id}
              className={`standing${i === 0 && r.alive ? " leader" : ""}${r.alive ? "" : " out"}`}
            >
              <span className="place">{i + 1}</span>
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
          {status.winnerName ? `${status.winnerName} wins` : "No survivors"}
        </div>
      ) : null}
    </>
  );
}
