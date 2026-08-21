/**
 * Trade: handing things between two people.
 *
 * Three kinds of thing, through one set of gestures. A **robot** is a whole
 * personality; a **place** is somewhere to fight, walls and ground together; a
 * **block** is one named behaviour out of a script. They travel the same way
 * because the conversation is the same in each case, and only the goods differ.
 *
 * Two directions, because they are different intentions. You can *give* one of
 * yours away, and you can *ask* for one you can see on someone's shelf. Both
 * need the agreement of whoever is on the other end: nothing arrives in your
 * library without you pressing something, and nothing leaves it without the
 * owner pressing something.
 *
 * What lands keeps its origin. A robot arrives with the traded script as a
 * version marked with who gave it to you; a place carries the same mark. That
 * is the whole point — something traded and then edited for a fortnight still
 * came from someone, and this is the only place that stays true.
 *
 * A block is the exception, and has to be: a block is not a thing a library can
 * hold on its own, it is text inside a script. So taking one grafts it into a
 * robot you already have, bringing whatever it hands off to along with it.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lobby } from "./Lobby.js";
import { navigate, parseRoute } from "../router.js";
import { useAutoJoin, useRoom } from "../useRoom.js";
import type { LibraryApi } from "../useLibrary.js";
import { deriveMeta } from "../../store/library.js";
import { THEMES, type Theme } from "../../lang/vocab.js";
import { RobotGlyph } from "../RobotGlyph.js";
import { RobotTable, type TableEntry } from "../RobotTable.js";
import {
  allTradeables,
  offeredGoods,
  pruneOffered,
  shelfFor,
  tableKey,
  toggleOffered,
  type Tradeables,
} from "../tradeShelf.js";
import { graftBlocks, libraryBlocks } from "../../workshop/blocks.js";
import { MapEditor } from "../MapEditor.js";
import { ARENA_SIZE } from "../../net/matchsetup.js";
import {
  sanitiseGoods,
  sanitiseShelf,
  sanitiseText,
  type Message,
  TRADE_KINDS,
  type ShelfItem,
  type TradeGoods,
  type TradeKind,
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

/** Something somebody is holding out to us, waiting to hear back. */
interface Incoming {
  from: string;
  fromName: string;
  kind: TradeKind;
  id: string;
  goods: TradeGoods;
}

/** Someone would like a copy of one of ours. */
interface IncomingRequest {
  from: string;
  fromName: string;
  kind: TradeKind;
  id: string;
  name: string;
}

/** Something we are reading before deciding whether to ask for it. */
interface Preview {
  from: string;
  kind: TradeKind;
  id: string;
  goods: TradeGoods;
}

/** The words for one kind, in the reader's own world. */
function kindWord(kind: TradeKind, words: { robot: string; arena: string }): string {
  return kind === "robot" ? words.robot : kind === "arena" ? words.arena : "block";
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
  /** Which kinds the library column is showing. All three to begin with. */
  const [showing, setShowing] = useState<Set<TradeKind>>(
    () => new Set<TradeKind>(["robot", "arena", "block"]),
  );
  const [offers, setOffers] = useState<Incoming[]>([]);
  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(robots[0]?.id ?? null);
  /** Ids you have put on the table, in the order you put them there. */
  const [offered, setOffered] = useState<string[]>([]);
  /**
   * The robot a traded block would go into.
   *
   * Whatever you last touched, falling back to the first thing in the library.
   * A block has to land in a script and there is no sensible way to guess which
   * one, so the screen says which it will be rather than asking every time.
   */
  /** Which list the pointer is over mid-drag, so the target is obvious. */
  const [dropping, setDropping] = useState<"table" | "library" | null>(null);

  const into = robots.find((r) => r.id === selectedId) ?? robots[0] ?? null;

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

  /**
   * Everything of yours that could be traded.
   *
   * Blocks are derived rather than stored, so this recomputes them from the
   * scripts — which also means editing a robot can quietly rename or delete a
   * block, and the table has to be re-checked against it rather than trusted.
   */
  const tradeables = useMemo<Tradeables>(
    () => ({ robots, arenas: lib.arenas, blocks: libraryBlocks(robots) }),
    [robots, lib.arenas],
  );

  const myThings = useMemo(
    () => allTradeables(tradeables).filter((item) => showing.has(item.kind)),
    [tradeables, showing],
  );

  // Anything deleted — or edited out of a script — cannot stay on the table.
  useEffect(() => {
    setOffered((prev) => {
      const next = pruneOffered(prev, tradeables);
      return next.length === prev.length ? prev : next;
    });
  }, [tradeables]);

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
  const shelf = useMemo(() => shelfFor(tradeables, offered), [offered, tradeables]);
  const sent = useRef<string>("");
  useEffect(() => {
    const session = room.session;
    if (!connected || !session) return;
    // Re-sent when the room changes as well as when the shelf does: someone who
    // has just walked in has never seen it.
    const key = JSON.stringify(shelf) + others.map((p) => p.id).join(",");
    if (sent.current === key) return;
    sent.current = key;
    session.send("all", { t: "shelf", items: shelf });
  }, [connected, others, room.session, shelf]);

  /**
   * Write arrived goods into the library.
   *
   * The one place a trade actually changes anything of yours, which is why it
   * is a single function rather than three scattered ones — and why a block,
   * which has nowhere of its own to live, has to say so here rather than fail
   * quietly somewhere else.
   */
  const keep = useCallback(
    (goods: TradeGoods, fromName: string): boolean => {
      if (goods.kind === "robot") {
        const added = library.importTraded(goods.source, fromName);
        refresh();
        setSelectedId(added.id);
        setNotice(`${added.name} is in your library, from ${fromName}.`);
        return true;
      }
      if (goods.kind === "arena") {
        const added = lib.arenaLib.importTraded(goods.name, goods.spec, fromName);
        refresh();
        setNotice(`${added.name} is yours, from ${fromName}.`);
        return true;
      }

      // A block goes *into* a script, so there has to be one to put it in.
      const target = robots.find((r) => r.id === selectedId) ?? robots[0];
      if (!target) {
        setNotice("Make a robot first — a block has to go into one.");
        return false;
      }
      const graft = graftBlocks(target.source, goods.text, fromName);
      if (graft.added.length === 0) {
        setNotice(`${target.name} already has ${goods.name}.`);
        return false;
      }
      library.updateSource(target.id, graft.source);
      refresh();
      setSelectedId(target.id);
      // The landed name is worth saying: it is not always the one it left with.
      setNotice(
        `${graft.added.map((n) => `\`${n}\``).join(", ")} added to ${target.name}, from ${fromName}.`,
      );
      return true;
    },
    [lib.arenaLib, library, refresh, robots, selectedId],
  );

  // --- incoming ------------------------------------------------------------
  useEffect(
    () =>
      room.onMessage((from, message: Message) => {
        const session = room.session;
        switch (message.t) {
          case "shelf":
            setShelves((prev) => ({
              ...prev,
              [from]: sanitiseShelf(message.items),
            }));
            return;

          case "peek": {
            // Reading something you put out needs no further ceremony: it is
            // what its owner would read aloud over their shoulder. But only
            // what is out — the table answers this, not the library.
            session?.send(from, {
              t: "peekResult",
              kind: message.kind,
              id: message.id,
              goods: offeredGoods(tradeables, offered, message.kind, message.id),
            });
            return;
          }

          case "peekResult": {
            const goods = sanitiseGoods(message.goods);
            if (!goods) {
              setNotice("That one is no longer there.");
              return;
            }
            setPreview({ from, kind: message.kind, id: message.id, goods });
            return;
          }

          case "copyRequest": {
            // Asking about something not on the table is answered the same way
            // whether it was taken back, deleted or never offered.
            const goods = offeredGoods(tradeables, offered, message.kind, message.id);
            if (!goods) {
              session?.send(from, {
                t: "copyResponse",
                kind: message.kind,
                id: message.id,
                goods: null,
                reason: "That one isn't on the table.",
              });
              return;
            }
            setRequests((prev) =>
              // One pending ask per thing per person; clicking twice is not two
              // questions.
              prev.some((r) => r.from === from && r.kind === message.kind && r.id === message.id)
                ? prev
                : [
                    ...prev,
                    {
                      from,
                      fromName: nameOf(from),
                      kind: message.kind,
                      id: message.id,
                      name: goods.name,
                    },
                  ],
            );
            return;
          }

          case "copyResponse": {
            const goods = sanitiseGoods(message.goods);
            if (!goods) {
              setNotice(sanitiseText(message.reason, 200) || `${nameOf(from)} said no thank you.`);
              return;
            }
            // An answered ask is consent already given, so it lands rather than
            // queueing a second question — except a block, which still needs to
            // be told which script to go into.
            if (goods.kind === "block") {
              setOffers((prev) => [
                ...prev,
                { from, fromName: nameOf(from), kind: goods.kind, id: message.id, goods },
              ]);
              return;
            }
            keep(goods, nameOf(from));
            return;
          }

          case "offer": {
            const goods = sanitiseGoods(message.goods);
            if (!goods) return;
            setOffers((prev) =>
              prev.some((o) => o.from === from && o.kind === message.kind && o.id === message.id)
                ? prev
                : [
                    ...prev,
                    { from, fromName: nameOf(from), kind: message.kind, id: message.id, goods },
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
    [keep, nameOf, offered, room, tradeables],
  );

  // --- outgoing ------------------------------------------------------------

  /** Put something on the table, or take it back. Idempotent either way. */
  const put = useCallback((key: string, onTable: boolean) => {
    if (!key) return;
    setOffered((prev) => (prev.includes(key) === onTable ? prev : toggleOffered(prev, key)));
  }, []);

  /** Hand one of yours to whoever is selected. */
  const give = useCallback(
    (item: ShelfItem) => {
      if (!target || !room.session) return;
      // Given straight from the library rather than from the table: giving is
      // its own decision, and having to put something out first would be
      // ceremony for nothing.
      const goods = offeredGoods(
        { ...tradeables, blocks: tradeables.blocks },
        [tableKey(item.kind, item.id)],
        item.kind,
        item.id,
      );
      if (!goods) return;
      room.session.send(target, { t: "offer", kind: item.kind, id: item.id, goods });
      setNotice(`Offered ${item.name} to ${nameOf(target)}. Waiting for them.`);
    },
    [nameOf, room.session, target, tradeables],
  );

  const accept = useCallback(
    (offer: Incoming) => {
      if (!keep(offer.goods, offer.fromName)) return;
      setOffers((prev) => prev.filter((o) => o !== offer));
      room.session?.send(offer.from, {
        t: "offerResult",
        kind: offer.kind,
        id: offer.id,
        accepted: true,
      });
    },
    [keep, room.session],
  );

  const decline = useCallback(
    (offer: Incoming) => {
      setOffers((prev) => prev.filter((o) => o !== offer));
      room.session?.send(offer.from, {
        t: "offerResult",
        kind: offer.kind,
        id: offer.id,
        accepted: false,
      });
    },
    [room.session],
  );

  const answer = useCallback(
    (request: IncomingRequest, agreed: boolean) => {
      setRequests((prev) => prev.filter((r) => r !== request));
      room.session?.send(request.from, {
        t: "copyResponse",
        kind: request.kind,
        id: request.id,
        // Read from the table again rather than from the copy taken when they
        // asked: it may have been taken back in between, and the table is
        // always the authority on what may leave.
        goods: agreed ? offeredGoods(tradeables, offered, request.kind, request.id) : null,
        reason: agreed ? null : "Not this one, sorry.",
      });
    },
    [offered, room.session, tradeables],
  );

  /**
   * The table: everything anyone in the room has put out, yours included.
   *
   * One surface rather than a shelf per person. A trade is a thing that happens
   * over a table — you look at what is on it, and it does not matter much whose
   * side of it a robot started on. Ownership stays on the card, because it
   * decides what you can do with it.
   */
  const table: TableEntry[] = [
    ...shelf.map((item) => ({ item, ownerId: null, ownerName: "you" })),
    ...others.flatMap((peer) =>
      (shelves[peer.id] ?? []).map((item) => ({
        item,
        ownerId: peer.id,
        ownerName: peer.displayName,
      })),
    ),
  ];

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
          <div key={`${offer.from}:${offer.kind}:${offer.id}`} className="notice trade-ask">
            {offer.goods.kind === "robot" ? (
              <RobotGlyph
                color={offer.goods.color}
                // An offer carries the whole script, so how it looks can simply
                // be read off it rather than trusted from the wire.
                locomotion={deriveMeta(offer.goods.source)?.locomotion ?? "skid"}
                theme={theme}
                size={32}
                name={offer.goods.name}
              />
            ) : null}
            <span>
              <strong>{offer.fromName}</strong> is offering you{" "}
              {offer.goods.kind === "block" ? (
                <>
                  the block <code>{offer.goods.name}</code> from {offer.goods.from}
                </>
              ) : offer.goods.kind === "arena" ? (
                <>
                  the {words.arena} {offer.goods.name}
                  {offer.goods.spec.walls.length > 0
                    ? ` — ${offer.goods.spec.walls.length} walls`
                    : ""}
                </>
              ) : (
                offer.goods.name
              )}
              {offer.goods.kind === "block" && into ? `, for ${into.name}` : ""}.
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
          <div
            key={`${request.from}:${request.kind}:${request.id}`}
            className="notice trade-ask"
          >
            <span>
              <strong>{request.fromName}</strong> would like a copy of{" "}
              {request.kind === "block" ? <code>{request.name}</code> : request.name}
              {request.kind === "robot" ? "" : ` (${kindWord(request.kind, words)})`}.
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

        {/* Which kinds the left-hand column shows. A library with forty blocks
            in it would otherwise bury the three robots. */}
        <div className="row kind-filter" aria-label="what to show">
          {TRADE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={showing.has(kind)}
              className={`btn small${showing.has(kind) ? " primary" : ""}`}
              onClick={() =>
                setShowing((prev) => {
                  const next = new Set(prev);
                  // Never all off: an empty column looks like a bug.
                  if (next.has(kind) && next.size > 1) next.delete(kind);
                  else next.add(kind);
                  return next;
                })
              }
            >
              {kind === "robot"
                ? words.robotPlural
                : kind === "arena"
                  ? words.arenaPlural
                  : words.blockPlural}
            </button>
          ))}
        </div>

        <RobotTable
          theme={theme}
          robotPlural={words.robotPlural}
          robots={myThings}
          offered={offered}
          onPut={put}
          keyOf={(item) => tableKey(item.kind, item.id)}
          entries={table}
          tableLabel="On the table"
          tableHint={table.length === 0 ? "nothing out yet" : `${table.length} up for viewing`}
          emptyTable={
            <>
              Empty. Drag one of yours across to show it — until somebody does, nobody in this room
              can see anyone&rsquo;s {words.robotPlural}.
            </>
          }
          dropping={dropping}
          onDropping={setDropping}
          actionsFor={({ item, ownerId, ownerName }) =>
            ownerId === null ? (
              <>
                {target === null ? null : (
                  <button type="button" className="btn small" onClick={() => give(item)}>
                    Give to {nameOf(target)}
                  </button>
                )}
                <button
                  type="button"
                  className="btn small"
                  onClick={() => put(tableKey(item.kind, item.id), false)}
                >
                  Take back
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn small"
                  onClick={() =>
                    room.session?.send(ownerId, { t: "peek", kind: item.kind, id: item.id })
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
                      kind: item.kind,
                      id: item.id,
                    });
                    setNotice(`Asked ${ownerName} for ${item.name}.`);
                  }}
                >
                  Ask
                </button>
              </>
            )
          }
        />

        {preview ? (
          /* Their script in a real editor rather than a block of text: the
             highlighting is what makes it readable, and reading it properly is
             the whole reason to ask for it. Shown only — it cannot be edited,
             selected or copied out, because the one way it reaches your library
             is by its owner agreeing to send it. */
          <section className="panel trade-preview">
            <div className="panel-head">
              {preview.goods.kind === "robot" ? (
                <RobotGlyph
                  color={preview.goods.color}
                  locomotion={deriveMeta(preview.goods.source)?.locomotion ?? "skid"}
                  theme={theme}
                  size={28}
                  name={preview.goods.name}
                />
              ) : null}
              <span className="silkscreen">{preview.goods.name}</span>
              <span className="roster-meta">
                {kindWord(preview.kind, words)} from {nameOf(preview.from)}
              </span>
              <span className="spacer" />
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  room.session?.send(preview.from, {
                    t: "copyRequest",
                    kind: preview.kind,
                    id: preview.id,
                  });
                  setNotice(`Asked ${nameOf(preview.from)} for ${preview.goods.name}.`);
                }}
              >
                Ask for a copy
              </button>
              <button type="button" className="btn small" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>

            {preview.goods.kind === "arena" ? (
              /* A map is looked at rather than read. The same editor the
                 Workshop draws with, with nothing to drag: what is worth
                 knowing about somebody's labyrinth is its shape. */
              <MapEditor
                spec={preview.goods.spec}
                width={ARENA_SIZE.width}
                height={ARENA_SIZE.height}
                theme={theme}
                readOnly
                onChange={() => undefined}
              />
            ) : (
              <Suspense fallback={<div className="empty small">Opening the editor…</div>}>
                <CodeEditor
                  key={`${preview.from}:${preview.kind}:${preview.id}`}
                  source={preview.goods.kind === "block" ? preview.goods.text : preview.goods.source}
                  theme={theme}
                  preview
                  // Nothing can change the document, so this never fires; a
                  // no-op is the honest implementation of "you cannot change it".
                  onChange={() => undefined}
                />
              </Suspense>
            )}
          </section>
        ) : null}
      </div>
    </Lobby>
  );
}
