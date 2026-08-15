/**
 * Workshop sessions.
 *
 * The distinction these tests exist to protect: **viewing follows the host,
 * editing does not.** Browsing the library during a session shows people a
 * robot; it must not move the editable document, the chat, or where a new
 * message is filed. Conflating the two would fragment the conversation across
 * robots nobody is working on, which is exactly what makes the chat worth
 * keeping in the first place.
 */

import { describe, expect, it } from "vitest";
import { createLoopbackRoom, LoopbackTransport } from "../../src/net/loopback.js";
import { Session } from "../../src/net/session.js";
import { RoomYProvider } from "../../src/net/yprovider.js";
import { ChatLog } from "../../src/store/chat.js";
import { MemoryStore } from "../../src/store/storage.js";
import { sanitiseChat } from "../../src/net/protocol.js";
import type { Message } from "../../src/net/protocol.js";
import { HUNTER, RACER } from "../../src/bots/index.js";

const HUNTER_ID = "bot_hunter";
const RACER_ID = "bot_racer";

function room(guests: number) {
  const { network, host, guests: peers } = createLoopbackRoom(guests);
  const sessions = [host, ...peers].map(
    (transport, i) =>
      new Session({
        transport,
        displayName: i === 0 ? "Matt" : `Guest ${i}`,
        robot: null,
      }),
  );
  for (const s of sessions) s.announce();
  network.flush();

  const providers = sessions.map(
    (s, i) =>
      new RoomYProvider(s, {
        name: i === 0 ? "Matt" : `Guest ${i}`,
        color: "#e8a33d",
        peerId: s.state.selfId,
      }),
  );
  return { network, sessions, providers, transports: [host, ...peers] };
}

/** What a guest screen would be showing, driven purely by messages. */
function guestView(session: Session) {
  const state = { viewing: null as string | null, sessionRobot: null as string | null };
  session.onMessage((_from, message: Message) => {
    if (message.t === "view") state.viewing = message.robotId;
    if (message.t === "session") {
      state.sessionRobot = message.robotId;
      state.viewing = message.robotId;
    }
  });
  return state;
}

describe("viewing follows the host", () => {
  it("shows guests whatever the host browses to", () => {
    const { network, sessions } = room(1);
    const view = guestView(sessions[1]!);

    sessions[0]!.broadcast({
      t: "session",
      robotId: HUNTER_ID,
      name: "Hunter",
      color: "#ff8800",
    });
    sessions[0]!.broadcast({
      t: "view",
      robotId: RACER_ID,
      name: "Racer",
      color: "#ffd166",
      source: RACER,
    });
    network.flush();

    expect(view.viewing).toBe(RACER_ID);
  });

  it("carries the source, since a guest does not have the host's library", () => {
    const { network, sessions } = room(1);
    let received = "";
    sessions[1]!.onMessage((_f, m) => {
      if (m.t === "view") received = m.source;
    });
    sessions[0]!.broadcast({
      t: "view",
      robotId: RACER_ID,
      name: "Racer",
      color: "#ffd166",
      source: RACER,
    });
    network.flush();
    expect(received).toBe(RACER);
  });
});

describe("editing does not follow browsing", () => {
  it("leaves the editable robot alone when the host browses away", () => {
    const { network, sessions } = room(1);
    const view = guestView(sessions[1]!);

    sessions[0]!.broadcast({
      t: "session",
      robotId: HUNTER_ID,
      name: "Hunter",
      color: "#ff8800",
    });
    network.flush();
    expect(view.sessionRobot).toBe(HUNTER_ID);

    sessions[0]!.broadcast({
      t: "view",
      robotId: RACER_ID,
      name: "Racer",
      color: "#ffd166",
      source: RACER,
    });
    network.flush();

    // On screen: Racer. Editable: still Hunter.
    expect(view.viewing).toBe(RACER_ID);
    expect(view.sessionRobot).toBe(HUNTER_ID);
  });

  it("moves both only on a deliberate switch", () => {
    const { network, sessions } = room(1);
    const view = guestView(sessions[1]!);

    sessions[0]!.broadcast({ t: "session", robotId: HUNTER_ID, name: "Hunter", color: "#ff8800" });
    sessions[0]!.broadcast({ t: "view", robotId: RACER_ID, name: "Racer", color: "#ffd166", source: RACER });
    sessions[0]!.broadcast({ t: "session", robotId: RACER_ID, name: "Racer", color: "#ffd166" });
    network.flush();

    expect(view.sessionRobot).toBe(RACER_ID);
    expect(view.viewing).toBe(RACER_ID);
  });

  it("files a message said while browsing against the robot being worked on", () => {
    // The reason `chat` carries a robotId rather than relying on "current".
    const store = new MemoryStore();
    const chat = new ChatLog(store);
    const { network, sessions } = room(1);

    let sessionRobot = HUNTER_ID;
    sessions[0]!.onMessage((_f, m) => {
      if (m.t === "chat") {
        chat.append(m.robotId, {
          at: m.at,
          author: "Guest 1",
          authorPeerId: "guest1",
          text: m.text,
        });
      }
    });

    // Host is showing Racer, but Hunter is what everyone is working on.
    sessions[0]!.broadcast({ t: "view", robotId: RACER_ID, name: "Racer", color: "#ffd166", source: RACER });
    sessions[1]!.broadcast({ t: "chat", robotId: sessionRobot, text: "widen the sweep", at: 1000 });
    network.flush();

    expect(chat.messagesFor(HUNTER_ID).map((m) => m.text)).toEqual(["widen the sweep"]);
    expect(chat.messagesFor(RACER_ID)).toEqual([]);
    void sessionRobot;
  });
});

describe("one document, a text per robot", () => {
  it("keeps every robot the session has worked on", () => {
    const { network, providers } = room(1);
    const owner = providers[0]!;

    owner.seed(HUNTER_ID, HUNTER);
    owner.seed(RACER_ID, RACER);
    owner.greet("guest1");
    network.flush();

    const guest = providers[1]!;
    expect(guest.textFor(HUNTER_ID).toString()).toBe(HUNTER);
    expect(guest.textFor(RACER_ID).toString()).toBe(RACER);
  });

  it("keeps edits to one robot out of the other", () => {
    const { network, providers } = room(1);
    providers[0]!.seed(HUNTER_ID, "hunter\n");
    providers[0]!.seed(RACER_ID, "racer\n");
    providers[0]!.greet("guest1");
    network.flush();

    providers[1]!.textFor(HUNTER_ID).insert(0, "-- edited\n");
    network.flush();

    expect(providers[0]!.textFor(HUNTER_ID).toString()).toBe("-- edited\nhunter\n");
    expect(providers[0]!.textFor(RACER_ID).toString()).toBe("racer\n");
  });

  it("gives a latecomer every robot in one sync", () => {
    const { network, sessions, providers, transports } = room(1);
    providers[0]!.seed(HUNTER_ID, HUNTER);
    providers[0]!.seed(RACER_ID, RACER);
    network.flush();
    void transports;
    void sessions;

    providers[0]!.greet("guest1");
    network.flush();
    expect(providers[1]!.textFor(HUNTER_ID).toString()).toBe(HUNTER);
    expect(providers[1]!.textFor(RACER_ID).toString()).toBe(RACER);
  });
});

describe("chat history reaching a guest", () => {
  it("arrives whole and in order", () => {
    const { network, sessions } = room(1);
    const owner = new ChatLog(new MemoryStore());
    owner.append(HUNTER_ID, { at: 1000, author: "Matt", authorPeerId: "host", text: "one" });
    owner.append(HUNTER_ID, { at: 2000, author: "Ada", authorPeerId: "guest1", text: "two" });

    let received: Message | null = null;
    sessions[1]!.onMessage((_f, m) => {
      if (m.t === "chatHistory") received = m;
    });
    sessions[0]!.send("guest1", {
      t: "chatHistory",
      robotId: HUNTER_ID,
      messages: owner.messagesFor(HUNTER_ID),
    });
    network.flush();

    const message = received as unknown as Extract<Message, { t: "chatHistory" }>;
    expect(message.robotId).toBe(HUNTER_ID);
    expect(sanitiseChat(message.messages).map((m) => m.text)).toEqual(["one", "two"]);
  });

  it("drops malformed lines without losing the rest", () => {
    const clean = sanitiseChat([
      { id: "a", at: 1, author: "Ada", authorPeerId: "g", text: "kept" },
      { id: "b", at: 2, author: "Ada", authorPeerId: "g" },
      null,
      "nonsense",
      { id: "c", at: 3, author: "Ada", authorPeerId: "g", text: "also kept" },
    ]);
    expect(clean.map((m) => m.text)).toEqual(["kept", "also kept"]);
  });
});

describe("the host removing someone", () => {
  it("takes them out of the room for everyone", () => {
    const { network, sessions, transports } = room(2);
    expect(sessions[0]!.state.peers).toHaveLength(3);

    transports[0]!.drop("guest2");
    network.flush();

    expect(sessions[0]!.state.peers.map((p) => p.id)).not.toContain("guest2");
    expect(sessions[1]!.state.peers.map((p) => p.id)).not.toContain("guest2");
  });

  it("refuses them if they come back under the same id", () => {
    const { network, transports } = room(1);
    const host = transports[0]!;
    host.drop("guest1");
    network.flush();

    // A reconnect from a known id is turned away on sight.
    const returning = new LoopbackTransport(network, "guest1", "host");
    returning.connect();
    network.flush();

    expect(host.peers).not.toContain("guest1");
  });

  it("reaches only the peer being removed", () => {
    const { network, sessions } = room(2);
    const atGuest1: Message[] = [];
    const atGuest2: Message[] = [];
    sessions[1]!.onMessage((_f, m) => atGuest1.push(m));
    sessions[2]!.onMessage((_f, m) => atGuest2.push(m));

    sessions[0]!.send("guest2", { t: "kick", reason: "Removed by the host" });
    network.flush();

    expect(atGuest1.filter((m) => m.t === "kick")).toHaveLength(0);
    expect(atGuest2.filter((m) => m.t === "kick")).toHaveLength(1);
  });

  it("leaves the rest of the room working", () => {
    const { network, sessions, transports, providers } = room(2);
    transports[0]!.drop("guest2");
    network.flush();

    providers[0]!.seed(HUNTER_ID, "still here\n");
    providers[0]!.greet("guest1");
    network.flush();

    expect(providers[1]!.textFor(HUNTER_ID).toString()).toBe("still here\n");
    expect(sessions[0]!.state.peers).toHaveLength(2);
  });
});
