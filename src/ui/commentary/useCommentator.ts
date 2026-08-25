/**
 * The commentator, as something a screen can mount.
 *
 * Casting note: the commentator is the *other* character. A player in the
 * mechanical world is taught by Sprocket and commentated by Pip, and the other
 * way round in biology. It costs nothing but a lookup, and it keeps the two
 * jobs apart — the helper explains, the commentator reacts, and they are
 * audibly different people.
 *
 * Captions do not wait for the voice. The words appear whether or not anybody
 * has downloaded a second model, which means the feature works immediately, in
 * a silent classroom, and on a browser that cannot synthesise at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Commentator, type Beat } from "../../sim/commentary.js";
import { phrase } from "./lines.js";
import { Speaker, createVoice } from "../character/speech.js";
import { BRANDING, type Character } from "../branding.js";
import { Tours } from "../../store/tour.js";
import type { World } from "../../sim/types.js";
import type { Theme } from "../../lang/vocab.js";

/** How many lines stay on screen. Enough to catch up, not a transcript. */
const KEPT = 3;

export interface Caption {
  id: number;
  text: string;
}

export interface CommentaryApi {
  /** Who is calling it — the character from the world the player did not pick. */
  presenter: Character;
  /** The world they belong to, so their face is drawn correctly. */
  presenterTheme: Theme;
  on: boolean;
  captions: readonly Caption[];
  /** Hand to `MatchCanvas`. Does nothing at all when commentary is off. */
  onTick: (world: World) => void;
  /** Say something that did not come from watching a match. */
  announce: (beat: Beat) => void;
  /** Everything left to say once a match is over. */
  flush: (tick: number) => void;
  /** Forget the match just watched, before watching another. */
  reset: () => void;
}

/** The character from the world the player is not in. */
export function presenterFor(theme: Theme): { character: Character; theme: Theme } {
  const other: Theme = theme === "mechanical" ? "biological" : "mechanical";
  return { character: BRANDING[other].character, theme: other };
}

export function useCommentator(theme: Theme, seed: number): CommentaryApi {
  const tours = useMemo(() => new Tours(), []);
  const [on] = useState(() => tours.commentary());
  const { character, theme: presenterTheme } = useMemo(() => presenterFor(theme), [theme]);

  const [captions, setCaptions] = useState<readonly Caption[]>([]);
  const commentator = useRef(new Commentator());
  const speaker = useRef<Speaker | null>(null);
  const nextId = useRef(0);

  // The second voice is fetched only for somebody who asked for commentary,
  // and never before. Captions carry the feature until it arrives — and carry
  // it entirely if it never does.
  useEffect(() => {
    if (!on || tours.muted()) return;
    const instance = new Speaker(createVoice(character));
    speaker.current = instance;
    void instance.load();
    return () => {
      instance.dispose();
      if (speaker.current === instance) speaker.current = null;
    };
  }, [character, on, tours]);

  const say = useCallback(
    (beat: Beat, tick: number) => {
      const text = phrase(beat, theme, seed + tick);
      setCaptions((current) => [...current, { id: nextId.current++, text }].slice(-KEPT));
      void speaker.current?.say(text);
    },
    [seed, theme],
  );

  const onTick = useCallback(
    (world: World) => {
      if (!on) return;
      commentator.current.observe(world);
      const beat = commentator.current.take(world.tick);
      if (beat) say(beat, world.tick);
    },
    [on, say],
  );

  const flush = useCallback(
    (tick: number) => {
      if (!on) return;
      // The death that ended the match and the result are two separate lines,
      // and a loop that stops the moment the match is over has only heard the
      // first of them.
      for (let beat = commentator.current.take(tick); beat; beat = commentator.current.take(tick)) {
        say(beat, tick);
      }
    },
    [on, say],
  );

  const announce = useCallback(
    (beat: Beat) => {
      if (!on) return;
      say(beat, nextId.current);
    },
    [on, say],
  );

  const reset = useCallback(() => {
    commentator.current = new Commentator();
    setCaptions([]);
  }, []);

  return { presenter: character, presenterTheme, on, captions, onTick, announce, flush, reset };
}
