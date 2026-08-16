/**
 * The tree, drawn as one column per round.
 *
 * Two things it must convey that a list of names cannot: which robots are still
 * alive in the draw, and that every promotion was earned over eleven matches
 * rather than one. So a settled tie shows its scoreline, and offers the match
 * behind it — the point of playing eleven is undermined if the room never sees
 * any of them.
 */

import { RobotGlyph } from "./RobotGlyph.js";
import { entrant, roundName, type Bracket, type BracketMatch } from "../net/bracket.js";
import { scoreline } from "../tournament/duel.js";
import type { DuelRecord } from "../tournament/round.js";
import { deriveMeta } from "../store/library.js";
import type { Theme } from "../lang/vocab.js";

interface Props {
  bracket: Bracket;
  /** Settled ties, by bracket match id. */
  records: Record<string, DuelRecord>;
  theme: Theme;
  /** Which round is being played right now, if any. */
  runningRound: number | null;
  /** Watch the match behind one tie. */
  onWatch: (matchId: string) => void;
  /** Watch every settled tie of a round, back to back. */
  onWatchRound: (round: number) => void;
}

export function BracketView({
  bracket,
  records,
  theme,
  runningRound,
  onWatch,
  onWatchRound,
}: Props) {
  return (
    <div className="bracket">
      {bracket.rounds.map((matches, round) => {
        const watchable = matches.filter((m) => records[m.id]?.result.showcase);
        const live = runningRound === round;
        return (
          <section key={round} className="bracket-round">
            <div className="entry-label">
              {roundName(bracket, round)}
              {watchable.length > 1 ? (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => onWatchRound(round)}
                  title="Play every match of this round one after another"
                >
                  ▶ Play all {watchable.length}
                </button>
              ) : null}
              {live ? <span className="lamp live">running</span> : null}
            </div>

            <div className="bracket-column">
              {matches.map((match) => (
                <Tie
                  key={match.id}
                  bracket={bracket}
                  match={match}
                  record={records[match.id]}
                  theme={theme}
                  onWatch={onWatch}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Tie({
  bracket,
  match,
  record,
  theme,
  onWatch,
}: {
  bracket: Bracket;
  match: BracketMatch;
  record: DuelRecord | undefined;
  theme: Theme;
  onWatch: (matchId: string) => void;
}) {
  // A slot with nobody in it at all is bracket padding, not a match anyone is
  // waiting for; drawing it as "— vs —" only makes the tree harder to read.
  if (match.a === null && match.b === null && match.winner === null) {
    return <div className="tie empty">—</div>;
  }

  return (
    <div className={`tie${match.winner !== null ? " settled" : ""}`}>
      <Corner bracket={bracket} id={match.a} winner={match.winner} theme={theme} />
      <Corner bracket={bracket} id={match.b} winner={match.winner} theme={theme} />

      <div className="tie-foot">
        {match.bye ? (
          <span className="roster-meta">bye</span>
        ) : record ? (
          <>
            <span className="roster-meta" title={decidedTitle(record)}>
              {scoreline(record.result)}
            </span>
            {record.result.showcase ? (
              <button
                type="button"
                className="btn small"
                onClick={() => onWatch(match.id)}
                title="Watch one of the eleven — a match the winner won"
              >
                ▶ Watch
              </button>
            ) : null}
          </>
        ) : match.a !== null && match.b !== null ? (
          <span className="roster-meta">waiting</span>
        ) : (
          <span className="roster-meta">to be decided</span>
        )}
      </div>
    </div>
  );
}

function Corner({
  bracket,
  id,
  winner,
  theme,
}: {
  bracket: Bracket;
  id: string | null;
  winner: string | null;
  theme: Theme;
}) {
  const who = entrant(bracket, id);
  if (!who) return <div className="tie-corner pending">—</div>;

  const beaten = winner !== null && winner !== who.id;
  return (
    <div className={`tie-corner${winner === who.id ? " won" : ""}${beaten ? " lost" : ""}`}>
      <RobotGlyph
        color={who.robot.color}
        locomotion={deriveMeta(who.robot.source)?.locomotion ?? "skid"}
        theme={theme}
        size={26}
        name={who.robot.name}
      />
      <span className="tie-name">{who.robot.name}</span>
      <span className="roster-meta">{who.ownerName}</span>
    </div>
  );
}

function decidedTitle(record: DuelRecord): string {
  switch (record.result.decidedBy) {
    case "record":
      return `Won ${record.result.winRate.toFixed(0)}% of ${record.result.matches} matches`;
    case "health":
      return "Level on wins; settled on health left across the eleven";
    case "walkover":
      return "Through unopposed: the other script would not compile";
    default:
      return "Neither script would compile";
  }
}
