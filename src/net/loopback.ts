/**
 * An in-process transport.
 *
 * This is what makes the whole networked half of the game testable in CI: a
 * lobby, a match, a tournament bracket and a trade can all be driven with three
 * simulated peers and no browser, no broker, and no timing flakiness.
 *
 * Delivery is asynchronous (a queued microtask) rather than a direct call, so
 * the tests exercise the same "message arrives later" ordering that a real
 * network imposes. A transport that delivered synchronously would hide
 * re-entrancy bugs that only appear over the wire.
 */

import { StarTransport, type PeerId } from "./transport.js";

/** A room that loopback transports join. */
export class LoopbackNetwork {
  private members = new Map<PeerId, LoopbackTransport>();
  /** Messages waiting to be delivered, for deterministic flushing in tests. */
  private queue: Array<() => void> = [];

  register(peer: LoopbackTransport): void {
    this.members.set(peer.selfId, peer);
  }

  unregister(peerId: PeerId): void {
    this.members.delete(peerId);
    for (const member of this.members.values()) member.notifyClosed(peerId);
  }

  deliver(to: PeerId, from: PeerId, raw: string): void {
    this.queue.push(() => this.members.get(to)?.receive(from, raw));
    queueMicrotask(() => this.flush());
  }

  /** Run every pending delivery, including any it causes. */
  flush(): void {
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    }
  }

  get(peerId: PeerId): LoopbackTransport | undefined {
    return this.members.get(peerId);
  }
}

export class LoopbackTransport extends StarTransport {
  readonly selfId: PeerId;
  readonly isHost: boolean;
  private network: LoopbackNetwork;
  private hostId: PeerId;

  constructor(network: LoopbackNetwork, selfId: PeerId, hostId: PeerId) {
    super();
    this.network = network;
    this.selfId = selfId;
    this.hostId = hostId;
    this.isHost = selfId === hostId;
    network.register(this);
  }

  /** Complete the join. Split from the constructor so listeners can attach first. */
  connect(): void {
    this.announceOpen();
    if (this.isHost) return;
    // Tell the host we exist, and note the host as our one link.
    this.linkOpened(this.hostId);
    this.network.get(this.hostId)?.acceptGuest(this.selfId);
  }

  /** Host side of a guest arriving. */
  acceptGuest(peerId: PeerId): void {
    this.linkOpened(peerId);
  }

  receive(from: PeerId, raw: string): void {
    this.linkData(from, raw);
  }

  notifyClosed(peerId: PeerId): void {
    this.linkClosed(peerId);
  }

  protected linkSendRaw(peerId: PeerId, raw: string): void {
    this.network.deliver(peerId, this.selfId, raw);
  }

  protected linkTeardown(): void {
    this.network.unregister(this.selfId);
  }

  protected linkDisconnect(peerId: PeerId): void {
    // Tell them their link is gone, but stay in the network ourselves.
    this.network.get(peerId)?.notifyClosed(this.selfId);
  }
}

/** Convenience for tests: a host and n guests, all connected. */
export function createLoopbackRoom(
  guestCount: number,
): { network: LoopbackNetwork; host: LoopbackTransport; guests: LoopbackTransport[] } {
  const network = new LoopbackNetwork();
  const host = new LoopbackTransport(network, "host", "host");
  host.connect();
  const guests: LoopbackTransport[] = [];
  for (let i = 0; i < guestCount; i++) {
    const guest = new LoopbackTransport(network, `guest${i + 1}`, "host");
    guest.connect();
    guests.push(guest);
  }
  network.flush();
  return { network, host, guests };
}
