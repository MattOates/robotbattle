/**
 * Tournament: a draw made from what the room puts on the table.
 *
 * Deliberately the same opening gesture as Trade — your library on the left, a
 * shared table on the right, nothing visible until you drag it across. What the
 * room does with the table is the difference: instead of swapping, the host
 * makes a random draw from everything on it, and each tie is then settled the
 * way the test bench settles an argument, over eleven matches rather than one.
 *
 * Entering is publishing. A robot in the draw has its script sent to everyone,
 * because every peer replays the matches locally — so the table says so, and a
 * robot you only want to show off belongs in Trade instead.
 *
 * The host does the simulating, in a worker, and broadcasts the outcome. That
 * is not a matter of trust: a result carries the seed it came from, so anybody
 * can watch the match it claims and see the same thing happen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lobby } from "./Lobby.js";
import { BracketView } from "../BracketView.js";
import { MatchCanvas, type MatchOutcome } from "../MatchCanvas.js";
import { RobotTable, type TableEntry } from "../RobotTable.js";
import { navigate, parseRoute } from "../router.js";
import { useAutoJoin, useRoom } from "../useRoom.js";
import type { LibraryApi } from "../useLibrary.js";
import { deriveMeta } from "../../store/library.js";
import { THEMES, type Theme } from "../../lang/vocab.js";
import {
  advance,
  buildBracket,
  entrant,
  isComplete,
  roundName,
  type Bracket,
  type Entrant,
} from "../../net/bracket.js";
import { newMatchSeed } from "../../net/matchsetup.js";
import { sanitiseEntry, sanitiseText, type Message } from "../../net/protocol.js";
import { DUEL_MATCHES, duelManifest, scoreline, type Duellist } from "../../tournament/duel.js";
import { seedForJob, type DuelJob, type DuelRecord } from "../../tournament/round.js";
import type { RoundWorkerIn, RoundWorkerOut } from "../../tournament/round.worker.js";
import { pruneOffered, toggleOffered } from "../tradeShelf.js";

interface Props {
  theme: Theme;
  lib: LibraryApi;
  playerName: string;
  onPlayerName: (name: string) => void;
  initialRoom: string | null;
}

/** What is queued for watching: a run of ties, played one after another. */
interface Viewing {
  matchIds: string[];
  index: number;
  round: number;
}

export function Tournament({ theme, lib, playerName, onPlayerName, initialRoom }: Props) {
  const { robots } = lib;
  const words = THEMES[theme];

  const room = useRoom(playerName || "Player", null);
  useAutoJoin(room, initialRoom);

  const connected = room.phase === "connected" && room.session !== null;
  const isHost = room.state?.isHost ?? false;

  useEffect(() => {
    if (connected && room.roomCode && parseRoute(window.location.hash).room !== room.roomCode) {
      navigate("tournament", room.roomCode);
    }
  }, [connected, room.roomCode]);

  const [offered, setOffered] = useState<string[]>([]);
  const [dropping, setDropping] = useState<"table" | "library" | null>(null);
  /** Everyone else's entries, by peer. */
  const [fields, setFields] = useState<Record<string, Entrant[]>>({});
  const [bracket, setBracket] = useState<Bracket | null>(null);
  const [records, setRecords] = useState<Record<string, DuelRecord>>({});
  const [running, setRunning] = useState<{ round: number; done: number; total: number } | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  /** Replay speed. A settled match is worth skimming; a live one never is. */
  const [speed, setSpeed] = useState(1);
  const workerRef = useRef<Worker | null>(null);

  const selfId = room.state?.selfId ?? "";
  const others = useMemo(
    () => (room.state?.peers ?? []).filter((p) => p.id !== selfId),
    [room.state, selfId],
  );

  // Leaving takes the whole tournament with it: a draw belongs to a room.
  useEffect(() => {
    if (connected) return;
    setFields({});
    setBracket(null);
    setRecords({});
    setRunning(null);
    setViewing(null);
    setOffered([]);
  }, [connected]);

  useEffect(() => {
    setOffered((prev) => {
      const next = pruneOffered(prev, robots);
      return next.length === prev.length ? prev : next;
    });
  }, [robots]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  /** My entries, with their scripts — entering a draw publishes them. */
  const mine = useMemo<Entrant[]>(
    () =>
      offered.flatMap((id) => {
        const robot = robots.find((r) => r.id === id);
        if (!robot) return [];
        return [
          {
            id: `${selfId}:${robot.id}`,
            ownerName: playerName || "Player",
            robot: { name: robot.name, color: robot.color, source: robot.source },
          },
        ];
      }),
    [offered, playerName, robots, selfId],
  );

  // Publish the field whenever it changes, and again when the room does — a
  // newcomer has never seen it.
  const sent = useRef("");
  useEffect(() => {
    const session = room.session;
    if (!connected || !session) return;
    const key = JSON.stringify(mine.map((e) => e.id)) + others.map((p) => p.id).join(",");
    if (sent.current === key) return;
    sent.current = key;
    session.send("all", { t: "tourField", entrants: mine });
  }, [connected, mine, others, room.session]);

  // The host catches newcomers up on a draw already in progress.
  const caughtUp = useRef(new Set<string>());
  useEffect(() => {
    const session = room.session;
    if (!isHost || !session || !bracket) return;
    for (const peer of others) {
      if (caughtUp.current.has(peer.id)) continue;
      caughtUp.current.add(peer.id);
      session.send(peer.id, { t: "bracket", bracket });
      for (const [round, list] of roundsOfRecords(records).entries()) {
        if (list.length > 0) session.send(peer.id, { t: "tourRound", round, records: list });
      }
    }
    const present = new Set(others.map((p) => p.id));
    for (const id of [...caughtUp.current]) if (!present.has(id)) caughtUp.current.delete(id);
  }, [bracket, isHost, others, records, room.session]);

  // --- incoming ------------------------------------------------------------
  useEffect(
    () =>
      room.onMessage((from, message: Message) => {
        switch (message.t) {
          case "tourField": {
            const list = Array.isArray(message.entrants) ? message.entrants.slice(0, 32) : [];
            setFields((prev) => ({
              ...prev,
              [from]: list.flatMap((raw) => {
                const robot = sanitiseEntry(raw?.robot);
                if (!robot || typeof raw?.id !== "string") return [];
                return [
                  {
                    id: raw.id.slice(0, 128),
                    ownerName: sanitiseText(raw.ownerName, 24) || "Someone",
                    robot,
                  },
                ];
              }),
            }));
            return;
          }

          case "bracket":
            // The host is authoritative about the draw, exactly as it is about
            // the roster: there is one answer to "who plays whom".
            if (isHost) return;
            setBracket(message.bracket);
            setRunning(null);
            return;

          case "tourProgress":
            if (isHost) return;
            setRunning({ round: message.round, done: message.done, total: message.total });
            return;

          case "tourRound": {
            if (isHost) return;
            const incoming = Array.isArray(message.records) ? message.records : [];
            setRecords((prev) => {
              const next = { ...prev };
              for (const record of incoming) {
                if (record && typeof record.matchId === "string") next[record.matchId] = record;
              }
              return next;
            });
            setRunning(null);
            return;
          }

          default:
            return;
        }
      }),
    [isHost, room],
  );

  // --- the field -----------------------------------------------------------

  const put = useCallback((robotId: string, onTable: boolean) => {
    if (!robotId) return;
    setOffered((prev) =>
      prev.includes(robotId) === onTable ? prev : toggleOffered(prev, robotId),
    );
  }, []);

  const field = useMemo<Entrant[]>(
    () => [...mine, ...others.flatMap((peer) => fields[peer.id] ?? [])],
    [fields, mine, others],
  );

  const tableEntries = useMemo<TableEntry[]>(
    () =>
      field.map((e) => ({
        item: {
          id: e.id,
          name: e.robot.name,
          color: e.robot.color,
          locomotion: deriveMeta(e.robot.source)?.locomotion ?? "skid",
        },
        ownerId: e.id.startsWith(`${selfId}:`) ? null : e.id.split(":")[0]!,
        ownerName: e.id.startsWith(`${selfId}:`) ? "you" : e.ownerName,
      })),
    [field, selfId],
  );

  // --- running a round -----------------------------------------------------

  const currentRound = useMemo(() => {
    if (!bracket) return null;
    for (const [index, matches] of bracket.rounds.entries()) {
      if (matches.some((m) => m.winner === null && m.a !== null && m.b !== null)) return index;
    }
    return null;
  }, [bracket]);

  const playRound = useCallback(() => {
    const session = room.session;
    if (!isHost || !bracket || currentRound === null || running) return;

    const duellist = (id: string | null): Duellist | null => {
      const found = entrant(bracket, id);
      return found
        ? { name: found.robot.name, color: found.robot.color, source: found.robot.source }
        : null;
    };

    const seedBase = newMatchSeed();
    const jobs: DuelJob[] = [];
    for (const match of bracket.rounds[currentRound] ?? []) {
      if (match.winner !== null || match.a === null || match.b === null) continue;
      const a = duellist(match.a);
      const b = duellist(match.b);
      if (!a || !b) continue;
      jobs.push({
        matchId: match.id,
        aId: match.a,
        bId: match.b,
        a,
        b,
        seedBase: seedForJob(seedBase, match.id),
      });
    }
    if (jobs.length === 0) return;

    workerRef.current?.terminate();
    const worker = new Worker(new URL("../../tournament/round.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    setRunning({ round: currentRound, done: 0, total: jobs.length * DUEL_MATCHES });
    session?.send("all", {
      t: "tourProgress",
      round: currentRound,
      done: 0,
      total: jobs.length * DUEL_MATCHES,
    });

    worker.onmessage = (event: MessageEvent<RoundWorkerOut>) => {
      const message = event.data;
      if (message.round !== currentRound) return;

      if (message.type === "progress") {
        setRunning({
          round: currentRound,
          done: message.progress.done,
          total: message.progress.total,
        });
        session?.send("all", {
          t: "tourProgress",
          round: currentRound,
          done: message.progress.done,
          total: message.progress.total,
        });
        return;
      }

      if (message.type === "failed") {
        setNotice(`The round stopped: ${message.message}`);
        setRunning(null);
        worker.terminate();
        return;
      }

      // Apply every result, then publish the whole draw — one message the room
      // can trust rather than a promotion each peer has to derive.
      setRecords((prev) => {
        const next = { ...prev };
        for (const record of message.records) next[record.matchId] = record;
        return next;
      });

      setBracket((prev) => {
        if (!prev) return prev;
        let updated = prev;
        for (const record of message.records) {
          if (record.winnerId !== null) updated = advance(updated, record.matchId, record.winnerId);
        }
        session?.send("all", { t: "bracket", bracket: updated });
        return updated;
      });
      session?.send("all", { t: "tourRound", round: currentRound, records: message.records });
      setRunning(null);
      worker.terminate();
    };

    worker.postMessage({
      type: "run",
      jobs,
      matches: DUEL_MATCHES,
      round: currentRound,
    } satisfies RoundWorkerIn);
  }, [bracket, currentRound, isHost, room.session, running]);

  const makeDraw = useCallback(() => {
    if (!isHost || field.length < 2) return;
    const drawn = buildBracket(field, newMatchSeed());
    setBracket(drawn);
    setRecords({});
    caughtUp.current.clear();
    room.session?.send("all", { t: "bracket", bracket: drawn });
  }, [field, isHost, room.session]);

  const reset = useCallback(() => {
    if (!isHost) return;
    workerRef.current?.terminate();
    setBracket(null);
    setRecords({});
    setRunning(null);
    setViewing(null);
    caughtUp.current.clear();
    room.session?.send("all", { t: "bracket", bracket: emptyBracket() });
  }, [isHost, room.session]);

  // --- watching ------------------------------------------------------------

  const watch = useCallback(
    (matchId: string) => {
      const record = records[matchId];
      if (!record?.result.showcase || !bracket) return;
      const round = bracket.rounds.findIndex((r) => r.some((m) => m.id === matchId));
      setViewing({ matchIds: [matchId], index: 0, round: Math.max(0, round) });
    },
    [bracket, records],
  );

  const watchRound = useCallback(
    (round: number) => {
      if (!bracket) return;
      const ids = (bracket.rounds[round] ?? [])
        .filter((m) => records[m.id]?.result.showcase)
        .map((m) => m.id);
      if (ids.length > 0) setViewing({ matchIds: ids, index: 0, round });
    },
    [bracket, records],
  );

  const viewingRecord = viewing ? records[viewing.matchIds[viewing.index] ?? ""] : undefined;
  const viewingManifest = useMemo(() => {
    if (!bracket || !viewingRecord?.result.showcase) return null;
    const a = entrant(bracket, viewingRecord.aId);
    const b = entrant(bracket, viewingRecord.bId);
    if (!a || !b) return null;
    const showcase = viewingRecord.result.showcase;
    return duelManifest(
      { name: a.robot.name, color: a.robot.color, source: a.robot.source },
      { name: b.robot.name, color: b.robot.color, source: b.robot.source },
      showcase.seed,
      showcase.aFirst,
    );
  }, [bracket, viewingRecord]);

  const nextInQueue = useCallback(() => {
    setViewing((prev) => {
      if (!prev) return prev;
      const index = prev.index + 1;
      return index >= prev.matchIds.length ? null : { ...prev, index };
    });
  }, []);

  // A watched match ends by itself; give people a moment to read the result
  // before the next one starts.
  const onFinished = useCallback(
    (_outcome: MatchOutcome) => {
      window.setTimeout(() => nextInQueue(), 2200);
    },
    [nextInQueue],
  );

  if (viewing && viewingManifest && viewingRecord && bracket) {
    const winner = entrant(bracket, viewingRecord.winnerId);
    const loser = entrant(
      bracket,
      viewingRecord.winnerId === viewingRecord.aId ? viewingRecord.bId : viewingRecord.aId,
    );
    return (
      <div className="fullscreen-match">
        <MatchCanvas
          key={`${viewingRecord.matchId}:${viewingRecord.result.showcase?.seed}`}
          manifest={viewingManifest}
          theme={theme}
          showCones={false}
          running
          speed={speed}
          fit="contain"
          onFinished={onFinished}
        />
        <div className="match-overlay">
          <span className="lamp live">{roundName(bracket, viewing.round)}</span>
          {/* One line rather than a labelled field: this is a sentence about
              what is on screen, not a gauge to read off. */}
          <span className="watching" title={`One of the ${DUEL_MATCHES} that settled this tie`}>
            <strong>{winner?.robot.name ?? "?"}</strong> beat {loser?.robot.name ?? "?"}{" "}
            {scoreline(viewingRecord.result)}
          </span>
          {viewing.matchIds.length > 1 ? (
            <span className="roster-meta">
              tie {viewing.index + 1} of {viewing.matchIds.length}
            </span>
          ) : null}
          <span className="spacer" />
          <span className="toggle speed">
            {[1, 2, 4].map((rate) => (
              <button
                key={rate}
                type="button"
                aria-pressed={speed === rate}
                onClick={() => setSpeed(rate)}
              >
                {rate}×
              </button>
            ))}
          </span>
          {viewing.index + 1 < viewing.matchIds.length ? (
            <button type="button" className="btn small" onClick={nextInQueue}>
              Skip →
            </button>
          ) : null}
          <button type="button" className="btn small" onClick={() => setViewing(null)}>
            Back to the draw
          </button>
        </div>
      </div>
    );
  }

  const drawn = bracket !== null && bracket.entrants.length > 0;
  const champion = bracket && isComplete(bracket) ? entrant(bracket, bracket.champion) : null;

  return (
    <Lobby
      title="Tournament"
      blurb={`Put ${words.robotPlural} forward, and the room draws them against each other. Every tie is settled over ${DUEL_MATCHES} matches, not one — and you can watch the ones that decided it.`}
      shareScreen="tournament"
      room={room}
      robots={robots}
      selectedRobotId={null}
      onSelectRobot={() => undefined}
      playerName={playerName}
      onPlayerName={onPlayerName}
      requiresRobot={false}
    >
      <div className="panel-head">
        <span className="silkscreen">{drawn ? "The draw" : "The table"}</span>
        <span className="spacer" />
        {running ? (
          <span className="roster-meta">
            playing {roundName(bracket!, running.round)} — {running.done}/{running.total} matches
          </span>
        ) : (
          <span className="roster-meta">
            {drawn ? `${bracket!.entrants.length} in the draw` : `${field.length} entered`}
          </span>
        )}
        {isHost && drawn ? (
          <button type="button" className="btn small" onClick={reset} disabled={running !== null}>
            Start over
          </button>
        ) : null}
      </div>

      <div className="panel-body">
        {notice ? <div className="notice">{notice}</div> : null}

        {champion ? (
          <div className="notice champion">
            <span className="silkscreen">Champion</span>
            <strong>{champion.robot.name}</strong>
            <span className="roster-meta">{champion.ownerName}</span>
          </div>
        ) : null}

        {running ? (
          <div className="progress" aria-label="round progress">
            <div
              className="progress-bar"
              style={{ width: `${Math.round((running.done / Math.max(1, running.total)) * 100)}%` }}
            />
          </div>
        ) : null}

        {drawn && bracket ? (
          <>
            <BracketView
              bracket={bracket}
              records={records}
              theme={theme}
              runningRound={running?.round ?? null}
              onWatch={watch}
              onWatchRound={watchRound}
            />
            {isHost && currentRound !== null ? (
              <div className="lobby-action">
                <span className="roster-meta">
                  {DUEL_MATCHES} matches per tie, run here and shared with the room.
                </span>
                <button
                  type="button"
                  className="btn primary"
                  disabled={running !== null}
                  onClick={playRound}
                >
                  {running ? "Playing…" : `Play ${roundName(bracket, currentRound)}`}
                </button>
              </div>
            ) : null}
            {!isHost && currentRound !== null && !running ? (
              <div className="empty small">
                Waiting for the host to play {roundName(bracket, currentRound)}.
              </div>
            ) : null}
          </>
        ) : (
          <>
            <RobotTable
              theme={theme}
              robotPlural={words.robotPlural}
              robots={robots}
              offered={offered}
              onPut={put}
              entries={tableEntries}
              tableLabel="Entered"
              tableHint={field.length === 0 ? "nothing entered yet" : `${field.length} in the draw`}
              emptyTable={
                <>
                  Empty. Drag {words.robotPlural} across to enter them — anyone in the room can
                  enter as many as they like.
                </>
              }
              dropping={dropping}
              onDropping={setDropping}
              actionsFor={({ item, ownerId }) =>
                ownerId === null ? (
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => put(item.id.split(":").slice(1).join(":"), false)}
                  >
                    Withdraw
                  </button>
                ) : null
              }
            />

            <p className="roster-meta entering-note">
              Entering shares the script: every screen replays the matches itself, so a robot in the
              draw is a robot everyone in this room has a copy of. To show one without handing it
              over, use Trade instead.
            </p>

            {isHost ? (
              <div className="lobby-action">
                <span className="roster-meta">
                  {field.length < 2
                    ? "Two entries are needed for a draw."
                    : `Random pairings from ${field.length} entries.`}
                </span>
                <button
                  type="button"
                  className="btn primary"
                  disabled={field.length < 2}
                  onClick={makeDraw}
                >
                  Make the draw
                </button>
              </div>
            ) : (
              <div className="empty small">The host makes the draw when everyone is in.</div>
            )}
          </>
        )}
      </div>
    </Lobby>
  );
}

/** Records grouped by the round their match id belongs to. */
function roundsOfRecords(records: Record<string, DuelRecord>): DuelRecord[][] {
  const out: DuelRecord[][] = [];
  for (const record of Object.values(records)) {
    const round = Number.parseInt(record.matchId.slice(1), 10);
    const index = Number.isFinite(round) ? round : 0;
    (out[index] ??= []).push(record);
  }
  for (let i = 0; i < out.length; i++) out[i] ??= [];
  return out;
}

/** A cleared draw, so "start over" reaches the guests as well. */
function emptyBracket(): Bracket {
  return { entrants: [], rounds: [], champion: null };
}
