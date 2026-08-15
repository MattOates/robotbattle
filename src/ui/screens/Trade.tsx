/**
 * Trade: handing scripts between two people.
 *
 * Two directions, because they are different intentions. You can *give* one of
 * yours away, and you can *ask* for one you can see on someone's shelf. Both
 * end in the same place — a script written into a library — and both need the
 * agreement of whoever is on the other end. Nothing arrives in your library
 * without you pressing something, and nothing leaves it without the owner
 * pressing something.
 *
 * What lands is a new robot with the traded script kept as a version, marked
 * with who gave it to you and when. That version is the whole point: a robot
 * that has been traded and then edited for a fortnight still came from someone,
 * and the version list is the only place that stays true.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lobby } from "./Lobby.js";
import { navigate, parseRoute } from "../router.js";
import { useAutoJoin, useRoom } from "../useRoom.js";
import type { LibraryApi } from "../useLibrary.js";
import { deriveMeta } from "../../store/library.js";
import { THEMES, type Theme } from "../../lang/vocab.js";
import { RobotGlyph } from "../RobotGlyph.js";
import type { Locomotion } from "../../lang/ast.js";
import { offeredSource, pruneOffered, shelfFor, toggleOffered } from "../tradeShelf.js";
import {
  MAX_SOURCE_LENGTH,
  sanitiseShelf,
  sanitiseText,
  type Message,
  type ShelfItem,
} from "../../net/protocol.js";

/**
 * The editor is the biggest thing in the bundle, and most of a trade never
 * opens one — so reading a script pays for it, and arranging one does not.
 */
const CodeEditor = lazy(() => import("../CodeEditor.js").then((m) => ({ default: m.CodeEditor })));

interface Props {
  theme: Theme;
  lib: LibraryApi;
  playerName: string;
  onPlayerName: (name: string) => void;
  initialRoom: string | null;
}

/** Someone has offered us a script and is waiting to hear back. */
interface IncomingOffer {
  from: string;
  fromName: string;
  robotId: string;
  name: string;
  color: string;
  locomotion: Locomotion;
  source: string;
}

/** Someone would like a copy of one of ours. */
interface IncomingRequest {
  from: string;
  fromName: string;
  robotId: string;
  robotName: string;
}

/** A script we are reading before deciding whether to ask for it. */
interface Preview {
  from: string;
  robotId: string;
  name: string;
  color: string;
  locomotion: Locomotion;
  source: string;
}

/** One card on the table, and who it belongs to. `null` owner means you. */
interface TableItem {
  item: ShelfItem;
  ownerId: string | null;
  ownerName: string;
}

export function Trade({ theme, lib, playerName, onPlayerName, initialRoom }: Props) {
  const { library, robots, refresh } = lib;
  const words = THEMES[theme];

  const room = useRoom(playerName || "Player", null);
  useAutoJoin(room, initialRoom);

  const connected = room.phase === "connected" && room.session !== null;

  // Hosting rewrites the URL so the room can be shared from the address bar.
  useEffect(() => {
    if (connected && room.roomCode && parseRoute(window.location.hash).room !== room.roomCode) {
      navigate("trade", room.roomCode);
    }
  }, [connected, room.roomCode]);

  const [shelves, setShelves] = useState<Record<string, ShelfItem[]>>({});
  const [offers, setOffers] = useState<IncomingOffer[]>([]);
  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(robots[0]?.id ?? null);
  /** Ids you have put on the table, in the order you put them there. */
  const [offered, setOffered] = useState<string[]>([]);
  /** Which list the pointer is over mid-drag, so the target is obvious. */
  const [dropping, setDropping] = useState<"table" | "library" | null>(null);

  const others = useMemo(
    () => (room.state?.peers ?? []).filter((p) => p.id !== room.state?.selfId),
    [room.state],
  );

  const nameOf = useCallback(
    (peerId: string) => room.state?.peers.find((p) => p.id === peerId)?.displayName ?? "Someone",
    [room.state],
  );

  // A room you have left takes its shelves and its half-finished trades with
  // it — including what you had put out. Offering something is a decision about
  // one conversation, not a standing property of the robot.
  useEffect(() => {
    if (connected) return;
    setShelves({});
    setOffers([]);
    setRequests([]);
    setPreview(null);
    setTarget(null);
    setOffered([]);
  }, [connected]);

  // A robot deleted in another tab cannot stay on the table.
  useEffect(() => {
    setOffered((prev) => {
      const next = pruneOffered(prev, robots);
      return next.length === prev.length ? prev : next;
    });
  }, [robots]);

  // Whoever is on screen by default is whoever is here; with one other person
  // in the room — which is the usual case — there is nothing to choose.
  useEffect(() => {
    if (target && others.some((p) => p.id === target)) return;
    setTarget(others[0]?.id ?? null);
  }, [others, target]);

  /**
   * Publish what we have put on the table.
   *
   * Names and colours of the offered robots only — nothing you have not put
   * out, and never a script. Everything past a title is a decision somebody
   * has to make.
   */
  const shelf = useMemo(() => shelfFor(robots, offered), [offered, robots]);
  const sent = useRef<string>("");
  useEffect(() => {
    const session = room.session;
    if (!connected || !session) return;
    // Re-sent when the room changes as well as when the shelf does: someone who
    // has just walked in has never seen it.
    const key = JSON.stringify(shelf) + others.map((p) => p.id).join(",");
    if (sent.current === key) return;
    sent.current = key;
    session.send("all", { t: "shelf", robots: shelf });
  }, [connected, others, room.session, shelf]);

  // --- incoming ------------------------------------------------------------
  useEffect(
    () =>
      room.onMessage((from, message: Message) => {
        const session = room.session;
        switch (message.t) {
          case "shelf":
            setShelves((prev) => ({
              ...prev,
              [from]: sanitiseShelf(message.robots),
            }));
            return;

          case "peek": {
            // Reading something you put out needs no further ceremony: it is
            // the script its owner would read aloud over their shoulder. But
            // only what is out — the table answers this, not the library.
            session?.send(from, {
              t: "peekResult",
              robotId: message.robotId,
              source: offeredSource(robots, offered, message.robotId),
            });
            return;
          }

          case "peekResult": {
            const source = typeof message.source === "string" ? message.source : null;
            if (source === null) {
              setNotice("That one is no longer there.");
              return;
            }
            const item = (shelves[from] ?? []).find((r) => r.id === message.robotId);
            setPreview({
              from,
              robotId: message.robotId,
              name: item?.name ?? "Their robot",
              color: item?.color ?? "#8a8f98",
              locomotion: item?.locomotion ?? "skid",
              source: source.slice(0, MAX_SOURCE_LENGTH),
            });
            return;
          }

          case "copyRequest": {
            // Asking about something that is not on the table is answered the
            // same way whether it was taken back, deleted or never offered.
            const mine =
              offeredSource(robots, offered, message.robotId) === null
                ? undefined
                : robots.find((r) => r.id === message.robotId);
            if (!mine) {
              session?.send(from, {
                t: "copyResponse",
                robotId: message.robotId,
                source: null,
                reason: "That one isn't on the table.",
              });
              return;
            }
            setRequests((prev) =>
              // One pending ask per robot per person; clicking twice is not two
              // questions.
              prev.some((r) => r.from === from && r.robotId === message.robotId)
                ? prev
                : [
                    ...prev,
                    {
                      from,
                      fromName: nameOf(from),
                      robotId: message.robotId,
                      robotName: mine.name,
                    },
                  ],
            );
            return;
          }

          case "copyResponse": {
            const source = typeof message.source === "string" ? message.source : null;
            if (source === null) {
              setNotice(sanitiseText(message.reason, 200) || `${nameOf(from)} said no thank you.`);
              return;
            }
            const added = library.importTraded(source.slice(0, MAX_SOURCE_LENGTH), nameOf(from));
            refresh();
            setSelectedId(added.id);
            setNotice(`${added.name} is in your library, from ${nameOf(from)}.`);
            return;
          }

          case "offer": {
            setOffers((prev) =>
              prev.some((o) => o.from === from && o.robotId === message.robotId)
                ? prev
                : [
                    ...prev,
                    {
                      from,
                      fromName: nameOf(from),
                      robotId: message.robotId,
                      name: sanitiseText(message.name, 32) || "Their robot",
                      color: /^#[0-9a-fA-F]{6}$/.test(message.color) ? message.color : "#8a8f98",
                      // An offer carries the whole script, so how it looks can
                      // simply be read off it rather than trusted from the wire.
                      locomotion: deriveMeta(message.source ?? "")?.locomotion ?? "skid",
                      source: sanitiseText(message.source, MAX_SOURCE_LENGTH),
                    },
                  ],
            );
            return;
          }

          case "offerResult":
            setNotice(
              message.accepted ? `${nameOf(from)} took it.` : `${nameOf(from)} passed on it.`,
            );
            return;

          default:
            return;
        }
      }),
    [library, nameOf, offered, refresh, robots, room, shelves],
  );

  // --- outgoing ------------------------------------------------------------

  /** Put a robot on the table, or take it back. Idempotent either way. */
  const put = useCallback((robotId: string, onTable: boolean) => {
    if (!robotId) return;
    setOffered((prev) =>
      prev.includes(robotId) === onTable ? prev : toggleOffered(prev, robotId),
    );
  }, []);

  const drag = useCallback(
    (robotId: string) => (event: React.DragEvent) => {
      event.dataTransfer.setData("text/plain", robotId);
      event.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const give = useCallback(
    (robotId: string) => {
      const mine = robots.find((r) => r.id === robotId);
      if (!mine || !target || !room.session) return;
      room.session.send(target, {
        t: "offer",
        robotId: mine.id,
        name: mine.name,
        color: mine.color,
        source: mine.source,
      });
      setNotice(`Offered ${mine.name} to ${nameOf(target)}. Waiting for them.`);
    },
    [nameOf, robots, room.session, target],
  );

  const accept = useCallback(
    (offer: IncomingOffer) => {
      const added = library.importTraded(offer.source, offer.fromName);
      refresh();
      setSelectedId(added.id);
      setOffers((prev) => prev.filter((o) => o !== offer));
      room.session?.send(offer.from, {
        t: "offerResult",
        robotId: offer.robotId,
        accepted: true,
      });
      setNotice(`${added.name} is in your library, from ${offer.fromName}.`);
    },
    [library, refresh, room.session],
  );

  const decline = useCallback(
    (offer: IncomingOffer) => {
      setOffers((prev) => prev.filter((o) => o !== offer));
      room.session?.send(offer.from, {
        t: "offerResult",
        robotId: offer.robotId,
        accepted: false,
      });
    },
    [room.session],
  );

  const answer = useCallback(
    (request: IncomingRequest, agreed: boolean) => {
      const mine = robots.find((r) => r.id === request.robotId);
      setRequests((prev) => prev.filter((r) => r !== request));
      room.session?.send(request.from, {
        t: "copyResponse",
        robotId: request.robotId,
        source: agreed && mine ? mine.source : null,
        reason: agreed ? null : "Not this one, sorry.",
      });
    },
    [robots, room.session],
  );

  /**
   * The table: everything anyone in the room has put out, yours included.
   *
   * One surface rather than a shelf per person. A trade is a thing that happens
   * over a table — you look at what is on it, and it does not matter much whose
   * side of it a robot started on. Ownership stays on the card, because it
   * decides what you can do with it.
   */
  const table: TableItem[] = [
    ...shelfFor(robots, offered).map((item) => ({ item, ownerId: null, ownerName: "you" })),
    ...others.flatMap((peer) =>
      (shelves[peer.id] ?? []).map((item) => ({
        item,
        ownerId: peer.id,
        ownerName: peer.displayName,
      })),
    ),
  ];
  const inLibrary = robots.filter((r) => !offered.includes(r.id));

  return (
    <Lobby
      title="Trade"
      blurb={`Swap ${words.robotPlural} with someone. Open a room and send them the link, or type in the code they gave you. Nothing moves in either direction without both of you agreeing.`}
      shareScreen="trade"
      room={room}
      robots={robots}
      selectedRobotId={selectedId}
      onSelectRobot={setSelectedId}
      playerName={playerName}
      onPlayerName={onPlayerName}
      requiresRobot={false}
    >
      <div className="panel-head">
        <span className="silkscreen">The table</span>
        <span className="spacer" />
        {others.length > 1 ? (
          <label className="field-row">
            <span className="roster-meta">give to</span>
            <select
              className="btn small"
              value={target ?? ""}
              onChange={(e) => setTarget(e.target.value)}
            >
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="roster-meta">{target ? nameOf(target) : "nobody else yet"}</span>
        )}
      </div>

      <div className="panel-body">
        {notice ? <div className="notice">{notice}</div> : null}

        {offers.map((offer) => (
          <div key={`${offer.from}:${offer.robotId}`} className="notice trade-ask">
            <RobotGlyph
              color={offer.color}
              locomotion={offer.locomotion}
              theme={theme}
              size={32}
              name={offer.name}
            />
            <span>
              <strong>{offer.fromName}</strong> is offering you {offer.name}.
            </span>
            <span className="spacer" />
            <button type="button" className="btn small primary" onClick={() => accept(offer)}>
              Take it
            </button>
            <button type="button" className="btn small" onClick={() => decline(offer)}>
              No thanks
            </button>
          </div>
        ))}

        {requests.map((request) => (
          <div key={`${request.from}:${request.robotId}`} className="notice trade-ask">
            <span>
              <strong>{request.fromName}</strong> would like a copy of {request.robotName}.
            </span>
            <span className="spacer" />
            <button
              type="button"
              className="btn small primary"
              onClick={() => answer(request, true)}
            >
              Give it
            </button>
            <button type="button" className="btn small" onClick={() => answer(request, false)}>
              Not this one
            </button>
          </div>
        ))}

        <div className="trade-floor">
          {/* Left: your library. Drag right to show something. */}
          <section
            className={`trade-side${dropping === "library" ? " over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDropping("library");
            }}
            onDragLeave={() => setDropping(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDropping(null);
              put(e.dataTransfer.getData("text/plain"), false);
            }}
          >
            <div className="entry-label">
              Your {words.robotPlural}
              <span className="roster-meta">drag onto the table →</span>
            </div>
            <div className="trade-list">
              {robots.length === 0 ? (
                <div className="empty small">
                  Nothing to trade yet — build something in the Workshop first.
                </div>
              ) : inLibrary.length === 0 ? (
                <div className="empty small">Everything you have is on the table.</div>
              ) : (
                inLibrary.map((robot) => (
                  <div
                    key={robot.id}
                    className="trade-card"
                    draggable
                    onDragStart={drag(robot.id)}
                    onDoubleClick={() => put(robot.id, true)}
                    title={`${robot.name} — drag onto the table, or double-click`}
                  >
                    <RobotGlyph
                      color={robot.color}
                      locomotion={robot.locomotion ?? "skid"}
                      theme={theme}
                      size={46}
                      name={robot.name}
                    />
                    <span className="trade-card-name">{robot.name}</span>
                    {/* Dragging is the nice way; a button is the way that works
                        on a touchscreen and from a keyboard. */}
                    <button type="button" className="btn small" onClick={() => put(robot.id, true)}>
                      Put out →
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Right: the table itself, everyone's. */}
          <section
            className={`trade-side table${dropping === "table" ? " over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDropping("table");
            }}
            onDragLeave={() => setDropping(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDropping(null);
              put(e.dataTransfer.getData("text/plain"), true);
            }}
          >
            <div className="entry-label">
              On the table
              <span className="roster-meta">
                {table.length === 0 ? "nothing out yet" : `${table.length} up for viewing`}
              </span>
            </div>
            <div className="trade-list">
              {table.length === 0 ? (
                <div className="empty small">
                  Empty. Drag one of yours across to show it — until somebody does, nobody in this
                  room can see anyone&rsquo;s {words.robotPlural}.
                </div>
              ) : (
                table.map(({ item, ownerId, ownerName }) => {
                  const mine = ownerId === null;
                  return (
                    <div
                      key={`${ownerId ?? "me"}:${item.id}`}
                      className={`trade-card${mine ? " mine" : ""}`}
                      draggable={mine}
                      onDragStart={mine ? drag(item.id) : undefined}
                      title={mine ? `${item.name} — drag back to take it off the table` : item.name}
                    >
                      <RobotGlyph
                        color={item.color}
                        locomotion={item.locomotion}
                        theme={theme}
                        size={46}
                        name={item.name}
                      />
                      <span className="trade-card-name">{item.name}</span>
                      <span className="roster-meta">{ownerName}</span>
                      {mine ? (
                        <div className="trade-card-actions">
                          {target === null ? null : (
                            <button
                              type="button"
                              className="btn small"
                              onClick={() => give(item.id)}
                            >
                              Give to {nameOf(target)}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn small"
                            onClick={() => put(item.id, false)}
                          >
                            Take back
                          </button>
                        </div>
                      ) : (
                        <div className="trade-card-actions">
                          <button
                            type="button"
                            className="btn small"
                            onClick={() =>
                              room.session?.send(ownerId, { t: "peek", robotId: item.id })
                            }
                          >
                            Read
                          </button>
                          <button
                            type="button"
                            className="btn small"
                            onClick={() => {
                              room.session?.send(ownerId, {
                                t: "copyRequest",
                                robotId: item.id,
                              });
                              setNotice(`Asked ${ownerName} for ${item.name}.`);
                            }}
                          >
                            Ask
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>

        {preview ? (
          /* Their script in a real editor rather than a block of text: the
             highlighting is what makes it readable, and reading it properly is
             the whole reason to ask for it. Shown only — it cannot be edited,
             selected or copied out, because the one way it reaches your library
             is by its owner agreeing to send it. */
          <section className="panel trade-preview">
            <div className="panel-head">
              <RobotGlyph
                color={preview.color}
                locomotion={preview.locomotion}
                theme={theme}
                size={28}
                name={preview.name}
              />
              <span className="silkscreen">{preview.name}</span>
              <span className="roster-meta">from {nameOf(preview.from)}</span>
              <span className="spacer" />
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  room.session?.send(preview.from, {
                    t: "copyRequest",
                    robotId: preview.robotId,
                  });
                  setNotice(`Asked ${nameOf(preview.from)} for ${preview.name}.`);
                }}
              >
                Ask for a copy
              </button>
              <button type="button" className="btn small" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
            <Suspense fallback={<div className="empty small">Opening the editor…</div>}>
              <CodeEditor
                key={`${preview.from}:${preview.robotId}`}
                source={preview.source}
                theme={theme}
                preview
                // Nothing can change the document, so this never fires; a no-op
                // is the honest implementation of "you cannot change it".
                onChange={() => undefined}
              />
            </Suspense>
          </section>
        ) : null}
      </div>
    </Lobby>
  );
}
