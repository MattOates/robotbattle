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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { accuracy, executionWarning } from "../../sim/telemetry.js";
import { shortAgo } from "../../store/chat.js";
import { MAX_CHAT_LENGTH, sanitiseChat, sanitiseText } from "../../net/protocol.js";
import type { Message } from "../../net/protocol.js";
import { RoomYProvider, CURSOR_COLORS } from "../../net/yprovider.js";
import { newId } from "../../store/storage.js";
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
import type { BattleRecord, ChatMessage, StoredArena, StoredRobot } from "../../store/types.js";
import type { ArenaSpec, TerrainConfig } from "../../sim/types.js";
import { WALL } from "../../sim/types.js";
import { drivableMazeGrid, generateFittingMaze } from "../../sim/maze.js";
import { blankArena } from "../../store/arenas.js";
import { MapEditor } from "../MapEditor.js";
import { ARENA_SIZE } from "../../net/matchsetup.js";
import { AssistantPanel } from "../../assistant/AssistantPanel.js";

interface Props {
  theme: Theme;
  lib: LibraryApi;
  playerName: string;
  initialRoom: string | null;
  /** Which model the assistant downloads when it is first asked to. */
  assistantModel: string;
}

type Pane = "editor" | "map" | "trial" | "bench" | "history";

const PANE_LABELS: Record<Pane, string> = {
  editor: "Editor",
  map: "Map",
  trial: "Trial",
  bench: "Test bench",
  history: "History",
};

/**
 * Which tabs each kind of thing gets.
 *
 * An arena has no Editor because there is no script, and no History because a
 * map does not accumulate one: battle records are filed against a robot, and
 * "this wall layout used to win" is not a sentence. What it keeps is Trial and
 * Test bench, which is the point of editing a map inside the Workshop at all —
 * you draw a labyrinth and immediately find out whether anything can solve it.
 */
const ROBOT_PANES: Pane[] = ["editor", "trial", "bench", "history"];

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
const ARENA_PANES: Pane[] = ["map", "trial", "bench"];

/** What is on screen — for a guest, whatever the host is showing. */
interface ViewedRobot {
  robotId: string;
  name: string;
  color: string;
  source: string;
}

export function Workshop({ theme, lib, playerName, initialRoom, assistantModel }: Props) {
  const { library, robots, refresh, chat } = lib;
  const [selectedId, setSelectedId] = useState<string | null>(robots[0]?.id ?? null);
  /**
   * Which arena is being edited, or null when a robot is.
   *
   * Kept beside `selectedId` rather than replacing it with a tagged union,
   * because the selected ROBOT still matters while an arena is open: Trial and
   * Test bench on a map need something to run on it, and it should be whatever
   * you were last working on rather than a second thing to pick.
   */
  const [selectedArenaId, setSelectedArenaId] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("editor");
  const [showCones, setShowCones] = useState(true);
  /**
   * Whether the assistant tray is out.
   *
   * Closed by default, and not remembered. It costs a gigabyte to start and
   * most visits to the Workshop are not questions, so the quiet state is the
   * right one to land in.
   */
  const [assistantOpen, setAssistantOpen] = useState(false);

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
  const panes = editingArena ? ARENA_PANES : ROBOT_PANES;

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

  const updateSource = useCallback(
    (source: string) => {
      if (!selected) return;
      library.updateSource(selected.id, source);
      refresh();
    },
    [library, refresh, selected],
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
    () => buildContenders([], selected?.id ?? null),
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
    <div className="workshop">
      <header className="screen-head">
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
      <div className={`assistant-tray${assistantOpen ? " open" : ""}`}>
        <button
          type="button"
          className="assistant-handle"
          aria-expanded={assistantOpen}
          aria-controls="assistant-tray-body"
          onClick={() => setAssistantOpen((open) => !open)}
        >
          {assistantOpen ? "Close ›" : "‹ Ask"}
        </button>
        <div className="assistant-tray-body" id="assistant-tray-body">
          {/* Mounted only while open, so a model is never quietly holding the
              GPU behind a closed tray. */}
          {assistantOpen ? (
            <AssistantPanel
              theme={theme}
              modelId={assistantModel}
              editorRef={editorViewRef}
              opponents={assistantOpponents}
              arena={benchArena ?? undefined}
              editable={editable}
            />
          ) : null}
        </div>
      </div>

      <div className="workshop-body">
        <aside className="column sidebar">
          {/* The library comes first: working alone is the common case, and the
              thing you reach for every time belongs above the thing you reach
              for occasionally. */}
          {inSession && !isHost ? (
            <section className="panel">
              <div className="panel-head">
                <span className="silkscreen">Session</span>
              </div>
              <div className="panel-body">
                <p className="empty small">
                  You are in {hostName(room)}&rsquo;s session, working on{" "}
                  <strong>{sessionRobotName}</strong>. Your own robots are waiting for you when you
                  leave.
                </p>
              </div>
            </section>
          ) : (
            <RobotLibrary
              lib={lib}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              theme={theme}
              sessionRobotId={inSession ? sessionRobotId : null}
            />
          )}

          <BlockShelf
            groups={shelfGroups}
            theme={theme}
            usable={editable}
            onTake={(block) => {
              setPane("editor");
              setPendingBlock(block);
            }}
          />

          {/* Last of the three shelves. Places are the thing you reach for
              least often, and the one whose selection changes the most. Hidden
              for a guest, who is here to look at somebody else's robot. */}
          {!inSession || isHost ? (
            <ArenaShelf
              lib={lib}
              theme={theme}
              selectedId={selectedArenaId}
              onSelect={setSelectedArenaId}
            />
          ) : null}

          <SessionPanel
            room={room}
            inSession={inSession}
            isHost={isHost}
            canStart={selected !== null}
            onStart={startSession}
          />

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
        </aside>

        <div className="column">
          <div className="pane-tabs" role="tablist">
            {panes.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={pane === name}
                className="pane-tab"
                onClick={() => setPane(name)}
              >
                {PANE_LABELS[name]}
              </button>
            ))}
            <span className="spacer" />
            <span className="roster-meta">
              {editingArena ? selectedArena.name : viewedName}
            </span>
          </div>

          {pane === "editor" ? (
            <section className="panel editor-panel">
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
                <span className="silkscreen">RoboScript</span>
                <span className="spacer" />
                {!inSession ? (
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

              {selected || (inSession && !isHost) ? (
                <CodeEditor
                  key={`${viewingId ?? "none"}-${editable ? "live" : "read"}`}
                  source={editorSource}
                  theme={theme}
                  collab={collab}
                  readOnly={inSession && !editable}
                  onChange={inSession ? () => undefined : updateSource}
                  viewRef={editorViewRef}
                  onDrop={onEditorDrop}
                />
              ) : (
                <div className="empty">Add a robot to start writing.</div>
              )}
            </section>
          ) : null}

          {pane === "map" && selectedArena ? (
            <MapPane arena={selectedArena} lib={lib} theme={theme} />
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
            />
          ) : null}
        </div>
      </div>
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
  // Collapsed by default: most of the time someone is here to write a robot on
  // their own, and an invitation they are not acting on should not cost them
  // half the sidebar. It opens itself if they arrived on an invite link, since
  // then joining is the whole reason they are here.
  const [open, setOpen] = useState(() => room.roomCode !== null || room.phase === "connecting");

  if (inSession && room.state) {
    return (
      <section className="panel">
        <div className="panel-head">
          <span className="silkscreen">In this room</span>
          <span className="spacer" />
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
      </section>
    );
  }

  return (
    <section className={`panel accordion${open ? " open" : ""}`}>
      <button
        type="button"
        className="panel-head accordion-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
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
    <section className="panel chat-panel">
      <div className="panel-head">
        <span className="silkscreen">Chat</span>
        <span className="spacer" />
        <span className="roster-meta">{robotName}</span>
      </div>
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
    </section>
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
}: {
  groups: ReturnType<typeof groupBlocks>;
  theme: Theme;
  /** False when the script on screen is not yours to change. */
  usable: boolean;
  onTake: (block: LibraryBlock) => void;
}) {
  const total = groups.reduce((n, g) => n + g.blocks.length, 0);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="silkscreen">
          Your {THEMES[theme].blockPlural}
        </span>
        <span className="spacer" />
        {total > 0 ? <span className="roster-meta">{total}</span> : null}
      </div>

      <div className="panel-body">
        {total === 0 ? (
          <p className="empty small">
            Nothing yet. Write a <code>can … given</code> block in any of your scripts and it
            appears here, ready to drop into the others.
          </p>
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
    </section>
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
    <section className="panel">
      <div className="panel-head">
        <span className="silkscreen">Your {words.arenaPlural}</span>
        <span className="spacer" />
        {arenas.length > 0 ? <span className="roster-meta">{arenas.length}</span> : null}
      </div>

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
            className="btn small"
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
    </section>
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
}: {
  arena: StoredArena;
  lib: LibraryApi;
  theme: Theme;
}) {
  const { arenaLib, refresh } = lib;
  const words = THEMES[theme];

  const commit = (spec: ArenaSpec) => {
    arenaLib.update(arena.id, spec);
    refresh();
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
}: {
  lib: LibraryApi;
  selectedId: string | null;
  onSelect: (id: string) => void;
  theme: Theme;
  sessionRobotId: string | null;
}) {
  const { library, robots, refresh, storage, chat } = lib;
  const [expanded, setExpanded] = useState<string | null>(null);
  const words = THEMES[theme];
  const selected = robots.find((r) => r.id === selectedId);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="silkscreen">Your {words.robotPlural}</span>
        <span className="spacer" />
        <span className="roster-meta">{Math.round((storage.used / 1024) * 10) / 10} kB used</span>
      </div>

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
    </section>
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
function buildContenders(robots: StoredRobot[], currentId: string | null): Contender[] {
  const out: Contender[] = SAMPLE_BOTS.map((b) => ({
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
}) {
  const [opponents, setOpponents] = useState<string[]>(["spinner", "racer"]);
  const [fuelLevel, setFuelLevel] = useState<FuelLevel>("normal");
  const [terrainLevel, setTerrainLevel] = useState<TerrainLevel>("flat");
  const [expanded, setExpanded] = useState(false);

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

  const contenders = useMemo(
    () => buildContenders(lib.robots, robot?.id ?? null),
    [lib.robots, robot?.id],
  );
  const groups = useMemo(() => groupContenders(contenders, words), [contenders, words]);
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

  const start = () => {
    if (!robot || !canRun || broken) return;
    // Filtered through the live list, so a version deleted since it was ticked
    // simply drops out rather than failing to compile.
    const chosen = contenders.filter((c) => opponents.includes(c.id));
    const next = makeManifest(
      [{ source: robot.source }, ...chosen.map((c) => ({ source: c.source }))],
      {
        seed: (Date.now() % 2147483647) | 0,
        fuel: FUEL_SETTINGS[fuelLevel],
        ...specToManifest(arenaOverride ?? arenaForLevel(terrainLevel)),
      },
    );
    setManifest(next);
    setLineup(["This version", ...chosen.map((c) => c.label)]);
    setRunning(true);
    if (inSession) onBroadcast(next);
  };

  const onFinished = useCallback(
    (outcome: MatchOutcome) => {
      if (!robot || !manifest || !canRun) return;
      lib.battles.record({
        mode: "trial",
        manifest,
        result: outcome.result,
        telemetry: outcome.telemetry,
        myRobotId: robot.id,
        myEntryIndex: 0,
      });
    },
    [canRun, lib.battles, manifest, robot],
  );

  return (
    <div className={`trial-body${expanded ? " has-expanded" : ""}`}>
      <section className={`panel arena-panel${expanded ? " expanded" : ""}`}>
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
        />

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
                onClick={start}
                disabled={!robot || broken}
                title={broken ? "Fix the line the editor is complaining about first" : undefined}
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

      {canRun ? (
        <section className="panel">
          <div className="panel-head">
            <span className="silkscreen">Who to fight</span>
            <span className="spacer" />
            <span className="roster-meta">
              {opponents.length === 0
                ? "Nobody picked — it will run on its own"
                : `${opponents.length} picked`}
            </span>
          </div>
          <div className="panel-body">
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
                          setOpponents((prev) =>
                            e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id),
                          )
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
  );
}

// ---------------------------------------------------------------------------
// Test bench
// ---------------------------------------------------------------------------

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
}: {
  robot: StoredRobot | null;
  robots: StoredRobot[];
  theme: Theme;
  canRun: boolean;
  sharedReport: TrialReport | null;
  onShare: (report: TrialReport) => void;
  inSession: boolean;
  /** The map to measure on, when an arena is being edited. See `TrialPane`. */
  arenaOverride: ArenaSpec | null;
  arenaName: string | null;
}) {
  const words = THEMES[theme];
  const [trials, setTrials] = useState(50);
  const [picked, setPicked] = useState<string[]>(["spinner", "racer"]);
  // The same words the Arena lobby offers, from the same table, so a robot
  // tuned against "hilly" here meets that ground when it gets there.
  const [fuelLevel, setFuelLevel] = useState<FuelLevel>("normal");
  const [terrainLevel, setTerrainLevel] = useState<TerrainLevel>("flat");
  const [report, setReport] = useState<TrialReport | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const contenders = useMemo(() => buildContenders(robots, robot?.id ?? null), [robots, robot?.id]);

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
}: {
  robot: StoredRobot | null;
  lib: LibraryApi;
  theme: Theme;
  canReplay: boolean;
  sharedEntries: BattleRecord[] | null;
  onShare: (entries: BattleRecord[]) => void;
  inSession: boolean;
}) {
  const [replay, setReplay] = useState<BattleRecord | null>(null);
  const own = robot ? lib.battles.forRobot(robot.id) : [];
  const records = canReplay ? own : (sharedEntries ?? []);
  const h2h = robot && canReplay ? lib.battles.headToHead(robot.id) : [];

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
          <div className="empty small">
            {canReplay
              ? "No battles yet. Run a trial and every one is kept here, replayable."
              : "The owner has not run anything yet."}
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
                  <button type="button" className="btn small" onClick={() => setReplay(record)}>
                    Watch
                  </button>
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
            </div>
          );
        })}
      </div>
    </section>
  );
}
