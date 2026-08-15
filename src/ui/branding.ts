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
  },
  biological: {
    prefix: "Bio",
    suffix: "Battle",
    full: "BioBattle",
    strap: "Program a cell in a little language of its own. Then find out whose survives.",
    blurb:
      "Ciliates and flagellates. Cilia, flagella, stingers and darts. The same game, in the language of the microscope.",
    battleCry: "Survive!",
  },
};

/** The fixed name, for anywhere a choice has not been made yet. */
export const DEFAULT_BRANDING = BRANDING.mechanical;

export function branding(theme: Theme | null): Branding {
  return theme ? BRANDING[theme] : DEFAULT_BRANDING;
}
