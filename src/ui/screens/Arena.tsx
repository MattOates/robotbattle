/**
 * Arena: everyone's robot in one battle, built to be watched on a big screen.
 *
 * The host sends one manifest and every peer plays the whole match locally.
 * Hash checks run alongside purely to notice if two screens ever disagree —
 * there is nothing to reconcile, only a bug to report honestly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArenaChoicePanel,
  GENERATE,
  resolveArena,
  type ArenaChoiceValue,
} from "../ArenaChoice.js";
import { Lobby } from "./Lobby.js";
import { Countdown } from "../Countdown.js";
import { MatchCanvas, type MatchOutcome, type MatchStatus } from "../MatchCanvas.js";
import { useAutoJoin, useRoom } from "../useRoom.js";
import type { LibraryApi } from "../useLibrary.js";
import type { Message } from "../../net/protocol.js";
import {
  entryIndexFor,
  manifestFromParticipants,
  newMatchId,
  newMatchSeed,
  type Participant,
} from "../../net/matchsetup.js";
import type { MatchManifest } from "../../sim/world.js";
import {
  FUEL_LEVELS,
  FUEL_SETTINGS,
  fuelBlurb,
  fuelHeading,
  fuelIntro,
  FIRE_LEVELS,
  FIRE_SETTINGS,
  fireBlurb,
  fireHeading,
  fireIntro,
  fireLevelWord,
  teamLabel,
  type FireLevel,
  type FuelLevel,
  type TerrainLevel,
} from "../matchSettings.js";
import { accuracy, executionWarning } from "../../sim/telemetry.js";
import type { RobotTelemetry } from "../../store/types.js";
import type { Theme } from "../../lang/vocab.js";
import { navigate, parseRoute } from "../router.js";

interface Props {
  theme: Theme;
  lib: LibraryApi;
  playerName: string;
  onPlayerName: (name: string) => void;
  initialRoom: string | null;
}

interface LiveMatch {
  matchId: string;
  manifest: MatchManifest;
  myIndex: number | null;
}

export function Arena({ theme, lib, playerName, onPlayerName, initialRoom }: Props) {
  const { robots } = lib;
  const [robotId, setRobotId] = useState<string | null>(robots[0]?.id ?? null);
  const robot = robots.find((r) => r.id === robotId) ?? robots[0] ?? null;

  const room = useRoom(
    playerName || "Player",
    robot ? { name: robot.name, color: robot.color, source: robot.source } : null,
  );

  const [match, setMatch] = useState<LiveMatch | null>(null);
  const [status, setStatus] = useState<MatchStatus | null>(null);
  const [outcome, setOutcome] = useState<MatchOutcome | null>(null);
  const [drifted, setDrifted] = useState(false);
  /** Held still for the 3-2-1 before anything moves. */
  const [counting, setCounting] = useState(false);
  const [nudge, setNudge] = useState<{ at: number; text: string } | null>(null);
  // Host-only, and only read when the host presses start: it rides to everyone
  // else inside the manifest, so there is nothing here to keep in sync.
  const [fuelLevel, setFuelLevel] = useState<FuelLevel>("normal");
  const [terrainLevel, setTerrainLevel] = useState<TerrainLevel>("flat");
  // Generate by default. A saved arena is something a host deliberately brings,
  // never something that arrives because it happened to be first in the list.
  const [arenaChoice, setArenaChoice] = useState<ArenaChoiceValue>(GENERATE);
  /** 0 is a free-for-all, which is what the Arena has always been. */
  const [teamCount, setTeamCount] = useState(0);
  /**
   * Defaults to off because the control only appears once there are
   * sides, and somebody who has just made two teams almost never means "and now
   * shoot each other". The manifest still defaults the other way — that is what
   * every match played before teams existed did — so this is a lobby default
   * and not a change to the rules.
   */
  const [fireLevel, setFireLevel] = useState<FireLevel>("off");
  const hashesRef = useRef(new Map<number, string>());

  useAutoJoin(room, initialRoom);
  useEffect(() => {
    if (room.phase === "connected" && room.roomCode && parseRoute(window.location.hash).room !== room.roomCode) {
      navigate("arena", room.roomCode);
    }
  }, [room.phase, room.roomCode]);

  useEffect(
    () =>
      room.onMessage((from, message: Message) => {
        if (message.t === "start") {
          hashesRef.current.clear();
          setDrifted(false);
          setOutcome(null);
          setCounting(true);
          setMatch({
            matchId: message.matchId,
            manifest: message.manifest,
            myIndex: null,
          });
        }
        if (message.t === "nudge") {
          setNudge({ at: Date.now(), text: message.text });
        }
        if (message.t === "hash") {
          const mine = hashesRef.current.get(message.tick);
          // Two peers claiming different state at the same tick is the one
          // failure this design can produce, so it is said out loud.
          if (mine && mine !== message.hash) setDrifted(true);
          void from;
        }
      }),
    [room],
  );

  const onStatus = useCallback(
    (next: MatchStatus) => {
      setStatus(next);
      if (!match || next.tick === 0) return;
      if (next.tick % 30 === 0 && !hashesRef.current.has(next.tick)) {
        hashesRef.current.set(next.tick, next.hash);
        room.session?.broadcast({
          t: "hash",
          matchId: match.matchId,
          tick: next.tick,
          hash: next.hash,
        });
      }
    },
    [match, room.session],
  );

  const onFinished = useCallback(
    (result: MatchOutcome) => {
      setOutcome(result);
      if (!match || !robot) return;
      lib.battles.record({
        mode: "arena",
        manifest: match.manifest,
        result: result.result,
        telemetry: result.telemetry,
        myRobotId: robot.id,
        myEntryIndex: match.myIndex,
      });
    },
    [lib.battles, match, robot],
  );

  const startMatch = () => {
    const session = room.session;
    const state = room.state;
    if (!session || !state) return;

    const participants = session.entries() as Participant[];
    if (participants.length < 2) {
      session.setNotice("At least two robots are needed.");
      return;
    }

    // Nobody is dragged into a battle they have not said yes to. Anyone
    // holding things up gets prodded individually, rather than the host being
    // left to shout across the room.
    const notReady = state.peers.filter((p) => !p.ready);
    if (notReady.length > 0) {
      for (const peer of notReady) {
        if (peer.id === state.selfId) continue;
        session.send(peer.id, {
          t: "nudge",
          text: peer.robot
            ? "Everyone is waiting on you — press “I’m ready” when your robot is set."
            : "Everyone is waiting on you — pick a robot, then press “I’m ready”.",
        });
      }
      const names = notReady.map((p) => (p.id === state.selfId ? "you" : p.displayName));
      session.setNotice(
        `Still waiting on ${names.join(", ")}. ${
          notReady.some((p) => p.id === state.selfId) ? "" : "They have been nudged."
        }`.trim(),
      );
      return;
    }

    session.setNotice(null);
    // Anybody the host never put on a side is spread over the sides that
    // exist, in peer-id order, so a room that forgot to sort itself out still
    // gets an even match rather than one team of five.
    const withTeams: Participant[] =
      teamCount > 1
        ? participants.map((p, i) => ({ ...p, team: p.team ?? i % teamCount }))
        : participants.map(({ team: _ignored, ...rest }) => rest);

    const manifest = manifestFromParticipants(withTeams, newMatchSeed(), {
      fuel: FUEL_SETTINGS[fuelLevel],
      arena: resolveArena(arenaChoice, terrainLevel, lib.arenas),
      ...(teamCount > 1 ? { friendlyFire: FIRE_SETTINGS[fireLevel] } : {}),
    });
    session.broadcast({ t: "start", matchId: newMatchId(), manifest, label: "Arena" });
  };

  // Work out which entry is ours once a match arrives.
  useEffect(() => {
    if (!match || match.myIndex !== null || !room.session) return;
    const participants = room.session.entries() as Participant[];
    const index = entryIndexFor(participants, room.state?.selfId ?? "");
    setMatch((m) => (m ? { ...m, myIndex: index } : m));
  }, [match, room.session, room.state?.selfId]);

  if (match) {
    return (
      <div className="fullscreen-match">
        <MatchCanvas
          manifest={match.manifest}
          theme={theme}
          showCones={false}
          running={!counting}
          fit="contain"
          onStatus={onStatus}
          onFinished={onFinished}
        />

        <div className="match-overlay">
          <span className="lamp live">Arena</span>
          <span className="field">
            <span className="field-label">Tick</span>
            <span className="field-value">{String(status?.tick ?? 0).padStart(5, "0")}</span>
          </span>
          <span className="spacer" />
          {drifted ? (
            <span className="notice bad inline">
              This screen has drifted from the others — the result below may not match theirs.
            </span>
          ) : null}
          <button type="button" className="btn small" onClick={() => setMatch(null)}>
            Back to room
          </button>
        </div>

        {counting ? (
          <Countdown theme={theme} onDone={() => setCounting(false)} />
        ) : null}

        {outcome ? (
          <Results
            outcome={outcome}
            myIndex={match.myIndex}
            theme={theme}
            onClose={() => {
              setMatch(null);
              setOutcome(null);
            }}
          />
        ) : null}
      </div>
    );
  }

  const peers = room.state?.peers ?? [];
  const withRobots = peers.filter((p) => p.robot !== null).length;
  const readyCount = peers.filter((p) => p.ready).length;
  const allReady = peers.length > 0 && readyCount === peers.length;

  return (
    <Lobby
      title="Arena"
      shareScreen="arena"
      blurb={
        teamCount > 1
          ? "Everyone's robot in one arena, in sides. The last side still running wins."
          : "Everyone's robot in one arena at once, all against all. Last one running wins."
      }
      teamCount={teamCount}
      theme={theme}
      room={room}
      robots={robots}
      selectedRobotId={robot?.id ?? null}
      onSelectRobot={(id) => {
        setRobotId(id);
        room.session?.setReady(false);
      }}
      playerName={playerName}
      onPlayerName={onPlayerName}
      nudge={nudge}
      action={
        room.isHost
          ? {
              label: "Start the battle",
              // Deliberately clickable when people are not ready: pressing it
              // is how the host nudges them.
              disabled: withRobots < 2,
              hint:
                withRobots < 2
                  ? "At least two robots are needed."
                  : allReady
                    ? `All ${readyCount} ready.`
                    : `${readyCount} of ${peers.length} ready — press to nudge the rest.`,
              onRun: startMatch,
            }
          : undefined
      }
    >
      {room.isHost ? (
        <>
          <div className="panel-head">
            <span className="silkscreen" title="Everyone against everyone, or two or more sides. On a side you can tell friend from foe with `event.friend`, and talk to each other with `broadcast` — though everybody hears that, including the other side.">Sides</span>
          </div>
          <div className="panel-body">
            <div className="setting">
              <div className="row">
                {[0, 2, 3, 4].map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={`btn small${teamCount === count ? " primary" : ""}`}
                    onClick={() => setTeamCount(count)}
                  >
                    {count === 0 ? "Free-for-all" : `${count} sides`}
                  </button>
                ))}
              </div>
              <p className="setting-note">
                {teamCount > 1
                  ? `Pick sides in the roster. Anyone left unassigned is spread between ${teamLabel(0, theme)} and ${teamLabel(teamCount - 1, theme)}.`
                  : "Everyone for themselves, as the Arena has always been."}
              </p>
            </div>
          </div>

          {teamCount > 1 ? (
            <>
              <div className="panel-head">
                <span className="silkscreen" title={fireIntro(theme)}>{fireHeading(theme)}</span>
              </div>
              <div className="panel-body">
                <div className="setting">
                  <div className="row">
                    {FIRE_LEVELS.map((level) => (
                      <button
                        key={level}
                        type="button"
                        className={`btn small${fireLevel === level ? " primary" : ""}`}
                        onClick={() => setFireLevel(level)}
                      >
                        {fireLevelWord(level, theme)}
                      </button>
                    ))}
                  </div>
                  <p className="setting-note">{fireBlurb(fireLevel, theme)}</p>
                </div>
              </div>
            </>
          ) : null}

          <div className="panel-head">
            <span className="silkscreen" title={fuelIntro(theme)}>{fuelHeading(theme)}</span>
          </div>
          <div className="panel-body">
            <div className="setting">
              <div className="row">
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
              <p className="setting-note">{fuelBlurb(fuelLevel, theme)}</p>
            </div>
          </div>
          <ArenaChoicePanel
            theme={theme}
            arenas={lib.arenas}
            choice={arenaChoice}
            onChoice={setArenaChoice}
            level={terrainLevel}
            onLevel={setTerrainLevel}
          />
        </>
      ) : null}
      <div className="panel-head">
        <span className="silkscreen">How it works</span>
      </div>
      <div className="panel-body">
        <p className="empty small">
          Only the scripts travel. Every screen then plays the whole battle for itself, which is why
          it looks identical everywhere — and why someone losing connection part way through does
          not change what happens.
        </p>
        {!room.isHost ? (
          <p className="empty small">Waiting for the host to start.</p>
        ) : null}
        <button type="button" className="btn small" onClick={() => navigate("menu")}>
          Back to menu
        </button>
      </div>
    </Lobby>
  );
}

export function Results({
  outcome,
  myIndex,
  theme = "mechanical",
  onClose,
}: {
  outcome: MatchOutcome;
  myIndex: number | null;
  theme?: Theme;
  onClose: () => void;
}) {
  const ranked = [...outcome.telemetry].sort((a, b) => a.place - b.place);

  // Read defensively: a `BattleRecord` saved before teams existed has no team
  // on its standings at all, and it still has to open.
  const standings = outcome.result.standings;
  const teamOf = new Map(standings.map((s) => [s.id, s.team]));
  const teamed = new Set(standings.map((s) => s.team ?? s.id)).size < standings.length;
  const winnerTeam = outcome.result.winnerTeam ?? null;
  // A side that won with more than one robot left is not described by any one
  // name, so it is named as the side it is.
  const wonAsTeam =
    winnerTeam !== null && standings.filter((s) => s.team === winnerTeam).length > 1;

  return (
    <div className="results-overlay">
      <div className="results-card">
        <h3 className="screen-title">
          {wonAsTeam
            ? `${teamLabel(winnerTeam, theme)} wins`
            : outcome.result.winnerName
              ? `${outcome.result.winnerName} wins`
              : "No survivors"}
        </h3>
        <table className="results-table">
          <thead>
            <tr>
              <th>#</th>
              {teamed ? <th>Side</th> : null}
              <th>Robot</th>
              <th>Damage</th>
              <th>Accuracy</th>
              <th>Kills</th>
              <th>Alive</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((t: RobotTelemetry) => (
              <tr key={t.robotId} className={t.robotId === myIndex ? "mine" : undefined}>
                <td>{t.place}</td>
                {teamed ? (
                  <td>
                    {teamOf.get(t.robotId) !== undefined ? (
                      <span className={`team-badge t${teamOf.get(t.robotId)! % 6}`}>
                        {teamOf.get(t.robotId)! + 1}
                      </span>
                    ) : null}
                  </td>
                ) : null}
                <td>
                  {t.name}
                  {t.robotId === myIndex ? " (you)" : ""}
                </td>
                <td>{Math.round(t.damageDealt)}</td>
                <td>{Math.round(accuracy(t))}%</td>
                <td>{t.kills}</td>
                <td>{Math.round(t.survivedTicks / 30)}s</td>
              </tr>
            ))}
          </tbody>
        </table>

        {myIndex !== null
          ? (() => {
              const mine = outcome.telemetry.find((t) => t.robotId === myIndex);
              const warning = mine ? executionWarning(mine) : null;
              return warning ? <div className="history-warning">{warning}</div> : null;
            })()
          : null}

        <button type="button" className="btn primary" onClick={onClose}>
          Back to the room
        </button>
      </div>
    </div>
  );
}
