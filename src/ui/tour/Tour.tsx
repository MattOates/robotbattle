/**
 * The coach mark: a card that points at the thing it is talking about.
 *
 * Two decisions worth stating. The scrim is four rectangles around the anchor
 * rather than one dimmed layer with a hole cut in it, because the anchor has to
 * stay *clickable* — the whole design is that the player really ticks the box
 * and really presses Start, so the tour must not sit on top of the controls it
 * is describing.
 *
 * And an anchor that is not on screen yet — a tab that has not been opened —
 * centres the card instead of hiding it. A tour step whose arrow has nothing to
 * point at is still a step worth reading.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Avatar } from "../character/Avatar.js";
import { BRANDING } from "../branding.js";
import { fillVocab } from "../../learn/markdown.js";
import { Prose } from "../Prose.js";
import type { TourApi } from "./useTour.js";
import type { Theme } from "../../lang/vocab.js";

/**
 * A step's copy: `code` and **emphasis**.
 *
 * `Prose` already turns backticks into code spans everywhere else in the game,
 * so bold is split off here and the rest handed to it — one component still
 * decides what a backtick means.
 */
function Copy({ text }: { text: string }) {
  return (
    <>
      {text.split(/\*\*/).map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i}>
            <Prose text={part} />
          </strong>
        ) : (
          <Prose key={i} text={part} />
        ),
      )}
    </>
  );
}

/**
 * A speaker, drawn rather than typed.
 *
 * The obvious emoji renders as a missing-glyph box in the display font, which
 * is not a thing to put on a beginner's first screen.
 */
function Speaker({ muted }: { muted: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M7 2.5 3.8 5.4H1.5v5.2h2.3L7 13.5z" fill="currentColor" />
      {muted ? (
        <path
          d="M10 6l4 4M14 6l-4 4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
      ) : (
        <path
          d="M10 5.6a3.4 3.4 0 0 1 0 4.8M12.2 3.6a6.4 6.4 0 0 1 0 8.8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
      )}
    </svg>
  );
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Follow an element's box as the page moves under it. */
function useAnchor(anchor: string | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    if (!anchor) {
      setRect(null);
      return;
    }

    let frame = 0;
    const measure = () => {
      const node = document.querySelector(`[data-tour="${anchor}"]`);
      if (!node) {
        setRect(null);
        return;
      }
      const box = node.getBoundingClientRect();
      setRect((current) =>
        current &&
        current.top === box.top &&
        current.left === box.left &&
        current.width === box.width &&
        current.height === box.height
          ? // Same box: returning the same object avoids re-rendering on every
            // scroll event of a page that has not moved.
            current
          : { top: box.top, left: box.left, width: box.width, height: box.height },
      );
    };

    // The anchor may not be mounted yet — a tab the step is about to ask for.
    // Polling on the animation frame covers that as well as scrolling, resizing
    // and panels opening, without needing to know which of them happened.
    const loop = () => {
      measure();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [anchor]);

  return rect;
}

const CARD_WIDTH = 340;
/** Enough for the tallest card. Only used to keep one on screen, not to size it. */
const CARD_HEIGHT = 260;
const MARGIN = 14;

/**
 * Where to put the card.
 *
 * The requested placement is a preference, not an instruction: a panel near the
 * top of the window has no room above it, and a card that is half off the
 * screen is worse than one on the wrong side of its anchor. So both axes are
 * clamped into the viewport, and `top` flips below when there is no room above.
 */
function place(rect: Rect | null, placement: string): React.CSSProperties {
  if (!rect) {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
  const clampX = (value: number) =>
    Math.max(MARGIN, Math.min(value, window.innerWidth - CARD_WIDTH - MARGIN));
  const clampY = (value: number) =>
    Math.max(MARGIN, Math.min(value, window.innerHeight - CARD_HEIGHT - MARGIN));

  switch (placement) {
    case "top": {
      const above = rect.top - MARGIN - CARD_HEIGHT;
      // No room above: drop below the anchor rather than off the top edge.
      return above < MARGIN
        ? { top: clampY(rect.top + rect.height + MARGIN), left: clampX(rect.left) }
        : { top: above, left: clampX(rect.left) };
    }
    case "left":
      return { top: clampY(rect.top), left: Math.max(MARGIN, rect.left - CARD_WIDTH - MARGIN) };
    case "right":
      return { top: clampY(rect.top), left: clampX(rect.left + rect.width + MARGIN) };
    default:
      return { top: clampY(rect.top + rect.height + MARGIN), left: clampX(rect.left) };
  }
}

interface Props {
  tour: TourApi;
  theme: Theme;
  /** Put the step's snippet into the script. Absent where nothing is editable. */
  onInsert?: (snippet: string) => void;
}

export function Tour({ tour, theme, onInsert }: Props) {
  const { step, voice } = tour;
  const rect = useAnchor(step?.anchor ?? null);
  const character = BRANDING[theme].character;
  const cardRef = useRef<HTMLDivElement | null>(null);

  /**
   * Move the mouth with the voice, without telling React about it.
   *
   * Sixty state updates a second would re-render the whole screen sixty times a
   * second; the Workshop is far too big for that and the arena visibly stalls.
   * So the loop writes the amplitude to a CSS variable and flips one attribute,
   * both of which the face is already styled from.
   */
  const { amplitude } = tour;
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      // Scheduled first, so that one bad frame cannot end the animation for
      // the rest of the tour. An earlier version bailed out whenever the voice
      // was not currently ready and only restarted if a dependency happened to
      // change again — which left the face frozen mid-tour while the audio
      // carried on playing behind it, and made the helper look broken when it
      // was talking perfectly well.
      frame = requestAnimationFrame(tick);
      const card = cardRef.current;
      if (!card) return;
      try {
        const level = amplitude();
        card.style.setProperty("--amp", level.toFixed(3));
        const face = card.querySelector<SVGElement>(".avatar");
        if (face) face.dataset["state"] = level > 0.02 ? "talking" : "idle";
      } catch {
        // Cosmetic. Never worth interrupting a tour over.
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [amplitude]);

  // Escape leaves, like every other dismissible thing in the game. Confirmed,
  // because losing your place by brushing a key would be worse than a prompt.
  useEffect(() => {
    if (!step) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (window.confirm(`Stop the tour? ${character.name} will not ask again.`)) tour.skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [character.name, step, tour]);

  if (!step) return null;

  const waiting = voice.status === "loading";

  return (
    <>
      {rect ? <Scrim rect={rect} /> : <div className="tour-scrim-full" />}

      <div className="tour-card" ref={cardRef} style={place(rect, step.placement)}>
        <div className="tour-head">
          <Avatar theme={theme} state={waiting ? "thinking" : "idle"} size={40} />
          <div className="tour-who">
            <span className="silkscreen">{character.name}</span>
            <span className="roster-meta">
              Step {tour.index + 1} of {tour.total}
            </span>
          </div>
          <span className="spacer" />
          {voice.status === "ready" ? (
            <button
              type="button"
              className="btn small icon-btn"
              aria-pressed={voice.muted}
              aria-label={voice.muted ? `Let ${character.name} speak` : "Quiet, please"}
              title={voice.muted ? `Let ${character.name} speak` : "Quiet, please"}
              onClick={tour.toggleMute}
            >
              <Speaker muted={voice.muted} />
            </button>
          ) : null}
        </div>

        {waiting ? (
          <VoiceLoading tour={tour} character={character.name} />
        ) : (
          <>
            <h3 className="tour-title">
              <Copy text={fillVocab(step.title, theme)} />
            </h3>
            <div className="tour-body">
              <Copy text={fillVocab(step.body, theme)} />
            </div>

            <div className="tour-actions">
              {step.insert && onInsert ? (
                <button
                  type="button"
                  className="btn small primary"
                  onClick={() => onInsert(step.insert!.snippet)}
                >
                  {fillVocab(step.insert.label, theme)}
                </button>
              ) : null}
              {step.gate.kind === "next" ? (
                <button
                  type="button"
                  className="btn small primary"
                  onClick={() => tour.signal({ kind: "next" })}
                >
                  Next
                </button>
              ) : null}
              <span className="spacer" />
              <button type="button" className="btn small" onClick={tour.skip}>
                Skip the tour
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/**
 * The wait for the voice.
 *
 * Shown as the helper getting ready rather than as a spinner, and always with a
 * way past it: a voice is a nicety and must never be the reason somebody cannot
 * start playing.
 */
function VoiceLoading({ tour, character }: { tour: TourApi; character: string }) {
  const percent = tour.voice.progress === null ? null : Math.round(tour.voice.progress * 100);
  return (
    <>
      <div className="tour-body">
        <p>
          {character} is finding their voice — a one-off download of a few dozen megabytes,
          kept for next time.
        </p>
      </div>
      <div className="progress">
        {/* The fill is the `i`, not the bar: `.progress-bar` is the track, and
            it is `flex: 1`, so a width set on it is ignored and the bar never
            moves however honest the percentage next to it is. */}
        <div className="progress-bar">
          <i style={{ width: `${percent ?? 4}%` }} />
        </div>
      </div>
      <div className="tour-actions">
        <span className="roster-meta">{percent === null ? "Starting…" : `${percent}%`}</span>
        <span className="spacer" />
        <button type="button" className="btn small" onClick={tour.giveUpOnVoice}>
          Carry on without the voice
        </button>
      </div>
    </>
  );
}

/** Four rectangles around the anchor, leaving it lit and clickable. */
function Scrim({ rect }: { rect: Rect }) {
  const pad = 6;
  const top = Math.max(0, rect.top - pad);
  const left = Math.max(0, rect.left - pad);
  const right = rect.left + rect.width + pad;
  const bottom = rect.top + rect.height + pad;

  return (
    <>
      <div className="tour-scrim" style={{ top: 0, left: 0, right: 0, height: top }} />
      <div className="tour-scrim" style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
      <div className="tour-scrim" style={{ top, left: 0, width: left, height: bottom - top }} />
      <div className="tour-scrim" style={{ top, left: right, right: 0, height: bottom - top }} />
      <div
        className="tour-halo"
        style={{ top, left, width: right - left, height: bottom - top }}
      />
    </>
  );
}
