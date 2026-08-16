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
import { BRANDING } from "../branding.js";

interface Props {
  theme: Theme;
  robotCount: number;
}

interface ModeCard {
  screen: ScreenName;
  title: string;
  blurb: string;
  /** Modes that need other people are marked, so nobody hits a dead end alone. */
  needsPeople: boolean;
  /** Marked on the card, so nobody picks it and then finds out. */
  underConstruction?: boolean;
}

const MODES: ModeCard[] = [
  {
    screen: "learn",
    title: "Learn",
    blurb: "How it all works, and how to write a robot — one idea at a time, with examples you can change and run.",
    needsPeople: false,
  },
  {
    screen: "workshop",
    title: "Workshop",
    blurb:
      "Write a robot, test it, keep every version — and open a session so other people can build it with you.",
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
    blurb:
      "A random draw from everything the room puts forward. Every tie is settled over eleven matches, and you can watch the ones that decided it.",
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

export function Menu({ theme, robotCount }: Props) {
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
  const brand = BRANDING[theme];

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
            {brand.prefix}
            <span>{brand.suffix}</span>
          </h1>
          <p className="menu-strap">{brand.strap}</p>
        </header>

        <nav className="menu-modes" aria-label="Game modes">
          {MODES.map((mode) => (
            <button
              key={mode.screen}
              type="button"
              className={`mode-card${mode.underConstruction ? " soon" : ""}`}
              onClick={() => navigate(mode.screen)}
            >
              <span className="mode-title">
                {mode.title}
                {mode.underConstruction ? (
                  <span className="mode-badge">Under construction</span>
                ) : null}
              </span>
              <span className="mode-blurb">{mode.blurb}</span>
              <span className="mode-foot">
                {mode.underConstruction
                  ? "Not playable yet — have a look at what is built"
                  : mode.needsPeople
                    ? "Needs someone to play with"
                    : mode.screen === "learn"
                      ? "Start here"
                      : `${robotCount} in your library`}
              </span>
            </button>
          ))}
        </nav>

        <footer className="menu-foot">
          <span className="menu-note">
            Robots are {words.robotPlural} here, and they fight in {words.arena}. Change that
            in settings, top right.
          </span>
          <span className="spacer" />
          {/* Not a mode card: About sits beside the game rather than in it. */}
          <button type="button" className="menu-link" onClick={() => navigate("about")}>
            About &amp; credits
          </button>
        </footer>
      </div>
    </div>
  );
}
