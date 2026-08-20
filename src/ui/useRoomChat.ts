/**
 * Talk in a lobby, for exactly as long as the lobby lasts.
 *
 * The Workshop keeps its conversations: advice about a robot is the most
 * valuable thing that happens in a pairing session, and it is stored against
 * the robot it was about. This is the opposite kind of talk. "Ready when you
 * are", "give me a minute", "that name is unfair" — arranging noise, useful
 * while you are arranging and worthless afterwards.
 *
 * So it is ephemeral by *construction* rather than by policy. The lines live in
 * React state and nothing here can reach storage, which means there is no code
 * path that could start keeping them by accident. Leaving the room empties it,
 * and so does closing the tab.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_CHAT_LENGTH, sanitiseText, type Message } from "../net/protocol.js";
import type { RoomApi } from "./useRoom.js";

/** One line, as it is shown. */
export interface RoomLine {
  /** Local only, for React. A line nobody keeps needs no identity of its own. */
  key: number;
  at: number;
  /** The peer who said it, so your own lines can be shown differently. */
  fromId: string;
  fromName: string;
  text: string;
  mine: boolean;
}

/**
 * How many lines are held.
 *
 * A room left open all afternoon should not grow without bound, and nobody
 * scrolls back through a conversation they know is going to be thrown away.
 */
export const MAX_ROOM_LINES = 200;

export interface RoomChat {
  lines: RoomLine[];
  send: (text: string) => void;
  /** False before the room is up, when there is nobody to say it to. */
  ready: boolean;
}

export function useRoomChat(room: RoomApi): RoomChat {
  const [lines, setLines] = useState<RoomLine[]>([]);
  const nextKey = useRef(1);

  const connected = room.phase === "connected" && room.session !== null;
  const selfId = room.state?.selfId ?? "";

  // Names are resolved when a line arrives rather than when it is drawn, so a
  // remark keeps the name its author had at the time. People rename themselves
  // mid-room and a conversation that retitles itself afterwards reads oddly.
  const peers = room.state?.peers;
  const nameOf = useCallback(
    (peerId: string) => peers?.find((p) => p.id === peerId)?.displayName ?? "Someone",
    [peers],
  );

  const push = useCallback((line: Omit<RoomLine, "key">) => {
    setLines((prev) => {
      const next = [...prev, { ...line, key: nextKey.current++ }];
      return next.length > MAX_ROOM_LINES ? next.slice(next.length - MAX_ROOM_LINES) : next;
    });
  }, []);

  // A room you have left takes the conversation with it. This is the whole of
  // "ephemeral": there is nowhere else it could have gone.
  useEffect(() => {
    if (connected) return;
    setLines([]);
  }, [connected]);

  useEffect(
    () =>
      room.onMessage((from, message: Message) => {
        if (message.t !== "say") return;
        const text = sanitiseText(message.text, MAX_CHAT_LENGTH).trim();
        if (!text) return;
        push({
          // The clock is the receiver's. A peer's `at` is untrusted input and
          // only ever used for ordering that the arrival order already gives.
          at: Date.now(),
          fromId: from,
          fromName: nameOf(from),
          text,
          mine: false,
        });
      }),
    [nameOf, push, room],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim().slice(0, MAX_CHAT_LENGTH);
      if (!text || !room.session) return;
      const at = Date.now();
      room.session.send("all", { t: "say", text, at });
      // Shown straight away rather than waiting for it to come back: a message
      // is not sent to yourself, and a compose box that appears to swallow what
      // you typed is one people press twice.
      push({ at, fromId: selfId, fromName: "You", text, mine: true });
    },
    [push, room.session, selfId],
  );

  return { lines, send, ready: connected };
}
