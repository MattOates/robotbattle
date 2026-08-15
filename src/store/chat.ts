/**
 * Conversations, kept against the robot they were about.
 *
 * The most valuable thing that happens in a pairing session is the advice, and
 * until now it evaporated when the room closed. Storing it per robot means a
 * player accumulates a record of how each of their robots came to be — and
 * someone joining a fresh session can read what was already said.
 *
 * Only the robot's owner stores anything. A guest sees the history for the
 * length of the session and keeps nothing, because the conversation belongs to
 * the robot and the robot lives in somebody's library.
 */

import {
  defaultStore,
  newId,
  readJson,
  writeJson,
  type KeyValueStore,
} from "./storage.js";
import type { ChatMessage } from "./types.js";

const KEY = "chat";

/** Per robot. Old advice is worth less than recent advice. */
export const MAX_MESSAGES = 200;

/** Cap on a single line, matching what the network layer accepts. */
const MAX_TEXT = 400;

type Store = Record<string, ChatMessage[]>;

export class ChatLog {
  private store: KeyValueStore;

  constructor(store: KeyValueStore = defaultStore()) {
    this.store = store;
  }

  private all(): Store {
    return readJson<Store>(this.store, KEY, {});
  }

  /** Oldest first, the way a conversation reads. */
  messagesFor(robotId: string): ChatMessage[] {
    return this.all()[robotId] ?? [];
  }

  count(robotId: string): number {
    return this.messagesFor(robotId).length;
  }

  /** True if this robot has ever been talked about. */
  hasHistory(robotId: string): boolean {
    return this.count(robotId) > 0;
  }

  append(
    robotId: string,
    message: Omit<ChatMessage, "id"> & { id?: string },
  ): ChatMessage {
    const stored: ChatMessage = {
      id: message.id ?? newId("msg"),
      at: message.at,
      author: message.author.slice(0, 24) || "Someone",
      authorPeerId: message.authorPeerId,
      text: message.text.slice(0, MAX_TEXT),
    };

    const all = this.all();
    const existing = all[robotId] ?? [];
    // Ignore a repeat of something already stored: the same message can arrive
    // twice when a guest is caught up on history it partly saw live.
    if (existing.some((m) => m.id === stored.id)) return stored;

    all[robotId] = [...existing, stored].slice(-MAX_MESSAGES);
    writeJson(this.store, KEY, all);
    return stored;
  }

  /** Merge a batch, keeping order and dropping anything already held. */
  merge(robotId: string, messages: readonly ChatMessage[]): void {
    const all = this.all();
    const existing = all[robotId] ?? [];
    const seen = new Set(existing.map((m) => m.id));
    const added = messages.filter((m) => !seen.has(m.id));
    if (added.length === 0) return;

    all[robotId] = [...existing, ...added]
      .sort((a, b) => a.at - b.at)
      .slice(-MAX_MESSAGES);
    writeJson(this.store, KEY, all);
  }

  clear(robotId: string): void {
    const all = this.all();
    if (!(robotId in all)) return;
    delete all[robotId];
    writeJson(this.store, KEY, all);
  }

  clearAll(): void {
    this.store.remove(KEY);
  }

  /** Drop the conversation for a robot that no longer exists. */
  forgetMissing(robotIds: readonly string[]): void {
    const keep = new Set(robotIds);
    const all = this.all();
    let changed = false;
    for (const id of Object.keys(all)) {
      if (!keep.has(id)) {
        delete all[id];
        changed = true;
      }
    }
    if (changed) writeJson(this.store, KEY, all);
  }
}

/** "4m", "2h", "3d" — how long ago, for a chat line. */
export function shortAgo(at: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
