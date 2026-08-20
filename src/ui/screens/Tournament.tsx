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
import { RobotGlyph } from "../RobotGlyph.js";
import { navigate, parseRoute } from "../router.js";
import { useAutoJoin, useRoom } from "../useRoom.js";
import type { LibraryApi } from "../useLibrary.js";
import { deriveMeta } from "../../store/library.js";
import { THEMES, type Theme } from "../../lang/vocab.js";
import { fuelHeading, terrainHeading, terrainLevelWord } from "../matchSettings.js";
import { GENERATE, type ArenaChoiceValue } from "../ArenaChoice.js";
import {
  advance,
  buildBracket,
  entrant,
  roundName,
  type Bracket,
  type Entrant,
} from "../../net/bracket.js";
import { newMatchSeed } from "../../net/matchsetup.js";
import { sanitiseEntry, sanitiseText, type Message } from "../../net/protocol.js";
import { DUEL_MATCHES, duelManifest, scoreline, type Duellist } from "../../tournament/duel.js";
import { seedForJob, type DuelJob, type DuelRecord } from "../../tournament/round.js";
import { needsQualifier, qualifierMatches, type Standing } from "../../tournament/qualifier.js";
import { FUEL_PRESETS, TERRAIN_PRESETS, type FuelConfig, type TerrainConfig } from "../../sim/types.js";
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

/**
 * Tournament fuel, leaner than the arena's by default: scarcity is what makes
 * a robot's movement budget part of how good it is, and a knockout wants to be
 * decided by something other than who happened to spawn nearer a cell.
 */
const TOUR_FUEL = {
  off: FUEL_PRESETS.off,
  scarce: { enabled: true, spawnEveryTicks: 200, maxOnField: 2, amount: 18, radius: 10 },
  normal: FUEL_PRESETS.tournament,
  plentiful: { enabled: true, spawnEveryTicks: 60, maxOnField: 8, amount: 28, radius: 12 },
} satisfies Record<string, FuelConfig>;

type TourFuelLevel = keyof typeof TOUR_FUEL;

/**
 * Tournament ground. Broader and gentler than the arena's when it is on: bigger
 * features give a script room to commit to a route, and the lower amplitude
 * keeps a knockout from turning on which half of the map somebody spawned in.
 */
const TOUR_TERRAIN = {
  flat: TERRAIN_PRESETS.off,
  rolling: { enabled: true, seed: 1, featureSize: 400, amplitude: 0.5 },
  hilly: TERRAIN_PRESETS.tournament,
} satisfies Record<string, TerrainConfig>;

type TourTerrainLevel = keyof typeof TOUR_TERRAIN;

export function Tournament({ theme, lib, playerName, onPlayerName, initialRoom }: Props) {
  const { robots } = lib;
  const words = THEMES[theme];

  const room = useRoom(playerName || "Player", null);
  useAutoJoin(room, initialRoom);

  const connected = room.phase === "connected" && room.session !== null;
  const isHost = room.state?.isHost ?? false;
  // Fixed for the whole tournament, and deliberately only settable before the
  // draw: changing the terms halfway through would make earlier rounds and
  // later ones incomparable, and the bracket is a claim about one contest.
  const [fuelLevel, setFuelLevel] = useState<TourFuelLevel>("normal");
  const fuel = TOUR_FUEL[fuelLevel];
  const [terrainLevel, setTerrainLevel] = useState<TourTerrainLevel>("flat");
  // Generate by default; a saved arena is something a host deliberately brings.
  const [arenaChoice, setArenaChoice] = useState<ArenaChoiceValue>(GENERATE);
  /**
   * The map every tie in this tournament is fought on.
   *
   * Fixed before the draw and never read from the control afterwards, for the
   * same reason the fuel setting is: rounds have to be comparable, and a host
   * nudging a button between rounds would quietly make the semi-final a
   * different competition from the quarter.
   *
   * A brought arena overrides the preset words entirely \u2014 it carries its own
   * ground, so honouring both would leave two sources of truth for it.
   */
  const arena = useMemo(() => {
    if (arenaChoice.kind === "saved") {
      const found = lib.arenas.find((a) => a.id === arenaChoice.id);
      if (found) return found.spec;
    }
    return { terrain: TOUR_TERRAIN[terrainLevel], walls: [] };
  }, [arenaChoice, lib.arenas, terrainLevel]);

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
  const [standings, setStandings] = useState<Standing[] | null>(null);
  const [qualifying, setQualifying] = useState<{ done: number; total: number } | null>(null);
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
    setStandings(null);
    setQualifying(null);
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

          case "tourQualifier":
            if (isHost) return;
            setQualifying(
              message.done >= message.total ? null : { done: message.done, total: message.total },
            );
            if (Array.isArray(message.standings) && message.standings.length > 0) {
              setStandings(message.standings);
            }
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
        fuel,
        arena,
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
      if (!("round" in message) || message.round !== currentRound) return;

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
  }, [bracket, currentRound, fuel, arena, isHost, room.session, running]);

  const draw = useCallback(
    (ranking: string[]) => {
      const drawn = buildBracket(field, newMatchSeed(), ranking);
      setBracket(drawn);
      setRecords({});
      caughtUp.current.clear();
      room.session?.send("all", { t: "bracket", bracket: drawn });
    },
    [field, room.session],
  );

  /**
   * Make the draw — qualifying first, if the field will ever need a bye.
   *
   * A field that halves cleanly all the way down never leaves anybody unpaired,
   * so there is nothing for a qualifying table to decide and it is not run. Any
   * other size will strand somebody in some round, and that free pass should go
   * to the robot with the best record rather than to whoever holds an awkward
   * slot.
   */
  const makeDraw = useCallback(() => {
    const session = room.session;
    if (!isHost || field.length < 2 || qualifying) return;

    if (!needsQualifier(field.length)) {
      draw([]);
      return;
    }

    workerRef.current?.terminate();
    const worker = new Worker(new URL("../../tournament/round.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    const total = qualifierMatches(field.length);
    setQualifying({ done: 0, total });
    setStandings(null);
    session?.send("all", { t: "tourQualifier", standings: [], done: 0, total });

    worker.onmessage = (event: MessageEvent<RoundWorkerOut>) => {
      const message = event.data;
      if (message.type === "qualifying") {
        setQualifying(message.progress);
        session?.send("all", {
          t: "tourQualifier",
          standings: [],
          done: message.progress.done,
          total: message.progress.total,
        });
        return;
      }
      if (message.type === "failed") {
        setNotice(`Qualifying stopped: ${message.message}`);
        setQualifying(null);
        worker.terminate();
        return;
      }
      if (message.type !== "qualified") return;

      setStandings(message.standings);
      setQualifying(null);
      session?.send("all", {
        t: "tourQualifier",
        standings: message.standings,
        done: total,
        total,
      });
      draw(message.standings.map((row) => row.id));
      worker.terminate();
    };

    worker.postMessage({
      type: "qualify",
      entrants: field.map((e) => ({ id: e.id, robot: e.robot })),
      seedBase: newMatchSeed(),
      fuel,
      arena,
    } satisfies RoundWorkerIn);
  }, [draw, field, fuel, arena, isHost, qualifying, room.session]);

  const reset = useCallback(() => {
    if (!isHost) return;
    workerRef.current?.terminate();
    setBracket(null);
    setRecords({});
    setRunning(null);
    setViewing(null);
    setStandings(null);
    setQualifying(null);
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
      showcase.fuel,
      // From the showcase, never from the control above. The host may have
      // moved the setting since this duel was fought, and a replay has to show
      // the match that actually happened.
      showcase.arena,
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
        {qualifying ? (
          <span className="roster-meta">
            qualifying — {qualifying.done}/{qualifying.total} matches
          </span>
        ) : running ? (
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

        {isHost && !drawn ? (
          <>
            <div className="row" aria-label="fuel">
              <span className="roster-meta">{fuelHeading(theme)}</span>
              {(Object.keys(TOUR_FUEL) as TourFuelLevel[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`btn small${fuelLevel === level ? " primary" : ""}`}
                  onClick={() => setFuelLevel(level)}
                  disabled={qualifying !== null}
                >
                  {level}
                </button>
              ))}
            </div>
            <div className="row" aria-label="ground">
              <span className="roster-meta">{terrainHeading(theme)}</span>
              {arenaChoice.kind === "saved" ? (
                // The preset words are gone rather than disabled: a brought
                // arena carries its own ground, so a row of words that no
                // longer describe the tournament would be worse than no row.
                <span className="roster-meta">brought with the {words.arena}</span>
              ) : (
                (Object.keys(TOUR_TERRAIN) as TourTerrainLevel[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={`btn small${terrainLevel === level ? " primary" : ""}`}
                    onClick={() => setTerrainLevel(level)}
                    disabled={qualifying !== null}
                  >
                    {terrainLevelWord(level, theme)}
                  </button>
                ))
              )}
            </div>
            {lib.arenas.length > 0 ? (
              <div className="row" aria-label={`saved ${words.arenaPlural}`}>
                <span className="roster-meta">{words.arena.charAt(0).toUpperCase() + words.arena.slice(1)}</span>
                <select
                  className="btn small"
                  aria-label={`Bring a saved ${words.arena}`}
                  value={arenaChoice.kind === "saved" ? arenaChoice.id : ""}
                  disabled={qualifying !== null}
                  onChange={(e) =>
                    setArenaChoice(
                      e.target.value ? { kind: "saved", id: e.target.value } : GENERATE,
                    )
                  }
                >
                  <option value="">Generate a new one</option>
                  {lib.arenas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.spec.walls.length > 0 ? ` \u2014 ${a.spec.walls.length} walls` : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </>
        ) : null}

        {/* No separate "champion" banner: the tree ends in the winner's
            plinth, which says it with more presence and in the right place. */}
        {running || qualifying ? (
          <div className="progress" aria-label="progress">
            <div
              className="progress-bar"
              style={{
                width: `${Math.round(((running ?? qualifying)!.done / Math.max(1, (running ?? qualifying)!.total)) * 100)}%`,
              }}
            />
          </div>
        ) : null}

        {qualifying ? (
          <p className="roster-meta entering-note">
            Everybody is playing everybody once. The table decides who is seeded through a round
            that cannot pair off — with {field.length} entered, some round will have an odd number
            left.
          </p>
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
            {standings && standings.length > 0 ? (
              <QualifyingTable standings={standings} bracket={bracket} theme={theme} />
            ) : null}

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
              Entering shares the script: every screen replays the matches itself, so{" "}
              {words.robotPlural} in the draw are ones everyone in this room has a copy of. To show
              one without handing it over, use Trade instead.
            </p>

            {isHost ? (
              <div className="lobby-action">
                <span className="roster-meta">
                  {field.length < 2
                    ? "Two entries are needed for a draw."
                    : needsQualifier(field.length)
                      ? `${field.length} entries: everybody plays everybody once first, and the table decides who is seeded through the rounds that cannot pair off.`
                      : `Random pairings from ${field.length} entries — this field halves cleanly, so nobody sits out.`}
                </span>
                <button
                  type="button"
                  className="btn primary"
                  disabled={field.length < 2 || qualifying !== null}
                  onClick={makeDraw}
                >
                  {qualifying
                    ? "Qualifying…"
                    : needsQualifier(field.length)
                      ? "Qualify, then draw"
                      : "Make the draw"}
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

/**
 * The qualifying table.
 *
 * Shown after the draw rather than instead of it, because its job is done by
 * then — but it is the only place in the tournament where every robot is
 * compared with every other, and it explains every bye on the tree.
 */
function QualifyingTable({
  standings,
  bracket,
  theme,
}: {
  standings: Standing[];
  bracket: Bracket;
  theme: Theme;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? standings : standings.slice(0, 3);

  return (
    <section className="qualifying">
      <div className="entry-label">
        Qualifying
        <span className="roster-meta">everybody played everybody once</span>
        <span className="spacer" />
        <button type="button" className="btn small" onClick={() => setOpen(!open)}>
          {open ? "Show the top three" : `Show all ${standings.length}`}
        </button>
      </div>
      <ol className="qualifying-table">
        {shown.map((row, index) => {
          const who = entrant(bracket, row.id);
          return (
            <li key={row.id} className="qualifying-row">
              <span className="qualifying-place">{index + 1}</span>
              {who ? (
                <RobotGlyph
                  color={who.robot.color}
                  locomotion={deriveMeta(who.robot.source)?.locomotion ?? "skid"}
                  theme={theme}
                  size={20}
                  name={who.robot.name}
                />
              ) : null}
              <span className="tie-name">{who?.robot.name ?? row.id}</span>
              <span className="roster-meta">{who?.ownerName}</span>
              <span className="qualifying-record">
                {row.broken ? "won't compile" : `${row.wins}W ${row.losses}L ${row.draws}D`}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
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
  return { entrants: [], rounds: [], champion: null, ranking: [] };
}
