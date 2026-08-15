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
  /**
   * There is now a link to send over.
   *
   * Distinct from `open` (we exist) and from `peerJoin` (someone is in the
   * room). A guest learns who is in the room from the host's roster, which can
   * arrive before its own link is up — so `peerJoin` is not a safe moment to
   * start talking, and this is.
   */
  ready: () => void;
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
  /** True once this peer has a link it can actually send over. */
  readonly ready: boolean;
  send(to: PeerId | "all", payload: unknown): void;
  on<K extends keyof TransportEvents>(event: K, fn: TransportEvents[K]): () => void;
  /**
   * Host only: remove a peer and refuse them if they come back.
   *
   * Soft moderation, and the UI says so. A peer that reconnects is handed a
   * fresh id by the broker, so this removes someone *now* rather than banning
   * them forever — which is why changing the room code is the real remedy.
   */
  drop(peerId: PeerId): void;
  close(): void;
}

/** What actually crosses the wire. */
type Envelope =
  | { k: "msg"; from: PeerId; to: PeerId | "all"; payload: unknown }
  /** Host tells guests who else is in the room. */
  | { k: "peers"; peers: PeerId[] }
  /** One slice of a message too big to send in one go. */
  | { k: "chunk"; id: string; i: number; n: number; part: string };

/**
 * Chunking.
 *
 * An `RTCDataChannel` will not carry an arbitrarily large message: SCTP
 * fragments, but browsers differ on the ceiling and sending past it fails the
 * send — sometimes silently, sometimes by closing the channel. 16 kB is the
 * size every engine agrees on, so anything larger is split here, in the shared
 * layer, rather than in the WebRTC transport.
 *
 * Doing it here matters for more than tidiness: it means the in-process
 * loopback transport exercises exactly the same splitting and reassembly that
 * WebRTC will, so this can be tested properly without a browser or a network.
 *
 * Yjs is what makes this necessary in practice. A pair-programming session
 * sends the whole document state to each newcomer, and that grows without
 * bound as people edit.
 */
const PART_SIZE = 15 * 1024;
/** Refuse a message claiming more slices than this — roughly 60 MB. */
const MAX_PARTS = 4096;
/** Half-finished messages held per peer before the oldest is discarded. */
const MAX_PENDING = 8;

interface Pending {
  parts: Array<string | undefined>;
  received: number;
  n: number;
}

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
  /** Half-received chunked messages, by sender then by message id. */
  private pending = new Map<PeerId, Map<string, Pending>>();
  private chunkSeq = 0;
  /** Peers the host has removed; refused on sight if they reconnect. */
  private kicked = new Set<PeerId>();

  private listeners: Listeners = {
    open: new Set(),
    ready: new Set(),
    peerJoin: new Set(),
    peerLeave: new Set(),
    message: new Set(),
    error: new Set(),
    close: new Set(),
  };

  get peers(): readonly PeerId[] {
    return [...this.roster].sort();
  }

  /**
   * A host can always send (it relays to whoever is there). A guest can only
   * send once its single link to the host is up.
   */
  get ready(): boolean {
    return this.isHost || this.links.size > 0;
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
    // Someone the host has already removed does not get back in under the same
    // id. A new id defeats this, which is why the UI is honest about it.
    if (this.isHost && this.kicked.has(peerId)) {
      this.linkDisconnect(peerId);
      return;
    }
    const wasFirst = this.links.size === 0;
    this.links.add(peerId);
    this.addToRoster(peerId);
    if (this.isHost) this.broadcastRoster();
    // Announced after the roster, so anyone acting on `ready` sees a complete
    // picture of the room rather than an empty one.
    else if (wasFirst) this.emit("ready");
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

    if (envelope.k === "chunk") {
      const whole = this.reassemble(from, envelope);
      if (whole !== null) this.linkData(from, whole);
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
    // Whatever they were half way through saying will never be finished.
    this.pending.delete(peerId);
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

  drop(peerId: PeerId): void {
    if (!this.isHost || this.closed) return;
    this.kicked.add(peerId);
    this.linkDisconnect(peerId);
    this.linkClosed(peerId);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.linkTeardown();
    this.links.clear();
    this.roster.clear();
    this.pending.clear();
    this.emit("close");
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Serialise and hand to the link layer. */
  private linkSend(peerId: PeerId, envelope: Envelope): void {
    const raw = JSON.stringify(envelope);
    if (raw.length <= PART_SIZE) {
      this.linkSendRaw(peerId, raw);
      return;
    }

    // Slicing a JS string can split a surrogate pair, but the halves are put
    // back together byte for byte and JSON escapes lone surrogates on the way,
    // so the rejoined string is identical to the original.
    const id = `${this.selfId}:${this.chunkSeq++}`;
    const n = Math.ceil(raw.length / PART_SIZE);
    for (let i = 0; i < n; i++) {
      const part = raw.slice(i * PART_SIZE, (i + 1) * PART_SIZE);
      this.linkSendRaw(peerId, JSON.stringify({ k: "chunk", id, i, n, part }));
    }
  }

  /**
   * Collect a chunked message. Returns the whole thing once the last slice
   * lands, or null while it is still incomplete.
   *
   * Every bound here exists because the sender is another person's browser:
   * a peer that starts a thousand huge messages and finishes none of them
   * must not be able to exhaust this tab's memory.
   */
  private reassemble(
    from: PeerId,
    chunk: { id: string; i: number; n: number; part: string },
  ): string | null {
    if (
      typeof chunk.id !== "string" ||
      !Number.isInteger(chunk.n) ||
      !Number.isInteger(chunk.i) ||
      chunk.n < 1 ||
      chunk.n > MAX_PARTS ||
      chunk.i < 0 ||
      chunk.i >= chunk.n ||
      typeof chunk.part !== "string"
    ) {
      return null;
    }

    let byPeer = this.pending.get(from);
    if (!byPeer) {
      byPeer = new Map();
      this.pending.set(from, byPeer);
    }

    let entry = byPeer.get(chunk.id);
    if (!entry) {
      // Insertion order is arrival order, so the first key is the oldest.
      if (byPeer.size >= MAX_PENDING) {
        const oldest = byPeer.keys().next().value;
        if (oldest !== undefined) byPeer.delete(oldest);
      }
      entry = { parts: new Array<string | undefined>(chunk.n), received: 0, n: chunk.n };
      byPeer.set(chunk.id, entry);
    }
    // A peer changing its mind about the length mid-message is nonsense.
    if (entry.n !== chunk.n) return null;
    // Ignore a repeated slice rather than double-counting it.
    if (entry.parts[chunk.i] !== undefined) return null;

    entry.parts[chunk.i] = chunk.part;
    entry.received++;
    if (entry.received < entry.n) return null;

    byPeer.delete(chunk.id);
    if (byPeer.size === 0) this.pending.delete(from);
    return entry.parts.join("");
  }

  protected abstract linkSendRaw(peerId: PeerId, raw: string): void;
  protected abstract linkTeardown(): void;
  /** Sever the link to one peer, leaving the rest of the room intact. */
  protected abstract linkDisconnect(peerId: PeerId): void;
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
