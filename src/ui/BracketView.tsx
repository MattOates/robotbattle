/**
 * The draw, as a tree.
 *
 * Columns of ties alone are only a table with extra steps: they leave the
 * reader to work out which pair feeds which slot, which is the one thing a
 * bracket exists to show. So the ties are joined by drawn connectors, and the
 * line a winner travelled along is lit.
 *
 * The lines are an SVG overlay measured from the laid-out cards rather than CSS
 * borders faked with pseudo-elements. Cards here are not a fixed height — a
 * settled tie carries a scoreline and a Watch button, a bye carries neither —
 * and every pseudo-element trick for brackets assumes they are. Measuring means
 * the elbows land on the real centres whatever the cards do, at any width, in
 * either theme.
 *
 * It must also convey that a promotion was earned over eleven matches rather
 * than one, which is why a settled tie shows its scoreline and offers the match
 * behind it.
 */

import { forwardRef, useCallback, useLayoutEffect, useRef, useState } from "react";
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

/** One drawn connector: a child tie feeding the slot above it. */
interface Line {
  key: string;
  d: string;
  /** True when the robot promoted along this line is already known. */
  taken: boolean;
}

export function BracketView({
  bracket,
  records,
  theme,
  runningRound,
  onWatch,
  onWatchRound,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // One stable callback per id: a fresh function each render would make React
  // detach and reattach every ref on every render, and the observer with it.
  const refCallbacks = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const register = useCallback((id: string) => {
    const existing = refCallbacks.current.get(id);
    if (existing) return existing;
    const callback = (element: HTMLDivElement | null) => {
      if (element) nodes.current.set(id, element);
      else nodes.current.delete(id);
    };
    refCallbacks.current.set(id, callback);
    return callback;
  }, []);

  /**
   * Measure the laid-out cards and route an elbow from each tie to the slot it
   * feeds. Offsets are taken against the scrolling container rather than the
   * viewport, so the lines stay attached when the tree is scrolled sideways.
   */
  const measure = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;

    const next: Line[] = [];
    for (const matches of bracket.rounds) {
      for (const match of matches) {
        // Each match remembers the ties that fed it, because pairings are made
        // when a round finishes rather than being fixed by the slot number.
        for (const childId of match.from) {
          if (childId === null) continue;
          const from = nodes.current.get(childId);
          const to = nodes.current.get(match.id);
          if (!from || !to) continue;
          const child = findMatch(bracket, childId);
          next.push({
            key: `${childId}->${match.id}`,
            d: elbow(from, to),
            taken: child?.winner != null,
          });
        }
      }
    }

    // And the final into the champion's plinth, so the tree resolves to one
    // node instead of stopping in mid-air.
    const finalMatch = bracket.rounds.at(-1)?.[0];
    const finalNode = finalMatch ? nodes.current.get(finalMatch.id) : undefined;
    const plinth = nodes.current.get(CHAMPION);
    if (finalMatch && finalNode && plinth) {
      next.push({
        key: "champion",
        d: elbow(finalNode, plinth),
        taken: bracket.champion !== null,
      });
    }

    // Sized from the cards rather than from the container's scroll extent: the
    // overlay is absolutely positioned inside that container, so measuring the
    // scroll extent would measure the overlay itself and latch it at whatever
    // width the tree once had, leaving a scrollbar over a tree that now fits.
    let width = host.clientWidth;
    let height = host.clientHeight;
    for (const node of nodes.current.values()) {
      width = Math.max(width, node.offsetLeft + node.offsetWidth);
      height = Math.max(height, node.offsetTop + node.offsetHeight);
    }

    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    setLines((prev) => (sameLines(prev, next) ? prev : next));
  }, [bracket]);

  // After layout rather than after paint: lines drawn a frame late read as a
  // flicker every time a round is played.
  useLayoutEffect(() => {
    measure();
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    // Cards change height when a tie gains a scoreline, and the whole tree
    // reflows when the panel does; both have to move the lines with them.
    const observer = new ResizeObserver(() => measure());
    observer.observe(host);
    for (const node of nodes.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [measure, records]);

  // A full classroom makes a 32-slot draw: sixteen ties in the first column,
  // and a tree far taller than the panel. Past a certain size the cards have to
  // give up some of their comfort or nobody can see two rounds at once.
  const dense = (bracket.rounds[0]?.length ?? 0) > 8;

  return (
    <div className={`bracket${dense ? " dense" : ""}`} ref={hostRef}>
      <svg
        className="bracket-lines"
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${Math.max(1, size.width)} ${Math.max(1, size.height)}`}
        aria-hidden="true"
      >
        {lines.map((line) => (
          <path key={line.key} className={`bracket-line${line.taken ? " taken" : ""}`} d={line.d} />
        ))}
      </svg>

      {bracket.rounds.map((matches, round) => {
        const byes = matches.filter((m) => m.bye).length;
        const watchable = matches.filter((m) => records[m.id]?.result.showcase);
        const live = runningRound === round;
        // A round of nothing but byes is a row of blanks; there is no round
        // there to look at.
        if (byes === matches.length) return null;
        return (
          <section key={round} className="bracket-round">
            <div className="entry-label">
              {roundName(bracket, round)}
              {byes > 0 ? (
                <span
                  className="roster-meta"
                  title="An odd number left, so the best qualifier still standing is seeded through"
                >
                  odd number — one seeded
                </span>
              ) : null}
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
              {matches.map((match) =>
                /**
                 * A bye is not a blank: it is a robot that earned its place.
                 *
                 * Any round with an odd number left has to strand somebody, and
                 * the qualifying table decides who — so the slot says whose it
                 * is and why, rather than leaving a gap that reads as a bug.
                 */
                match.bye ? (
                  <Seeded
                    key={match.id}
                    ref={register(match.id)}
                    bracket={bracket}
                    match={match}
                    theme={theme}
                    dense={dense}
                  />
                ) : (
                  <Tie
                    key={match.id}
                    ref={register(match.id)}
                    bracket={bracket}
                    match={match}
                    record={records[match.id]}
                    theme={theme}
                    dense={dense}
                    onWatch={onWatch}
                  />
                ),
              )}
            </div>
          </section>
        );
      })}

      {/* The tree ends somewhere: a winner's plinth, so the final has something
          to promote into rather than trailing off the right-hand edge. */}
      <section className="bracket-round champion-round">
        <div className="entry-label">Champion</div>
        <div className="bracket-column">
          <Champion ref={register(CHAMPION)} bracket={bracket} theme={theme} />
        </div>
      </section>
    </div>
  );
}

/** The node every line eventually points at. */
const CHAMPION = "__champion";

/**
 * The odd one out, seeded to the next round.
 *
 * Shown as a card rather than a gap, with the reason on it: this is the one
 * place in the tournament where a robot advances without playing, so it should
 * be the most clearly explained thing on the tree rather than the least.
 */
const Seeded = forwardRef<
  HTMLDivElement,
  { bracket: Bracket; match: BracketMatch; theme: Theme; dense: boolean }
>(function Seeded({ bracket, match, theme, dense }, ref) {
  const who = entrant(bracket, match.winner ?? match.a);
  const place = who ? bracket.ranking.indexOf(who.id) : -1;

  return (
    <div className="tie seeded" ref={ref}>
      <Corner
        bracket={bracket}
        id={who?.id ?? null}
        winner={who?.id ?? null}
        theme={theme}
        dense={dense}
      />
      <div className="tie-foot">
        <span className="marker seeded-mark">seeded</span>
        <span
          className="roster-meta"
          title={
            place >= 0
              ? `An odd number left in this round, and ${who?.robot.name} qualified ${ordinal(place + 1)}`
              : "An odd number left in this round, so one robot goes through unopposed"
          }
        >
          {place >= 0 ? `${ordinal(place + 1)} in qualifying` : "through unopposed"}
        </span>
      </div>
    </div>
  );
});

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

const Champion = forwardRef<HTMLDivElement, { bracket: Bracket; theme: Theme }>(function Champion(
  { bracket, theme },
  ref,
) {
  const winner = entrant(bracket, bracket.champion);
  if (!winner) {
    return (
      <div className="champion-slot empty" ref={ref}>
        still to be won
      </div>
    );
  }
  return (
    <div className="champion-slot won" ref={ref}>
      <RobotGlyph
        color={winner.robot.color}
        locomotion={deriveMeta(winner.robot.source)?.locomotion ?? "skid"}
        theme={theme}
        size={54}
        name={winner.robot.name}
      />
      <span className="champion-name">{winner.robot.name}</span>
      <span className="roster-meta">{winner.ownerName}</span>
    </div>
  );
});

/** Takes a ref, so the tree can measure where each tie ended up. */
const Tie = forwardRef<
  HTMLDivElement,
  {
    bracket: Bracket;
    match: BracketMatch;
    record: DuelRecord | undefined;
    theme: Theme;
    dense: boolean;
    onWatch: (matchId: string) => void;
  }
>(function Tie({ bracket, match, record, theme, dense, onWatch }, ref) {
  // A slot with nobody in it at all is bracket padding, not a match anyone is
  // waiting for; drawing it as "— vs —" only makes the tree harder to read.
  if (match.a === null && match.b === null && match.winner === null) {
    return (
      <div className="tie empty" ref={ref}>
        —
      </div>
    );
  }

  return (
    <div className={`tie${match.winner !== null ? " settled" : ""}`} ref={ref}>
      <Corner bracket={bracket} id={match.a} winner={match.winner} theme={theme} dense={dense} />
      <Corner bracket={bracket} id={match.b} winner={match.winner} theme={theme} dense={dense} />

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
});

function Corner({
  bracket,
  id,
  winner,
  theme,
  dense,
}: {
  bracket: Bracket;
  id: string | null;
  winner: string | null;
  theme: Theme;
  dense: boolean;
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
        size={dense ? 20 : 26}
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
    case "toss":
      return "Nothing separated them over the eleven — through on the draw";
    case "walkover":
      return "Through unopposed: the other script would not compile";
    default:
      return "Neither script would compile";
  }
}

/** An elbow from the right edge of one card to the left edge of another. */
function elbow(from: HTMLElement, to: HTMLElement): string {
  const x1 = from.offsetLeft + from.offsetWidth;
  const y1 = from.offsetTop + from.offsetHeight / 2;
  const x2 = to.offsetLeft;
  const y2 = to.offsetTop + to.offsetHeight / 2;
  // Halfway across the gap, so the two lines into a slot share a vertical.
  const mid = x1 + (x2 - x1) / 2;
  return `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`;
}

function findMatch(bracket: Bracket, id: string): BracketMatch | undefined {
  for (const round of bracket.rounds) {
    const match = round.find((m) => m.id === id);
    if (match) return match;
  }
  return undefined;
}

/** Cheap equality, so measuring on every resize does not re-render the tree. */
function sameLines(a: Line[], b: Line[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((line, i) => line.d === b[i]!.d && line.taken === b[i]!.taken);
}
