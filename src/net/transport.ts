/**
 * The transport seam.
 *
 * Every networked mode is written against this interface and never against a
 * concrete transport, which buys three things: the session logic is unit-
 * testable over an in-process link, the flows can be driven in two real tabs
 * without depending on a public broker, and the real WebRTC implementation is
 * one file rather than a concern spread through the UI.
 *
 * Topology is a star: guests hold one link to the host, and the host relays.
 * That is enough because every mode here is host-authoritative, and it avoids
 * the n-squared connection mesh a peer-to-peer graph would need.
 */

export type PeerId = string;

export interface TransportEvents {
  /** The local peer is connected and has an id. */
  open: (selfId: PeerId) => void;
  peerJoin: (peerId: PeerId) => void;
  peerLeave: (peerId: PeerId) => void;
  message: (from: PeerId, payload: unknown) => void;
  error: (error: Error) => void;
  close: () => void;
}

export interface Transport {
  readonly selfId: PeerId;
  readonly isHost: boolean;
  /** Everyone in the room, including the host, excluding yourself. */
  readonly peers: readonly PeerId[];
  send(to: PeerId | "all", payload: unknown): void;
  on<K extends keyof TransportEvents>(event: K, fn: TransportEvents[K]): () => void;
  close(): void;
}

/** What actually crosses the wire. */
type Envelope =
  | { k: "msg"; from: PeerId; to: PeerId | "all"; payload: unknown }
  /** Host tells guests who else is in the room. */
  | { k: "peers"; peers: PeerId[] };

type Listeners = { [K in keyof TransportEvents]: Set<TransportEvents[K]> };

/**
 * Shared routing, roster tracking and event plumbing.
 *
 * A concrete transport only has to move strings between two endpoints: call
 * `linkOpened` / `linkData` / `linkClosed` as its link layer reports them, and
 * implement `linkSend`.
 */
export abstract class StarTransport implements Transport {
  abstract readonly selfId: PeerId;
  abstract readonly isHost: boolean;

  /** Peers we hold a direct link to. For a guest this is just the host. */
  protected links = new Set<PeerId>();
  /** Everyone in the room except us, direct or relayed. */
  private roster = new Set<PeerId>();
  private closed = false;

  private listeners: Listeners = {
    open: new Set(),
    peerJoin: new Set(),
    peerLeave: new Set(),
    message: new Set(),
    error: new Set(),
    close: new Set(),
  };

  get peers(): readonly PeerId[] {
    return [...this.roster].sort();
  }

  on<K extends keyof TransportEvents>(event: K, fn: TransportEvents[K]): () => void {
    this.listeners[event].add(fn as never);
    return () => {
      this.listeners[event].delete(fn as never);
    };
  }

  protected emit<K extends keyof TransportEvents>(
    event: K,
    ...args: Parameters<TransportEvents[K]>
  ): void {
    for (const fn of [...this.listeners[event]]) {
      (fn as (...a: unknown[]) => void)(...args);
    }
  }

  send(to: PeerId | "all", payload: unknown): void {
    if (this.closed) return;
    const envelope: Envelope = { k: "msg", from: this.selfId, to, payload };

    if (this.isHost) {
      this.route(envelope);
      return;
    }
    // A guest has exactly one link, so everything goes to the host, which
    // either keeps it or passes it on.
    for (const hostId of this.links) this.linkSend(hostId, envelope);
  }

  /** Host-side delivery: keep what is ours, forward the rest. */
  private route(envelope: Envelope): void {
    if (envelope.k !== "msg") return;
    if (envelope.to === "all") {
      for (const peer of this.links) {
        if (peer !== envelope.from) this.linkSend(peer, envelope);
      }
      if (envelope.from !== this.selfId) {
        this.emit("message", envelope.from, envelope.payload);
      }
      return;
    }
    if (envelope.to === this.selfId) {
      this.emit("message", envelope.from, envelope.payload);
      return;
    }
    if (this.links.has(envelope.to)) this.linkSend(envelope.to, envelope);
  }

  // ---- called by the concrete link layer --------------------------------

  protected linkOpened(peerId: PeerId): void {
    if (this.closed || peerId === this.selfId) return;
    this.links.add(peerId);
    this.addToRoster(peerId);
    if (this.isHost) this.broadcastRoster();
  }

  protected linkData(from: PeerId, raw: string): void {
    if (this.closed) return;
    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch {
      // A peer sending us junk is not a reason to tear down the room.
      this.emit("error", new Error(`unreadable message from ${from}`));
      return;
    }

    if (envelope.k === "peers") {
      // Only the host is authoritative about who is present.
      this.syncRoster(envelope.peers);
      return;
    }
    if (envelope.k !== "msg") return;

    if (this.isHost) {
      this.route(envelope);
      return;
    }
    if (envelope.to === "all" || envelope.to === this.selfId) {
      this.emit("message", envelope.from, envelope.payload);
    }
  }

  protected linkClosed(peerId: PeerId): void {
    if (!this.links.delete(peerId)) return;
    if (this.isHost) {
      this.removeFromRoster(peerId);
      this.broadcastRoster();
    } else {
      // The host went away, which ends the room for a guest.
      this.emit("peerLeave", peerId);
      this.close();
    }
  }

  protected linkError(error: Error): void {
    this.emit("error", error);
  }

  protected announceOpen(): void {
    this.emit("open", this.selfId);
  }

  // ---- roster -----------------------------------------------------------

  private addToRoster(peerId: PeerId): void {
    if (peerId === this.selfId || this.roster.has(peerId)) return;
    this.roster.add(peerId);
    this.emit("peerJoin", peerId);
  }

  private removeFromRoster(peerId: PeerId): void {
    if (!this.roster.delete(peerId)) return;
    this.emit("peerLeave", peerId);
  }

  private broadcastRoster(): void {
    const peers = [this.selfId, ...this.roster];
    const envelope: Envelope = { k: "peers", peers };
    for (const peer of this.links) this.linkSend(peer, envelope);
  }

  private syncRoster(peers: PeerId[]): void {
    const next = new Set(peers.filter((p) => p !== this.selfId));
    for (const gone of [...this.roster]) {
      if (!next.has(gone)) this.removeFromRoster(gone);
    }
    for (const added of next) this.addToRoster(added);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.linkTeardown();
    this.links.clear();
    this.roster.clear();
    this.emit("close");
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Serialise and hand to the link layer. */
  private linkSend(peerId: PeerId, envelope: Envelope): void {
    this.linkSendRaw(peerId, JSON.stringify(envelope));
  }

  protected abstract linkSendRaw(peerId: PeerId, raw: string): void;
  protected abstract linkTeardown(): void;
}

const ROOM_WORDS = [
  "BOLT", "GEAR", "SPARK", "RIVET", "PISTON", "AMOEBA", "CILIA", "SPORE",
  "FLUKE", "DIODE", "TORQUE", "PLASMID", "AXON", "COG", "VOLT", "MITE",
];

/** A short, sayable room code — this gets read aloud across a classroom. */
export function makeRoomCode(random: () => number = Math.random): string {
  const word = ROOM_WORDS[Math.floor(random() * ROOM_WORDS.length)] ?? "BOLT";
  const digits = String(Math.floor(random() * 9000) + 1000);
  return `${word}-${digits}`;
}

export function normaliseRoomCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}
