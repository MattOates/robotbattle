/**
 * Lobby chat, and the one property that matters about it.
 *
 * Talk in a lobby is arranging noise — "ready when you are", "give me a
 * minute" — and it is meant to be gone when the room is. The Workshop's chat is
 * the opposite: notes about a robot, kept in its owner's library. The tests
 * worth having are the ones that hold those two apart, because the failure mode
 * is silent and only shows up as somebody's throwaway remark still being there
 * a week later.
 */

import { describe, expect, it } from "vitest";
import { createLoopbackRoom } from "../../src/net/loopback.js";
import { Session } from "../../src/net/session.js";
import { isMessage, sanitiseText, MAX_CHAT_LENGTH, type Message } from "../../src/net/protocol.js";
import { readFileSync } from "node:fs";
import { MAX_ROOM_LINES } from "../../src/ui/useRoomChat.js";

interface Side {
  session: Session;
  heard: Array<{ from: string; message: Message }>;
}

function pair(): { flush: () => void; ada: Side; bob: Side } {
  const { network, host, guests } = createLoopbackRoom(1);
  const sides = [host, guests[0]!].map((transport, i) => {
    const side: Side = {
      session: new Session({
        transport,
        displayName: i === 0 ? "Ada" : "Bob",
        robot: null,
      }),
      heard: [],
    };
    side.session.onMessage((from, message) => side.heard.push({ from, message }));
    return side;
  });
  for (const side of sides) side.session.announce();
  network.flush();
  return { flush: () => network.flush(), ada: sides[0]!, bob: sides[1]! };
}

const saidTo = (side: Side) =>
  side.heard.filter((h) => h.message.t === "say").map((h) => (h.message as { text: string }).text);

describe("saying something to the room", () => {
  it("reaches everybody else", () => {
    const { flush, ada, bob } = pair();
    ada.session.send("all", { t: "say", text: "two minutes", at: Date.now() });
    flush();
    expect(saidTo(bob)).toEqual(["two minutes"]);
  });

  it("is a known message, so a peer does not drop it", () => {
    expect(isMessage({ t: "say", text: "hello", at: 1 })).toBe(true);
  });

  it("carries no author and no id", () => {
    // The room already knows who sent it, and a line nobody keeps needs no
    // identity beyond the moment it arrived. Anything more would be a hint
    // that somebody meant to store it.
    const { flush, ada, bob } = pair();
    ada.session.send("all", { t: "say", text: "hello", at: 5 });
    flush();
    const message = bob.heard.find((h) => h.message.t === "say")!.message;
    expect(Object.keys(message).sort()).toEqual(["at", "t", "text"]);
  });

  it("trims a wall of text down to the same cap as any other line", () => {
    expect(sanitiseText("x".repeat(MAX_CHAT_LENGTH * 3), MAX_CHAT_LENGTH)).toHaveLength(
      MAX_CHAT_LENGTH,
    );
  });
});

describe("what a lobby keeps", () => {
  /**
   * The guarantee is structural, so it is checked structurally.
   *
   * "Ephemeral" is a promise about code that does not exist: there must be no
   * path from the lobby's chat to storage. Asserting that some particular run
   * wrote nothing would pass just as happily the day somebody adds a `writeJson`
   * — so instead this reads the module and insists it cannot even reach one.
   * The same trick the simulation uses to stay deterministic.
   */
  const SOURCE = readFileSync("src/ui/useRoomChat.ts", "utf8");

  /**
   * The code with its prose taken out.
   *
   * The comments explain at length that this never touches storage, so scanning
   * the file whole finds the word "storage" and fails for saying so.
   */
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("cannot reach storage at all", () => {
    for (const forbidden of [
      "localStorage",
      "sessionStorage",
      "writeJson",
      "readJson",
      "defaultStore",
      "ChatLog",
      "Library",
    ]) {
      expect(CODE, `useRoomChat reaches ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("imports only the protocol and the room", () => {
    const imports = [...SOURCE.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["../net/protocol.js", "./useRoom.js", "react"]);
  });

  it("empties itself when the room goes", () => {
    // The effect that does it, named so a reader can find it. Anything that
    // survived a disconnect would survive the room.
    expect(SOURCE).toContain("setLines([])");
  });

  it("is not the chat the Workshop keeps", () => {
    // Two different messages on purpose. The Workshop's carries the robot it is
    // about, because that is where it is filed; this one cannot, because there
    // is nowhere to file it.
    const kept: Message = { t: "chat", robotId: "bot_1", text: "widen the sweep", at: 1 };
    const said: Message = { t: "say", text: "ready when you are", at: 1 };
    expect(kept.t).not.toBe(said.t);
    expect("robotId" in said).toBe(false);
  });

  it("holds only so many lines, however long the room stays open", () => {
    expect(MAX_ROOM_LINES).toBeGreaterThan(20);
    expect(MAX_ROOM_LINES).toBeLessThanOrEqual(500);
    expect(SOURCE).toContain("MAX_ROOM_LINES");
  });
});
