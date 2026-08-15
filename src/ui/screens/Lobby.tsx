/**
 * The shared front door for every networked mode: pick a robot, open or join a
 * room, see who else is here.
 */

import { useEffect, useState } from "react";
import type { RoomApi, TransportKind } from "../useRoom.js";
import type { StoredRobot } from "../../store/types.js";
import { navigate, routePath, type ScreenName } from "../router.js";

/** Build the URL someone else can click to land straight in this room. */
export function roomUrl(screen: ScreenName, room: string): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${routePath(screen, room)}`;
}

function ShareLink({ screen, room }: { screen: ScreenName; room: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!room) return null;

  return (
    <button
      type="button"
      className="btn small"
      onClick={() => {
        const url = roomUrl(screen, room);
        void navigator.clipboard?.writeText(url).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          },
          () => {
            // Clipboard access can be refused; showing the URL still lets
            // someone copy it by hand rather than leaving them stuck.
            window.prompt("Copy this link and send it to whoever is joining:", url);
          },
        );
      }}
    >
      {copied ? "Link copied" : "Copy invite link"}
    </button>
  );
}

interface Props {
  title: string;
  blurb: string;
  /** Which route an invite link should point at. */
  shareScreen: ScreenName;
  room: RoomApi;
  robots: StoredRobot[];
  selectedRobotId: string | null;
  onSelectRobot: (id: string) => void;
  playerName: string;
  onPlayerName: (name: string) => void;
  /** Whether this mode wants everyone to bring a robot. */
  requiresRobot?: boolean;
  /** Set when the host has prodded us for holding things up. */
  nudge?: { at: number; text: string } | null;
  /** Host-only action, shown when the room is ready to begin. */
  action?:
    | { label: string; disabled: boolean; hint: string | null; onRun: () => void }
    | undefined;
  children?: React.ReactNode;
}

export function Lobby({
  title,
  blurb,
  shareScreen,
  room,
  robots,
  selectedRobotId,
  onSelectRobot,
  playerName,
  onPlayerName,
  requiresRobot = true,
  nudge = null,
  action,
  children,
}: Props) {
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<TransportKind>("online");

  const self = room.state?.peers.find((p) => p.id === room.state?.selfId);
  const iAmReady = self?.ready ?? false;

  // The prod fades after a few seconds so it reads as an event, not a state.
  const [nudging, setNudging] = useState(false);
  useEffect(() => {
    if (!nudge) return;
    setNudging(true);
    const timer = window.setTimeout(() => setNudging(false), 4000);
    return () => window.clearTimeout(timer);
  }, [nudge]);

  if (room.phase === "connected" && room.state) {
    return (
      <div className="lobby">
        <header className="screen-head">
          <button type="button" className="btn small" onClick={() => navigate("menu")}>
            ← Menu
          </button>
          <h2 className="screen-title">{title}</h2>
          <span className="spacer" />
          <span className="room-code" title="Read this out, or share the link">
            {room.roomCode}
          </span>
          <ShareLink screen={shareScreen} room={room.roomCode} />
          <button type="button" className="btn small" onClick={room.leave}>
            Leave room
          </button>
        </header>

        {nudging && nudge ? <div className="notice nudge">{nudge.text}</div> : null}
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
                  {requiresRobot ? (
                    <span className={`ready-pip${peer.ready ? " on" : ""}`}>
                      {peer.ready ? "Ready" : "Waiting"}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            {requiresRobot ? (
              <div className="lobby-robot">
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
                  <span className="spacer" />
                  <button
                    type="button"
                    className="btn small"
                    title="Opens in a new tab so you can keep this room open"
                    onClick={() => window.open(routePath("workshop"), "_blank", "noopener")}
                  >
                    Edit in Workshop ↗
                  </button>
                </label>
                <span className="roster-meta">
                  Whatever you last saved is what fights — edit in the Workshop and this room
                  picks it up straight away, no need to rejoin.
                </span>
                <button
                  type="button"
                  className={`btn ${iAmReady ? "" : "primary"}${nudging ? " nudged" : ""}`}
                  disabled={!selectedRobotId}
                  onClick={() => room.session?.setReady(!iAmReady)}
                >
                  {iAmReady ? "Ready — click to change your mind" : "I'm ready"}
                </button>
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
