/**
 * A same-origin transport over BroadcastChannel.
 *
 * Two browser tabs, no broker, no internet. This exists so the multiplayer
 * flows can be built and driven end to end without depending on a public
 * signalling server being reachable — which matters both for developing on a
 * train and for a classroom behind a strict firewall.
 *
 * It speaks the same `Transport` interface as the real WebRTC one, so nothing
 * above it can tell the difference.
 */

import { StarTransport, type PeerId } from "./transport.js";

type BusMessage =
  | { type: "join"; from: PeerId }
  | { type: "welcome"; from: PeerId; to: PeerId }
  | { type: "data"; from: PeerId; to: PeerId; raw: string }
  | { type: "bye"; from: PeerId }
  | { type: "kicked"; from: PeerId; to: PeerId };

export class ChannelTransport extends StarTransport {
  readonly selfId: PeerId;
  readonly isHost: boolean;
  private channel: BroadcastChannel;
  private hostId: PeerId;

  constructor(room: string, selfId: PeerId, asHost: boolean) {
    super();
    this.selfId = selfId;
    this.isHost = asHost;
    // The host's id is derived from the room code so guests know where to
    // knock without any discovery step.
    this.hostId = asHost ? selfId : `host-${room}`;
    this.channel = new BroadcastChannel(`robobattle:${room}`);
    this.channel.onmessage = (event: MessageEvent<BusMessage>) => this.onBus(event.data);
  }

  connect(): void {
    this.announceOpen();
    if (this.isHost) return;
    this.post({ type: "join", from: this.selfId });
  }

  private onBus(message: BusMessage): void {
    if (this.isClosed) return;

    switch (message.type) {
      case "join":
        // Only the host answers the door.
        if (!this.isHost || message.from === this.selfId) return;
        this.linkOpened(message.from);
        this.post({ type: "welcome", from: this.selfId, to: message.from });
        return;

      case "welcome":
        if (this.isHost || message.to !== this.selfId) return;
        this.hostId = message.from;
        this.linkOpened(message.from);
        return;

      case "data":
        if (message.to !== this.selfId) return;
        this.linkData(message.from, message.raw);
        return;

      case "bye":
        this.linkClosed(message.from);
        return;

      case "kicked":
        if (message.to !== this.selfId) return;
        this.linkClosed(message.from);
        return;
    }
  }

  private post(message: BusMessage): void {
    try {
      this.channel.postMessage(message);
    } catch (err) {
      this.linkError(err instanceof Error ? err : new Error("could not reach the other tab"));
    }
  }

  protected linkSendRaw(peerId: PeerId, raw: string): void {
    this.post({ type: "data", from: this.selfId, to: peerId, raw });
  }

  protected linkTeardown(): void {
    this.post({ type: "bye", from: this.selfId });
    this.channel.close();
  }

  protected linkDisconnect(peerId: PeerId): void {
    // BroadcastChannel has no per-peer connection to sever, so the removal is
    // announced and the peer is expected to act on it. A modified client could
    // ignore it — hence the honest wording in the UI about soft moderation.
    this.post({ type: "kicked", from: this.selfId, to: peerId });
  }

  /** Where a guest should address the host before the roster arrives. */
  get host(): PeerId {
    return this.hostId;
  }
}

/** BroadcastChannel is not available in every context (older Safari, Node). */
export function channelSupported(): boolean {
  return typeof BroadcastChannel !== "undefined";
}
