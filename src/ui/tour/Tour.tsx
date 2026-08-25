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
import type { EditorView } from "@codemirror/view";
import { placeCard, type Box } from "./placement.js";
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

/** Read an element's box in viewport coordinates, or null if it is not there. */
function measure(anchor: string): Box | null {
  const node = document.querySelector(`[data-tour="${anchor}"]`);
  if (!node) return null;
  const box = node.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === null || b === null) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/**
 * The box around the lines the editor is currently lighting up.
 *
 * CodeMirror reports line geometry relative to the top of the document, so it
 * is converted against the content element's own box. Measured on the same
 * animation frame loop as everything else, which is what makes it follow
 * scrolling and typing without anyone having to say when.
 */
function useCodeAnchor(
  viewRef: React.MutableRefObject<EditorView | null> | undefined,
  range: { from: number; to: number } | null,
): Box | null {
  const [rect, setRect] = useState<Box | null>(null);
  const key = range ? `${range.from}:${range.to}` : "";

  useLayoutEffect(() => {
    if (!viewRef || key === "") {
      setRect((current) => (current === null ? current : null));
      return;
    }
    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const view = viewRef.current;
      const [from, to] = key.split(":").map(Number) as [number, number];
      let next: Box | null = null;
      if (view && to <= view.state.doc.length) {
        const content = view.contentDOM.getBoundingClientRect();
        const first = view.lineBlockAt(from);
        const last = view.lineBlockAt(to);
        next = {
          top: content.top + first.top,
          left: content.left,
          width: content.width,
          height: Math.max(first.bottom, last.bottom) - first.top,
        };
      }
      setRect((current) => (sameBox(current, next) ? current : next));
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [key, viewRef]);

  return rect;
}

/**
 * The boxes this step has asked the player to look at, followed live.
 *
 * Same polling loop and same identity-preserving update as the anchor: these
 * feed the placement scorer every frame, and a new array each frame would move
 * the card on every frame too.
 */
function useKeepClear(anchors: readonly string[]): Box[] {
  const key = anchors.join(",");
  const [boxes, setBoxes] = useState<Box[]>([]);

  useLayoutEffect(() => {
    if (key === "") {
      setBoxes((current) => (current.length === 0 ? current : []));
      return;
    }
    const names = key.split(",");
    let frame = 0;
    const loop = () => {
      const next = names.map(measure).filter((b): b is Box => b !== null);
      setBoxes((current) =>
        current.length === next.length && current.every((b, i) => sameBox(b, next[i]!))
          ? current
          : next,
      );
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [key]);

  return boxes;
}

/** Follow an element's box as the page moves under it. */
function useAnchor(anchor: string | null): Box | null {
  const [rect, setRect] = useState<Box | null>(null);

  useLayoutEffect(() => {
    if (!anchor) {
      setRect(null);
      return;
    }

    let frame = 0;
    // The anchor may not be mounted yet — a tab the step is about to ask for.
    // Polling on the animation frame covers that as well as scrolling, resizing
    // and panels opening, without needing to know which of them happened.
    // Returning the same object when nothing moved avoids re-rendering the
    // screen sixty times a second on a page that is sitting still.
    const loop = () => {
      const next = measure(anchor);
      setRect((current) => (sameBox(current, next) ? current : next));
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [anchor]);

  return rect;
}

const CARD = { width: 340, height: 260 };

/** Module level, so an absent `keepClear` is not a new array every render. */
const EMPTY: readonly string[] = [];

interface Props {
  tour: TourApi;
  theme: Theme;
  /**
   * The live editor, so a step about two lines of code can point at those two
   * lines rather than at five hundred pixels of panel.
   */
  editorView?: React.MutableRefObject<EditorView | null>;
  /** Document range currently lit up, matching what the editor was told. */
  spotlight?: { from: number; to: number } | null;
  /** So the helper can greet somebody by name rather than at them. */
  playerName?: string;
  /** Put the step's snippet into the script. Absent where nothing is editable. */
  onInsert?: (snippet: string) => void;
}

export function Tour({ tour, theme, playerName, editorView, spotlight, onInsert }: Props) {
  const { step, voice } = tour;
  const elementRect = useAnchor(step?.anchor ?? null);
  const codeRect = useCodeAnchor(editorView, spotlight ?? null);
  // The lines win when they are on screen; the panel is the fallback for a
  // step whose code the player has since deleted or rewritten.
  const rect = codeRect ?? elementRect;
  const keepClear = useKeepClear(step?.keepClear ?? EMPTY);
  const character = BRANDING[theme].character;
  const cardRef = useRef<HTMLDivElement | null>(null);

  /** The vocabulary substitutions, plus the two names `fillVocab` cannot know. */
  const say = (text: string) =>
    fillVocab(text, theme)
      .replaceAll("{name}", playerName?.trim() || "there")
      .replaceAll("{helper}", character.name);

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
      {rect ? (
        <Scrim rect={rect} keepClear={keepClear} />
      ) : (
        <div className="tour-scrim-full" />
      )}

      <div
        className="tour-card"
        ref={cardRef}
        style={placeCard(rect, keepClear, CARD, {
          width: window.innerWidth,
          height: window.innerHeight,
        }, step.placement)}
      >
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
              <Copy text={say(step.title)} />
            </h3>
            <div className="tour-body">
              <Copy text={say(step.body)} />
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

/**
 * Four rectangles around what matters, leaving it lit and clickable.
 *
 * "What matters" is the anchor together with anything the step asked the
 * player to watch, so the arena is not dimmed while somebody is being told to
 * look at it. Four rectangles around the union rather than a mask with several
 * holes: it keeps the lit region clickable, which the whole design depends on,
 * and the extra strip of undimmed screen between the two costs nothing.
 *
 * The halo stays on the anchor alone — it is pointing, not framing.
 */
function Scrim({ rect, keepClear }: { rect: Box; keepClear: readonly Box[] }) {
  const pad = 6;
  const lit = [rect, ...keepClear];
  const top = Math.max(0, Math.min(...lit.map((b) => b.top)) - pad);
  const left = Math.max(0, Math.min(...lit.map((b) => b.left)) - pad);
  const right = Math.max(...lit.map((b) => b.left + b.width)) + pad;
  const bottom = Math.max(...lit.map((b) => b.top + b.height)) + pad;
  const halo = {
    top: Math.max(0, rect.top - pad),
    left: Math.max(0, rect.left - pad),
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };

  return (
    <>
      <div className="tour-scrim" style={{ top: 0, left: 0, right: 0, height: top }} />
      <div className="tour-scrim" style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
      <div className="tour-scrim" style={{ top, left: 0, width: left, height: bottom - top }} />
      <div className="tour-scrim" style={{ top, left: right, right: 0, height: bottom - top }} />
      <div className="tour-halo" style={halo} />
    </>
  );
}
