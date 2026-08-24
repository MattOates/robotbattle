/**
 * The game's name changes with the world you chose to play in.
 *
 * Only the *display* name changes. Storage keys and peer-id prefixes stay
 * `robobattle` forever: they identify saved data and rooms, and renaming them
 * would orphan everyone's robots the first time somebody switched theme.
 */

import type { Theme } from "../lang/vocab.js";

export interface Branding {
  /** Split so the second half can be accented in the wordmark. */
  prefix: string;
  suffix: string;
  full: string;
  /** One line under the title on the menu. */
  strap: string;
  /** How this world is described when choosing between them. */
  blurb: string;
  /** Shouted at the end of the countdown, when a battle begins. */
  battleCry: string;
  /** The helper who runs the tour and fronts the assistant. */
  character: Character;
}

/**
 * The face and voice of the helper, per world.
 *
 * A named character rather than an anonymous "Assistant" because the tour and
 * the assistant are the same helper doing two jobs, and a beginner who was
 * shown around by somebody should find that somebody still there afterwards.
 */
export interface Character {
  name: string;
  /** One line, for the first thing they ever say. */
  greeting: string;
  /**
   * A Piper voice id from the `rhasspy/piper-voices` catalogue.
   *
   * Both are British, and both are the best quality Piper publishes for that
   * voice. Note the asymmetry is forced rather than chosen: `en_GB-cori-high`
   * is the *only* high-tier en_GB voice there is, and it is female. Every
   * British male voice tops out at medium, so Sprocket takes the best of those.
   */
  voiceId: string;
  /** Roughly how much there is to download, for the copy that says so. */
  voiceMB: number;
}

export const BRANDING: Readonly<Record<Theme, Branding>> = {
  mechanical: {
    prefix: "Bot",
    suffix: "Battle",
    full: "BotBattle",
    strap: "Program a robot in a little language of its own. Then find out whose is best.",
    blurb:
      "Tanks and cars. Tracks, wheels, turrets and bullets. Learn to program by building a fighting robot.",
    battleCry: "Fight!",
    character: {
      name: "Sprocket",
      greeting: "Right then. Let us build you a robot.",
      voiceId: "en_GB-alan-medium",
      voiceMB: 63,
    },
  },
  biological: {
    prefix: "Bio",
    suffix: "Battle",
    full: "BioBattle",
    strap: "Program a cell in a little language of its own. Then find out whose survives.",
    blurb:
      "Ciliates and flagellates. Cilia, flagella, stingers and darts. The same game, in the language of the microscope.",
    battleCry: "Survive!",
    character: {
      name: "Pip",
      greeting: "Right then. Let us grow you an organism.",
      voiceId: "en_GB-cori-high",
      voiceMB: 114,
    },
  },
};

/** The fixed name, for anywhere a choice has not been made yet. */
export const DEFAULT_BRANDING = BRANDING.mechanical;

export function branding(theme: Theme | null): Branding {
  return theme ? BRANDING[theme] : DEFAULT_BRANDING;
}
