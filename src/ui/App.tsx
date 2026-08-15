/**
 * The shell: routes between screens and owns the state they share.
 *
 * Screens are lazy so each mode is its own chunk — someone joining an Arena to
 * spectate should not download the editor, and the editor is the biggest part
 * of the bundle.
 */

import { Suspense, lazy, useEffect } from "react";
import { useRoute, navigate, type ScreenName } from "./router.js";
import { useLibrary, useProfile } from "./useLibrary.js";
import { branding } from "./branding.js";
import { Welcome } from "./screens/Welcome.js";
import { Settings } from "./Settings.js";

const Menu = lazy(() => import("./screens/Menu.js").then((m) => ({ default: m.Menu })));
const Workshop = lazy(() =>
  import("./screens/Workshop.js").then((m) => ({ default: m.Workshop })),
);
const Arena = lazy(() => import("./screens/Arena.js").then((m) => ({ default: m.Arena })));
const Trade = lazy(() => import("./screens/Trade.js").then((m) => ({ default: m.Trade })));
const Learn = lazy(() => import("./screens/Learn.js").then((m) => ({ default: m.Learn })));
const About = lazy(() => import("./screens/About.js").then((m) => ({ default: m.About })));

/** Modes whose screens are not built yet. Honest rather than a dead link. */
const NOT_YET: Partial<Record<ScreenName, string>> = {
  tournament:
    "The bracket, seeding and match progression are built and tested — the screen that draws them is not finished yet.",
};

/** Screens where the second path segment is a room code rather than a page id. */
const ROOM_SCREENS: ReadonlySet<ScreenName> = new Set<ScreenName>([
  "workshop",
  "arena",
  "tournament",
  "trade",
]);

export function App() {
  const route = useRoute();
  const { profile, setName, setTheme, complete } = useProfile();
  const lib = useLibrary();
  const brand = branding(profile.onboarded ? profile.theme : null);

  // The tab is named after the world you chose.
  useEffect(() => {
    document.title = brand.full;
  }, [brand.full]);

  // A first visit goes through the welcome screen, wherever they were headed.
  // The room code is remembered so a shared link still lands in the room.
  if (!profile.onboarded) {
    return (
      <Welcome
        invitedTo={ROOM_SCREENS.has(route.screen) ? route.room : null}
        onDone={(name, theme) => complete(name, theme)}
      />
    );
  }

  const pending = NOT_YET[route.screen];

  return (
    <>
      <Settings profile={profile} onName={setName} onTheme={setTheme} lib={lib} />
      <Suspense fallback={<div className="splash">Loading…</div>}>
      {route.screen === "menu" ? (
        <Menu theme={profile.theme} robotCount={lib.robots.length} />
      ) : null}

      {route.screen === "workshop" ? (
        <Workshop
          theme={profile.theme}
          lib={lib}
          playerName={profile.name}
          initialRoom={route.room}
        />
      ) : null}

      {route.screen === "arena" ? (
        <Arena
          theme={profile.theme}
          lib={lib}
          playerName={profile.name}
          onPlayerName={setName}
          initialRoom={route.room}
        />
      ) : null}

      {route.screen === "trade" ? (
        <Trade
          theme={profile.theme}
          lib={lib}
          playerName={profile.name}
          onPlayerName={setName}
          initialRoom={route.room}
        />
      ) : null}

      {route.screen === "learn" ? (
        <Learn theme={profile.theme} lessonId={route.room} />
      ) : null}

      {route.screen === "about" ? (
        <About
          theme={profile.theme}
          robotCount={lib.robots.length}
          storageBytes={lib.storage.used}
        />
      ) : null}

      {pending ? (
        <div className="workshop">
          <header className="screen-head">
            <button type="button" className="btn small" onClick={() => navigate("menu")}>
              ← Menu
            </button>
            <h2 className="screen-title">
              {route.screen[0]!.toUpperCase() + route.screen.slice(1)}
            </h2>
          </header>
          <div className="join-card">
            <p className="join-blurb">{pending}</p>
            <div className="join-actions">
              <button type="button" className="btn primary" onClick={() => navigate("workshop")}>
                Go to the Workshop
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </Suspense>
    </>
  );
}
