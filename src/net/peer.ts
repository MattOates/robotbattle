/**
 * The real thing: WebRTC data channels, brokered by PeerJS.
 *
 * The broker is used for signalling only — swapping SDP and ICE candidates so
 * two browsers can find each other. Once the data channel is up, no game
 * traffic touches a server, and there is no server to run.
 *
 * The host's peer id is derived from the room code, which is what lets a guest
 * connect knowing nothing but four letters and four digits.
 */

import Peer, { type DataConnection } from "peerjs";
import { StarTransport, type PeerId } from "./transport.js";

/** Namespaced so we cannot collide with another app on the public broker. */
export function hostPeerId(room: string): string {
  return `robobattle-${room.toLowerCase()}`;
}

export interface PeerTransportOptions {
  room: string;
  asHost: boolean;
  /** How long to wait for the broker before giving up. */
  timeoutMs?: number;
}

export class PeerTransport extends StarTransport {
  selfId: PeerId = "";
  readonly isHost: boolean;

  private peer: Peer | null = null;
  private connections = new Map<PeerId, DataConnection>();
  private room: string;
  private timeoutMs: number;
  private openTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: PeerTransportOptions) {
    super();
    this.isHost = options.asHost;
    this.room = options.room;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  /** Resolves once we are on the broker and, for a guest, joined to the host. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const settled = { done: false };
      const fail = (message: string) => {
        if (settled.done) return;
        settled.done = true;
        this.clearTimer();
        reject(new Error(message));
      };
      const succeed = () => {
        if (settled.done) return;
        settled.done = true;
        this.clearTimer();
        resolve();
      };

      this.openTimer = setTimeout(
        () =>
          fail(
            "Could not reach the matchmaking service. Check the connection, or use a local room instead.",
          ),
        this.timeoutMs,
      );

      const peer = this.isHost ? new Peer(hostPeerId(this.room)) : new Peer();
      this.peer = peer;

      peer.on("open", (id) => {
        this.selfId = id;
        this.announceOpen();
        if (this.isHost) {
          succeed();
          return;
        }
        const connection = peer.connect(hostPeerId(this.room), { reliable: true });
        this.wire(connection, succeed);
      });

      peer.on("connection", (connection) => this.wire(connection));

      peer.on("error", (err) => {
        const message =
          err.type === "unavailable-id"
            ? "That room code is already in use. Try starting a new room."
            : err.type === "peer-unavailable"
              ? "No room with that code is open right now."
              : `Connection problem: ${err.message}`;
        this.linkError(new Error(message));
        fail(message);
      });

      peer.on("disconnected", () => {
        // The broker link dropped. Existing data channels survive, so this is
        // only fatal for peers who have not joined yet.
        this.linkError(new Error("Lost contact with the matchmaking service."));
      });
    });
  }

  private wire(connection: DataConnection, onOpen?: () => void): void {
    connection.on("open", () => {
      this.connections.set(connection.peer, connection);
      this.linkOpened(connection.peer);
      onOpen?.();
    });
    connection.on("data", (data) => {
      if (typeof data === "string") this.linkData(connection.peer, data);
    });
    connection.on("close", () => {
      this.connections.delete(connection.peer);
      this.linkClosed(connection.peer);
    });
    connection.on("error", (err) => {
      this.linkError(err instanceof Error ? err : new Error("data channel error"));
    });
  }

  protected linkSendRaw(peerId: PeerId, raw: string): void {
    const connection = this.connections.get(peerId);
    // A peer that has dropped is not an error worth surfacing: the match keeps
    // running for everyone else, because their robot's script is already here.
    if (connection?.open) connection.send(raw);
  }

  protected linkDisconnect(peerId: PeerId): void {
    const connection = this.connections.get(peerId);
    this.connections.delete(peerId);
    connection?.close();
  }

  protected linkTeardown(): void {
    this.clearTimer();
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    this.peer?.destroy();
    this.peer = null;
  }

  private clearTimer(): void {
    if (this.openTimer !== null) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
  }
}
