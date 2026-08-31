/**
 * The shell: routes between screens and owns the state they share.
 *
 * Screens are lazy so each mode is its own chunk — someone joining an Arena to
 * spectate should not download the editor, and the editor is the biggest part
 * of the bundle.
 */

import { Suspense, lazy, useCallback, useMemo, useState, useEffect } from "react";
import { useRoute, type ScreenName } from "./router.js";
import { useLibrary, useProfile, starterRobot } from "./useLibrary.js";
import { navigate } from "./router.js";
import { branding } from "./branding.js";
import { Welcome } from "./screens/Welcome.js";
import { Settings } from "./Settings.js";
import { JourneyBar } from "./JourneyBar.js";
import { QuestLog } from "./quest/QuestLog.js";
import { QuestToasts } from "./quest/QuestToast.js";
import { useQuests } from "./quest/useQuests.js";
import { levelSpec, nextLevel } from "./level.js";
import { fillVocab } from "../learn/markdown.js";
import { Tours } from "../store/tour.js";

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
const Reference = lazy(() =>
  import("./screens/Reference.js").then((m) => ({ default: m.Reference })),
);
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
  const { profile, setName, setTheme, setLevel, setAssistantModel, complete } = useProfile();
  // Nothing is seeded until a world has been chosen, because which robot a new
  // player starts with depends on whether they took the tour.
  const lib = useLibrary(starterRobot(profile.onboarded, profile.level));
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
        onDone={(name, theme, level, wantsTour) => {
          complete(name, theme, level, wantsTour);
          // The tour opens on the menu — a greeting, and what the modes are
          // for — and walks them to the Workshop itself.
          if (wantsTour && !ROOM_SCREENS.has(route.screen)) navigate("menu");
        }}
      />
    );
  }

  return (
    <AppShell
      profile={profile}
      lib={lib}
      route={route}
      setName={setName}
      setTheme={setTheme}
      setLevel={setLevel}
      setAssistantModel={setAssistantModel}
    />
  );
}

/**
 * The shell proper, below the welcome gate.
 *
 * Split out so the quest hooks are only mounted once somebody has a level,
 * rather than being called and then thrown away on a first visit — and because
 * hooks cannot live below the early return above.
 */
function AppShell({
  profile,
  lib,
  route,
  setName,
  setTheme,
  setLevel,
  setAssistantModel,
}: {
  profile: ReturnType<typeof useProfile>["profile"];
  lib: ReturnType<typeof useLibrary>;
  route: ReturnType<typeof useRoute>;
  setName: (name: string) => void;
  setTheme: ReturnType<typeof useProfile>["setTheme"];
  setLevel: ReturnType<typeof useProfile>["setLevel"];
  setAssistantModel: (id: string) => void;
}) {
  const spec = levelSpec(profile.level);


  /** One line, in the right register and the right world. */
  const say = useCallback(
    (both: { full: string; simple: string }) =>
      spec.register === "simple" ? both.simple : both.full,
    [spec.register],
  );
  const fill = useCallback((text: string) => fillVocab(text, profile.theme), [profile.theme]);

  const quests = useQuests(profile.level, say, fill);
  const [logOpen, setLogOpen] = useState(false);

  const tours = useMemo(() => new Tours(), []);
  const [narrating, setNarrating] = useState(() => tours.commentary() || spec.voiceDefault);

  // The journey bar is for somebody finding their way. An Engineer has been
  // using the menu perfectly well and does not need a game telling them where
  // they are.
  const showJourney = profile.level !== "engineer";

  return (
    <>
      <Settings
        profile={profile}
        onName={setName}
        onTheme={setTheme}
        onLevel={setLevel}
        onAssistantModel={setAssistantModel}
        lib={lib}
      />
      <Suspense fallback={<div className="splash">Loading…</div>}>
      {route.screen === "menu" ? (
        <Menu
          theme={profile.theme}
          robotCount={lib.robots.length}
          playerName={profile.name}
          level={profile.level}
          quests={quests}
          say={say}
          fill={fill}
          onOpenLog={() => setLogOpen(true)}
        />
      ) : null}

      {route.screen === "workshop" ? (
        <Workshop
          theme={profile.theme}
          lib={lib}
          playerName={profile.name}
          initialRoom={route.room}
          assistantModel={profile.assistantModel}
          level={profile.level}
          unlocked={quests.unlocked}
          onQuestSignal={quests.signal}
          onQuestObserve={quests.observe}
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

      {route.screen === "reference" ? <Reference theme={profile.theme} /> : null}

      {route.screen === "about" ? (
        <About
          theme={profile.theme}
          robotCount={lib.robots.length}
          storageBytes={lib.storage.used}
        />
      ) : null}

      </Suspense>

      {/* Mounted by the shell rather than by each screen, because a step can be
          met on any screen and the toast for it has to survive the navigation
          that met it — going to the Workshop is itself a quest step. */}
      {showJourney ? (
        <>
          <JourneyBar
            level={profile.level}
            screen={route.screen}
            quests={quests}
            say={say}
            fill={fill}
            onOpenLog={() => setLogOpen(true)}
            narration={{
              on: narrating,
              toggle: () =>
                setNarrating((on) => {
                  // One mute for the lot. Somebody who turned the noise off
                  // turned the noise off.
                  new Tours().setCommentary(!on);
                  return !on;
                }),
            }}
          />
          <QuestLog
            quests={quests}
            open={logOpen}
            onClose={() => setLogOpen(false)}
            say={say}
            fill={fill}
          />
        </>
      ) : null}

      <QuestToasts
        queue={quests.celebrations}
        onDismiss={quests.dismiss}
        theme={profile.theme}
        onLevelUp={() => {
          const up = nextLevel(profile.level);
          if (up) setLevel(up);
          // Cleared so the next level's own offer arrives fresh rather than
          // arriving already declined.
          new Tours();
          quests.celebrations.forEach((c) => quests.dismiss(c.id));
        }}
        onDeclineLevelUp={quests.declineLevelUp}
      />
    </>
  );
}
