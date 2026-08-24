/**
 * Running a tour: which step, what advances it, and the voice that reads it.
 *
 * The screen being toured knows nothing about any of this beyond two things:
 * it renders `<Tour>`, and it calls `signal()` when something happens. Whether
 * that something matters is decided by `steps.ts`, which is why the rule is
 * testable and this file is only plumbing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tours, type TourId } from "../../store/tour.js";
import { TOURS, isSatisfied, type TourSignal, type TourStep } from "./steps.js";
import { Speaker, createVoice } from "../character/speech.js";
import { BRANDING } from "../branding.js";
import { fillVocab } from "../../learn/markdown.js";
import type { Theme } from "../../lang/vocab.js";

export type VoiceStatus = "off" | "loading" | "ready" | "unavailable";

export interface TourApi {
  /** The step being shown, or null when no tour is running. */
  step: TourStep | null;
  index: number;
  total: number;
  /** Tell the tour something happened. Safe to call when no tour is running. */
  signal: (signal: TourSignal) => void;
  skip: () => void;
  /** Start it, or start it again. */
  begin: () => void;
  /** Already done or declined, so it should not be offered again. */
  settled: boolean;
  voice: { status: VoiceStatus; progress: number | null; muted: boolean };
  toggleMute: () => void;
  /** Give up waiting for the voice and read the rest in silence. */
  giveUpOnVoice: () => void;
  /**
   * How loud the helper is right now, 0 to 1, read on demand.
   *
   * Deliberately a function rather than a piece of state. The face is redrawn
   * from this sixty times a second, and putting that in state re-rendered the
   * whole Workshop on every frame — which froze the editor solid and made the
   * arena run at about one frame a second. The overlay reads it in its own
   * animation loop and writes it straight to the DOM instead.
   */
  amplitude: () => number;
}

export function useTour(id: TourId, theme: Theme, enabled = true): TourApi {
  const tours = useMemo(() => new Tours(), []);
  const steps = TOURS[id];
  const character = BRANDING[theme].character;

  const [stepId, setStepId] = useState<string | null>(() => {
    const state = tours.state(id);
    return typeof state === "object" ? state.step : null;
  });
  const [settled, setSettled] = useState(() => tours.isSettled(id));
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("off");
  const [progress, setProgress] = useState<number | null>(null);
  const [muted, setMuted] = useState(() => tours.muted());

  const speaker = useRef<Speaker | null>(null);
  const index = stepId === null ? -1 : steps.findIndex((s) => s.id === stepId);
  const step = index >= 0 ? steps[index]! : null;

  // --- the voice -----------------------------------------------------------

  // Downloading starts as soon as a tour does, and the first step waits on it.
  // Nothing is fetched for somebody who never takes a tour.
  useEffect(() => {
    if (!enabled || stepId === null || speaker.current) return;
    const instance = new Speaker(createVoice(character));
    speaker.current = instance;
    setVoiceStatus("loading");

    void instance
      .load((p) => setProgress(p.fraction))
      .then((ok) => {
        if (speaker.current !== instance) return;
        setVoiceStatus(ok ? "ready" : "unavailable");
      });

    return () => {
      instance.dispose();
      if (speaker.current === instance) speaker.current = null;
    };
  }, [character, enabled, stepId !== null]);

  // Read the step out when it changes, and get the next one ready while this
  // one plays so that pressing Next is not followed by a pause.
  useEffect(() => {
    const instance = speaker.current;
    if (!instance || voiceStatus !== "ready" || !step) return;
    if (muted) {
      instance.stop();
      return;
    }
    void instance.say(fillVocab(`${step.title}. ${step.body}`, theme));
    const next = steps[index + 1];
    if (next) void instance.prepare(fillVocab(`${next.title}. ${next.body}`, theme));
  }, [index, muted, step, steps, theme, voiceStatus]);

  const amplitude = useCallback(
    () => (voiceStatus === "ready" && !muted ? (speaker.current?.amplitude() ?? 0) : 0),
    [muted, voiceStatus],
  );

  // --- moving through it ---------------------------------------------------

  const finish = useCallback(() => {
    tours.finish(id);
    setStepId(null);
    setSettled(true);
    speaker.current?.stop();
  }, [id, tours]);

  const advance = useCallback(() => {
    const next = steps[index + 1];
    if (!next) {
      finish();
      return;
    }
    tours.advanceTo(id, next.id);
    setStepId(next.id);
  }, [finish, id, index, steps, tours]);

  const signal = useCallback(
    (event: TourSignal) => {
      if (!step) return;
      if (!isSatisfied(step.gate, event)) return;
      advance();
    },
    [advance, step],
  );

  const skip = useCallback(() => {
    tours.skip(id);
    setStepId(null);
    setSettled(true);
    speaker.current?.stop();
  }, [id, tours]);

  const begin = useCallback(() => {
    const first = steps[0];
    if (!first) return;
    tours.begin(id, first.id);
    setStepId(first.id);
    setSettled(false);
  }, [id, steps, tours]);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      tours.setMuted(next);
      if (next) speaker.current?.stop();
      return next;
    });
  }, [tours]);

  const giveUpOnVoice = useCallback(() => setVoiceStatus("unavailable"), []);

  return {
    step,
    index,
    total: steps.length,
    signal,
    skip,
    begin,
    settled,
    voice: { status: voiceStatus, progress, muted },
    toggleMute,
    giveUpOnVoice,
    amplitude,
  };
}
