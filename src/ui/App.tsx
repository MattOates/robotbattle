/**
 * The shell: routes between screens and owns the state they share.
 *
 * Screens are lazy so each mode is its own chunk — someone joining an Arena to
 * spectate should not download the editor, and the editor is the biggest part
 * of the bundle.
 */

import { Suspense, lazy, useEffect } from "react";
import { useRoute, type ScreenName } from "./router.js";
import { useLibrary, useProfile } from "./useLibrary.js";
import { branding } from "./branding.js";
import { Welcome } from "./screens/Welcome.js";
import { Settings } from "./Settings.js";

const Menu = lazy(() => import("./screens/Menu.js").then((m) => ({ default: m.Menu })));
const Workshop = lazy(() =>
  import("./screens/Workshop.js").then((m) => ({ default: m.Workshop })),
);
const Arena = lazy(() => import("./screens/Arena.js").then((m) => ({ default: m.Arena })));
const Tournament = lazy(() =>
  import("./screens/Tournament.js").then((m) => ({ default: m.Tournament })),
);
const Trade = lazy(() => import("./screens/Trade.js").then((m) => ({ default: m.Trade })));
const Learn = lazy(() => import("./screens/Learn.js").then((m) => ({ default: m.Learn })));
const About = lazy(() => import("./screens/About.js").then((m) => ({ default: m.About })));

/** Screens where the second path segment is a room code rather than a page id. */
const ROOM_SCREENS: ReadonlySet<ScreenName> = new Set<ScreenName>([
  "workshop",
  "arena",
  "tournament",
  "trade",
]);

export function App() {
  const route = useRoute();
  const { profile, setName, setTheme, setAssistantModel, complete } = useProfile();
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

  return (
    <>
      <Settings
        profile={profile}
        onName={setName}
        onTheme={setTheme}
        onAssistantModel={setAssistantModel}
        lib={lib}
      />
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
          assistantModel={profile.assistantModel}
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

      {route.screen === "tournament" ? (
        <Tournament
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

      </Suspense>
    </>
  );
}
