import { beforeEach, describe, expect, it } from "vitest";
import { ChatLog, MAX_MESSAGES, shortAgo } from "../../src/store/chat.js";
import { MemoryStore } from "../../src/store/storage.js";

let store: MemoryStore;
let chat: ChatLog;

beforeEach(() => {
  store = new MemoryStore();
  chat = new ChatLog(store);
});

const line = (text: string, at = Date.now(), author = "Ada") => ({
  at,
  author,
  authorPeerId: "guest1",
  text,
});

describe("keeping a conversation", () => {
  it("starts empty and survives a reload", () => {
    expect(chat.messagesFor("bot_a")).toEqual([]);
    chat.append("bot_a", line("try sweeping wider"));
    // A fresh log over the same store is what a page reload looks like.
    expect(new ChatLog(store).messagesFor("bot_a")).toHaveLength(1);
    expect(new ChatLog(store).messagesFor("bot_a")[0]!.text).toBe("try sweeping wider");
  });

  it("reads oldest first", () => {
    chat.append("bot_a", line("first", 1000));
    chat.append("bot_a", line("second", 2000));
    expect(chat.messagesFor("bot_a").map((m) => m.text)).toEqual(["first", "second"]);
  });

  it("keeps each robot's conversation separate", () => {
    // The whole point: advice about Hunter must not show up under Racer.
    chat.append("bot_a", line("about A"));
    chat.append("bot_b", line("about B"));
    expect(chat.messagesFor("bot_a").map((m) => m.text)).toEqual(["about A"]);
    expect(chat.messagesFor("bot_b").map((m) => m.text)).toEqual(["about B"]);
  });

  it("stamps every message with a time", () => {
    const at = Date.UTC(2026, 0, 1);
    chat.append("bot_a", line("hello", at));
    expect(chat.messagesFor("bot_a")[0]!.at).toBe(at);
  });

  it("caps how much it keeps, dropping the oldest", () => {
    for (let i = 0; i < MAX_MESSAGES + 25; i++) {
      chat.append("bot_a", line(`line ${i}`, 1000 + i));
    }
    const kept = chat.messagesFor("bot_a");
    expect(kept).toHaveLength(MAX_MESSAGES);
    expect(kept[0]!.text).toBe("line 25");
    expect(kept[kept.length - 1]!.text).toBe(`line ${MAX_MESSAGES + 24}`);
  });

  it("reports whether a robot has been talked about", () => {
    expect(chat.hasHistory("bot_a")).toBe(false);
    chat.append("bot_a", line("hi"));
    expect(chat.hasHistory("bot_a")).toBe(true);
  });

  it("trims a hostile name or line", () => {
    chat.append("bot_a", line("x".repeat(2000), 1, "y".repeat(200)));
    const stored = chat.messagesFor("bot_a")[0]!;
    expect(stored.text.length).toBeLessThanOrEqual(400);
    expect(stored.author.length).toBeLessThanOrEqual(24);
  });
});

describe("merging history from the owner", () => {
  it("adds what it does not already have", () => {
    const a = chat.append("bot_a", line("mine", 1000));
    chat.merge("bot_a", [
      a,
      { id: "m2", at: 2000, author: "Matt", authorPeerId: "host", text: "theirs" },
    ]);
    // The message we already had is not duplicated.
    expect(chat.messagesFor("bot_a").map((m) => m.text)).toEqual(["mine", "theirs"]);
  });

  it("puts merged messages back in time order", () => {
    chat.append("bot_a", line("later", 5000));
    chat.merge("bot_a", [
      { id: "m1", at: 1000, author: "Matt", authorPeerId: "host", text: "earlier" },
    ]);
    expect(chat.messagesFor("bot_a").map((m) => m.text)).toEqual(["earlier", "later"]);
  });

  it("ignores a message it already stored, by id", () => {
    const first = chat.append("bot_a", line("once"));
    chat.append("bot_a", { ...first });
    expect(chat.messagesFor("bot_a")).toHaveLength(1);
  });
});

describe("tidying up", () => {
  it("clears one robot without touching the others", () => {
    chat.append("bot_a", line("a"));
    chat.append("bot_b", line("b"));
    chat.clear("bot_a");
    expect(chat.messagesFor("bot_a")).toEqual([]);
    expect(chat.messagesFor("bot_b")).toHaveLength(1);
  });

  it("forgets conversations for robots that no longer exist", () => {
    // Otherwise deleting a robot leaves its chat behind forever.
    chat.append("bot_a", line("a"));
    chat.append("bot_gone", line("orphan"));
    chat.forgetMissing(["bot_a"]);
    expect(chat.messagesFor("bot_gone")).toEqual([]);
    expect(chat.messagesFor("bot_a")).toHaveLength(1);
  });

  it("survives a corrupted store rather than throwing", () => {
    store.set("chat", "{not json");
    expect(chat.messagesFor("bot_a")).toEqual([]);
  });
});

describe("how long ago", () => {
  const now = Date.UTC(2026, 0, 2, 12, 0, 0);
  it("reads at a glance", () => {
    expect(shortAgo(now - 5_000, now)).toBe("now");
    expect(shortAgo(now - 4 * 60_000, now)).toBe("4m");
    expect(shortAgo(now - 3 * 3_600_000, now)).toBe("3h");
    expect(shortAgo(now - 2 * 86_400_000, now)).toBe("2d");
  });
});
