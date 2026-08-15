/**
 * A room: who is here, what robot they brought, and whether they are ready.
 *
 * Shared by Arena, Tournament, Pair Program and Trade, because all four need
 * the same lobby. Mode-specific messages pass straight through to a listener
 * rather than being understood here.
 *
 * The host is authoritative about the roster. Guests never invent membership;
 * they render what the host last told them, which means there is exactly one
 * answer to "who is in this room" at any moment.
 */

import type { Transport, PeerId } from "./transport.js";
import {
  isMessage,
  sanitiseEntry,
  sanitiseText,
  type Message,
  type PeerInfo,
  type RobotEntry,
} from "./protocol.js";

export interface SessionState {
  selfId: PeerId;
  isHost: boolean;
  connected: boolean;
  /** Everyone including yourself, host first, then by join order. */
  peers: PeerInfo[];
  notice: string | null;
  error: string | null;
}

export interface SessionOptions {
  transport: Transport;
  displayName: string;
  robot: RobotEntry | null;
}

type StateListener = (state: SessionState) => void;
type MessageListener = (from: PeerId, message: Message) => void;

export class Session {
  private transport: Transport;
  private stateListeners = new Set<StateListener>();
  private messageListeners = new Set<MessageListener>();
  private unsubscribes: Array<() => void> = [];

  /** Host-side record of everyone, in join order. */
  private roster: PeerInfo[] = [];
  /** Full scripts, host-side, keyed by peer. Guests only hold their own. */
  private robotsByPeer = new Map<PeerId, RobotEntry>();
  private notice: string | null = null;
  private error: string | null = null;
  private connected = false;
  private displayName: string;
  private robot: RobotEntry | null;

  constructor(options: SessionOptions) {
    this.transport = options.transport;
    this.displayName = options.displayName;
    this.robot = options.robot;

    const self: PeerInfo = {
      id: this.transport.selfId,
      displayName: this.displayName,
      isHost: this.transport.isHost,
      ready: false,
      robot: this.robot ? { name: this.robot.name, color: this.robot.color } : null,
    };
    this.roster = [self];
    if (this.transport.isHost && this.robot) {
      this.robotsByPeer.set(this.transport.selfId, this.robot);
    }
    // Seed from whoever is already connected. A Session is often constructed
    // after the transport is up, and those join events are long gone.
    if (this.transport.isHost) {
      for (const peerId of this.transport.peers) this.ensurePeer(peerId);
    }

    this.unsubscribes.push(
      this.transport.on("open", () => {
        this.connected = true;
        this.selfInfo().id = this.transport.selfId;
        this.publish();
      }),
      this.transport.on("peerJoin", (peerId) => this.onPeerJoin(peerId)),
      // Not `peerJoin`: a guest hears about the host from the roster, which can
      // arrive before its own link exists, and a hello sent then goes nowhere.
      this.transport.on("ready", () => this.announce()),
      this.transport.on("peerLeave", (peerId) => this.onPeerLeave(peerId)),
      this.transport.on("message", (from, payload) => this.handleMessage(from, payload)),
      this.transport.on("error", (err) => {
        this.error = err.message;
        this.publish();
      }),
      this.transport.on("close", () => {
        this.connected = false;
        this.publish();
      }),
    );

    if (this.transport.selfId) this.connected = true;
  }

  /**
   * Introduce ourselves to the host.
   *
   * Safe to call at any time, and called automatically the moment the link to
   * the host opens. Calling it before then would post into the void: a guest
   * has no links yet while the transport is still shaking hands, so the
   * message would be dropped and the host would show us as "Joining…" forever.
   */
  announce(): void {
    if (this.transport.isHost) return;
    if (!this.transport.ready) return;
    this.send("all", {
      t: "hello",
      displayName: this.displayName,
      robot: this.robot,
    });
  }

  get state(): SessionState {
    return {
      selfId: this.transport.selfId,
      isHost: this.transport.isHost,
      connected: this.connected,
      peers: this.roster.map((p) => ({ ...p })),
      notice: this.notice,
      error: this.error,
    };
  }

  onChange(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  /** Subscribe to mode-specific messages; lobby traffic never reaches here. */
  onMessage(fn: MessageListener): () => void {
    this.messageListeners.add(fn);
    return () => this.messageListeners.delete(fn);
  }

  // ---- outgoing ---------------------------------------------------------

  send(to: PeerId | "all", message: Message): void {
    this.transport.send(to, message);
  }

  broadcast(message: Message): void {
    this.transport.send("all", message);
    // A broadcast should reach us too, so the sender's own UI updates without
    // a special case at every call site.
    this.handleMessage(this.transport.selfId, message);
  }

  setRobot(robot: RobotEntry | null): void {
    this.robot = robot;
    const info = this.selfInfo();
    info.robot = robot ? { name: robot.name, color: robot.color } : null;
    if (this.transport.isHost) {
      // The host's own robot goes into the same map as everyone else's, so
      // `entries()` has no special case for it.
      if (robot) this.robotsByPeer.set(this.transport.selfId, robot);
      else this.robotsByPeer.delete(this.transport.selfId);
      this.publishRoster();
    } else {
      this.send("all", { t: "entry", robot });
    }
    this.publish();
  }

  setReady(ready: boolean): void {
    this.selfInfo().ready = ready;
    if (this.transport.isHost) this.publishRoster();
    else this.send("all", { t: "ready", ready });
    this.publish();
  }

  /** Host only: tell the room why something is or is not happening. */
  setNotice(text: string | null): void {
    this.notice = text;
    if (this.transport.isHost && text !== null) {
      this.transport.send("all", { t: "notice", text } satisfies Message);
    }
    this.publish();
  }

  /** Full robot entries, host-side, for building a manifest. */
  entries(): Array<{ peerId: PeerId; displayName: string; robot: RobotEntry }> {
    return [...this.robotsByPeer.entries()]
      .map(([peerId, robot]) => ({
        peerId,
        displayName:
          this.roster.find((p) => p.id === peerId)?.displayName ?? "Unknown",
        robot,
      }))
      // Stable order so every peer builds the identical manifest.
      .sort((a, b) => a.peerId.localeCompare(b.peerId));
  }

  close(): void {
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
    this.stateListeners.clear();
    this.messageListeners.clear();
    this.transport.close();
  }

  // ---- incoming ---------------------------------------------------------

  private onPeerJoin(peerId: PeerId): void {
    if (!this.transport.isHost) return;
    this.ensurePeer(peerId);
    this.publishRoster();
  }

  /**
   * Get a peer's roster entry, creating a placeholder if their `hello` has not
   * arrived yet. Making this an upsert means the lobby survives any ordering of
   * connection and announcement, which over a real network is not guaranteed.
   */
  private ensurePeer(peerId: PeerId): PeerInfo {
    const existing = this.roster.find((p) => p.id === peerId);
    if (existing) return existing;
    const created: PeerInfo = {
      id: peerId,
      displayName: "Joining…",
      isHost: false,
      ready: false,
      robot: null,
    };
    this.roster.push(created);
    return created;
  }

  private onPeerLeave(peerId: PeerId): void {
    this.roster = this.roster.filter((p) => p.id === this.transport.selfId || p.id !== peerId);
    this.robotsByPeer.delete(peerId);
    if (this.transport.isHost) this.publishRoster();
    else this.publish();
  }

  private handleMessage(from: PeerId, payload: unknown): void {
    if (!isMessage(payload)) return;
    const message = payload;

    switch (message.t) {
      case "hello": {
        if (!this.transport.isHost) return;
        const robot = sanitiseEntry(message.robot);
        const info = this.ensurePeer(from);
        info.displayName = sanitiseText(message.displayName, 24) || "Player";
        info.robot = robot ? { name: robot.name, color: robot.color } : null;
        if (robot) this.robotsByPeer.set(from, robot);
        this.publishRoster();
        return;
      }

      case "entry": {
        if (!this.transport.isHost) return;
        const robot = sanitiseEntry(message.robot);
        this.ensurePeer(from).robot = robot
          ? { name: robot.name, color: robot.color }
          : null;
        if (robot) this.robotsByPeer.set(from, robot);
        else this.robotsByPeer.delete(from);
        this.publishRoster();
        return;
      }

      case "ready": {
        if (!this.transport.isHost) return;
        this.ensurePeer(from).ready = message.ready === true;
        this.publishRoster();
        return;
      }

      case "roster": {
        // Only the host is believed about membership.
        if (this.transport.isHost) return;
        this.roster = message.peers.map((p) => ({
          id: p.id,
          displayName: sanitiseText(p.displayName, 24) || "Player",
          isHost: p.isHost === true,
          ready: p.ready === true,
          robot: p.robot ?? null,
        }));
        this.publish();
        return;
      }

      case "notice": {
        if (this.transport.isHost) return;
        this.notice = sanitiseText(message.text, 200);
        this.publish();
        return;
      }

      default:
        // Everything else belongs to a mode, not to the lobby.
        for (const fn of [...this.messageListeners]) fn(from, message);
    }
  }

  // ---- plumbing ---------------------------------------------------------

  private selfInfo(): PeerInfo {
    const found = this.roster.find((p) => p.id === this.transport.selfId);
    if (found) return found;
    const created: PeerInfo = {
      id: this.transport.selfId,
      displayName: this.displayName,
      isHost: this.transport.isHost,
      ready: false,
      robot: this.robot ? { name: this.robot.name, color: this.robot.color } : null,
    };
    this.roster.unshift(created);
    return created;
  }

  private publishRoster(): void {
    if (!this.transport.isHost) return;
    // Host first, then join order, so every screen lists the room identically.
    this.roster.sort((a, b) => Number(b.isHost) - Number(a.isHost));
    this.transport.send("all", { t: "roster", peers: this.state.peers } satisfies Message);
    this.publish();
  }

  private publish(): void {
    const snapshot = this.state;
    for (const fn of [...this.stateListeners]) fn(snapshot);
  }
}
