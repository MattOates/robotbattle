/**
 * Shared editing over the room's transport.
 *
 * Concurrent text editing is one of those problems where hand-rolling the
 * merge logic produces something that looks right for a week and then corrupts
 * someone's work. So the merging is Yjs's job — a CRDT, which converges no
 * matter what order updates arrive in — and this file is only the plumbing that
 * carries its bytes over the `Session` we already have.
 *
 * Two kinds of traffic:
 *
 *  - `sync`: document updates. Yjs updates are idempotent and commutative, so
 *    they can be applied in any order, and re-applying one is harmless. That is
 *    what lets a newcomer simply be sent the whole document state.
 *  - `awareness`: who is where. Cursors and selections, which are ephemeral and
 *    deliberately not part of the document.
 */

import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import type { Session } from "./session.js";
import type { Message } from "./protocol.js";

/** JSON is the transport, so binary updates travel as base64. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface PairUser {
  name: string;
  color: string;
  /**
   * Which peer this cursor belongs to.
   *
   * Yjs identifies clients by its own numeric id, which says nothing about the
   * room. Carrying the peer id lets us clear a cursor the moment its owner
   * disconnects, rather than leaving a ghost sitting in the document until
   * awareness times it out.
   */
  peerId: string;
}

/**
 * Cursor colours, legible on the editor's dark background and distinguishable
 * from each other. Ten of them, because a room is not limited to two and six
 * people in a classroom would start sharing a colour.
 */
export const CURSOR_COLORS = [
  "#e8a33d",
  "#5fd0c5",
  "#b085f5",
  "#6ad98a",
  "#ff6b6b",
  "#ffd166",
  "#7fb2ff",
  "#ff9ecd",
  "#c9e265",
  "#f0a58f",
];

export class RoomYProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;

  private session: Session;
  private unsubscribe: () => void;
  private destroyed = false;
  /** Peers we have already sent the full document to. */
  private greeted = new Set<string>();

  constructor(session: Session, user: PairUser) {
    this.session = session;
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);
    this.awareness.setLocalStateField("user", user);

    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);

    this.unsubscribe = session.onMessage((from, message) => this.onMessage(from, message));

    // Anyone already here needs the current document; anyone arriving later is
    // caught by `greet` below.
    for (const peer of session.state.peers) {
      if (peer.id !== session.state.selfId) this.greet(peer.id);
    }
  }

  /**
   * The shared text for one robot.
   *
   * One document holding a named text per robot, rather than a document per
   * robot: a session that moves between robots keeps every one of them, and a
   * newcomer receives the lot in a single sync. Only robots that have actually
   * *been* the session robot ever get a text — browsing does not create one.
   */
  textFor(robotId: string): Y.Text {
    return this.doc.getText(`robot:${robotId}`);
  }

  /**
   * Seed a robot's text. Only the room owner should call this, and only into
   * an empty text — if both sides seeded, the CRDT would faithfully merge both
   * copies and you would end up with the script twice.
   */
  seed(robotId: string, source: string): void {
    const text = this.textFor(robotId);
    if (text.length > 0) return;
    text.insert(0, source);
  }

  /** Send the whole document to a peer who has just arrived. */
  greet(peerId: string): void {
    if (this.destroyed || this.greeted.has(peerId)) return;
    this.greeted.add(peerId);
    this.session.send(peerId, {
      t: "ydoc",
      kind: "sync",
      data: toBase64(Y.encodeStateAsUpdate(this.doc)),
    });
    const clients = [...this.awareness.getStates().keys()];
    if (clients.length > 0) {
      this.session.send(peerId, {
        t: "ydoc",
        kind: "awareness",
        data: toBase64(encodeAwarenessUpdate(this.awareness, clients)),
      });
    }
  }

  forget(peerId: string): void {
    this.greeted.delete(peerId);
  }

  /** Clear a departed peer's cursor for everyone, without waiting for a timeout. */
  dropPeer(peerId: string): void {
    this.greeted.delete(peerId);
    const gone: number[] = [];
    for (const [clientId, state] of this.awareness.getStates()) {
      const user = (state as { user?: PairUser } | undefined)?.user;
      if (user?.peerId === peerId) gone.push(clientId);
    }
    if (gone.length > 0) removeAwarenessStates(this.awareness, gone, "left");
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    // Updates we applied ourselves from the network must not be echoed back.
    if (this.destroyed || origin === this) return;
    this.session.send("all", { t: "ydoc", kind: "sync", data: toBase64(update) });
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (this.destroyed || origin === this) return;
    const changed = [...added, ...updated, ...removed];
    if (changed.length === 0) return;
    this.session.send("all", {
      t: "ydoc",
      kind: "awareness",
      data: toBase64(encodeAwarenessUpdate(this.awareness, changed)),
    });
  };

  private onMessage(from: string, message: Message): void {
    if (this.destroyed || message.t !== "ydoc") return;
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(message.data);
    } catch {
      // Garbled traffic from another browser is not worth ending the session.
      return;
    }

    if (message.kind === "sync") {
      // `this` as the origin marks it as remote, so it is not echoed back out.
      // Deliberately no `greet(from)` here. Replying with our whole document
      // to anyone who syncs with us makes joining cost one full-document send
      // per person already in the room; the owner hands it over once instead.
      Y.applyUpdate(this.doc, bytes, this);
      void from;
      return;
    }
    applyAwarenessUpdate(this.awareness, bytes, this);
  }

  destroy(): void {
    if (this.destroyed) return;
    // Say goodbye BEFORE tearing anything down. Removing our awareness state
    // fires an update, and that update has to reach the room — otherwise our
    // cursor stays on everyone else's screen after we have gone.
    removeAwarenessStates(this.awareness, [this.doc.clientID], "left");

    this.destroyed = true;
    this.unsubscribe();
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.awareness.destroy();
    this.doc.destroy();
  }
}
