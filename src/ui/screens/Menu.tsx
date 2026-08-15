/**
 * The main menu.
 *
 * The background is a real match — the sample bots fighting for real, restarted
 * with a fresh seed whenever someone wins. It costs nothing (the simulation and
 * renderer already exist) and it is the most honest hero image the game could
 * have: what you see behind the menu is exactly what the game does.
 */

import { useMemo, useState } from "react";
import { MatchCanvas } from "../MatchCanvas.js";
import { navigate, type ScreenName } from "../router.js";
import { makeManifest } from "../../sim/world.js";
import { DODGER, HUNTER, RACER, SPINNER } from "../../bots/index.js";
import { THEMES, type Theme } from "../../lang/vocab.js";

interface Props {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  robotCount: number;
}

interface ModeCard {
  screen: ScreenName;
  title: string;
  blurb: string;
  /** Modes that need other people are marked, so nobody hits a dead end alone. */
  needsPeople: boolean;
}

const MODES: ModeCard[] = [
  {
    screen: "workshop",
    title: "Workshop",
    blurb: "Write a robot, test it against the arena bots, and keep every version you try.",
    needsPeople: false,
  },
  {
    screen: "arena",
    title: "Arena",
    blurb: "Everyone's robot in one arena at once. Last one running wins.",
    needsPeople: true,
  },
  {
    screen: "tournament",
    title: "Tournament",
    blurb: "One against one, round after round, until a single robot is left standing.",
    needsPeople: true,
  },
  {
    screen: "pair",
    title: "Pair Program",
    blurb: "Build a robot together in one editor, with chat, and see each other type.",
    needsPeople: true,
  },
  {
    screen: "trade",
    title: "Trade",
    blurb: "Show each other your robots and swap copies — with permission, never without.",
    needsPeople: true,
  },
];

/** Robots for the background fight. A mix that produces a lively match. */
const BACKGROUND_BOTS = [
  { source: HUNTER },
  { source: RACER },
  { source: SPINNER },
  { source: DODGER },
];

export function Menu({ theme, onThemeChange, robotCount }: Props) {
  const [seed] = useState(() => Math.floor(Math.random() * 1e9));

  const manifest = useMemo(
    () => makeManifest(BACKGROUND_BOTS, { seed, maxTicks: 30 * 60 }),
    [seed],
  );

  // Respect a preference for stillness: the match is built either way, but it
  // is not animated.
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  const words = THEMES[theme];

  return (
    <div className="menu">
      <div className="menu-backdrop">
        <MatchCanvas
          manifest={manifest}
          theme={theme}
          showCones={false}
          running={!reducedMotion}
          fit="cover"
          ambient
          autoRestart={() => Math.floor(Math.random() * 1e9)}
        />
      </div>

      <div className="menu-content">
        <header className="menu-head">
          <h1 className="menu-title">
            Robo<span>Battle</span>
          </h1>
          <p className="menu-strap">
            Program a robot in a little language of its own. Then find out whose is best.
          </p>
        </header>

        <nav className="menu-modes" aria-label="Game modes">
          {MODES.map((mode) => (
            <button
              key={mode.screen}
              type="button"
              className="mode-card"
              onClick={() => navigate(mode.screen)}
            >
              <span className="mode-title">{mode.title}</span>
              <span className="mode-blurb">{mode.blurb}</span>
              <span className="mode-foot">
                {mode.needsPeople ? "Needs someone to play with" : `${robotCount} in your library`}
              </span>
            </button>
          ))}
        </nav>

        <footer className="menu-foot">
          <div className="toggle" role="group" aria-label="Theme">
            <button
              type="button"
              aria-pressed={theme === "mechanical"}
              onClick={() => onThemeChange("mechanical")}
            >
              Mechanical
            </button>
            <button
              type="button"
              aria-pressed={theme === "biological"}
              onClick={() => onThemeChange("biological")}
            >
              Biological
            </button>
          </div>
          <span className="menu-note">
            Robots are {words.robotPlural} here, and they fight in {words.arena}.
          </span>
        </footer>
      </div>
    </div>
  );
}
