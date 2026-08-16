/**
 * Your library on the left, a shared table on the right.
 *
 * Shared by Trade and Tournament because they are the same gesture: nothing of
 * yours is visible to a room until you deliberately put it out, and you do that
 * by dragging it across. What differs is only what the room then does with it —
 * reads and swaps in one case, a draw in the other — so that is what the caller
 * supplies, as the buttons on each card.
 */

import type { ReactNode } from "react";
import { RobotGlyph } from "./RobotGlyph.js";
import type { ShelfItem } from "../net/protocol.js";
import type { StoredRobot } from "../store/types.js";
import type { Theme } from "../lang/vocab.js";

/** One card on the table, and who put it there. `null` owner means you. */
export interface TableEntry {
  item: ShelfItem;
  ownerId: string | null;
  ownerName: string;
}

interface Props {
  theme: Theme;
  /** Plural noun for robots in the current world. */
  robotPlural: string;
  /** Everything in your library. */
  robots: StoredRobot[];
  /** Ids of yours currently on the table. */
  offered: readonly string[];
  /** Put one out, or take it back. */
  onPut: (robotId: string, onTable: boolean) => void;
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
  tableLabel,
  tableHint,
  emptyTable,
  frozen = false,
  dropping,
  onDropping,
}: Props) {
  const inLibrary = robots.filter((r) => !offered.includes(r.id));

  const drag = (robotId: string) => (event: React.DragEvent) => {
    event.dataTransfer.setData("text/plain", robotId);
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
            inLibrary.map((robot) => (
              <div
                key={robot.id}
                className="trade-card"
                draggable={!frozen}
                onDragStart={drag(robot.id)}
                onDoubleClick={() => (frozen ? undefined : onPut(robot.id, true))}
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
                {/* Dragging is the nice way; a button is the way that works on
                    a touchscreen and from a keyboard. */}
                <button
                  type="button"
                  className="btn small"
                  disabled={frozen}
                  onClick={() => onPut(robot.id, true)}
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
                  key={`${entry.ownerId ?? "me"}:${entry.item.id}`}
                  className={`trade-card${mine ? " mine" : ""}`}
                  draggable={mine && !frozen}
                  onDragStart={mine && !frozen ? drag(entry.item.id) : undefined}
                  title={
                    mine && !frozen
                      ? `${entry.item.name} — drag back to take it off the table`
                      : entry.item.name
                  }
                >
                  <RobotGlyph
                    color={entry.item.color}
                    locomotion={entry.item.locomotion}
                    theme={theme}
                    size={46}
                    name={entry.item.name}
                  />
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
