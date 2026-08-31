/**
 * The little card that says you just did something.
 *
 * This is the part of the quest system a player actually feels. The log tells
 * you what to do; the toast tells you it worked, and it is the only moment in
 * the game where the helper speaks unprompted about your own progress.
 *
 * Three rules, all of them about not becoming wallpaper:
 *
 *  - **One at a time.** A queue, not a stack. Two cards sliding over each other
 *    is a notification centre, and nobody reads a notification centre.
 *  - **Never over a fight.** A countdown or a fullscreen match holds the queue
 *    until it is over. Congratulating somebody for adding a `fire` line while
 *    they are watching that line miss is the worst possible timing.
 *  - **Quiet when asked.** The same mute that silences the commentator and the
 *    tour silences these, because a child who has turned the noise off has
 *    turned the noise off.
 */

import { useEffect, useState } from "react";
import { Avatar } from "../character/Avatar.js";
import type { Celebration } from "./useQuests.js";
import type { Theme } from "../../lang/vocab.js";

/** How long a card stays before it goes on its own, per kind. */
const DWELL_MS: Record<Celebration["kind"], number> = {
  step: 2600,
  // A finished quest names its reward, which is a sentence rather than a tick.
  quest: 4200,
  // The level-up is not dismissed on a timer at all; it waits to be answered.
  levelUp: 0,
};

interface Props {
  queue: readonly Celebration[];
  onDismiss: (id: number) => void;
  theme: Theme;
  /**
   * Hold the queue. True during a countdown or a fullscreen match — the cards
   * wait rather than being dropped, because the thing they are congratulating
   * is usually the reason the fight is happening.
   */
  paused?: boolean;
  /** Read the line aloud. Omitted when narration is off. */
  speak?: (text: string) => void;
  /** Answering a level-up offer. */
  onLevelUp?: () => void;
  onDeclineLevelUp?: () => void;
}

export function QuestToasts({
  queue,
  onDismiss,
  theme,
  paused = false,
  speak,
  onLevelUp,
  onDeclineLevelUp,
}: Props) {
  const showing = paused ? undefined : queue[0];
  const id = showing?.id;
  const [leaving, setLeaving] = useState(false);

  // Say it once, when it appears — not on every re-render of the parent.
  useEffect(() => {
    if (showing && speak) speak(showing.text);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLeaving(false);
    if (!showing) return;
    const dwell = DWELL_MS[showing.kind];
    if (dwell === 0) return;
    // Two timers: one to start the fade, one to actually drop it, so the card
    // is not yanked out from under its own exit animation.
    const fade = window.setTimeout(() => setLeaving(true), dwell);
    const drop = window.setTimeout(() => onDismiss(showing.id), dwell + 320);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(drop);
    };
  }, [id, onDismiss, showing]);

  if (!showing) return null;

  const isLevelUp = showing.kind === "levelUp";

  return (
    <div
      className={`quest-toasts${leaving ? " leaving" : ""}`}
      // Polite, not assertive: this is good news, never an interruption, and a
      // screen reader should finish the sentence it is on first.
      role="status"
      aria-live="polite"
    >
      <div className={`quest-toast ${showing.kind}`}>
        <span className="quest-toast-face" aria-hidden="true">
          <Avatar theme={theme} state="pleased" size={isLevelUp ? 52 : 36} />
        </span>

        <span className="quest-toast-body">
          <span className="quest-toast-icon" aria-hidden="true">
            {showing.icon}
          </span>
          <span className="quest-toast-text">{showing.text}</span>

          {showing.pips ? (
            <span
              className="quest-pips"
              aria-label={`${showing.pips.done} of ${showing.pips.total} done`}
            >
              {Array.from({ length: showing.pips.total }, (_, i) => (
                <i key={i} className={i < showing.pips!.done ? "on" : ""} />
              ))}
            </span>
          ) : null}

          {isLevelUp ? (
            <span className="quest-toast-actions">
              <button type="button" className="btn primary" onClick={onLevelUp}>
                Yes, show me
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onDeclineLevelUp?.();
                  onDismiss(showing.id);
                }}
              >
                Not yet
              </button>
            </span>
          ) : null}
        </span>

        {/* Dismissable by hand as well as by timer. A card that can only be
            waited out is a card that is in the way. */}
        {isLevelUp ? null : (
          <button
            type="button"
            className="quest-toast-close"
            aria-label="Dismiss"
            onClick={() => onDismiss(showing.id)}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
