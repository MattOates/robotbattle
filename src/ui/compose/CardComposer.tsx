/**
 * Building a {robot} by tapping.
 *
 * The Build pane for anybody whose level does not open straight into
 * CodeMirror. Everything here is a view over the script — see
 * `workshop/compose.ts` for why that matters — so this component never holds
 * the robot, only renders a `Sketch` and hands back new source text through the
 * same `onSource` the editor uses. Lint, compile, trials, version history and
 * the shared Yjs document are all unaware that it exists.
 *
 * Two rules it is built around:
 *
 *  - **Tap, never drag.** Drag-and-drop is the obvious idiom for a block
 *    editor and it is the wrong one here: it is hard at seven, hard on a
 *    trackpad, and impossible with a keyboard. Cards are added by pressing
 *    them in the palette and reordered with two arrows.
 *  - **Nothing is typed.** Every value is a chip or a dial with a fixed set of
 *    choices, drawn from what the compiler will actually accept, so a card can
 *    never be assembled into something that does not compile.
 */

import { useMemo, useState } from "react";
import {
  ANGLE_CHOICES,
  CARDS,
  addBlock,
  addCard,
  availableEvents,
  cardSpec,
  editCard,
  fromSource,
  moveCard,
  removeBlock,
  removeCard,
  toSource,
  type Block,
  type Card,
  type CardSpec,
  type Hole,
  type Sketch,
} from "../../workshop/compose.js";
import { ScriptLine } from "../ScriptLine.js";
import { EVENT_DOCS } from "../../lang/events.js";
import { phraseFor, type Theme } from "../../lang/vocab.js";
import type { EventName } from "../../lang/ast.js";

interface Props {
  source: string;
  onSource: (next: string) => void;
  theme: Theme;
  editable: boolean;
  say: (both: { full: string; simple: string }) => string;
  fill: (text: string) => string;
  /** A card was added by tapping. For the quests; nothing else uses it. */
  onCardAdded?: () => void;
}

/** Card groups, in the order the palette shows them. */
const GROUPS: readonly { id: CardSpec["group"]; label: string; icon: string }[] = [
  { id: "move", label: "Move", icon: "🏃" },
  { id: "look", label: "Look", icon: "👀" },
  { id: "shoot", label: "Shoot", icon: "💥" },
  { id: "wait", label: "Wait", icon: "⏱" },
];

/**
 * Which events are offered as new blocks.
 *
 * Not all nineteen. The rest are reachable in the text view and are shown
 * normally if a script already has them — this is the list somebody is offered
 * when they have no idea what any of them mean, so it is the six that a first
 * {robot} is built out of.
 */
const OFFERED: readonly EventName[] = [
  "start",
  "sense robot",
  "hit by bullet",
  "hit wall",
  "tick",
  "sense fuel",
];

export function CardComposer({
  source,
  onSource,
  theme,
  editable,
  say,
  fill,
  onCardAdded,
}: Props) {
  const sketch = useMemo(() => fromSource(source), [source]);
  // Which block the palette is adding to. Null closes it.
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [addingBlock, setAddingBlock] = useState(false);

  const apply = (next: Sketch) => onSource(toSource(next));

  const canAddEvents = availableEvents(sketch).filter((e) => OFFERED.includes(e));

  return (
    <div className="composer">
      {sketch.blocks.length === 0 ? (
        <p className="empty">
          Nothing here yet. Add a <strong>when</strong> to start — it says when your{" "}
          {fill("{robot}")} should do something.
        </p>
      ) : null}

      {sketch.blocks.map((block) => (
        <BlockCard
          key={block.id}
          block={block}
          theme={theme}
          editable={editable}
          say={say}
          fill={fill}
          palette={addingTo === block.id}
          onPalette={(open) => setAddingTo(open ? block.id : null)}
          onAdd={(spec) => {
            apply(addCard(sketch, block.id, spec));
            onCardAdded?.();
          }}
          onRemove={(cardId) => apply(removeCard(sketch, block.id, cardId))}
          onMove={(cardId, by) => apply(moveCard(sketch, block.id, cardId, by))}
          onEdit={(cardId, index, value) => apply(editCard(sketch, block.id, cardId, index, value))}
          onRemoveBlock={() => apply(removeBlock(sketch, block.id))}
        />
      ))}

      {editable ? (
        <div className="composer-add-block">
          {addingBlock ? (
            <>
              <p className="composer-prompt">{fill(say(WHEN_PROMPT))}</p>
              <div className="composer-events">
                {canAddEvents.map((event) => (
                  <button
                    key={event}
                    type="button"
                    className="event-card"
                    onClick={() => {
                      apply(addBlock(sketch, event));
                      setAddingBlock(false);
                    }}
                  >
                    <span className="event-name">{phraseFor(event, theme)}</span>
                    <span className="event-blurb">{fill(EVENT_DOCS[event].summary)}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="btn" onClick={() => setAddingBlock(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn primary big"
              onClick={() => setAddingBlock(true)}
              disabled={canAddEvents.length === 0}
            >
              + When something happens…
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Exported so `tests/workshop/compose.test.ts` checks its placeholders too:
    this string reached the screen reading "your {robot}" verbatim, because it
    went through `say` without `fill`. */
export const WHEN_PROMPT = {
  full: "Pick what your {robot} should react to.",
  simple: "When should your {robot} do something?",
};

// ---------------------------------------------------------------------------

function BlockCard({
  block,
  theme,
  editable,
  say,
  fill,
  palette,
  onPalette,
  onAdd,
  onRemove,
  onMove,
  onEdit,
  onRemoveBlock,
}: {
  block: Block;
  theme: Theme;
  editable: boolean;
  say: (both: { full: string; simple: string }) => string;
  fill: (text: string) => string;
  palette: boolean;
  onPalette: (open: boolean) => void;
  onAdd: (spec: CardSpec) => void;
  onRemove: (cardId: string) => void;
  onMove: (cardId: string, by: number) => void;
  onEdit: (cardId: string, index: number, value: string) => void;
  onRemoveBlock: () => void;
}) {
  // Only inside a handler that carries a bearing does "at them" mean anything.
  const hasEvent = block.event !== null && EVENT_DOCS[block.event].fields.length > 0;

  return (
    <section className="block-card">
      <header className="block-head">
        <span className="block-when">When</span>
        <span className="block-event">
          {block.event ? phraseFor(block.event, theme) : block.header.trim()}
        </span>
        {/* Before the blurb, not after it. The head is a grid whose first row
            is `when / event / remove` and whose second is the explanation
            across the full width, so source order decides which row this
            lands on. */}
        {editable ? (
          <button
            type="button"
            className="btn small"
            onClick={onRemoveBlock}
            aria-label="Remove this whole block"
          >
            ✕
          </button>
        ) : (
          <span />
        )}
        {block.event ? (
          <span className="block-blurb">{fill(EVENT_DOCS[block.event].summary)}</span>
        ) : null}
      </header>

      <ol className="block-cards">
        {block.cards.map((card, i) => (
          <li key={card.id}>
            <StatementCard
              card={card}
              hasEvent={hasEvent}
              editable={editable}
              say={say}
              fill={fill}
              first={i === 0}
              last={i === block.cards.length - 1}
              onRemove={() => onRemove(card.id)}
              onMove={(by) => onMove(card.id, by)}
              onEdit={(index, value) => onEdit(card.id, index, value)}
            />
          </li>
        ))}
      </ol>

      {editable ? (
        palette ? (
          <div className="palette">
            {GROUPS.map((group) => {
              const cards = CARDS.filter((c) => c.group === group.id);
              if (cards.length === 0) return null;
              return (
                <div key={group.id} className="palette-group">
                  <span className="palette-title">
                    <span aria-hidden="true">{group.icon}</span> {group.label}
                  </span>
                  <div className="palette-cards">
                    {cards.map((spec) => (
                      <button
                        key={spec.id}
                        type="button"
                        className="palette-card"
                        onClick={() => {
                          onAdd(spec);
                          onPalette(false);
                        }}
                      >
                        <span className="palette-icon" aria-hidden="true">
                          {spec.icon}
                        </span>
                        {fill(say(spec.say).replace(/\{0\}/g, "…"))}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <button type="button" className="btn" onClick={() => onPalette(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="btn add-card" onClick={() => onPalette(true)}>
            + Do something
          </button>
        )
      ) : null}
    </section>
  );
}

function StatementCard({
  card,
  hasEvent,
  editable,
  say,
  fill,
  first,
  last,
  onRemove,
  onMove,
  onEdit,
}: {
  card: Card;
  hasEvent: boolean;
  editable: boolean;
  say: (both: { full: string; simple: string }) => string;
  fill: (text: string) => string;
  first: boolean;
  last: boolean;
  onRemove: () => void;
  onMove: (by: number) => void;
  onEdit: (index: number, value: string) => void;
}) {
  const spec = cardSpec(card.spec);

  /*
   * Anything the catalogue does not model is shown as its own code, in the
   * editor's own colours, and cannot be edited here. Not hidden and not
   * rewritten: it is somebody's work, and most often it is the interesting
   * part of a robot they were given.
   */
  if (!spec) {
    if (card.text === "") return null;
    return (
      <div className="statement-card raw">
        <span className="raw-badge">Written by hand</span>
        <pre className="raw-code">
          {card.text.split("\n").map((line, i) => (
            <ScriptLine key={i} text={line} />
          ))}
        </pre>
      </div>
    );
  }

  const phrase = fill(say(spec.say));
  const [before, after] = phrase.split("{0}");

  return (
    <div className="statement-card">
      <span className="statement-icon" aria-hidden="true">
        {spec.icon}
      </span>

      <span className="statement-say">
        {before}
        {card.holes.map((hole, i) => (
          <HoleControl
            key={i}
            hole={hole}
            hasEvent={hasEvent}
            editable={editable}
            onChange={(value) => onEdit(i, value)}
          />
        ))}
        {after ?? ""}
      </span>

      {editable ? (
        <span className="statement-tools">
          <button type="button" onClick={() => onMove(-1)} disabled={first} aria-label="Move up">
            ↑
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={last} aria-label="Move down">
            ↓
          </button>
          <button type="button" onClick={onRemove} aria-label="Remove">
            ✕
          </button>
        </span>
      ) : null}
    </div>
  );
}

/**
 * One value, as a control rather than a text box.
 *
 * A number field would be the easy thing and it would need a keyboard, need
 * validating, and let a child write 900 into a speed that stops at 100. These
 * cannot be wrong.
 */
function HoleControl({
  hole,
  hasEvent,
  editable,
  onChange,
}: {
  hole: Hole;
  hasEvent: boolean;
  editable: boolean;
  onChange: (value: string) => void;
}) {
  if (!editable) return <span className="hole static">{hole.value}</span>;

  if (hole.kind === "angle") {
    const choices = ANGLE_CHOICES.filter((c) => hasEvent || !c.needsEvent);
    // A value written by hand — `event.bearing + 45`, say — is kept as an
    // option of its own rather than being silently snapped to the nearest one.
    const known = choices.some((c) => c.value === hole.value);
    return (
      <select
        className="hole"
        value={hole.value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="which way"
      >
        {known ? null : <option value={hole.value}>{hole.value}</option>}
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.say}
          </option>
        ))}
      </select>
    );
  }

  if (hole.kind === "power") {
    return (
      <span className="hole power" role="group" aria-label="how hard">
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={hole.value === String(n)}
            onClick={() => onChange(String(n))}
          >
            {"●".repeat(n)}
          </button>
        ))}
      </span>
    );
  }

  // Speed and ticks are both a number on a range, so both are a slider with
  // the value read out beside it — a number nobody has to be able to type.
  const max = hole.kind === "speed" ? 100 : 60;
  const value = Number(hole.value);
  if (!Number.isFinite(value)) return <span className="hole static">{hole.value}</span>;
  return (
    <span className="hole slider">
      <input
        type="range"
        min={0}
        max={max}
        step={hole.kind === "speed" ? 10 : 5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={hole.kind === "speed" ? "how fast" : "how long"}
      />
      <b>{value}</b>
    </span>
  );
}
