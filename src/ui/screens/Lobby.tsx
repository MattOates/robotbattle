/**
 * The shared front door for every networked mode: pick a robot, open or join a
 * room, see who else is here.
 */

import { useState } from "react";
import type { RoomApi, TransportKind } from "../useRoom.js";
import type { StoredRobot } from "../../store/types.js";
import { navigate } from "../router.js";

interface Props {
  title: string;
  blurb: string;
  room: RoomApi;
  robots: StoredRobot[];
  selectedRobotId: string | null;
  onSelectRobot: (id: string) => void;
  playerName: string;
  onPlayerName: (name: string) => void;
  /** Whether this mode wants everyone to bring a robot. */
  requiresRobot?: boolean;
  /** Host-only action, shown when the room is ready to begin. */
  action?:
    | { label: string; disabled: boolean; hint: string | null; onRun: () => void }
    | undefined;
  children?: React.ReactNode;
}

export function Lobby({
  title,
  blurb,
  room,
  robots,
  selectedRobotId,
  onSelectRobot,
  playerName,
  onPlayerName,
  requiresRobot = true,
  action,
  children,
}: Props) {
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<TransportKind>("online");

  if (room.phase === "connected" && room.state) {
    return (
      <div className="lobby">
        <header className="screen-head">
          <button type="button" className="btn small" onClick={() => navigate("menu")}>
            ← Menu
          </button>
          <h2 className="screen-title">{title}</h2>
          <span className="spacer" />
          <span className="room-code" title="Give this code to whoever is joining">
            {room.roomCode}
          </span>
          <button type="button" className="btn small" onClick={room.leave}>
            Leave room
          </button>
        </header>

        {room.state.notice ? <div className="notice">{room.state.notice}</div> : null}
        {room.error ? <div className="notice bad">{room.error}</div> : null}

        <div className="lobby-body">
          <section className="panel">
            <div className="panel-head">
              <span className="silkscreen">In this room</span>
              <span className="spacer" />
              <span className="roster-meta">{room.state.peers.length}</span>
            </div>
            <div className="panel-body flush">
              {room.state.peers.map((peer) => (
                <div key={peer.id} className="roster-item">
                  <span className="roster-select" style={{ cursor: "default" }}>
                    <span
                      className="chip"
                      style={{ background: peer.robot?.color ?? "#3a4034" }}
                    />
                    <span className="roster-name">
                      {peer.displayName}
                      {peer.id === room.state?.selfId ? " (you)" : ""}
                    </span>
                    <span className="roster-meta">
                      {peer.isHost ? "host · " : ""}
                      {peer.robot ? peer.robot.name : "no robot yet"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            {requiresRobot ? (
              <div className="roster-actions">
                <label className="field-row">
                  <span className="silkscreen">Your robot</span>
                  <select
                    className="btn small"
                    value={selectedRobotId ?? ""}
                    onChange={(e) => onSelectRobot(e.target.value)}
                  >
                    {robots.length === 0 ? <option value="">No robots yet</option> : null}
                    {robots.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </section>

          <section className="panel">{children}</section>
        </div>

        {action ? (
          <div className="lobby-action">
            {action.hint ? <span className="roster-meta">{action.hint}</span> : null}
            <button
              type="button"
              className="btn primary"
              disabled={action.disabled}
              onClick={action.onRun}
            >
              {action.label}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="lobby">
      <header className="screen-head">
        <button type="button" className="btn small" onClick={() => navigate("menu")}>
          ← Menu
        </button>
        <h2 className="screen-title">{title}</h2>
      </header>

      <div className="join-card">
        <p className="join-blurb">{blurb}</p>

        <label className="field">
          <span className="silkscreen">Your name</span>
          <input
            className="text-input"
            value={playerName}
            maxLength={24}
            placeholder="What should people call you?"
            onChange={(e) => onPlayerName(e.target.value)}
          />
        </label>

        {requiresRobot ? (
          <label className="field">
            <span className="silkscreen">Robot to bring</span>
            <select
              className="text-input"
              value={selectedRobotId ?? ""}
              onChange={(e) => onSelectRobot(e.target.value)}
            >
              {robots.length === 0 ? <option value="">Build one in the Workshop first</option> : null}
              {robots.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="field">
          <span className="silkscreen">Where</span>
          <div className="toggle">
            <button
              type="button"
              aria-pressed={kind === "online"}
              onClick={() => setKind("online")}
            >
              Over the internet
            </button>
            <button
              type="button"
              aria-pressed={kind === "local"}
              onClick={() => setKind("local")}
            >
              This computer
            </button>
          </div>
          <span className="roster-meta">
            {kind === "online"
              ? "Peer to peer. A matchmaking service is used only to introduce you."
              : "Other tabs on this computer. Works with no internet at all."}
          </span>
        </div>

        {room.error ? <div className="notice bad">{room.error}</div> : null}

        <div className="join-actions">
          <button
            type="button"
            className="btn primary"
            disabled={room.phase === "connecting"}
            onClick={() => void room.host(kind)}
          >
            {room.phase === "connecting" ? "Opening…" : "Open a new room"}
          </button>
          <span className="or">or</span>
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
            className="btn"
            disabled={room.phase === "connecting" || code.trim() === ""}
            onClick={() => void room.join(code, kind)}
          >
            Join
          </button>
        </div>
      </div>
    </div>
  );
}
