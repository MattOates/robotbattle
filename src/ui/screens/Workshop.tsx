/**
 * The Workshop: where robots are built, versioned, tried, measured — and,
 * since pairing was folded in, talked about.
 *
 * The rule that decides what a session shares: a session is scoped to a robot,
 * so anything *about that robot* is shared and anything *about you* is not.
 * Your library and your storage stay yours; the editor, the chat, the trial and
 * the record travel.
 *
 * And within that, two different things are called "the robot":
 *
 *  - the **session robot** is the one that is editable and the one chat is
 *    attached to. It changes only when the host deliberately switches.
 *  - whatever the host has **on screen** is followed by guests read-only, so
 *    "let me show you how I did it here" works without dragging the
 *    conversation onto a robot nobody is working on.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { yCollab } from "y-codemirror.next";
import type { EditorView } from "@codemirror/view";
import { BLOCK_MIME, CodeEditor } from "../CodeEditor.js";
import { MatchCanvas, type MatchOutcome, type MatchStatus } from "../MatchCanvas.js";
import { Standings } from "../Standings.js";
import { navigate, parseRoute, routePath } from "../router.js";
import { useAutoJoin, useRoom, type TransportKind } from "../useRoom.js";
import type { LibraryApi } from "../useLibrary.js";
import { SAMPLE_BOTS } from "../../bots/index.js";
import { checkScript, makeManifest, type MatchManifest } from "../../sim/world.js";
import { phraseFor, THEMES, type Theme } from "../../lang/vocab.js";
import {
  blockInsertion,
  groupBlocks,
  libraryBlocks,
  type LibraryBlock,
} from "../../workshop/blocks.js";
import { accuracy, executionWarning, explainBattle } from "../../sim/telemetry.js";
import { shortAgo } from "../../store/chat.js";
import { MAX_CHAT_LENGTH, sanitiseChat, sanitiseText } from "../../net/protocol.js";
import type { Message } from "../../net/protocol.js";
import { RoomYProvider, CURSOR_COLORS } from "../../net/yprovider.js";
import { newId } from "../../store/storage.js";
import { MAX_TEAM_SIZE } from "../../workshop/trials.js";
import type { Contender, TrialReport } from "../../workshop/trials.js";
import {
  FUEL_LEVELS,
  FUEL_SETTINGS,
  TERRAIN_LEVELS,
  arenaForLevel,
  describeConditions,
  fuelHeading,
  terrainHeading,
  terrainLevelWord,
  type FuelLevel,
  type TerrainLevel,
} from "../matchSettings.js";
import type { TrialWorkerIn, TrialWorkerOut } from "../../workshop/trials.worker.js";
import type {
  BattleRecord,
  ChatMessage,
  RobotTelemetry,
  StoredArena,
  StoredRobot,
} from "../../store/types.js";
import type { ArenaSpec, TerrainConfig } from "../../sim/types.js";
import { WALL } from "../../sim/types.js";
import { drivableMazeGrid, generateFittingMaze } from "../../sim/maze.js";
import { blankArena } from "../../store/arenas.js";
import { MapEditor } from "../MapEditor.js";
import { ARENA_SIZE } from "../../net/matchsetup.js";
import { AssistantPanel } from "../../assistant/AssistantPanel.js";
import { Tour } from "../tour/Tour.js";
import { useTour } from "../tour/useTour.js";
import { applySnippet, findLines, type TourSignal } from "../tour/steps.js";
import { PANE_LABELS, PANE_LABELS_SIMPLE, type Pane, type PanelName } from "../panes.js";
import { HelperPanel } from "../quest/HelperPanel.js";
import { CardComposer } from "../compose/CardComposer.js";
import { PictureDebrief, whereFixGoes } from "../fight/PictureDebrief.js";
import { ScriptStatus } from "../ScriptStatus.js";
import { addCard, cardSpec, fromSource, toSource } from "../../workshop/compose.js";
// A megabyte of Blockly, fetched only when somebody opens the tab that needs it.
const BlockEditor = lazy(() =>
  import("../blocks/BlockEditor.js").then((m) => ({ default: m.BlockEditor })),
);
import { AUTHORING_LABELS, type Authoring } from "../panes.js";
import type { Quest, Step } from "../../workshop/quests.js";
import { authoringFor, levelSpec, panesFor, showsPanel, type Level } from "../level.js";
import { TrialPrefs } from "../../store/trial.js";
import { WorkshopPrefs } from "../../store/workshop.js";
import { useAssistantUsable } from "../../assistant/useAssistant.js";
import { readVariables } from "../../lang/vm.js";
import { ScriptLine } from "../ScriptLine.js";
import {
  chronologicalDecisions,
  decisionReplayTick,
  describeDecision,
  inspectManifest,
  mergeCoverage,
  sourceHash,
  type DecisionEntry,
  type InspectionTrace,
  type ScriptCoverage,
} from "../../sim/inspection.js";

interface Props {
  theme: Theme;
  lib: LibraryApi;
  playerName: string;
  initialRoom: string | null;
  /** Which model the assistant downloads when it is first asked to. */
  assistantModel: string;
  level: Level;
  /** What quests have handed over, unioned with what the level starts with. */
  unlocked: { panes: Pane[]; panels: PanelName[]; opponents: string[] };
  /**
   * The same events the tour is told about, forwarded to the quest system.
   *
   * Two consumers, one set of emitters — see the note on `TourSignal`. This is
   * a prop rather than a hook call because the quests live in the shell: a step
   * met here has to still be true after navigating away from this screen.
   */
  onQuestSignal: (signal: TourSignal) => void;
  /** The script as it stands, whenever it changes. See `settle`. */
  onQuestObserve: (world: { source: string | null }) => void;
  /** The quest step being worked on, for the helper panel. Null when done. */
  helperStep: { quest: Quest; step: Step } | null;
  questsDone: ReadonlySet<string>;
  say: (both: { full: string; simple: string }) => string;
  fill: (text: string) => string;
  /** A quest-log deep link into one of this screen's panes. */
  requestedPane: Pane | null;
  onRequestedPaneHandled: () => void;
}


/**
 * Spread an `ArenaSpec` into the two flat fields a manifest carries.
 *
 * The manifest keeps `terrain` and `walls` side by side rather than nesting a
 * spec, because it is the wire format and a flat shape is the one worth
 * versioning. This is the one-line bridge between the two.
 */
function specToManifest(spec: ArenaSpec) {
  return { terrain: spec.terrain, walls: spec.walls };
}

/** What is on screen — for a guest, whatever the host is showing. */
interface ViewedRobot {
  robotId: string;
  name: string;
  color: string;
  source: string;
}

export function Workshop({
  theme,
  lib,
  playerName,
  initialRoom,
  assistantModel,
  level,
  unlocked,
  onQuestSignal,
  onQuestObserve,
  helperStep,
  questsDone,
  say,
  fill,
  requestedPane,
  onRequestedPaneHandled,
}: Props) {
  const { library, robots, refresh, chat } = lib;
  const workshopPrefs = useMemo(() => new WorkshopPrefs(), []);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const remembered = workshopPrefs.selectedRobotId();
    return robots.some((robot) => robot.id === remembered) ? remembered : (robots[0]?.id ?? null);
  });
  /**
   * Which arena is being edited, or null when a robot is.
   *
   * Kept beside `selectedId` rather than replacing it with a tagged union,
   * because the selected ROBOT still matters while an arena is open: Trial and
   * Test bench on a map need something to run on it, and it should be whatever
   * you were last working on rather than a second thing to pick.
   */
  const [selectedArenaId, setSelectedArenaId] = useState<string | null>(() => {
    const remembered = workshopPrefs.selectedArenaId();
    return lib.arenas.some((arena) => arena.id === remembered) ? remembered : null;
  });
  const [pane, setPane] = useState<Pane>(() => workshopPrefs.pane<Pane>("editor"));
  /**
   * The guided tour, if one is running.
   *
   * Off in a shared session: a coach mark telling somebody to press Start when
   * only the host can is worse than no help at all.
   */
  /*
   * The coach-mark tour runs for the instrument skin only.
   *
   * Not a preference — see `quest/HelperPanel.tsx`. `Tour.tsx` places its card
   * from a hard-coded `CARD = { width: 340, height: 260 }`, which is true at
   * 11px type and roughly half the real height at this skin's, so every
   * placement decision built on it is wrong. And the Explorer quest arc is
   * this tour, in five beats instead of twenty, so running both taught the
   * same lesson twice with two disagreeing progress counters on screen.
   */
  const guided = levelSpec(level).skin === "instrument";
  const rawTour = useTour("workshop", theme, guided && !initialRoom, playerName);

  /*
   * One emitter, two listeners.
   *
   * Every `signal()` in this file was written for the tour. The quest system
   * wants the same events, so rather than sprinkling a second call beside each
   * of the six existing ones — which would have drifted apart the first time
   * somebody added a button — the tour's own `signal` is wrapped once here and
   * both are told. Neither knows the other exists.
   */
  const tour = useMemo(
    () => ({
      ...rawTour,
      signal: (signal: TourSignal) => {
        rawTour.signal(signal);
        onQuestSignal(signal);
      },
    }),
    [onQuestSignal, rawTour],
  );
  const [showCones, setShowCones] = useState(true);
  /**
   * Whether the assistant tray is out.
   *
   * Closed by default, and not remembered. It costs a gigabyte to start and
   * most visits to the Workshop are not questions, so the quiet state is the
   * right one to land in.
   */
  const [assistantOpen, setAssistantOpen] = useState(false);

  /**
   * Whether the tray has ever been opened this visit.
   *
   * The panel is mounted from the first time it is asked for and then left
   * alone, rather than torn down whenever the tray shuts. Closing it used to
   * unmount the panel, which threw away the conversation and — much worse —
   * unloaded the model, so shutting the tray for a moment cost a multi-gigabyte
   * reload to open it again.
   *
   * It still goes when the Workshop does, which is the case the tearing-down
   * was really for: nobody should hold six gigabytes of video memory for a
   * screen they have left.
   */
  const [assistantUsed, setAssistantUsed] = useState(false);

  /**
   * Whether this machine can run an assistant at all.
   *
   * Null while the graphics adapter is being asked. Nothing is drawn until the
   * answer arrives, and nothing ever if it is no — there is no point offering
   * a handle that opens onto an explanation of why it cannot work.
   */
  const assistantUsable = useAssistantUsable();

  const room = useRoom(playerName || "Player", null);
  useAutoJoin(room, initialRoom);

  const inSession = room.phase === "connected" && room.session !== null;
  const isHost = room.state?.isHost ?? false;

  // Hosting rewrites the URL so the room can be shared from the address bar.
  useEffect(() => {
    if (inSession && room.roomCode && parseRoute(window.location.hash).room !== room.roomCode) {
      navigate("workshop", room.roomCode);
    }
  }, [inSession, room.roomCode]);

  // --- session state ------------------------------------------------------
  const [provider, setProvider] = useState<RoomYProvider | null>(null);
  const [sessionRobotId, setSessionRobotId] = useState<string | null>(null);
  const [guestView, setGuestView] = useState<ViewedRobot | null>(null);
  const [guestChat, setGuestChat] = useState<ChatMessage[]>([]);
  const [guestReport, setGuestReport] = useState<TrialReport | null>(null);
  const [guestHistory, setGuestHistory] = useState<BattleRecord[]>([]);
  const [liveMatch, setLiveMatch] = useState<MatchManifest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = robots.find((r) => r.id === selectedId) ?? robots[0] ?? null;
  const selectedArena = lib.arenas.find((a) => a.id === selectedArenaId) ?? null;
  const editingArena = selectedArena !== null;
  // Two filters, both of which have to pass: what the thing being edited has,
  // and what this player's level shows plus whatever their quests have opened.
  const panes = panesFor(level, editingArena ? "arena" : "robot", unlocked.panes);
  // "Test bench" is a machine-shop word. At the simple register the tabs are
  // named for what you would go there to do instead — see `ui/panes.ts`.
  const paneLabels = levelSpec(level).register === "simple" ? PANE_LABELS_SIMPLE : PANE_LABELS;
  /*
   * The authoring views on offer, most approachable first — the level decides.
   * The default is the first, which for an Explorer is cards and for an
   * Engineer is text, so nobody is moved off what they came for.
   */
  /*
   * A beginner's Workshop has one {robot}, one opponent and one thing worth
   * looking at. The instrument's three-column layout spends 380px on a column
   * holding that one {robot} and 320px on a column holding that one opponent,
   * and takes 305px of height in banners before the arena gets any. `compact`
   * is what collapses all of that.
   */
  const compact = levelSpec(level).register === "simple";
  const ways = levelSpec(level).authoring;
  const [way, setWay] = useState<Authoring>(() => ways[0] ?? "text");

  // A level can be changed while this screen remains mounted. Never leave the
  // player in a view the new level does not offer (and may provide no tab for).
  useEffect(() => {
    const next = authoringFor(level, way);
    if (next !== way) setWay(next);
  }, [level, way]);

  useEffect(() => workshopPrefs.setSelectedRobotId(selectedId), [selectedId, workshopPrefs]);
  useEffect(() => workshopPrefs.setSelectedArenaId(selectedArenaId), [selectedArenaId, workshopPrefs]);
  useEffect(() => workshopPrefs.setPane(pane), [pane, workshopPrefs]);

  /**
   * The map Trial and Test bench fight on.
   *
   * An open arena unless one is being edited, in which case it is that one —
   * so "does anything get through my labyrinth" is one click from drawing it.
   */
  const benchArena = selectedArena?.spec ?? null;

  // A tab that does not exist for what is now selected falls back to the first
  // one that does, rather than showing an empty column.
  useEffect(() => {
    if (!panes.includes(pane)) setPane(panes[0]!);
  }, [panes, pane]);

  /*
   * Honour the pane carried by a quest's "Take me there" action. Editor links
   * leave an arena, while map links select an existing arena or make the first
   * one; those panes do not exist for the other kind of selection.
   */
  useEffect(() => {
    if (!requestedPane) return;
    if (requestedPane === "editor") setSelectedArenaId(null);
    if (requestedPane === "map" && !selectedArena) {
      const arena =
        lib.arenas[0] ??
        lib.arenaLib.create(`New ${THEMES[theme].arena}`, blankArena());
      if (lib.arenas.length === 0) refresh();
      setSelectedArenaId(arena.id);
    }
    setPane(requestedPane);
    onRequestedPaneHandled();
  }, [
    lib.arenaLib,
    lib.arenas,
    onRequestedPaneHandled,
    refresh,
    requestedPane,
    selectedArena,
    theme,
  ]);

  useEffect(() => {
    if (!selected && robots.length > 0) setSelectedId(robots[0]!.id);
  }, [robots, selected]);

  // A provider lives exactly as long as the session does. Created inside the
  // effect rather than memoised, so a remount gets a live one.
  useEffect(() => {
    const session = room.session;
    if (!inSession || !session || !room.state) {
      setProvider(null);
      return;
    }
    const index = Math.abs(hashString(room.state.selfId)) % CURSOR_COLORS.length;
    const created = new RoomYProvider(session, {
      name: playerName || "Player",
      color: CURSOR_COLORS[index]!,
      peerId: room.state.selfId,
    });
    setProvider(created);
    return () => {
      created.destroy();
      setProvider(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inSession, room.session]);

  // Leaving a session drops everything that belonged to it.
  useEffect(() => {
    if (inSession) return;
    setSessionRobotId(null);
    setGuestView(null);
    setGuestChat([]);
    setGuestReport(null);
    setGuestHistory([]);
  }, [inSession]);

  // --- host: opening a session on the selected robot ----------------------
  const startSession = useCallback(
    async (kind: TransportKind) => {
      if (!selected) return;
      await room.host(kind);
      setSessionRobotId(selected.id);
    },
    [room, selected],
  );

  // Once the room is up, seed the session robot and announce it.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    const session = room.session;
    if (!isHost || !provider || !session || !sessionRobotId) return;
    const robot = robots.find((r) => r.id === sessionRobotId);
    if (!robot) return;

    provider.seed(sessionRobotId, robot.source);
    if (announced.current === sessionRobotId) return;
    announced.current = sessionRobotId;

    session.broadcast({
      t: "session",
      robotId: robot.id,
      name: robot.name,
      color: robot.color,
    });
    session.broadcast({
      t: "view",
      robotId: robot.id,
      name: robot.name,
      color: robot.color,
      source: robot.source,
    });
    session.send("all", {
      t: "chatHistory",
      robotId: robot.id,
      messages: chat.messagesFor(robot.id),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, provider, room.session, sessionRobotId, robots]);

  // --- host: browsing is shown, not shared for editing --------------------
  useEffect(() => {
    if (!isHost || !inSession || !selected || !room.session) return;
    room.session.broadcast({
      t: "view",
      robotId: selected.id,
      name: selected.name,
      color: selected.color,
      source: selected.source,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, inSession, selected?.id, selected?.source, room.session]);

  /**
   * Bring a newcomer up to date on everything they missed.
   *
   * The document alone is not enough: someone arriving after the room opened
   * has never seen which robot is the session robot, what is on screen, or
   * anything that was already said. Without this they sit looking at an empty
   * editor wondering what went wrong.
   */
  const caughtUp = useRef(new Set<string>());
  useEffect(() => {
    const session = room.session;
    if (!isHost || !session || !provider || !sessionRobotId) return;
    const sessionRobot = robots.find((r) => r.id === sessionRobotId);
    const shown = selected ?? sessionRobot;
    if (!sessionRobot || !shown) return;

    for (const peer of room.state?.peers ?? []) {
      if (peer.id === room.state?.selfId || caughtUp.current.has(peer.id)) continue;
      caughtUp.current.add(peer.id);
      provider.greet(peer.id);
      session.send(peer.id, {
        t: "session",
        robotId: sessionRobot.id,
        name: sessionRobot.name,
        color: sessionRobot.color,
      });
      session.send(peer.id, {
        t: "view",
        robotId: shown.id,
        name: shown.name,
        color: shown.color,
        source: shown.source,
      });
      session.send(peer.id, {
        t: "chatHistory",
        robotId: sessionRobot.id,
        messages: chat.messagesFor(sessionRobot.id),
      });
    }
    // Someone who has left should be caught up again if they return.
    const present = new Set((room.state?.peers ?? []).map((p) => p.id));
    for (const id of [...caughtUp.current]) {
      if (!present.has(id)) caughtUp.current.delete(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, provider, room.state?.peers, sessionRobotId, robots, selected]);

  /** Host: make what is on screen the thing everyone edits. */
  const workOnThis = useCallback(() => {
    if (!isHost || !selected || !room.session || !provider) return;
    provider.seed(selected.id, selected.source);
    setSessionRobotId(selected.id);
    announced.current = selected.id;
    room.session.broadcast({
      t: "session",
      robotId: selected.id,
      name: selected.name,
      color: selected.color,
    });
    room.session.send("all", {
      t: "chatHistory",
      robotId: selected.id,
      messages: chat.messagesFor(selected.id),
    });
  }, [chat, isHost, provider, room.session, selected]);

  // --- incoming session traffic -------------------------------------------
  useEffect(
    () =>
      room.onMessage((from, message: Message) => {
        switch (message.t) {
          case "view":
            setGuestView({
              robotId: message.robotId,
              name: sanitiseText(message.name, 32),
              color: message.color,
              source: sanitiseText(message.source, 64 * 1024),
            });
            return;

          case "session":
            setSessionRobotId(message.robotId);
            return;

          case "chatHistory":
            setGuestChat(sanitiseChat(message.messages));
            return;

          case "chat": {
            const line: ChatMessage = {
              id: newId("msg"),
              at: typeof message.at === "number" ? message.at : Date.now(),
              author: room.state?.peers.find((p) => p.id === from)?.displayName ?? "Someone",
              authorPeerId: from,
              text: sanitiseText(message.text, MAX_CHAT_LENGTH),
            };
            if (!line.text) return;
            // The owner is the only one who keeps it: the conversation belongs
            // to the robot, and the robot lives in their library.
            if (isHost) {
              chat.append(message.robotId, line);
              refresh();
            }
            setGuestChat((prev) => [...prev.slice(-199), line]);
            return;
          }

          case "start":
            setLiveMatch(message.manifest);
            setPane("trial");
            return;

          case "bench":
            setGuestReport(message.report as TrialReport);
            return;

          case "history":
            setGuestHistory(message.entries as BattleRecord[]);
            return;

          case "kick":
            setNotice(sanitiseText(message.reason, 200) || "You were removed from the room.");
            room.leave();
            return;

          case "endSession":
            setNotice("The host closed the session.");
            room.leave();
            return;

          default:
            return;
        }
      }),
    [chat, isHost, refresh, room],
  );

  // --- what the editor is actually showing --------------------------------
  const viewingId = inSession && !isHost ? (guestView?.robotId ?? null) : (selected?.id ?? null);
  const editable = inSession ? viewingId !== null && viewingId === sessionRobotId : true;
  const viewedName = inSession && !isHost ? (guestView?.name ?? "") : (selected?.name ?? "");

  /**
   * The lines the tour is pointing at, if it is pointing at any.
   *
   * Recomputed from the live script rather than remembered, so it follows the
   * player's edits — including the one the step is asking them to make.
   */
  const spotlight = useMemo(() => {
    const want = tour.step?.code;
    if (!want || !selected) return null;
    return findLines(selected.source, want.find, want.through);
  }, [selected, tour.step]);

  // Getting here is what completes the menu step that asked them to come.
  // Sent once on mount: the two screens share the tour through storage rather
  // than through React, so this is how one hands over to the other.
  const announceArrival = tour.signal;
  useEffect(() => {
    announceArrival({ kind: "screen", screen: "workshop" });
  }, [announceArrival]);

  /*
   * Show the quests the script as it stands, not only as it changes.
   *
   * `updateSource` below signals on every edit, which is all the tour ever
   * needed — it is choreographing what somebody is doing right now. A quest
   * asks a different question, about the world rather than the moment, so this
   * is an observation rather than an event: it credits whatever the *current*
   * quest already asks for, and stops there. That is the difference between
   * "you have already done this one" and "here is the end of the story".
   */
  useEffect(() => {
    onQuestObserve({ source: selected?.source ?? null });
  }, [onQuestObserve, selected?.id, selected?.source]);

  const updateSource = useCallback(
    (source: string) => {
      if (!selected) return;
      library.updateSource(selected.id, source);
      refresh();
      tour.signal({ kind: "source", text: source });
    },
    [library, refresh, selected, tour],
  );

  /**
   * Take the picture debrief up on one of its suggestions.
   *
   * The card goes where it would actually run — a `fire` inside the handler
   * that saw something, a sweep inside `on start` — rather than on the end of
   * the script, where it would be legal, silent and baffling. When that
   * handler does not exist yet the button is not offered at all: the finding's
   * own words already say to add it, and adding a handler on somebody's behalf
   * is a bigger move than adding a line to one.
   */
  const applyFix = useCallback(
    (cardId: string) => {
      if (!selected || !editable || inSession) return;
      const spec = cardSpec(cardId);
      if (!spec) return;
      const sketch = fromSource(selected.source);
      const blockId = whereFixGoes(sketch, cardId);
      if (!blockId) return;
      updateSource(toSource(addCard(sketch, blockId, spec)));
      setPane("editor");
      tour.signal({ kind: "fixApplied" });
    },
    [editable, inSession, selected, tour, updateSource],
  );


  // In a session the shared document is the working copy, so the owner's
  // library is written as everyone types. Snapshots are the undo.
  useEffect(() => {
    if (!isHost || !provider || !sessionRobotId) return;
    const text = provider.textFor(sessionRobotId);
    const save = () => {
      library.updateSource(sessionRobotId, text.toString());
      refresh();
    };
    text.observe(save);
    return () => text.unobserve(save);
  }, [isHost, library, provider, refresh, sessionRobotId]);

  const collab = useMemo(() => {
    if (!provider || !sessionRobotId || !editable) return undefined;
    return yCollab(provider.textFor(sessionRobotId), provider.awareness);
  }, [provider, sessionRobotId, editable]);

  /*
   * The same shared document, for the block editor.
   *
   * `yCollab` above is a CodeMirror extension and means nothing to a block
   * canvas, so the block editor is handed the two things it actually needs —
   * the text to write into, and the awareness to say where it is.
   */
  const blockCollab = useMemo(() => {
    if (!provider || !sessionRobotId || !editable) return undefined;
    return { text: provider.textFor(sessionRobotId), awareness: provider.awareness };
  }, [provider, sessionRobotId, editable]);

  const words = THEMES[theme];
  const sessionRobotName =
    robots.find((r) => r.id === sessionRobotId)?.name ??
    (sessionRobotId === guestView?.robotId ? guestView?.name : null) ??
    "the shared robot";

  const editorSource = inSession && !isHost ? (guestView?.source ?? "") : (selected?.source ?? "");

  // --- the block shelf ------------------------------------------------------
  // Every `can` block the player has written, across every robot they own. It
  // is built from their own library even mid-session: your blocks are yours,
  // and bringing one into a shared script is one of the better reasons to be in
  // a session at all.
  const editorViewRef = useRef<EditorView | null>(null);

  /**
   * Who the assistant fights when it wants to know whether a change helped.
   *
   * The sample robots only. The test bench proper offers your own library and
   * your snapshots too, but the assistant is answering "is this any better",
   * and the samples are the one set of opponents that means the same thing
   * from one week to the next.
   */
  const assistantOpponents = useMemo(
    () => buildContenders([], selected?.id ?? null, null),
    [selected?.id],
  );

  const shelf = useMemo(() => libraryBlocks(robots), [robots]);
  const shelfGroups = useMemo(() => groupBlocks(shelf), [shelf]);

  /** Put a block into the script, and say what happened if it was not literal. */
  const applyBlock = useCallback(
    (doc: string, block: LibraryBlock, at: number | null) => {
      const edit = blockInsertion(doc, block, shelf, at);
      if (!edit) {
        setNotice(`This script already has \`${block.name}\`.`);
        return null;
      }
      const brought =
        edit.brought.length > 0 ? ` It brought \`${edit.brought.join("`, `")}\` with it.` : "";
      // A rename is the one outcome the player must not miss: they dropped
      // `dodge` and the script now says `dodge2`.
      if (edit.name !== block.name) {
        setNotice(`Added \`${edit.name}\` — you already had a \`${block.name}\`.${brought}`);
      } else if (brought) {
        setNotice(`Added \`${edit.name}\`.${brought}`);
      }
      return edit;
    },
    [shelf],
  );

  const onEditorDrop = useCallback(
    (doc: string, payload: string, pos: number) => {
      const block = shelf.find((b) => `${b.robotId}/${b.name}` === payload);
      return block ? applyBlock(doc, block, pos) : null;
    },
    [applyBlock, shelf],
  );

  // Clicking a block adds it at the end. The editor has to be on screen for
  // that, so the click switches to it and the insertion waits a render for the
  // editor to exist.
  const [pendingBlock, setPendingBlock] = useState<LibraryBlock | null>(null);
  useEffect(() => {
    if (!pendingBlock) return;
    const view = editorViewRef.current;
    if (!view) return;
    setPendingBlock(null);
    if (view.state.readOnly) return;
    const edit = applyBlock(view.state.doc.toString(), pendingBlock, null);
    if (!edit) return;
    view.dispatch({
      changes: { from: edit.from, insert: edit.text },
      selection: { anchor: edit.from + edit.text.length },
      scrollIntoView: true,
    });
  }, [applyBlock, pane, pendingBlock]);

  return (
    <div className={`workshop${compact ? " compact" : ""}`}>
      {/*
        * Hidden below the instrument.
        *
        * "← Menu" and the word "Workshop" cost 55px of height and say what the
        * journey bar already says with the Build station lit — and the arena
        * was the thing paying for it, since the trial canvas is height-bound
        * and was down to 320×220 in a 1512×827 window. A room code still has
        * to appear, so the header stays when there is one.
        */}
      <header className={`screen-head${compact && !inSession ? " hidden" : ""}`}>
        <button type="button" className="btn small" onClick={() => navigate("menu")}>
          ← Menu
        </button>
        <h2 className="screen-title">Workshop</h2>
        <span className="spacer" />
        {inSession ? (
          <>
            <span className="room-code" title="Read this out, or share the link">
              {room.roomCode}
            </span>
            <CopyInvite room={room.roomCode} />
          </>
        ) : null}
      </header>

      {notice ? (
        <div className="notice">
          {notice}
          <button type="button" className="btn small" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {room.error ? <div className="notice bad">{room.error}</div> : null}

      {/* Not in the sidebar with the shelves.
          A conversation is a thing you turn to and then turn away from, and it
          wants more width than a 300px column while it is open — so it lives
          off the right edge and slides out over the workspace, rather than
          permanently taking room from the editor. */}
      {assistantUsable === true ? (
      <div className={`assistant-tray${assistantOpen ? " open" : ""}`}>
        <button
          type="button"
          className="assistant-handle"
          aria-expanded={assistantOpen}
          aria-controls="assistant-tray-body"
          onClick={() => {
            setAssistantUsed(true);
            setAssistantOpen((open) => !open);
          }}
        >
          {assistantOpen ? "Close ›" : "‹ Ask"}
        </button>
        <div
          className="assistant-tray-body"
          id="assistant-tray-body"
          aria-hidden={!assistantOpen}
        >
          {/* Nothing until it is first asked for — otherwise every visit to the
              Workshop would quietly start loading a cached model for somebody
              who never opens the tray. */}
          {assistantUsed ? (
            <AssistantPanel
              theme={theme}
              modelId={assistantModel}
              editorRef={editorViewRef}
              script={editorSource}
              opponents={assistantOpponents}
              arena={benchArena ?? undefined}
              editable={editable}
            />
          ) : null}
        </div>
      </div>
      ) : null}

      <div className="workshop-body">
        <aside className="column sidebar">
          {/* The library comes first: working alone is the common case, and the
              thing you reach for every time belongs above the thing you reach
              for occasionally. */}
          {inSession && !isHost ? (
            <SidebarAccordion id="session" title="Session">
              <div className="panel-body">
                <p className="empty small">
                  You are in {hostName(room)}&rsquo;s session, working on{" "}
                  <strong>{sessionRobotName}</strong>. Your own robots are waiting for you when you
                  leave.
                </p>
              </div>
            </SidebarAccordion>
          ) : (
            <RobotLibrary
              lib={lib}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              theme={theme}
              sessionRobotId={inSession ? sessionRobotId : null}
              onSaved={() => tour.signal({ kind: "saved" })}
              forceOpen={tour.step?.anchor === "save-version" || tour.step?.anchor === "robot-list"}
            />
          )}

          {showsPanel(level, "behaviours", unlocked.panels) ? (
          <BlockShelf
            groups={shelfGroups}
            theme={theme}
            usable={editable}
            onCreate={() => {
              if (!selected || !editable) return;
              const base = "dodge";
              let name = base;
              let suffix = 2;
              while (new RegExp(`^\\s*can\\s+${name}\\b`, "m").test(selected.source)) {
                name = `${base}${suffix++}`;
              }
              setPane("editor");
              updateSource(`${selected.source.trimEnd()}\n\ncan ${name} given hit by bullet\n  turn body by event.bearing + 90\n  drive forward 80\nend\n`);
            }}
            onTake={(block) => {
              setPane("editor");
              setPendingBlock(block);
              tour.signal({ kind: "blockTaken" });
            }}
          />
          ) : null}

          {/* Last of the three shelves. Places are the thing you reach for
              least often, and the one whose selection changes the most. Hidden
              for a guest, who is here to look at somebody else's robot. */}
          {(!inSession || isHost) && showsPanel(level, "arenas", unlocked.panels) ? (
            <ArenaShelf
              lib={lib}
              theme={theme}
              selectedId={selectedArenaId}
              onSelect={setSelectedArenaId}
            />
          ) : null}

          {showsPanel(level, "room", unlocked.panels) ? (
          <SessionPanel
            room={room}
            inSession={inSession}
            isHost={isHost}
            canStart={selected !== null}
            onStart={startSession}
          />
          ) : null}

          {showsPanel(level, "chat", unlocked.panels) ? (
          <ChatPanel
            inSession={inSession}
            robotId={inSession ? sessionRobotId : (selected?.id ?? null)}
            robotName={inSession ? sessionRobotName : (selected?.name ?? "")}
            // The owner reads its own stored log; a guest reads what it was
            // sent, since it keeps nothing of its own.
            messages={
              inSession
                ? isHost
                  ? chat.messagesFor(sessionRobotId ?? "")
                  : guestChat
                : selected
                  ? chat.messagesFor(selected.id)
                  : []
            }
            selfId={room.state?.selfId ?? ""}
            onSend={(text) => {
              const session = room.session;
              if (!session || !sessionRobotId) return;
              session.broadcast({
                t: "chat",
                robotId: sessionRobotId,
                text,
                at: Date.now(),
              });
            }}
          />
          ) : null}
        </aside>

        <div className="column">
          {/* Above the tabs and in the flow, so it can never cover them. */}
          {!guided && helperStep ? (
            <HelperPanel
              quest={helperStep.quest}
              step={helperStep.step}
              theme={theme}
              say={say}
              fill={fill}
              done={questsDone}
              script={
                pane === "editor" && selected
                  ? { source: selected.source, onChange: updateSource, editable }
                  : null
              }
            />
          ) : null}

          <div className="pane-tabs" role="tablist">
            {panes.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={pane === name}
                className="pane-tab"
                data-tour={`${name}-tab`}
                onClick={() => {
                  setPane(name);
                  tour.signal({ kind: "pane", pane: name });
                }}
              >
                {paneLabels[name]}
              </button>
            ))}
            <span className="spacer" />
            <span className="roster-meta">
              {editingArena ? selectedArena.name : viewedName}
            </span>
          </div>

          {pane === "editor" ? (
            <section className="panel editor-panel" data-tour="editor">
              {inSession && !editable ? (
                <div className="viewing-banner">
                  <span>
                    Viewing <strong>{viewedName}</strong> — read-only. Everyone is working on{" "}
                    <strong>{sessionRobotName}</strong>.
                  </span>
                  {isHost ? (
                    <button type="button" className="btn small primary" onClick={workOnThis}>
                      Work on this one
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="panel-head">
                {/*
                  * Which way the {robot} is being written.
                  *
                  * Only shown when the level offers more than one, so an
                  * Engineer sees the panel it has always had. The views are
                  * over the same text — see `workshop/compose.ts` — so this
                  * switches how it is displayed and nothing else. Flipping
                  * back and forth cannot change the {robot}.
                  */}
                {ways.length > 1 ? (
                  <div className="way-tabs" role="tablist" aria-label="How to write it">
                    {ways.map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="tab"
                        aria-selected={way === option}
                        className="way-tab"
                        onClick={() => setWay(option)}
                      >
                        {AUTHORING_LABELS[option]}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="silkscreen">
                    {way === "text" ? "RoboScript" : AUTHORING_LABELS[way]}
                  </span>
                )}
                <span className="spacer" />
                {!inSession && levelSpec(level).register === "full" ? (
                  <select
                    className="btn small"
                    value=""
                    aria-label="Load an example"
                    onChange={(e) => {
                      const sample = SAMPLE_BOTS.find((b) => b.id === e.target.value);
                      if (sample) updateSource(sample.source);
                      e.target.value = "";
                    }}
                  >
                    <option value="">Load an example…</option>
                    {SAMPLE_BOTS.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title} — {b.teaches}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>

              {/*
                * The status belongs to the pane, not to the editor.
                *
                * A script that will not compile disables Start, and at this
                * register there is no editor tab — so without this a child got
                * a button that would not press and no way to find out why. The
                * escape is the Code view, which is the only place the problem
                * can actually be fixed when it lives in a raw block.
                */}
              {way !== "text" && selected ? (
                <ScriptStatus
                  source={editorSource}
                  register={levelSpec(level).register}
                  showLabel="Show me the writing"
                  onShow={() => setWay("text")}
                />
              ) : null}

              {way === "blocks" && selected ? (
                <Suspense fallback={<div className="empty">Loading blocks…</div>}>
                  <BlockEditor
                    source={editorSource}
                    onSource={updateSource}
                    theme={theme}
                    register={levelSpec(level).register}
                    /*
                     * Editable in a session too, unlike before. The block
                     * editor writes into the shared document as a small diff
                     * rather than replacing it, so two people can be in it at
                     * once — which is the whole point of a session.
                     */
                    editable={editable}
                    {...(blockCollab ? { collab: blockCollab } : {})}
                    {...(selected.layout ? { layout: selected.layout } : {})}
                    onLayout={(next) => library.setLayout(selected.id, next)}
                  />
                </Suspense>
              ) : way === "cards" && selected ? (
                <CardComposer
                  source={editorSource}
                  onSource={inSession ? () => undefined : updateSource}
                  theme={theme}
                  editable={editable && !inSession}
                  say={say}
                  fill={fill}
                  onCardAdded={() => tour.signal({ kind: "cardAdded" })}
                />
              ) : selected || (inSession && !isHost) ? (
                <CodeEditor
                  key={`${viewingId ?? "none"}-${editable ? "live" : "read"}`}
                  source={editorSource}
                  theme={theme}
                  spotlight={spotlight}
                  collab={collab}
                  readOnly={inSession && !editable}
                  onChange={inSession ? () => undefined : updateSource}
                  guide={editable || !inSession}
                  register={levelSpec(level).register}
                  viewRef={editorViewRef}
                  onDrop={onEditorDrop}
                />
              ) : (
                <div className="empty onboarding-empty">
                  <p>Add a robot to start writing, testing and saving versions.</p>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => {
                      const created = library.create();
                      refresh();
                      setSelectedId(created.id);
                    }}
                  >
                    Create your first {THEMES[theme].robot}
                  </button>
                </div>
              )}
            </section>
          ) : null}

          {pane === "map" && selectedArena ? (
            <MapPane
              arena={selectedArena}
              lib={lib}
              theme={theme}
              onDraw={() => tour.signal({ kind: "mapDrawn" })}
            />
          ) : null}

          {pane === "trial" ? (
            <TrialPane
              robot={selected}
              theme={theme}
              showCones={showCones}
              onShowCones={setShowCones}
              lib={lib}
              words={words}
              canRun={!inSession || isHost}
              liveMatch={liveMatch}
              onBroadcast={(manifest) =>
                room.session?.broadcast({
                  t: "start",
                  matchId: newId("trial"),
                  manifest,
                  label: "Trial",
                })
              }
              inSession={inSession}
              arenaOverride={benchArena}
              arenaName={selectedArena?.name ?? null}
              onOpponents={(ids) => tour.signal({ kind: "opponents", ids })}
              onTrialStarted={(ids) => tour.signal({ kind: "trialStart", opponents: ids })}
              onTrialFinished={(ids, won) =>
                tour.signal({ kind: "trial", opponents: ids, won })
              }
              onHistory={() => setPane("history")}
              level={level}
              unlockedOpponents={unlocked.opponents}
              say={say}
              fill={fill}
              {...(applyFix ? { onApplyFix: applyFix } : {})}
              onFixThere={() => {
                setPane("editor");
                setWay("text");
              }}
              onInspectorOpened={() => tour.signal({ kind: "inspectorOpened" })}
            />
          ) : null}
          {pane === "bench" ? (
            <BenchPane
              robot={selected}
              robots={robots}
              theme={theme}
              canRun={!inSession || isHost}
              sharedReport={inSession && !isHost ? guestReport : null}
              onShare={(report) =>
                room.session?.broadcast({
                  t: "bench",
                  robotId: sessionRobotId ?? "",
                  report,
                })
              }
              onRan={() => tour.signal({ kind: "benchRun" })}
              inSession={inSession}
              arenaOverride={benchArena}
              arenaName={selectedArena?.name ?? null}
            />
          ) : null}
          {pane === "history" ? (
            <HistoryPane
              robot={selected}
              lib={lib}
              theme={theme}
              canReplay={!inSession || isHost}
              sharedEntries={inSession && !isHost ? guestHistory : null}
              onShare={(entries) =>
                room.session?.broadcast({
                  t: "history",
                  robotId: sessionRobotId ?? "",
                  entries,
                })
              }
              inSession={inSession}
              onGoToTrial={() => setPane("trial")}
            />
          ) : null}
        </div>
      </div>

      {/* Menu steps belong to the menu, which mounts its own copy. */}
      <Tour
        tour={tour.step?.screen === "menu" ? { ...tour, step: null } : tour}
        theme={theme}
        playerName={playerName}
        editorView={editorViewRef}
        spotlight={pane === "editor" ? spotlight : null}
        onInsert={(snippet) => {
          if (!selected) return;
          // Applied to the stored script rather than to the editor's buffer, so
          // that the same tour step behaves the same whether or not the editor
          // happens to be the pane on screen. `updateSource` signals the tour.
          setPane("editor");
          updateSource(
            applySnippet(selected.source, {
              label: "",
              snippet,
              ...(tour.step?.insert?.replaces ? { replaces: tour.step.insert.replaces } : {}),
            }),
          );
        }}
      />
    </div>
  );
}

function hostName(room: ReturnType<typeof useRoom>): string {
  return room.state?.peers.find((p) => p.isHost)?.displayName ?? "the host";
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0;
  return hash;
}

function SidebarAccordion({
  id,
  title,
  meta,
  defaultOpen = true,
  className = "",
  forceOpen = false,
  children,
}: {
  id: string;
  title: string;
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  forceOpen?: boolean;
  children: React.ReactNode;
}) {
  const prefs = useMemo(() => new WorkshopPrefs(), []);
  const [open, setOpen] = useState(() => prefs.accordion(id, defaultOpen));
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  const toggle = () => {
    setOpen((value) => {
      prefs.setAccordion(id, !value);
      return !value;
    });
  };
  return (
    <section className={`panel accordion${open ? " open" : ""}${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="panel-head accordion-head"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="silkscreen">{title}</span>
        <span className="spacer" />
        {meta === undefined ? null : <span className="roster-meta">{meta}</span>}
        <span className="accordion-mark" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>
      {open ? children : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Session panel
// ---------------------------------------------------------------------------

function CopyInvite({ room }: { room: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!room) return null;
  const url = `${window.location.origin}${window.location.pathname}${routePath("workshop", room)}`;
  return (
    <button
      type="button"
      className="btn small"
      onClick={() => {
        void navigator.clipboard?.writeText(url).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          },
          () => window.prompt("Copy this link and send it to whoever is joining:", url),
        );
      }}
    >
      {copied ? "Link copied" : "Copy invite link"}
    </button>
  );
}

function SessionPanel({
  room,
  inSession,
  isHost,
  canStart,
  onStart,
}: {
  room: ReturnType<typeof useRoom>;
  inSession: boolean;
  isHost: boolean;
  canStart: boolean;
  onStart: (kind: TransportKind) => void;
}) {
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<TransportKind>("online");
  const prefs = useMemo(() => new WorkshopPrefs(), []);
  // Collapsed by default: most of the time someone is here to write a robot on
  // their own, and an invitation they are not acting on should not cost them
  // half the sidebar. It opens itself if they arrived on an invite link, since
  // then joining is the whole reason they are here.
  const [open, setOpen] = useState(() =>
    prefs.accordion("work-together", room.roomCode !== null || room.phase === "connecting"),
  );
  const toggleOpen = () => {
    setOpen((value) => {
      prefs.setAccordion("work-together", !value);
      return !value;
    });
  };

  if (inSession && room.state) {
    return (
      <SidebarAccordion
        id="room"
        title="In this room"
        meta={room.state.peers.length}
      >
        <div className="roster-actions">
          <button
            type="button"
            className="btn small"
            onClick={() => {
              if (isHost) room.session?.broadcast({ t: "endSession" });
              room.leave();
            }}
          >
            {isHost ? "End session" : "Leave"}
          </button>
        </div>
        <div className="panel-body flush">
          {room.state.peers.map((peer) => (
            <div key={peer.id} className="roster-item">
              <span className="roster-select" style={{ cursor: "default" }}>
                <span
                  className="chip"
                  style={{
                    background: CURSOR_COLORS[Math.abs(hashString(peer.id)) % CURSOR_COLORS.length],
                  }}
                />
                <span className="roster-name">
                  {peer.displayName}
                  {peer.id === room.state?.selfId ? " (you)" : ""}
                </span>
                {peer.isHost ? <span className="roster-meta">owner</span> : null}
              </span>
              {isHost && peer.id !== room.state?.selfId ? (
                <button
                  type="button"
                  className="btn small danger"
                  onClick={() => {
                    if (!window.confirm(`Remove ${peer.displayName} from the session?`)) return;
                    room.session?.send(peer.id, {
                      t: "kick",
                      reason: "The host removed you from the session.",
                    });
                    room.kick(peer.id);
                  }}
                >
                  Kick
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {isHost ? (
          <div className="roster-actions">
            <span className="roster-meta">
              Removing someone ends their connection now. They could rejoin with a new identity —
              change the room code if that matters.
            </span>
          </div>
        ) : null}
      </SidebarAccordion>
    );
  }

  return (
    <section className={`panel accordion${open ? " open" : ""}`}>
      <button
        type="button"
        className="panel-head accordion-head"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <span className="silkscreen">Work together</span>
        <span className="spacer" />
        {open ? null : <span className="roster-meta">Invite someone</span>}
        <span className="accordion-mark" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>
      {!open ? null : (
        <div className="panel-body">
          <p className="empty small">
            Open a session and other people can edit this robot with you, and talk about it. The
            conversation is kept against the robot afterwards.
          </p>
          <div className="toggle" role="group" aria-label="Where">
            <button
              type="button"
              aria-pressed={kind === "online"}
              onClick={() => setKind("online")}
            >
              Internet
            </button>
            <button type="button" aria-pressed={kind === "local"} onClick={() => setKind("local")}>
              This computer
            </button>
          </div>
          <div className="roster-actions">
            <button
              type="button"
              className="btn primary small"
              disabled={!canStart || room.phase === "connecting"}
              onClick={() => onStart(kind)}
            >
              {room.phase === "connecting" ? "Opening…" : "Start a session"}
            </button>
          </div>
          <div className="roster-actions">
            <input
              className="text-input code"
              value={code}
              placeholder="BOLT-7429"
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void room.join(code, kind);
              }}
            />
            <button
              type="button"
              className="btn small"
              disabled={code.trim() === "" || room.phase === "connecting"}
              onClick={() => void room.join(code, kind)}
            >
              Join
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function ChatPanel({
  inSession,
  robotId,
  robotName,
  messages,
  selfId,
  onSend,
}: {
  inSession: boolean;
  robotId: string | null;
  robotName: string;
  messages: ChatMessage[];
  selfId: string;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Outside a session the panel is still shown whenever there is something to
  // read — the whole point of keeping the conversation.
  if (!inSession && messages.length === 0) return null;

  return (
    <SidebarAccordion
      id="chat"
      title="Chat"
      meta={robotName}
      defaultOpen={inSession}
      className="chat-panel"
    >
      <div className="chat-log">
        {messages.length === 0 ? (
          <p className="empty small">Say hello. Everyone here is editing the same robot.</p>
        ) : null}
        {messages.map((line) => (
          <div key={line.id} className={`chat-line${line.authorPeerId === selfId ? " mine" : ""}`}>
            <span className="chat-who">
              {line.authorPeerId === selfId ? "You" : line.author}
              <time
                className="chat-when"
                dateTime={new Date(line.at).toISOString()}
                title={new Date(line.at).toLocaleString()}
              >
                {shortAgo(line.at)}
              </time>
            </span>
            <span className="chat-text">{line.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {inSession && robotId ? (
        <form
          className="chat-compose"
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.trim().slice(0, MAX_CHAT_LENGTH);
            if (!text) return;
            onSend(text);
            setDraft("");
          }}
        >
          <input
            className="text-input"
            value={draft}
            maxLength={MAX_CHAT_LENGTH}
            placeholder="Say something…"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn small" disabled={draft.trim() === ""}>
            Send
          </button>
        </form>
      ) : (
        <div className="chat-compose">
          <span className="roster-meta">
            Kept from earlier sessions. Start a session to add to it.
          </span>
        </div>
      )}
    </SidebarAccordion>
  );
}

// ---------------------------------------------------------------------------
// The block shelf
// ---------------------------------------------------------------------------

/**
 * Every `can` block the player has written, grouped by the event it works on,
 * ready to be dragged into a script.
 *
 * Grouping by event is the whole idea. A `can … given hit by bullet` is not a
 * general-purpose function, it is an answer to one thing that happens — so the
 * shelf is organised the way the question arrives ("what have I got for getting
 * shot?") rather than by which robot it came from. The robot name is there, but
 * as provenance, in small print.
 */
function BlockShelf({
  groups,
  theme,
  usable,
  onTake,
  onCreate,
}: {
  groups: ReturnType<typeof groupBlocks>;
  theme: Theme;
  /** False when the script on screen is not yours to change. */
  usable: boolean;
  onTake: (block: LibraryBlock) => void;
  onCreate: () => void;
}) {
  const total = groups.reduce((n, g) => n + g.blocks.length, 0);

  return (
    <SidebarAccordion
      id="behaviours"
      title={`Your ${THEMES[theme].blockPlural}`}
      meta={total > 0 ? total : undefined}
      defaultOpen={total > 0}
    >
      <div className="panel-body">
        {total === 0 ? (
          <div className="onboarding-empty">
            <p className="empty small">
              Nothing yet. Write a <code>can … given</code> block in any of your scripts and it
              appears here, ready to drop into the others.
            </p>
            <button type="button" className="btn small primary" disabled={!usable} onClick={onCreate}>
              Add a starter {theme === "biological" ? "behaviour" : "block"}
            </button>
          </div>
        ) : (
          <>
            <p className="roster-meta shelf-hint">
              {usable ? "Drag one into your script, or click to add it." : "Read-only just now."}
            </p>
            {groups.map((group) => (
              <div className="block-group" key={group.event ?? "anywhere"}>
                {/* `given`, not `on`. These are blocks, and the difference is
                    the point: a handler is one script's flow control, a
                    `given` block is a behaviour that fits anybody's. */}
                <div className="block-group-head">given {phraseFor(group.event, theme)}</div>
                {group.blocks.map((block) => (
                  <div
                    key={`${block.robotId}/${block.name}`}
                    className="block-chip"
                    draggable={usable}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(BLOCK_MIME, `${block.robotId}/${block.name}`);
                      // Anywhere that is not our editor gets the block itself,
                      // which is the sensible thing to paste into a chat or a
                      // text file.
                      event.dataTransfer.setData("text/plain", block.text);
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                    title={block.text}
                  >
                    <button
                      type="button"
                      className="block-take"
                      disabled={!usable}
                      onClick={() => onTake(block)}
                    >
                      <span className="block-name">{block.name}</span>
                      {block.params.length > 0 ? (
                        <span className="block-params">with {block.params.join(", ")}</span>
                      ) : null}
                    </button>
                    <span className="roster-meta block-from">
                      {block.robotName}
                      {block.alsoIn.length > 0 ? ` +${block.alsoIn.length}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </SidebarAccordion>
  );
}

// ---------------------------------------------------------------------------
// Arenas
// ---------------------------------------------------------------------------

/**
 * The places you have built, beside the robots and the blocks.
 *
 * Selecting one switches the whole right-hand column: no editor, no history,
 * and a Map tab in their place. That is a bigger change than a shelf usually
 * makes, which is why the panel says what it is for rather than only listing
 * names — somebody who clicks an arena and finds the editor gone should be able
 * to see immediately why.
 */
function ArenaShelf({
  lib,
  theme,
  selectedId,
  onSelect,
}: {
  lib: LibraryApi;
  theme: Theme;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { arenaLib, arenas, refresh } = lib;
  const words = THEMES[theme];
  const selected = arenas.find((a) => a.id === selectedId) ?? null;

  return (
    <SidebarAccordion
      id="arenas"
      title={`Your ${words.arenaPlural}`}
      meta={arenas.length > 0 ? arenas.length : undefined}
      defaultOpen={arenas.length > 0 || selected !== null}
    >
      <div className="panel-body flush">
        {arenas.length === 0 ? (
          <p className="empty small">
            Nothing yet. An {words.arena} is somewhere to fight rather than something to fight
            with &mdash; draw walls on it, pick its {words.ground}, and bring it to a match.
          </p>
        ) : (
          arenas.map((arena) => (
            <div
              key={arena.id}
              className="roster-item"
              aria-current={arena.id === selectedId ? "true" : undefined}
            >
              <button
                type="button"
                className="roster-select"
                // Clicking the one already open closes it, which is how you get
                // back to your robot without hunting for it in the other list.
                onClick={() => onSelect(arena.id === selectedId ? null : arena.id)}
              >
                <span className="roster-name">{arena.name}</span>
                <span className="roster-meta">
                  {wallCountLabel(arena.spec.walls.length)}
                  {arena.origin ? ` \u00b7 from ${arena.origin.from}` : ""}
                </span>
              </button>
            </div>
          ))
        )}

        <div className="roster-actions">
          <button
            type="button"
            className={`btn small${arenas.length === 0 ? " primary" : ""}`}
            onClick={() => {
              const created = arenaLib.create(`New ${words.arena}`, blankArena());
              refresh();
              onSelect(created.id);
            }}
          >
            New {words.arena}
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              const copy = arenaLib.duplicate(selected.id);
              refresh();
              if (copy) onSelect(copy.id);
            }}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              // A map is not recoverable from anywhere else \u2014 there are no
              // versions to fall back on \u2014 so this asks first.
              if (!window.confirm(`Delete ${selected.name}? This cannot be undone.`)) return;
              arenaLib.remove(selected.id);
              refresh();
              onSelect(null);
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </SidebarAccordion>
  );
}

/**
 * The map editor.
 *
 * Everything here writes straight through to storage rather than holding a
 * draft. A map has no versions to fall back on, so a "save" button would only
 * create a state where what you can see and what a match would use disagree.
 */
function MapPane({
  arena,
  lib,
  theme,
  onDraw,
}: {
  arena: StoredArena;
  lib: LibraryApi;
  theme: Theme;
  onDraw: () => void;
}) {
  const { arenaLib, refresh } = lib;
  const words = THEMES[theme];

  const commit = (spec: ArenaSpec) => {
    arenaLib.update(arena.id, spec);
    refresh();
    onDraw();
  };

  const grid = drivableMazeGrid(ARENA_SIZE.width, ARENA_SIZE.height);

  return (
    <section className="panel map-panel">
      <div className="panel-head">
        <span className="silkscreen">Map</span>
        <span className="spacer" />
        <span className="roster-meta">
          {arena.spec.walls.length} / {WALL.maxCount} walls
        </span>
      </div>

      <div className="panel-body">
        <div className="row">
          <input
            className="text-input"
            aria-label={`Name of this ${words.arena}`}
            value={arena.name}
            onChange={(e) => {
              arenaLib.rename(arena.id, e.target.value);
              refresh();
            }}
          />
        </div>

        <MapEditor
          spec={arena.spec}
          width={ARENA_SIZE.width}
          height={ARENA_SIZE.height}
          theme={theme}
          onChange={commit}
        />

        <p className="empty small">
          Drag to draw a wall. Hold <kbd>Shift</kbd> to snap to the grid and to right angles.
          Click a wall to select it, then <kbd>Delete</kbd> to remove it. Walls stop{" "}
          {words.robotPlural} and nothing else &mdash; {words.bullet}s fly over them and a{" "}
          {words.pingVerb} sees straight through.
        </p>

        <div className="row" aria-label="ground">
          <span className="roster-meta">{terrainHeading(theme)}</span>
          {TERRAIN_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={`btn small${
                sameGround(arena.spec.terrain, arenaForLevel(level).terrain) ? " primary" : ""
              }`}
              onClick={() =>
                commit({
                  ...arena.spec,
                  // The seed is kept across a change of level, so switching
                  // from rolling to hilly makes the same map harder rather
                  // than replacing it with a different one.
                  terrain: { ...arenaForLevel(level).terrain, seed: arena.spec.terrain.seed },
                })
              }
            >
              {terrainLevelWord(level, theme)}
            </button>
          ))}
          <span className="spacer" />
          <span className="roster-meta">seed {arena.spec.terrain.seed}</span>
          <button
            type="button"
            className="btn small"
            disabled={!arena.spec.terrain.enabled}
            onClick={() =>
              commit({
                ...arena.spec,
                terrain: {
                  ...arena.spec.terrain,
                  // A fresh map from a new number. Seeds are how the ground is
                  // varied here rather than sculpting it by hand: the ground is
                  // generated, the walls are drawn, and keeping the two jobs
                  // separate is what keeps a saved arena a few hundred bytes.
                  seed: (Math.floor(Math.random() * 2147483647) | 0) || 1,
                },
              })
            }
          >
            New seed
          </button>
        </div>

        <div className="roster-actions">
          <button
            type="button"
            className="btn small"
            onClick={() => {
              if (
                arena.spec.walls.length > 0 &&
                !window.confirm("Replace every wall with a new labyrinth? This cannot be undone.")
              ) {
                return;
              }
              const seed = (Math.floor(Math.random() * 2147483647) | 0) || 1;
              commit({
                ...arena.spec,
                walls: generateFittingMaze(
                  seed,
                  grid.cols,
                  grid.rows,
                  ARENA_SIZE.width,
                  ARENA_SIZE.height,
                ),
              });
            }}
          >
            Generate labyrinth
          </button>
          <button
            type="button"
            className="btn small"
            disabled={arena.spec.walls.length === 0}
            onClick={() => {
              if (!window.confirm("Remove every wall?")) return;
              commit({ ...arena.spec, walls: [] });
            }}
          >
            Clear walls
          </button>
        </div>

        <p className="empty small">
          A labyrinth is drawn on a {grid.cols}&times;{grid.rows} grid &mdash; the finest one whose
          corridors a {words.robot} can actually get down. Anything tighter is a wall with a
          pattern on it.
        </p>
      </div>
    </section>
  );
}

/** "no walls" / "1 wall" / "12 walls". */
function wallCountLabel(count: number): string {
  if (count === 0) return "no walls";
  return count === 1 ? "1 wall" : `${count} walls`;
}

/** Do two terrain configs describe the same ground, ignoring which seed? */
function sameGround(a: TerrainConfig, b: TerrainConfig): boolean {
  return (
    a.enabled === b.enabled && a.featureSize === b.featureSize && a.amplitude === b.amplitude
  );
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

function RobotLibrary({
  lib,
  selectedId,
  onSelect,
  theme,
  sessionRobotId,
  onSaved,
  forceOpen = false,
}: {
  lib: LibraryApi;
  selectedId: string | null;
  onSelect: (id: string) => void;
  theme: Theme;
  sessionRobotId: string | null;
  /** Told when a version is saved, so the tour can notice. */
  onSaved?: () => void;
  forceOpen?: boolean;
}) {
  const { library, robots, refresh, storage, chat } = lib;
  const [expanded, setExpanded] = useState<string | null>(null);
  const words = THEMES[theme];
  const selected = robots.find((r) => r.id === selectedId);

  return (
    <SidebarAccordion
      id="robots"
      title={`Your ${words.robotPlural}`}
      meta={`${Math.round((storage.used / 1024) * 10) / 10} kB used`}
      forceOpen={forceOpen}
    >
      <div className="panel-body flush">
        {robots.map((robot) => (
          <div key={robot.id}>
            <div
              className="roster-item"
              aria-current={robot.id === selectedId ? "true" : undefined}
            >
              <button type="button" className="roster-select" onClick={() => onSelect(robot.id)}>
                <span className="chip" style={{ background: robot.color }} />
                <span className="roster-name">{robot.name}</span>
                {/* Never both at once: one is what is editable, the other is
                    what happens to be on screen. */}
                {robot.id === sessionRobotId ? (
                  <span className="marker session">session</span>
                ) : robot.id === selectedId && sessionRobotId !== null ? (
                  <span className="marker viewing">viewing</span>
                ) : (
                  <span className="roster-meta">
                    {chat.hasHistory(robot.id) ? `${chat.count(robot.id)} chat · ` : ""}
                    {robot.snapshots.length > 0 ? `${robot.snapshots.length} saved` : "no versions"}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => setExpanded(expanded === robot.id ? null : robot.id)}
                aria-expanded={expanded === robot.id}
              >
                Versions
              </button>
            </div>
            {expanded === robot.id ? (
              <SnapshotList robot={robot} lib={lib} onRestored={refresh} />
            ) : null}
          </div>
        ))}

        <div className="roster-actions">
          <button
            type="button"
            className="btn small"
            onClick={() => {
              const created = library.create();
              refresh();
              onSelect(created.id);
            }}
          >
            New robot
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              const copy = library.duplicate(selected.id);
              refresh();
              if (copy) onSelect(copy.id);
            }}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="btn small"
            data-tour="save-version"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              const label = window.prompt(
                `Save a version of ${selected.name}. What should it be called?`,
                `v${selected.snapshots.length + 1}`,
              );
              if (label === null) return;
              library.saveSnapshot(selected.id, label);
              refresh();
              setExpanded(selected.id);
              onSaved?.();
            }}
          >
            Save version
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!selected || robots.length <= 1}
            onClick={() => {
              if (!selected) return;
              if (!window.confirm(`Delete ${selected.name}, its versions and its chat?`)) return;
              library.remove(selected.id);
              chat.clear(selected.id);
              refresh();
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </SidebarAccordion>
  );
}

function SnapshotList({
  robot,
  lib,
  onRestored,
}: {
  robot: StoredRobot;
  lib: LibraryApi;
  onRestored: () => void;
}) {
  const { library, refresh } = lib;
  if (robot.snapshots.length === 0) {
    return (
      <div className="empty small">
        No saved versions yet. Save one before a big change — especially before letting someone else
        edit.
      </div>
    );
  }
  return (
    <div className="snapshots">
      {robot.snapshots.map((snap) => (
        <div key={snap.id} className={`snapshot${snap.origin ? " traded" : ""}`}>
          <button
            type="button"
            className={`pin${snap.pinned ? " on" : ""}`}
            title={snap.pinned ? "Unpin" : "Pin so it is offered as an opponent"}
            onClick={() => {
              library.togglePin(robot.id, snap.id);
              refresh();
            }}
          >
            ★
          </button>
          <span className="snapshot-label">
            {snap.label}
            {/* Where it came from, not just when: a traded version is the only
                record that this robot was somebody else's first. */}
            {snap.origin ? (
              <span
                className="marker traded"
                title={`Traded from ${snap.origin.from} on ${new Date(
                  snap.origin.at,
                ).toLocaleString()}, as "${snap.origin.robotName}"`}
              >
                traded
              </span>
            ) : null}
          </span>
          <span className="roster-meta">
            {snap.origin
              ? `${snap.origin.from} · ${new Date(snap.origin.at).toLocaleDateString()}`
              : new Date(snap.createdAt).toLocaleDateString()}
          </span>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              if (!window.confirm(`Replace the working copy with "${snap.label}"?`)) return;
              library.restoreSnapshot(robot.id, snap.id);
              onRestored();
            }}
          >
            Restore
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              library.removeSnapshot(robot.id, snap.id);
              refresh();
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trial
// ---------------------------------------------------------------------------

/**
 * Everything a robot can be put up against: the built-in arena bots, the other
 * robots in the library, and every saved version of all of them — including
 * the current robot's own, which is the whole point. "Is today's better than
 * yesterday's?" is the question the Workshop exists to answer, and it needs
 * the same list of answers in the Trial as in the Test bench.
 */
/**
 * Everything that can be fought.
 *
 * `sampleIds` is the filter on the built-in {robotPlural}, and it is the one
 * place a quest reward becomes visible as an actual thing rather than a
 * sentence. An Explorer starts with the Sitting Duck and nothing else — a
 * shelf of fourteen strangers with names like "Toolkit" and "Boid" is not a
 * choice, it is a wall — and Hunter appears in it the moment they finish the
 * quest that says he will. Null means the lot, which is every level above.
 */
function buildContenders(
  robots: StoredRobot[],
  currentId: string | null,
  sampleIds: readonly string[] | null,
): Contender[] {
  const samples = sampleIds ? SAMPLE_BOTS.filter((b) => sampleIds.includes(b.id)) : SAMPLE_BOTS;
  const out: Contender[] = samples.map((b) => ({
    id: b.id,
    label: b.title,
    source: b.source,
    kind: "arena",
  }));
  for (const other of robots) {
    // Its current source is not a contender against itself — that is a mirror
    // match of identical programs, and tells you nothing. Its snapshots are,
    // because they are genuinely different programs.
    if (other.id !== currentId) {
      out.push({ id: other.id, label: other.name, source: other.source, kind: "library" });
    }
    for (const snap of other.snapshots) {
      out.push({
        id: snap.id,
        label: other.id === currentId ? snap.label : `${other.name} · ${snap.label}`,
        source: snap.source,
        kind: "snapshot",
      });
    }
  }
  return out;
}

/** The contender list, split into the groups the pickers show. */
function groupContenders(contenders: Contender[], words: { robotPlural: string; arena: string }) {
  const here = words.arena.charAt(0).toUpperCase() + words.arena.slice(1);
  return [
    // Themed like everything around it: these are the built-in examples, and in
    // the microcosm they are organisms in a microcosm, not bots in an arena.
    { title: `${here} ${words.robotPlural}`, items: contenders.filter((c) => c.kind === "arena") },
    { title: `Your ${words.robotPlural}`, items: contenders.filter((c) => c.kind === "library") },
    { title: "Versions", items: contenders.filter((c) => c.kind === "snapshot") },
  ].filter((group) => group.items.length > 0);
}

function TrialPane({
  robot,
  theme,
  showCones,
  onShowCones,
  lib,
  words,
  canRun,
  liveMatch,
  onBroadcast,
  inSession,
  arenaOverride,
  arenaName,
  onOpponents,
  onTrialStarted,
  onTrialFinished,
  onHistory,
  level,
  unlockedOpponents,
  say,
  fill,
  onApplyFix,
  onFixThere,
  onInspectorOpened,
}: {
  robot: StoredRobot | null;
  theme: Theme;
  showCones: boolean;
  onShowCones: (show: boolean) => void;
  lib: LibraryApi;
  words: { arena: string; robotPlural: string };
  canRun: boolean;
  liveMatch: MatchManifest | null;
  onBroadcast: (manifest: MatchManifest) => void;
  inSession: boolean;
  /**
   * The map to fight on, when an arena is being edited. Null means "use the
   * preset words below", which is the ordinary case.
   *
   * An override does not merely add walls: it carries the ground too, so the
   * terrain buttons are hidden while it is in force. Same reasoning as the
   * lobby \u2014 two sources of truth for the ground would drift, and the map you
   * drew would not be the map you tested against.
   */
  arenaOverride: ArenaSpec | null;
  arenaName: string | null;
  /** Who is ticked, whenever that changes. For the tour; nothing else uses it. */
  onOpponents?: (ids: readonly string[]) => void;
  /** A fight has begun. For the tour; nothing else uses it. */
  onTrialStarted?: (ids: readonly string[]) => void;
  /** How a fight went, once it is over. Also only the tour. */
  onTrialFinished?: (ids: readonly string[], won: boolean) => void;
  /** Open the durable record after reading the immediate debrief. */
  onHistory: () => void;
  level: Level;
  /** Built-in {robotPlural} this player's quests have handed over. */
  unlockedOpponents: readonly string[];
  say: (both: { full: string; simple: string }) => string;
  fill: (text: string) => string;
  /** Take the debrief up on one of its suggestions. */
  onApplyFix?: ((cardId: string) => void) | undefined;
  /** Go to where a broken script can be fixed. */
  onFixThere: () => void;
  /** The behaviour inspector was opened after a fight. */
  onInspectorOpened: () => void;
}) {
  // Remembered between sessions: tuning a robot means running the same fight
  // over and over, and having the panel put its own two back each time is a
  // small insult repeated twenty times.
  const trialPrefs = useMemo(() => new TrialPrefs(), []);
  const [opponents, setOpponentsState] = useState<string[]>(() => trialPrefs.opponents());
  const setOpponents = useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      setOpponentsState((prev) => {
        const chosen = typeof next === "function" ? next(prev) : next;
        trialPrefs.setOpponents(chosen);
        return chosen;
      });
    },
    [trialPrefs],
  );
  /**
   * Copies of each robot per side, and 1 means the free-for-all this has always
   * been rather than a 1v1 — the Trial pits you against everything you ticked
   * at once. Above 1 it becomes sides: your copies against theirs, which is the
   * only way to watch a robot that works with its own team actually do it.
   */
  /*
   * How the fight is set up before anybody touches it.
   *
   * Taken from the level rather than from one fixed preset. An Explorer fights
   * with no {fuel} and flat ground, because both are good mechanics and both
   * are a second thing to explain at the moment somebody is still working out
   * why their {robot} drove into a wall.
   */
  const preset = levelSpec(level).match;
  const [teamSize, setTeamSize] = useState(1);
  const [fuelLevel, setFuelLevel] = useState<FuelLevel>(preset.fuel);
  const [terrainLevel, setTerrainLevel] = useState<TerrainLevel>(preset.terrain);
  /*
   * And whether those rows are on show at all.
   *
   * Eleven buttons across three rows, above the list of who to fight, every
   * one of them a decision about a mechanic you have not met — sides, {fuel}
   * scarcity, terrain amplitude. For a beginner they are not options, they are
   * noise sitting between them and the one button they came here to press. So
   * they fold away, with the preset named on the fold, and open on a tap.
   */
  const simple = levelSpec(level).register === "simple";
  const compact = simple;
  const [showSetup, setShowSetup] = useState(!simple);
  const [expanded, setExpanded] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<MatchOutcome | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const openInspector = () => {
    setInspecting(true);
    onInspectorOpened();
  };

  // Escape leaves the expanded view. A view that fills the screen and can only
  // be dismissed by finding one small button again is a trap.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  /*
   * Which built-in {robotPlural} this player has met.
   *
   * The Duck is always there — it is the one you are meant to lose to first —
   * and everything else at the simple register arrives as a quest reward. At
   * the full register there is no filter at all.
   */
  const sampleIds = useMemo(
    () => (simple ? ["sitting-duck", ...unlockedOpponents] : null),
    [simple, unlockedOpponents],
  );
  const contenders = useMemo(
    () => buildContenders(lib.robots, robot?.id ?? null, sampleIds),
    [lib.robots, robot?.id, sampleIds],
  );
  const groups = useMemo(() => groupContenders(contenders, words), [contenders, words]);
  const picked = useMemo(
    () => contenders.filter((c) => opponents.includes(c.id)),
    [contenders, opponents],
  );
  // The player is always entry zero in a trial.
  const mineTelemetry = lastOutcome?.telemetry.find((entry) => entry.robotId === 0);
  const [manifest, setManifest] = useState<MatchManifest | null>(null);
  /** What each entry in the current manifest was picked as, entry order. */
  const [lineup, setLineup] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [stepSignal, setStepSignal] = useState(0);
  const [status, setStatus] = useState<MatchStatus | null>(null);

  // A trial started by the owner is watched by everyone: the manifest is all
  // that travels, exactly as in the Arena.
  useEffect(() => {
    if (liveMatch) {
      setManifest(liveMatch);
      // Someone else chose this line-up; we were not told what they picked.
      setLineup([]);
      setRunning(true);
    }
  }, [liveMatch]);

  // A script that will not compile takes the arena down with it — the renderer
  // builds the world the moment it is handed a manifest, and a compile error
  // thrown there is thrown during React's commit. The editor is already showing
  // what is wrong; the button just has to stop asking.
  const broken = robot ? !checkScript(robot.source).ok : false;

  /**
   * Who this match is against, fixed at the moment Start was pressed.
   *
   * A ref rather than state because it must not re-render anything, and it
   * exists at all because the ticked list can change while a battle is still
   * running — reporting the result against the new list would say the player
   * beat somebody they never fought.
   */
  const foughtRef = useRef<readonly string[]>([]);

  const start = () => {
    if (!robot || !canRun || broken) return;
    /*
     * At the simple register the fight fills the screen.
     *
     * The Trial pane shows the arena, its transport, the setup, who to fight
     * and the debrief at once — which is right for tuning a robot, and wrong
     * for watching one fight. The canvas is aspect-locked, so on an 827px
     * window with this skin's type it was rendering at 206x142: nine percent
     * of the screen for the only part of the game that moves.
     *
     * Rather than win that back twenty pixels at a time from panels that all
     * have a reason to exist, the fight stops being one panel among them.
     * Everything else is still there when it ends — this is the same expand
     * the button beside it has always offered, taken automatically for
     * somebody who has not yet met the button.
     */
    if (compact) setExpanded(true);
    // Filtered through the live list, so a version deleted since it was ticked
    // simply drops out rather than failing to compile.
    const chosen = contenders.filter((c) => opponents.includes(c.id));
    foughtRef.current = chosen.map((c) => c.id);
    setLastOutcome(null);
    setInspecting(false);
    onTrialStarted?.(foughtRef.current);
    // At size 1 this is the free-for-all it has always been: no teams stated,
    // so the manifest is byte-identical to the ones this panel used to build.
    // Above 1, your copies are one side and everything you ticked is the other.
    const entries =
      teamSize > 1
        ? [
            ...Array.from({ length: teamSize }, () => ({ source: robot.source, team: 0 })),
            ...chosen.flatMap((c) =>
              Array.from({ length: teamSize }, () => ({ source: c.source, team: 1 })),
            ),
          ]
        : [{ source: robot.source }, ...chosen.map((c) => ({ source: c.source }))];
    const next = makeManifest(entries, {
      seed: (Date.now() % 2147483647) | 0,
      fuel: FUEL_SETTINGS[fuelLevel],
      ...specToManifest(arenaOverride ?? arenaForLevel(terrainLevel)),
      // Off for a team match, matching the lobby and the bench.
      ...(teamSize > 1 ? { friendlyFire: false } : {}),
    });
    setManifest(next);
    setLineup(
      teamSize > 1
        ? [
            ...Array.from({ length: teamSize }, () => "This version"),
            ...chosen.flatMap((c) => Array.from({ length: teamSize }, () => c.label)),
          ]
        : ["This version", ...chosen.map((c) => c.label)],
    );
    setRunning(true);
    if (inSession) onBroadcast(next);
  };

  const onFinished = useCallback(
    (outcome: MatchOutcome) => {
      if (!robot || !manifest || !canRun) return;
      setLastOutcome(outcome);
      lib.battles.record({
        mode: "trial",
        manifest,
        result: outcome.result,
        telemetry: outcome.telemetry,
        myRobotId: robot.id,
        myEntryIndex: 0,
        ...(outcome.inspection ? { inspection: outcome.inspection.coverage } : {}),
      });
      // The player is always entry zero in a trial, so first place is a win.
      // Reported with the opponents that were actually fought rather than
      // whatever is ticked now, which they may already have changed.
      const mine = outcome.result.standings.find((s) => s.id === 0);
      onTrialFinished?.(foughtRef.current, mine?.place === 1);
    },
    [canRun, lib.battles, manifest, onTrialFinished, robot],
  );

  return (
    <div className={`trial-body${expanded ? " has-expanded" : ""}`}>
      <section
        className={`panel arena-panel${expanded ? " expanded" : ""}`}
        data-tour="arena"
      >
        <div className="panel-head">
          <span className="silkscreen">{words.arena}</span>
          <span className="spacer" />
          <label className="check">
            <input
              type="checkbox"
              checked={showCones}
              onChange={(e) => onShowCones(e.target.checked)}
            />
            Show sense cones
          </label>
          <button
            type="button"
            className="btn small icon-btn"
            onClick={() => setExpanded((v) => !v)}
            aria-pressed={expanded}
            title={expanded ? "Back to the workshop (Esc)" : "Fill the screen"}
            aria-label={expanded ? "Shrink the arena" : "Expand the arena"}
          >
            {expanded ? "\u2715" : "\u2921"}
          </button>
        </div>

        <MatchCanvas
          manifest={manifest}
          theme={theme}
          showCones={showCones}
          running={running}
          stepSignal={stepSignal}
          onStatus={setStatus}
          onFinished={onFinished}
          {...(canRun ? { traceRobotId: 0 } : {})}
        />

        {/*
          * Why the button will not press, next to the button.
          *
          * A tooltip is not an answer for somebody who is not going to hover,
          * and the Build tab's copy of this is on another tab. The disabled
          * control and the reason for it belong in the same place.
          */}
        {broken && robot ? (
          <ScriptStatus
            source={robot.source}
            register={levelSpec(level).register}
            showLabel="Take me to it"
            onShow={onFixThere}
          />
        ) : null}

        <div className="readout">
          <span
            className={`lamp ${!manifest ? "" : status?.over ? "done" : running ? "live" : "held"}`}
          >
            {!manifest ? "Idle" : status?.over ? "Finished" : running ? "Running" : "Paused"}
          </span>
          <span className="field">
            <span className="field-label">Tick</span>
            <span className="field-value">{String(status?.tick ?? 0).padStart(5, "0")}</span>
          </span>
          <span className="spacer" />
          {canRun ? (
            <span className="transport">
              <button
                type="button"
                className="btn primary"
                data-tour="trial-start"
                onClick={start}
                disabled={!robot || broken}
                title={
                  broken
                    ? simple
                      ? "Something in your robot does not make sense yet — see the message under it."
                      : "Fix the line the editor is complaining about first"
                    : undefined
                }
              >
                {manifest ? "Restart" : "Start trial"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={!manifest || status?.over}
                onClick={() => setRunning((r) => !r)}
              >
                {running ? "Pause" : "Resume"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={!manifest || running || status?.over}
                onClick={() => setStepSignal((s) => s + 1)}
              >
                Step
              </button>
            </span>
          ) : (
            <span className="roster-meta">
              The owner starts trials — you watch the same battle.
            </span>
          )}
        </div>
      </section>

      <div className="trial-side">
        {lastOutcome && simple && mineTelemetry ? (
          /*
           * The numbers are still there behind "show me the numbers" — this
           * replaces which of the two is on top, not the fact that both exist.
           */
          <PictureDebrief
            facts={{
              mine: mineTelemetry,
              field: lastOutcome.telemetry,
              ticks: status?.tick ?? 0,
              ...(lastOutcome.inspection ? { coverage: lastOutcome.inspection.coverage } : {}),
            }}
            say={say}
            fill={fill}
            {...(onApplyFix ? { onFix: onApplyFix } : {})}
            {...(lastOutcome.inspection ? { onDetail: openInspector } : {})}
          />
        ) : lastOutcome ? (
          <BattleDebrief
            mine={mineTelemetry ?? null}
            field={lastOutcome.telemetry}
            winnerId={lastOutcome.result.winnerId}
            onHistory={onHistory}
            {...(lastOutcome.inspection ? { onInspect: openInspector } : {})}
          />
        ) : null}

        {canRun ? (
        <section className="panel" data-tour="opponent-chips">
          <div className="panel-head">
            <span className="silkscreen">Who to fight</span>
            <span className="spacer" />
            <span className="roster-meta">
              {/* Counted against the contenders rather than against the stored
                  ticks. The two differ for anybody whose list has shrunk —
                  a player dropping to a level that has met fewer built-in
                  {robotPlural} keeps their ticks, and `start` already filters
                  them out, so a raw count would promise two opponents and
                  field none. */}
              {picked.length === 0
                ? "Nobody picked — it will run on its own"
                : `${picked.length} picked`}
            </span>
          </div>
          <div className="panel-body">
            {simple ? (
              <button
                type="button"
                className="setup-toggle"
                aria-expanded={showSetup}
                onClick={() => setShowSetup((v) => !v)}
              >
                {showSetup ? "▾" : "▸"} How the fight is set up
                <span className="roster-meta">
                  {fuelLevel === "off" ? `no ${words.arena === "arena" ? "fuel" : "food"}` : fuelLevel}
                  {" · "}
                  {terrainLevelWord(terrainLevel, theme)}
                  {teamSize === 1 ? "" : ` · ${teamSize} a side`}
                </span>
              </button>
            ) : null}

            {showSetup ? (
            <>
            <div className="row" aria-label="copies per side">
              <span className="roster-meta">Per side</span>
              {[1, 2, 3, MAX_TEAM_SIZE].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`btn small${teamSize === n ? " primary" : ""}`}
                  onClick={() => setTeamSize(n)}
                  title={
                    n === 1
                      ? "One of each, all against all — the Trial as it has always run."
                      : `${n} copies of yours against ${n} of each robot you have picked.`
                  }
                >
                  {n === 1 ? "Solo" : `${n} a side`}
                </button>
              ))}
            </div>
            <div className="row" aria-label="fuel">
              <span className="roster-meta">{fuelHeading(theme)}</span>
              {FUEL_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`btn small${fuelLevel === level ? " primary" : ""}`}
                  onClick={() => setFuelLevel(level)}
                >
                  {level}
                </button>
              ))}
            </div>
            <div className="row" aria-label="ground">
              <span className="roster-meta">{terrainHeading(theme)}</span>
              {arenaOverride ? (
                // Hidden rather than disabled while a map is open: a row of
                // words that no longer describe the fight is worse than no row.
                <span className="roster-meta">from {arenaName}</span>
              ) : (
                TERRAIN_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={`btn small${terrainLevel === level ? " primary" : ""}`}
                    onClick={() => setTerrainLevel(level)}
                  >
                    {terrainLevelWord(level, theme)}
                  </button>
                ))
              )}
            </div>
            <p className="empty small">Takes effect on the next start.</p>
            </>
            ) : null}
            {groups.map((group) => (
              <div key={group.title} className="chip-group">
                <span className="chip-group-title">{group.title}</span>
                <div className="chip-row">
                  {group.items.map((c) => (
                    <label key={c.id} className="opponent-chip">
                      <input
                        type="checkbox"
                        checked={opponents.includes(c.id)}
                        onChange={(e) =>
                          setOpponents((prev) => {
                            const next = e.target.checked
                              ? [...prev, c.id]
                              : prev.filter((id) => id !== c.id);
                            onOpponents?.(next);
                            return next;
                          })
                        }
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <Standings status={status} theme={theme} entryLabels={lineup} />
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-body">
            <Standings status={status} theme={theme} />
          </div>
        </section>
        )}
      </div>

      {inspecting && lastOutcome?.inspection && manifest ? (
        <BehaviourInspector
          title="Trial behaviour"
          source={manifest.entries[0]?.source ?? ""}
          manifest={manifest}
          theme={theme}
          trace={lastOutcome.inspection}
          onClose={() => setInspecting(false)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Test bench
// ---------------------------------------------------------------------------

function BattleDebrief({
  mine,
  field,
  winnerId,
  onHistory,
  onInspect,
  compact = false,
}: {
  mine: RobotTelemetry | null;
  field: readonly RobotTelemetry[];
  winnerId?: number | null;
  onHistory?: () => void;
  onInspect?: () => void;
  compact?: boolean;
}) {
  if (!mine) return null;
  const explanation = explainBattle(mine, field, winnerId);
  return (
    <section className={`battle-debrief ${explanation.tone}${compact ? " compact" : ""}`}>
      <div className="debrief-head">
        <span className="silkscreen">{compact ? "What happened" : "After the fight"}</span>
        <strong>{explanation.headline}</strong>
        <span className="spacer" />
        {onHistory ? (
          <button type="button" className="btn small" onClick={onHistory}>
            Open history
          </button>
        ) : null}
        {onInspect ? (
          <button type="button" className="btn small primary" onClick={onInspect}>
            Inspect decisions
          </button>
        ) : null}
      </div>
      <ul>
        {explanation.points.map((point) => <li key={point}>{point}</li>)}
      </ul>
    </section>
  );
}

type CoverageMode = "activity" | "decisions" | "problems";

function CoverageHeatmap({
  source,
  coverage,
  activeLine,
  onLine,
}: {
  source: string;
  coverage: ScriptCoverage;
  activeLine?: number;
  onLine?: (line: number) => void;
}) {
  const [mode, setMode] = useState<CoverageMode>("activity");
  const lines = source.split("\n");
  const score = (line: number) => {
    const item = coverage.lines[line];
    if (!item) return 0;
    if (mode === "decisions") return item.conditions;
    if (mode === "problems") return item.errors + item.suspensions;
    return item.executions;
  };
  const maximum = Math.max(1, ...lines.map((_line, index) => score(index + 1)));

  return (
    <div className="coverage-view">
      <div className="coverage-toolbar">
        <span className="silkscreen">Code heatmap</span>
        <span className="spacer" />
        {(["activity", "decisions", "problems"] as CoverageMode[]).map((option) => (
          <button
            key={option}
            type="button"
            className={`btn small${mode === option ? " primary" : ""}`}
            onClick={() => setMode(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="coverage-code" aria-label={`${mode} by source line`}>
        {lines.map((text, index) => {
          const line = index + 1;
          const item = coverage.lines[line];
          const value = score(line);
          const intensity = value === 0 ? 0 : Math.max(0.12, Math.sqrt(value / maximum));
          const branch = item?.conditions
            ? `${item.trueBranches} true / ${item.falseBranches} false`
            : "";
          const problems = item ? item.errors + item.suspensions : 0;
          const detail = mode === "decisions" ? branch : mode === "problems"
            ? `${problems} problem${problems === 1 ? "" : "s"}`
            : `${item?.executions ?? 0} execution${item?.executions === 1 ? "" : "s"}`;
          return (
            <button
              type="button"
              key={line}
              aria-label={`Line ${line}, ${detail}`}
              className={`coverage-line${activeLine === line ? " active" : ""}`}
              onClick={() => onLine?.(line)}
              title={detail}
            >
              <span className="coverage-heat" style={{ opacity: intensity }} />
              <span className="coverage-count">{value || "·"}</span>
              <span className="coverage-number">{line}</span>
              <ScriptLine text={text} />
              {branch ? <span className="coverage-branch">{branch}</span> : null}
              {problems > 0 ? <span className="coverage-problem">!{problems}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type TimelineFilter = "all" | "events" | "actions" | "problems";

function BehaviourInspector({
  title,
  source,
  manifest,
  theme,
  trace,
  onClose,
}: {
  title: string;
  source: string;
  manifest: MatchManifest;
  theme: Theme;
  trace: InspectionTrace;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<TimelineFilter>("all");
  // A full match can leave twelve thousand moments here. Sorting and filtering
  // them on every render made selecting one feel slower than the fight itself.
  const chronological = useMemo(() => chronologicalDecisions(trace.timeline), [trace]);
  const filtered = useMemo(() => chronological.filter((entry) => {
    if (filter === "events") return entry.kind === "handler" || entry.kind === "fuel";
    if (filter === "actions") return entry.kind === "action";
    if (filter === "problems") return entry.kind === "error" || entry.kind === "suspend";
    return true;
  }), [chronological, filter]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => setSelectedIndex(0), [filter, trace]);
  const selected = filtered[Math.min(selectedIndex, Math.max(0, filtered.length - 1))] ?? null;
  const visibleStart = Math.max(0, Math.min(selectedIndex - 100, Math.max(0, filtered.length - 250)));
  const visible = filtered.slice(visibleStart, visibleStart + 250);
  // Clicking a line means "show me this line", and the moment you want is the
  // next time it ran, not the first time it ever ran. Wraps back to the start.
  const chooseLine = (line: number) => {
    const at = (index: number) => filtered[index]?.line === line;
    for (let step = 1; step <= filtered.length; step++) {
      const index = (selectedIndex + step) % filtered.length;
      if (at(index)) return setSelectedIndex(index);
    }
  };

  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      // Without this the page behind the inspector scrolls as you walk the list.
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setSelectedIndex((value) => Math.max(0, Math.min(filtered.length - 1, value + delta)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered.length, onClose]);

  // Keyboard selection has to stay on screen to be worth having.
  useEffect(() => {
    listRef.current?.querySelector(".timeline-entry.active")?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, filter]);

  return (
    <div className="behaviour-inspector" role="dialog" aria-modal="true" aria-label={title}>
      <div className="inspector-head">
        <div>
          <span className="silkscreen">Behaviour Inspector</span>
          <strong>{title}</strong>
        </div>
        <span className="roster-meta">Tick-rate activity is summarised in one-second windows</span>
        <button
          type="button"
          className="inspector-close"
          aria-label="Close Behaviour Inspector"
          title="Close"
          autoFocus
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="inspector-grid">
        <div className="inspector-replay">
          <MatchCanvas
            manifest={manifest}
            theme={theme}
            showCones
            running={false}
            seekTick={selected ? decisionReplayTick(selected) : 1}
          />
          <DecisionDetail entry={selected} names={trace.variableNames} theme={theme} />
          <EventCoverageList coverage={trace.coverage} />
        </div>

        <CoverageHeatmap
          source={source}
          coverage={trace.coverage}
          {...(selected ? { activeLine: selected.line } : {})}
          onLine={chooseLine}
        />

        <div className="decision-timeline">
          <div className="timeline-toolbar">
            {(["all", "events", "actions", "problems"] as TimelineFilter[]).map((option) => (
              <button
                key={option}
                type="button"
                className={`btn small${filter === option ? " primary" : ""}`}
                onClick={() => setFilter(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="timeline-nav">
            <button type="button" className="btn small" disabled={selectedIndex === 0} onClick={() => setSelectedIndex((i) => i - 1)}>Previous</button>
            <span className="roster-meta">
              {filtered.length ? selectedIndex + 1 : 0} / {filtered.length} moment{filtered.length === 1 ? "" : "s"}
            </span>
            <button type="button" className="btn small" disabled={selectedIndex >= filtered.length - 1} onClick={() => setSelectedIndex((i) => i + 1)}>Next</button>
          </div>
          <div className="timeline-list" ref={listRef}>
            {visible.map((entry, visibleIndex) => {
              const index = visibleStart + visibleIndex;
              return (
              <button
                type="button"
                key={`${entry.tick}:${entry.line}:${entry.kind}:${index}`}
                className={`timeline-entry kind-${entry.kind}${index === selectedIndex ? " active" : ""}`}
                onClick={() => setSelectedIndex(index)}
              >
                <span>
                  {describeDecision(entry, THEMES[theme].fuel)}
                  {entry.endFuel !== undefined ? (
                    <span className="timeline-energy">
                      {fuelHeading(theme)} {Math.round(entry.endFuel)}%
                    </span>
                  ) : null}
                </span>
                <span className="roster-meta">{entry.line > 0 ? `line ${entry.line}` : "arena"}</span>
              </button>
              );
            })}
            {filtered.length === 0 ? <p className="empty small">No decisions match this filter.</p> : null}
          </div>
          {trace.truncated ? <p className="notice">The timeline was capped; coverage still includes the whole fight.</p> : null}
        </div>
      </div>
    </div>
  );
}

function DecisionDetail({ entry, names, theme }: {
  entry: DecisionEntry | null;
  names: readonly string[];
  theme: Theme;
}) {
  if (!entry) return <div className="decision-detail empty">Choose a decision to explain it.</div>;
  const contextual = entry.kind === "handler" || entry.kind === "condition" || entry.kind === "action";
  const eventValues = contextual ? Object.entries(entry.eventValues) : [];
  const variables = contextual ? readVariables(names, entry.variables) : [];
  return (
    <div className="decision-detail">
      <strong>{describeDecision(entry, THEMES[theme].fuel)}</strong>
      <p>
        {entry.kind === "handler" ? `The ${entry.event} event started this handler.` : null}
        {entry.kind === "condition" ? `The condition on line ${entry.line} selected the ${entry.result ? "first" : "other"} branch.` : null}
        {entry.kind === "action" ? `The ${entry.event} handler reached this action with the values shown below.` : null}
        {entry.kind === "suspend" ? "The handler used its full instruction allowance and resumed on the next simulation tick." : null}
        {entry.kind === "wait" ? `The script deliberately paused this handler for ${entry.ticks} ticks.` : null}
        {entry.kind === "error" ? entry.message : null}
        {entry.kind === "fuel"
          ? `The robot collected ${entry.amount.toFixed(1)} ${THEMES[theme].fuel} and finished the tick at ${Math.round(entry.endFuel ?? 0)}%.`
          : null}
      </p>
      {eventValues.length > 0 ? <ValueList title="Event" values={eventValues} /> : null}
      {variables.length > 0 ? <ValueList title="Variables" values={variables} /> : null}
    </div>
  );
}

function ValueList({ title, values }: { title: string; values: Array<[string, unknown]> }) {
  return (
    <div className="inspector-values">
      <span className="silkscreen">{title}</span>
      {values.map(([name, value]) => (
        <span key={name}><code>{name}</code><strong>{String(value)}</strong></span>
      ))}
    </div>
  );
}

function EventCoverageList({ coverage }: { coverage: ScriptCoverage }) {
  const events = Object.entries(coverage.events).sort((a, b) => b[1].queued - a[1].queued);
  return (
    <details className="event-coverage">
      <summary>Event coverage ({events.length})</summary>
      <p className="event-coverage-note">Raw occurrences are shown here; continuous runs are grouped in the timeline.</p>
      {events.map(([name, counts]) => (
        <div key={name} className="event-coverage-row">
          <code>{name}</code>
          {counts.queued === 0 ? <span className="bad">never happened</span> : <span>{counts.queued} arrived</span>}
          <span>{counts.handled} handled</span>
          {counts.dropped ? <span className="bad">{counts.dropped} dropped</span> : null}
        </div>
      ))}
    </details>
  );
}

function BenchPane({
  robot,
  robots,
  theme,
  canRun,
  sharedReport,
  onShare,
  inSession,
  arenaOverride,
  arenaName,
  onRan,
}: {
  robot: StoredRobot | null;
  robots: StoredRobot[];
  theme: Theme;
  canRun: boolean;
  sharedReport: TrialReport | null;
  onShare: (report: TrialReport) => void;
  /** A batch finished here. Fires on the machine that ran it, not on watchers. */
  onRan: () => void;
  inSession: boolean;
  /** The map to measure on, when an arena is being edited. See `TrialPane`. */
  arenaOverride: ArenaSpec | null;
  arenaName: string | null;
}) {
  const words = THEMES[theme];
  const [trials, setTrials] = useState(50);
  /**
   * Copies of each script per side. 1 is the duel the bench has always run.
   *
   * Above 1 it is N of yours against N of theirs, which is the only way to
   * measure a robot whose behaviour is about its own side: a flock of one does
   * not flock, and a robot that calls out what it finds has nobody to call to.
   */
  const [teamSize, setTeamSize] = useState(1);
  /**
   * Whether a shot stops in one of your own. Only means anything above a size
   * of one, so the control appears with the teams and not before.
   *
   * Worth having rather than fixing at off: a host can turn it on, and a robot
   * that has only ever been measured with it off has not been measured for that
   * match.
   */
  const [benchFriendlyFire, setBenchFriendlyFire] = useState(false);
  const [picked, setPicked] = useState<string[]>(["spinner", "racer"]);
  // The same words the Arena lobby offers, from the same table, so a robot
  // tuned against "hilly" here meets that ground when it gets there.
  const [fuelLevel, setFuelLevel] = useState<FuelLevel>("normal");
  const [terrainLevel, setTerrainLevel] = useState<TerrainLevel>("flat");
  const [report, setReport] = useState<TrialReport | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const contenders = useMemo(
    () => buildContenders(robots, robot?.id ?? null, null),
    [robots, robot?.id],
  );

  const run = () => {
    if (!robot) return;
    workerRef.current?.terminate();
    const worker = new Worker(new URL("../../workshop/trials.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    setReport(null);
    setProgress({ done: 0, total: trials * picked.length });

    worker.onmessage = (event: MessageEvent<TrialWorkerOut>) => {
      const message = event.data;
      if (message.type === "progress") setProgress(message.progress);
      if (message.type === "done") {
        setReport(message.report);
        setProgress(null);
        onRan();
        // One machine burns the CPU; everyone else just gets the table.
        if (inSession) onShare(message.report);
      }
      if (message.type === "failed") {
        setReport({
          rows: [],
          totalMatches: 0,
          overallWinRate: 0,
          conditions: {
            fuel: FUEL_SETTINGS[fuelLevel],
            arena: arenaOverride ?? arenaForLevel(terrainLevel),
            teamSize,
            friendlyFire: benchFriendlyFire,
          },
          error: message.message,
        });
        setProgress(null);
      }
    };

    const request: TrialWorkerIn = {
      type: "run",
      request: {
        subject: { label: robot.name, source: robot.source },
        opponents: contenders.filter((c) => picked.includes(c.id)),
        trials,
        seedBase: 1234,
        fuel: FUEL_SETTINGS[fuelLevel],
        arena: arenaOverride ?? arenaForLevel(terrainLevel),
        teamSize,
        friendlyFire: benchFriendlyFire,
      },
    };
    worker.postMessage(request);
  };

  const shown = canRun ? report : sharedReport;

  return (
    <section className="panel bench">
      <div className="panel-head">
        <span className="silkscreen">Test bench</span>
        <span className="spacer" />
        {canRun ? (
          <>
            <label className="check">
              Trials each
              <input
                className="num-input"
                type="number"
                min={1}
                max={500}
                value={trials}
                onChange={(e) => setTrials(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
              />
            </label>
            <label className="check" title="Copies of each robot per side. Above 1 it is a team match, which is the only way to bench a robot that works with its own side.">
              Per side
              <input
                className="num-input"
                type="number"
                min={1}
                max={MAX_TEAM_SIZE}
                value={teamSize}
                onChange={(e) =>
                  setTeamSize(Math.max(1, Math.min(MAX_TEAM_SIZE, Number(e.target.value) || 1)))
                }
              />
            </label>
            {teamSize > 1 ? (
              <label
                className="check"
                title="Whether a shot stops in one of your own. A host can turn this on, so it is worth knowing how your robot does under it."
              >
                <input
                  type="checkbox"
                  checked={benchFriendlyFire}
                  onChange={(e) => setBenchFriendlyFire(e.target.checked)}
                />
                Friendly fire
              </label>
            ) : null}
            <button
              type="button"
              className="btn primary small"
              disabled={!robot || picked.length === 0 || progress !== null}
              onClick={run}
            >
              {progress ? "Running…" : "Run"}
            </button>
          </>
        ) : (
          <span className="roster-meta">The owner runs this; the result is shared with you.</span>
        )}
      </div>

      <div className="panel-body">
        {canRun ? (
          <>
            <p className="empty small">
              Every trial is a different battle, and your {words.robot} swaps sides each time, so
              the result measures the {words.robot} rather than where it happened to start. The{" "}
              {words.ground} is the same every time, though — you cannot tell whether a change
              helped if it moves under you.
            </p>
            <div className="row" aria-label="fuel">
              <span className="roster-meta">{fuelHeading(theme)}</span>
              {FUEL_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`btn small${fuelLevel === level ? " primary" : ""}`}
                  onClick={() => setFuelLevel(level)}
                  disabled={progress !== null}
                >
                  {level}
                </button>
              ))}
            </div>
            <div className="row" aria-label="ground">
              <span className="roster-meta">{terrainHeading(theme)}</span>
              {arenaOverride ? (
                <span className="roster-meta">from {arenaName}</span>
              ) : (
                TERRAIN_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={`btn small${terrainLevel === level ? " primary" : ""}`}
                    onClick={() => setTerrainLevel(level)}
                    disabled={progress !== null}
                  >
                    {terrainLevelWord(level, theme)}
                  </button>
                ))
              )}
            </div>
            <div className="chip-row">
              {contenders.map((c) => (
                <label key={c.id} className={`opponent-chip kind-${c.kind}`}>
                  <input
                    type="checkbox"
                    checked={picked.includes(c.id)}
                    onChange={(e) =>
                      setPicked((prev) =>
                        e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id),
                      )
                    }
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </>
        ) : null}

        {progress ? (
          <div className="progress">
            <div className="progress-bar">
              <i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
            </div>
            <span className="roster-meta">
              {progress.done} / {progress.total} battles
            </span>
          </div>
        ) : null}

        {shown?.error ? <div className="notice bad">{shown.error}</div> : null}

        {shown && shown.rows.length > 0 ? (
          <div className="matchups">
            {shown.rows.map((row) => (
              <div key={row.opponentId} className="matchup">
                <span className="matchup-name">
                  vs {row.label}
                  {row.kind !== "arena" ? <span className="roster-meta"> (yours)</span> : null}
                </span>
                <span className="meter wide">
                  <i
                    style={{ width: `${row.winRate}%` }}
                    className={row.winRate >= 50 ? "good" : "poor"}
                  />
                </span>
                <span className="tally">{Math.round(row.winRate)}%</span>
                <span className="tally dim">{row.avgTicks} ticks</span>
              </div>
            ))}
            <div className="matchup overall">
              <span className="matchup-name">Overall</span>
              <span className="spacer" />
              <span className="tally">{Math.round(shown.overallWinRate)}%</span>
              <span className="tally dim">{shown.totalMatches} battles</span>
            </div>
            {/* What the numbers were fought over. A table travels to everyone
                in a shared session, and 74% on flat ground and 74% in the hills
                are different claims about a robot. */}
            <p className="empty small">
              Fought with {describeConditions(shown.conditions, theme)}.
            </p>
          </div>
        ) : null}

        {!shown && !canRun ? (
          <p className="empty small">Nothing measured yet in this session.</p>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function HistoryPane({
  robot,
  lib,
  theme,
  canReplay,
  sharedEntries,
  onShare,
  inSession,
  onGoToTrial,
}: {
  robot: StoredRobot | null;
  lib: LibraryApi;
  theme: Theme;
  canReplay: boolean;
  sharedEntries: BattleRecord[] | null;
  onShare: (entries: BattleRecord[]) => void;
  inSession: boolean;
  onGoToTrial: () => void;
}) {
  const [replay, setReplay] = useState<BattleRecord | null>(null);
  const [inspection, setInspection] = useState<{ record: BattleRecord; trace: InspectionTrace } | null>(null);
  const [coverageScope, setCoverageScope] = useState<"all" | "wins" | "losses">("all");
  const [coverageProgress, setCoverageProgress] = useState<{ done: number; total: number } | null>(null);
  // Analysing a battle attaches coverage to a record that already exists, so
  // the log's length is unchanged and the memos below have nothing else to
  // notice. Bump this whenever coverage is written.
  const [coverageRevision, setCoverageRevision] = useState(0);
  const own = robot ? lib.battles.forRobot(robot.id) : [];
  const records = canReplay ? own : (sharedEntries ?? []);
  const h2h = robot && canReplay ? lib.battles.headToHead(robot.id) : [];
  const [coverageVersion, setCoverageVersion] = useState(() => sourceHash(robot?.source ?? ""));
  useEffect(() => setCoverageVersion(sourceHash(robot?.source ?? "")), [robot?.id, robot?.source]);
  // Every one of these walks the whole battle log, so they are worth keeping
  // off the render path: the list only changes when a battle is recorded or a
  // filter moves.
  const coverageVersions = useMemo(() => {
    const versions = new Map<string, {
      source: string;
      label: string;
      count: number;
      measured: number;
    }>();
    if (!robot || !canReplay) return versions;
    for (const record of own) {
      if (record.myEntryIndex === null) continue;
      const source = record.manifest.entries[record.myEntryIndex]?.source;
      if (!source) continue;
      const hash = sourceHash(source);
      const existing = versions.get(hash);
      if (existing) {
        existing.count++;
        if (record.inspection) existing.measured++;
      }
      else {
        const snapshot = robot.snapshots.find((item) => item.source === source);
        versions.set(hash, {
          source,
          label: source === robot.source ? "Current working copy" : snapshot?.label ?? `Historical ${hash}`,
          count: 1,
          measured: record.inspection ? 1 : 0,
        });
      }
    }
    return versions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robot?.id, robot?.source, canReplay, own.length, coverageRevision]);

  // Falling back to the first version without correcting the state left the
  // dropdown showing a version the rest of the panel was not using.
  const resolvedVersion = coverageVersions.has(coverageVersion)
    ? coverageVersion
    : [...coverageVersions.keys()][0];
  useEffect(() => {
    if (resolvedVersion !== undefined && resolvedVersion !== coverageVersion) {
      setCoverageVersion(resolvedVersion);
    }
  }, [resolvedVersion, coverageVersion]);
  const selectedCoverageVersion = resolvedVersion === undefined
    ? undefined
    : coverageVersions.get(resolvedVersion);

  // Source equality, not hash equality: coverage is line-indexed, and merging
  // two different scripts would quietly add up unrelated lines.
  const { compatible, missingCoverage } = useMemo(() => {
    const source = selectedCoverageVersion?.source;
    if (!robot || !canReplay || source === undefined) {
      return { compatible: [] as typeof own, missingCoverage: [] as typeof own };
    }
    const mine = own.filter((record) =>
      record.myEntryIndex !== null &&
      record.manifest.entries[record.myEntryIndex]?.source === source);
    const inScope = (record: BattleRecord) =>
      coverageScope === "all" ||
      (coverageScope === "wins" && record.result.winnerId === record.myEntryIndex) ||
      (coverageScope === "losses" &&
        record.result.winnerId !== null && record.result.winnerId !== record.myEntryIndex);
    return {
      compatible: mine.filter((record) => record.inspection && inScope(record)),
      missingCoverage: mine.filter((record) => !record.inspection),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own.length, selectedCoverageVersion?.source, coverageScope, canReplay, robot?.id, coverageRevision]);

  const aggregateCoverage = useMemo(
    () => mergeCoverage(compatible.flatMap((record) => record.inspection ? [record.inspection] : [])),
    [compatible],
  );

  // The owner shares the record so advice is not given blind. Summaries only:
  // a replay needs manifests that live on the owner's machine.
  const sharedRef = useRef<string>("");
  useEffect(() => {
    if (!inSession || !canReplay) return;
    const summary = own.map((r) => ({ ...r, manifest: undefined })) as unknown as BattleRecord[];
    const key = own.map((r) => r.id).join(",");
    if (key === sharedRef.current) return;
    sharedRef.current = key;
    onShare(summary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inSession, canReplay, own.length]);

  if (inspection && inspection.record.myEntryIndex !== null) {
    return (
      <BehaviourInspector
        title={`${inspection.record.result.winnerName ?? "Draw"} · ${new Date(inspection.record.at).toLocaleString()}`}
        source={inspection.record.manifest.entries[inspection.record.myEntryIndex]?.source ?? ""}
        manifest={inspection.record.manifest}
        theme={theme}
        trace={inspection.trace}
        onClose={() => setInspection(null)}
      />
    );
  }

  if (replay) {
    return (
      <section className="panel arena-panel">
        <div className="panel-head">
          <span className="silkscreen">Replay</span>
          <span className="spacer" />
          <button type="button" className="btn small" onClick={() => setReplay(null)}>
            Back to history
          </button>
        </div>
        <MatchCanvas manifest={replay.manifest} theme={theme} showCones running />
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="silkscreen">History</span>
        <span className="spacer" />
        <span className="roster-meta">{records.length} battles</span>
      </div>
      <div className="panel-body">
        {selectedCoverageVersion ? (
          <details className="history-coverage">
            <summary>
              Code coverage across {compatible.length} compatible battle{compatible.length === 1 ? "" : "s"}
            </summary>
            <div className="coverage-scope" role="group" aria-label="Coverage battles">
              <select
                className="btn small"
                aria-label="Script version"
                value={resolvedVersion}
                onChange={(event) => setCoverageVersion(event.target.value)}
              >
                {[...coverageVersions].map(([hash, version]) => (
                  <option key={hash} value={hash}>
                    {version.label} · {version.measured}/{version.count} analysed
                  </option>
                ))}
              </select>
              {(["all", "wins", "losses"] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  className={`btn small${coverageScope === scope ? " primary" : ""}`}
                  onClick={() => setCoverageScope(scope)}
                >
                  {scope}
                </button>
              ))}
              {missingCoverage.length > 0 ? (
                <button
                  type="button"
                  className="btn small"
                  disabled={coverageProgress !== null}
                  onClick={async () => {
                    const pending = [...missingCoverage];
                    setCoverageProgress({ done: 0, total: pending.length });
                    for (let index = 0; index < pending.length; index++) {
                      const record = pending[index]!;
                      const entryIndex = record.myEntryIndex;
                      if (entryIndex !== null) {
                        const analysed = inspectManifest(record.manifest, entryIndex);
                        lib.battles.attachInspection(record.id, analysed.trace.coverage);
                        setCoverageRevision((value) => value + 1);
                      }
                      setCoverageProgress({ done: index + 1, total: pending.length });
                      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
                    }
                    setCoverageProgress(null);
                  }}
                >
                  {coverageProgress
                    ? `Analysing ${coverageProgress.done}/${coverageProgress.total}`
                    : `Analyse ${missingCoverage.length} older`}
                </button>
              ) : null}
            </div>
            {aggregateCoverage ? (
              <>
                <EventCoverageList coverage={aggregateCoverage} />
                <CoverageHeatmap source={selectedCoverageVersion.source} coverage={aggregateCoverage} />
              </>
            ) : (
              <p className="empty small">No {coverageScope} battles are available for this version.</p>
            )}
          </details>
        ) : null}

        {h2h.length > 0 ? (
          <>
            <div className="silkscreen">Record</div>
            <div className="matchups">
              {h2h.map((h) => (
                <div key={h.opponent} className="matchup">
                  <span className="matchup-name">vs {h.opponent}</span>
                  <span className="spacer" />
                  <span className="tally">
                    {h.wins}W {h.losses}L{h.draws > 0 ? ` ${h.draws}D` : ""}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {records.length === 0 ? (
          <div className="empty onboarding-empty small">
            <p>
              {canReplay
                ? "No battles yet. Run a trial and every one is kept here, replayable."
                : "The owner has not run anything yet."}
            </p>
            {canReplay ? (
              <button type="button" className="btn primary small" onClick={onGoToTrial}>
                Go to Trial
              </button>
            ) : null}
          </div>
        ) : null}

        {records.map((record) => {
          const mine = record.telemetry.find((t) => t.robotId === record.myEntryIndex);
          const warning = mine ? executionWarning(mine) : null;
          return (
            <div key={record.id} className="history-row">
              <div className="history-head">
                <span className={`place p${mine?.place ?? 0}`}>#{mine?.place ?? "—"}</span>
                <span className="who">{record.result.winnerName ?? "No winner"} won</span>
                <span className="roster-meta">{new Date(record.at).toLocaleString()}</span>
                {canReplay ? (
                  <>
                    <button type="button" className="btn small" onClick={() => setReplay(record)}>
                      Watch
                    </button>
                    <button
                      type="button"
                      className="btn small primary"
                      onClick={() => {
                        if (record.myEntryIndex === null) return;
                        const inspected = inspectManifest(record.manifest, record.myEntryIndex);
                        lib.battles.attachInspection(record.id, inspected.trace.coverage);
                        setCoverageRevision((value) => value + 1);
                        setInspection({ record, trace: inspected.trace });
                      }}
                    >
                      Inspect
                    </button>
                  </>
                ) : null}
              </div>
              {mine ? (
                <div className="history-stats">
                  <span>{Math.round(mine.damageDealt)} damage dealt</span>
                  <span>{Math.round(accuracy(mine))}% accuracy</span>
                  <span>{mine.kills} kills</span>
                  <span>{Math.round(mine.survivedTicks / 30)}s alive</span>
                </div>
              ) : null}
              {warning ? <div className="history-warning">{warning}</div> : null}
              {mine ? (
                <details className="history-explanation">
                  <summary>What happened?</summary>
                  <BattleDebrief
                    mine={mine}
                    field={record.telemetry}
                    winnerId={record.result.winnerId}
                    compact
                  />
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
