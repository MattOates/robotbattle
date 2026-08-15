/**
 * Joining and hosting rooms, shared by all four networked modes.
 *
 * Two transports are offered: `online` goes over WebRTC via the public PeerJS
 * broker, `local` uses BroadcastChannel between tabs on this machine. The local
 * option is not a toy — it is how the modes can be used with no internet, and
 * how two people at one computer can play.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChannelTransport, channelSupported } from "../net/channel.js";
import { PeerTransport } from "../net/peer.js";
import { Session, type SessionState } from "../net/session.js";
import { makeRoomCode, normaliseRoomCode, type Transport } from "../net/transport.js";
import type { Message, RobotEntry } from "../net/protocol.js";
import { newId } from "../store/storage.js";

export type RoomPhase = "idle" | "connecting" | "connected" | "error";
export type TransportKind = "online" | "local";

export interface RoomApi {
  phase: RoomPhase;
  error: string | null;
  roomCode: string | null;
  isHost: boolean;
  state: SessionState | null;
  session: Session | null;
  host: (kind: TransportKind) => Promise<void>;
  join: (code: string, kind: TransportKind) => Promise<void>;
  leave: () => void;
  onMessage: (fn: (from: string, message: Message) => void) => () => void;
}

export function useRoom(displayName: string, robot: RobotEntry | null): RoomApi {
  const [phase, setPhase] = useState<RoomPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const listeners = useRef(new Set<(from: string, message: Message) => void>());

  const teardown = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    setState(null);
    setRoomCode(null);
    setPhase("idle");
    setError(null);
  }, []);

  useEffect(() => () => sessionRef.current?.close(), []);

  const attach = useCallback(
    (transport: Transport, code: string) => {
      const session = new Session({ transport, displayName, robot });
      sessionRef.current = session;
      session.onChange(setState);
      session.onMessage((from, message) => {
        for (const fn of [...listeners.current]) fn(from, message);
      });
      session.announce();
      setState(session.state);
      setRoomCode(code);
      setPhase("connected");
    },
    [displayName, robot],
  );

  const start = useCallback(
    async (kind: TransportKind, code: string, asHost: boolean) => {
      setPhase("connecting");
      setError(null);
      try {
        if (kind === "local") {
          if (!channelSupported()) {
            throw new Error("This browser cannot open a local room.");
          }
          const selfId = asHost ? `host-${code}` : newId("peer");
          const transport = new ChannelTransport(code, selfId, asHost);
          transport.connect();
          attach(transport, code);
          return;
        }
        const transport = new PeerTransport({ room: code, asHost });
        await transport.connect();
        attach(transport, code);
      } catch (err) {
        sessionRef.current?.close();
        sessionRef.current = null;
        setPhase("error");
        setError(err instanceof Error ? err.message : "Could not open the room.");
      }
    },
    [attach],
  );

  const host = useCallback(
    async (kind: TransportKind) => {
      await start(kind, makeRoomCode(), true);
    },
    [start],
  );

  const join = useCallback(
    async (code: string, kind: TransportKind) => {
      const normalised = normaliseRoomCode(code);
      if (!normalised) {
        setPhase("error");
        setError("Type the room code you were given.");
        return;
      }
      await start(kind, normalised, false);
    },
    [start],
  );

  const onMessage = useCallback((fn: (from: string, message: Message) => void) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  // Keep the room's copy of our robot current as it is edited.
  useEffect(() => {
    if (sessionRef.current && phase === "connected") sessionRef.current.setRobot(robot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robot?.source, robot?.name, robot?.color, phase]);

  return {
    phase,
    error,
    roomCode,
    isHost: state?.isHost ?? false,
    state,
    session: sessionRef.current,
    host,
    join,
    leave: teardown,
    onMessage,
  };
}
