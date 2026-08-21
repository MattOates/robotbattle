/**
 * Your library on the left, a shared table on the right.
 *
 * Shared by Trade and Tournament because they are the same gesture: nothing of
 * yours is visible to a room until you deliberately put it out, and you do that
 * by dragging it across. What differs is only what the room then does with it —
 * reads and swaps in one case, a draw in the other — so that is what the caller
 * supplies, as the buttons on each card.
 *
 * Both sides hold `ShelfItem`s rather than robots, because a trade can be about
 * a robot, a place or a single block. Only a robot has a shape worth drawing;
 * the other two get a plain card saying what they are. The Tournament passes
 * robots and never sees the difference.
 */

import type { ReactNode } from "react";
import { RobotGlyph } from "./RobotGlyph.js";
import type { ShelfItem } from "../net/protocol.js";
import type { Theme } from "../lang/vocab.js";

/**
 * The picture on a card.
 *
 * A robot is drawn; a place and a block are described. Trying to give the other
 * two a glyph would mean inventing artwork for a wall list, and the useful
 * thing to know about them is not what they look like — it is how big the map
 * is, or which event the block fits.
 */
function CardFace({ item, theme }: { item: ShelfItem; theme: Theme }) {
  if (item.kind === "robot") {
    return (
      <RobotGlyph
        color={item.color ?? "#8a8f98"}
        locomotion={item.locomotion ?? "skid"}
        theme={theme}
        size={46}
        name={item.name}
      />
    );
  }
  return (
    <span className={`trade-face ${item.kind}`} aria-hidden="true">
      {item.kind === "arena"
        ? `${item.walls ?? 0} walls`
        : item.event
          ? `given ${item.event}`
          : "anywhere"}
    </span>
  );
}

/** One card on the table, and who put it there. `null` owner means you. */
export interface TableEntry {
  item: ShelfItem;
  ownerId: string | null;
  ownerName: string;
}

interface Props {
  theme: Theme;
  /** Heading for the left-hand side: what these things are called. */
  robotPlural: string;
  /** Everything of yours that could go out. */
  robots: ShelfItem[];
  /** Keys of yours currently on the table, from `tableKey`. */
  offered: readonly string[];
  /** Put one out, or take it back. Takes the key, not the bare id. */
  onPut: (key: string, onTable: boolean) => void;
  /** How a row is keyed on the table. Kinds have their own id spaces. */
  keyOf: (item: ShelfItem) => string;
  /** Everything on the table, yours and everyone else's. */
  entries: TableEntry[];
  /** Buttons for one card. */
  actionsFor: (entry: TableEntry) => ReactNode;
  /** Heading for the right-hand side. */
  tableLabel: string;
  /** Small print under that heading. */
  tableHint: string;
  /** Shown when the table is empty. */
  emptyTable: ReactNode;
  /** Set while the table is closed — the draw has been made, or a match is on. */
  frozen?: boolean;
  /** Which list the pointer is over mid-drag. */
  dropping: "table" | "library" | null;
  onDropping: (where: "table" | "library" | null) => void;
}

export function RobotTable({
  theme,
  robotPlural,
  robots,
  offered,
  onPut,
  entries,
  actionsFor,
  keyOf,
  tableLabel,
  tableHint,
  emptyTable,
  frozen = false,
  dropping,
  onDropping,
}: Props) {
  const inLibrary = robots.filter((r) => !offered.includes(keyOf(r)));

  const drag = (key: string) => (event: React.DragEvent) => {
    event.dataTransfer.setData("text/plain", key);
    event.dataTransfer.effectAllowed = "move";
  };

  const dropTo = (onTable: boolean) => (event: React.DragEvent) => {
    event.preventDefault();
    onDropping(null);
    if (frozen) return;
    onPut(event.dataTransfer.getData("text/plain"), onTable);
  };

  const dragOver = (where: "table" | "library") => (event: React.DragEvent) => {
    if (frozen) return;
    event.preventDefault();
    onDropping(where);
  };

  return (
    <div className="trade-floor">
      <section
        className={`trade-side${dropping === "library" ? " over" : ""}`}
        onDragOver={dragOver("library")}
        onDragLeave={() => onDropping(null)}
        onDrop={dropTo(false)}
      >
        <div className="entry-label">
          Your {robotPlural}
          <span className="roster-meta">{frozen ? "closed" : "drag onto the table →"}</span>
        </div>
        <div className="trade-list">
          {robots.length === 0 ? (
            <div className="empty small">
              Nothing to enter yet — build something in the Workshop first.
            </div>
          ) : inLibrary.length === 0 ? (
            <div className="empty small">Everything you have is on the table.</div>
          ) : (
            inLibrary.map((item) => (
              <div
                key={keyOf(item)}
                className={`trade-card ${item.kind}`}
                draggable={!frozen}
                onDragStart={drag(keyOf(item))}
                onDoubleClick={() => (frozen ? undefined : onPut(keyOf(item), true))}
                title={`${item.name} — drag onto the table, or double-click`}
              >
                <CardFace item={item} theme={theme} />
                <span className="trade-card-name">{item.name}</span>
                {/* Dragging is the nice way; a button is the way that works on
                    a touchscreen and from a keyboard. */}
                <button
                  type="button"
                  className="btn small"
                  disabled={frozen}
                  onClick={() => onPut(keyOf(item), true)}
                >
                  Put out →
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section
        className={`trade-side table${dropping === "table" ? " over" : ""}`}
        onDragOver={dragOver("table")}
        onDragLeave={() => onDropping(null)}
        onDrop={dropTo(true)}
      >
        <div className="entry-label">
          {tableLabel}
          <span className="roster-meta">{tableHint}</span>
        </div>
        <div className="trade-list">
          {entries.length === 0 ? (
            <div className="empty small">{emptyTable}</div>
          ) : (
            entries.map((entry) => {
              const mine = entry.ownerId === null;
              return (
                <div
                  key={`${entry.ownerId ?? "me"}:${keyOf(entry.item)}`}
                  className={`trade-card ${entry.item.kind}${mine ? " mine" : ""}`}
                  draggable={mine && !frozen}
                  onDragStart={mine && !frozen ? drag(keyOf(entry.item)) : undefined}
                  title={
                    mine && !frozen
                      ? `${entry.item.name} — drag back to take it off the table`
                      : entry.item.name
                  }
                >
                  <CardFace item={entry.item} theme={theme} />
                  <span className="trade-card-name">{entry.item.name}</span>
                  <span className="roster-meta">{entry.ownerName}</span>
                  <div className="trade-card-actions">{actionsFor(entry)}</div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
