/**
 * Three, two, one — Fight! (or Survive!, in the microcosm.)
 *
 * Purely presentational. Each peer runs its own countdown locally rather than
 * being told when to start, which is the right call: the simulation is
 * deterministic and identical everywhere, so the only thing being synchronised
 * is the drama. They all begin within a few milliseconds of each other because
 * they all received the same `start` message, and nothing depends on that being
 * exact.
 */

import { useEffect, useRef, useState } from "react";
import { BRANDING } from "./branding.js";
import type { Theme } from "../lang/vocab.js";

interface Props {
  theme: Theme;
  onDone: () => void;
}

/** Milliseconds each number is held, and then the cry. */
const BEAT = 700;
const CRY = 900;

export function Countdown({ theme, onDone }: Props) {
  const [step, setStep] = useState(3);
  const cry = BRANDING[theme].battleCry;

  /**
   * Held in a ref so the timer depends only on the beat.
   *
   * The screen around this one re-renders several times a second while a match
   * is on screen, which means a plain callback prop arrives with a new identity
   * each time. Depending on it would cancel and restart the timer before it
   * could ever fire, and the countdown would sit on "3" forever.
   */
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const timer = window.setTimeout(
      () => {
        if (step === 0) doneRef.current();
        else setStep((current) => current - 1);
      },
      step === 0 ? CRY : BEAT,
    );
    return () => window.clearTimeout(timer);
  }, [step]);

  return (
    <div className="countdown" role="status" aria-live="assertive">
      {/* Keyed so each beat replays the animation rather than sitting still. */}
      <span key={step} className={step === 0 ? "countdown-cry" : "countdown-value"}>
        {step === 0 ? cry : step}
      </span>
    </div>
  );
}
