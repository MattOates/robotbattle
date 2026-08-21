/**
 * Themed vocabulary.
 *
 * RoboBattle can be taught as robotics or as biology. Rather than forking the
 * language, we keep ONE canonical grammar and let the lexer rewrite synonyms
 * into it. A biological script and its mechanical translation therefore produce
 * byte-identical bytecode and identical physics — the theme is art and wording,
 * never a balance difference.
 *
 * Both vocabularies always parse, in any arena theme, so nobody's script breaks
 * for being written in the "wrong" words.
 *
 * One table drives both directions: the lexer reads it to canonicalise what was
 * typed, and the editor reads it to decide which words to *suggest*. A single
 * source means autocomplete can never offer a word the parser would reject.
 */

export type Theme = "mechanical" | "biological";

export interface Synonym {
  /** The word the parser and compiler actually see. */
  canonical: string;
  mechanical: string;
  biological: string;
  /** Extra spellings that are accepted but never suggested. */
  also?: readonly string[];
}

export const SYNONYMS: readonly Synonym[] = [
  // `body` and `chassis` are interchangeable everywhere, so both
  // `body ciliate` and `turn body by 90` read naturally.
  { canonical: "chassis", mechanical: "chassis", biological: "body" },
  {
    canonical: "skid",
    mechanical: "tank",
    biological: "ciliate",
    also: ["tracks", "cilia"],
  },
  {
    canonical: "steered",
    mechanical: "car",
    biological: "flagellate",
    also: ["wheels", "flagellum"],
  },
  { canonical: "drive", mechanical: "drive", biological: "swim" },
  { canonical: "turret", mechanical: "turret", biological: "stinger" },
  { canonical: "fire", mechanical: "fire", biological: "sting" },
  // The second sense: a narrow beam you aim and send out deliberately, as
  // against the wide cone that simply reports what wanders into it.
  {
    canonical: "radar",
    mechanical: "radar",
    biological: "eyespot",
    also: ["ocellus"],
  },
  { canonical: "ping", mechanical: "ping", biological: "peek", also: ["glance"] },
  // The one consumable in the arena. A robot refuels; an organism feeds.
  { canonical: "fuel", mechanical: "fuel", biological: "food", also: ["nutrient"] },
  // The shape of the ground. One field, two readings: a machine climbs a hill,
  // an organism shoves through goop, and both are fighting the same gradient.
  { canonical: "slope", mechanical: "slope", biological: "thickness", also: ["gradient"] },
  // The two ways along that gradient. A machine climbs or descends; an organism
  // pushes into thicker goop or slips out into thinner. Same two directions.
  // What stopped the beam. A machine's line of sight ends at a ridge; an
  // organism's peek ends where the goop gets too thick to see through.
  { canonical: "ridge", mechanical: "ridge", biological: "murk" },
  { canonical: "uphill", mechanical: "uphill", biological: "thickest" },
  { canonical: "downhill", mechanical: "downhill", biological: "thinnest" },
  {
    canonical: "bullet",
    mechanical: "bullet",
    biological: "dart",
    also: ["nematocyst"],
  },
  {
    canonical: "robot",
    mechanical: "robot",
    biological: "organism",
    also: ["cell", "creature"],
  },
];

/**
 * Word-level synonyms, resolved during lexing. A synonym may expand to several
 * canonical words, which is how `stung` becomes `hit by bullet`.
 */
export const WORD_ALIASES: Readonly<Record<string, readonly string[]>> = (() => {
  const table: Record<string, readonly string[]> = {
    // The one multi-word shorthand: too good a word to give up for the sake of
    // a uniform table.
    stung: ["hit", "by", "bullet"],
  };
  for (const s of SYNONYMS) {
    for (const spelling of [s.mechanical, s.biological, ...(s.also ?? [])]) {
      if (spelling !== s.canonical) table[spelling] = [s.canonical];
    }
  }
  return table;
})();

/** Look up the word to *show* for a canonical word in a given theme. */
export function wordFor(canonical: string, theme: Theme): string {
  const found = SYNONYMS.find((s) => s.canonical === canonical);
  if (!found) return canonical;
  return theme === "biological" ? found.biological : found.mechanical;
}

/** Render a canonical multi-word phrase in a theme's words. */
export function phraseFor(canonical: string, theme: Theme): string {
  // `on stung` is far friendlier than `on hit by bullet` in biology words.
  if (theme === "biological" && canonical === "hit by bullet") return "stung";
  return canonical
    .split(" ")
    .map((w) => wordFor(w, theme))
    .join(" ");
}

/**
 * Property synonyms, resolved when a `me.<prop>` access is compiled.
 * Kept separate from WORD_ALIASES because `health` should not be rewritten
 * when it appears as a plain variable name.
 */
export const PROPERTY_ALIASES: Readonly<Record<string, string>> = {
  eyespot: "radar",
  ocellus: "radar",
  peekheat: "pingheat",
  vitality: "health",
  integrity: "health",
  energy: "health",
  hp: "health",
  facing: "heading",
};

/**
 * Display wording per theme. Purely cosmetic: HUD labels, tutorial copy and
 * editor autocomplete. Nothing here reaches the simulation.
 */
export interface ThemeVocab {
  readonly theme: Theme;
  readonly robot: string;
  readonly robotPlural: string;
  readonly bullet: string;
  readonly health: string;
  readonly skidName: string;
  readonly steeredName: string;
  readonly weapon: string;
  readonly fireVerb: string;
  /** The narrow, aimable sense: radar dish or eyespot. */
  readonly scanner: string;
  readonly pingVerb: string;
  readonly driveVerb: string;
  /** The consumable scattered about: fuel cells or morsels of food. */
  readonly fuel: string;
  /** The gradient of the ground: a slope to climb, or goop to shove through. */
  readonly slope: string;
  /** The stuff underneath you: ground, or the fluid you are suspended in. */
  readonly ground: string;
  /** Which way the going gets harder. Its opposite is where you want to be. */
  readonly uphill: string;
  readonly downhill: string;
  readonly arena: string;
  /** More than one of them. Saved arenas are listed, so the plural is needed. */
  readonly arenaPlural: string;
  /**
   * What a reusable `can ... given` block is called.
   *
   * Here rather than as a ternary at the one call site, because there are now
   * three "Your ..." shelves in the Workshop sidebar and they should all get
   * their heading from the same table.
   */
  readonly blockPlural: string;
}

export const THEMES: Readonly<Record<Theme, ThemeVocab>> = {
  mechanical: {
    theme: "mechanical",
    robot: "robot",
    robotPlural: "robots",
    bullet: "bullet",
    health: "integrity",
    skidName: "tracks",
    steeredName: "wheels",
    weapon: "turret",
    fireVerb: "fire",
    scanner: "radar",
    pingVerb: "ping",
    driveVerb: "drive",
    fuel: "fuel",
    slope: "slope",
    ground: "ground",
    uphill: "uphill",
    downhill: "downhill",
    arena: "arena",
    arenaPlural: "arenas",
    blockPlural: "blocks",
  },
  biological: {
    theme: "biological",
    robot: "organism",
    robotPlural: "organisms",
    bullet: "dart",
    health: "vitality",
    skidName: "cilia",
    steeredName: "flagellum",
    weapon: "stinger",
    fireVerb: "sting",
    scanner: "eyespot",
    pingVerb: "peek",
    driveVerb: "swim",
    fuel: "food",
    slope: "thickness",
    ground: "goop",
    uphill: "thickest",
    downhill: "thinnest",
    arena: "microcosm",
    arenaPlural: "microcosms",
    blockPlural: "behaviours",
  },
};

/** Expand a word through the alias table. Returns the canonical word(s). */
export function canonicalizeWord(word: string): readonly string[] {
  return WORD_ALIASES[word] ?? [word];
}

export function canonicalizeProperty(prop: string): string {
  return PROPERTY_ALIASES[prop] ?? prop;
}

/** The health property under the theme's own name, for `me.<x>` suggestions. */
export function healthPropertyFor(theme: Theme): string {
  return theme === "biological" ? "vitality" : "health";
}
