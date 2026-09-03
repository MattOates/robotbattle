/**
 * The spine, always on screen.
 *
 * The menu presents Learn, Workshop, Arena, Tournament, Trade and Reference as
 * six equal cards, which is honest about the architecture and useless as a
 * sense of direction: nothing on it says where you are, where you came from, or
 * what any of it is for. An adult reads the blurbs. A child clicks the first
 * card.
 *
 * So the modes are laid out as an arc — **Learn, Build, Fight, Share** — with
 * the station you are on lit, the ones you have not earned dimmed and labelled
 * with the quest that opens them, and one sentence saying what to do next. It
 * is the same six screens. What is new is that they are in an order, and that
 * the order is a sentence: learn how, build one, fight with it, give it away.
 *
 * Not shown to an Engineer, who has been using the menu perfectly well and does
 * not need a game telling them where they are.
 */

import { navigate, type ScreenName } from "./router.js";
import { showsMode, type Level } from "./level.js";
import type { QuestApi } from "./quest/useQuests.js";

interface Station {
  id: string;
  /** Which screen the button goes to. */
  screen: ScreenName;
  label: { full: string; simple: string };
  icon: string;
  /**
   * Screens that count as being "at" this station.
   *
   * A tournament is a kind of fighting and the trial pane is another; neither
   * deserves a station of its own, and giving each one would put the arc back
   * to being a directory with icons.
   */
  covers: readonly ScreenName[];
}

const STATIONS: readonly Station[] = [
  {
    id: "learn",
    screen: "learn",
    label: { full: "Learn", simple: "Learn" },
    icon: "📖",
    covers: ["learn", "reference"],
  },
  {
    id: "build",
    screen: "workshop",
    label: { full: "Build", simple: "Build" },
    icon: "🔧",
    covers: ["workshop", "pair"],
  },
  {
    id: "fight",
    screen: "arena",
    label: { full: "Fight", simple: "Fight" },
    icon: "⚔️",
    covers: ["arena", "tournament"],
  },
  {
    id: "share",
    screen: "trade",
    label: { full: "Share", simple: "Share" },
    icon: "🎁",
    covers: ["trade"],
  },
];

interface Props {
  level: Level;
  screen: ScreenName;
  quests: QuestApi;
  say: (both: { full: string; simple: string }) => string;
  fill: (text: string) => string;
  onOpenLog: () => void;
}

export function JourneyBar({ level, screen, quests, say, fill, onOpenLog }: Props) {
  const next = quests.next;
  const doneCount = quests.quests.filter((q) =>
    q.steps.every((s) => quests.done.has(`${q.id}/${s.id}`)),
  ).length;

  return (
    <nav className="journey" aria-label="Where you are">
      <ol className="journey-stations">
        {STATIONS.map((station) => {
          const here = station.covers.includes(screen);
          // A station is open if the level shows it, or a quest has opened it.
          const open = showsMode(level, station.screen, quests.unlocked.modes);
          // Which quest would open it, so a locked station explains itself
          // rather than simply refusing.
          const opener = open
            ? null
            : quests.quests.find(
                (q) => q.reward.kind === "unlock" && q.reward.mode === station.screen,
              );
          return (
            <li key={station.id}>
              <button
                type="button"
                className={`journey-station${here ? " here" : ""}${open ? "" : " locked"}`}
                aria-current={here ? "page" : undefined}
                /* Locked stations are still buttons, and they still go there.
                   Nothing in this game is a wall — the dimming says "not yet
                   the point", not "you may not". */
                onClick={() => navigate(station.screen)}
                title={
                  opener ? fill(`Opens when you finish: ${say(opener.title)}`) : undefined
                }
              >
                <span className="journey-icon" aria-hidden="true">
                  {station.icon}
                </span>
                <span className="journey-label">{say(station.label)}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* The single most useful thing on screen: what to do next, as a
          sentence, with the button that does it. */}
      <div className="journey-next">
        {next ? (
          <button type="button" className="journey-todo" onClick={onOpenLog}>
            <span className="journey-todo-icon" aria-hidden="true">
              {next.quest.icon}
            </span>
            <span className="journey-todo-text">{fill(say(next.step.say))}</span>
          </button>
        ) : (
          <button type="button" className="journey-todo" onClick={onOpenLog}>
            <span className="journey-todo-icon" aria-hidden="true">
              🏅
            </span>
            <span className="journey-todo-text">All done here</span>
          </button>
        )}
      </div>

      <div className="journey-tools">
        <button
          type="button"
          className="btn small"
          onClick={onOpenLog}
          aria-label={`Your quests — ${doneCount} of ${quests.quests.length} done`}
        >
          Quests {doneCount}/{quests.quests.length}
        </button>
      </div>
    </nav>
  );
}
