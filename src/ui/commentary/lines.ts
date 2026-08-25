/**
 * What the commentator actually says.
 *
 * Written by hand rather than generated. The alternative was the in-browser
 * assistant, and a language model is the wrong tool here on three counts: it
 * needs gigabytes loaded before anybody can hear a word, it is slow against a
 * match running at thirty ticks a second, and it can be confidently wrong about
 * a result the player just watched. Authored lines are none of those, and they
 * can be tested.
 *
 * Every line goes through `fillVocab`, so the same beat reads correctly whether
 * the fight is between robots or organisms. A test forbids an unfilled
 * placeholder reaching anybody.
 *
 * Variation is chosen from the match seed and the tick, never from a random
 * number — the same match narrated twice says the same words, which is what
 * makes a replay a replay.
 */

import type { Beat } from "../../sim/commentary.js";
import { fillVocab } from "../../learn/markdown.js";
import type { Theme } from "../../lang/vocab.js";

/**
 * Slots are filled after vocabulary substitution, so a {robot}'s *name* can
 * contain a brace without being mistaken for a placeholder.
 *
 * The consequence is that a slot may not be named after a vocabulary word.
 * `{health}` was, and "{health} left" came out as "integrity left" — valid
 * prose, wrong sentence, and invisible to a test looking for leftover braces.
 * `SLOT_NAMES` below is checked against the vocabulary so it cannot recur.
 */
type Slots = Record<string, string | number>;

const LINES: Record<Beat["kind"], readonly string[]> = {
  start: [
    "And we are away — {who} on the floor.",
    "Here we go. {who}, and nobody has thrown a punch yet.",
    "{who}. Let us see what they have brought.",
  ],
  firstBlood: [
    "First blood to {by} — {on} felt that one.",
    "And {by} opens the scoring on {on}.",
    "There it is! {by} lands the first on {on}.",
  ],
  hit: [
    "{by} catches {on} again.",
    "Another one on {on}, and {by} is finding the range.",
    "{by} puts {damage} more into {on}.",
    "{on} takes another. That is going to add up.",
  ],
  kill: [
    "{on} is gone! {by} did that.",
    "And that is the end of {on} — {by} with the finish.",
    "{by} destroys {on}. {remaining} left standing.",
  ],
  selfDestruct: [
    "{who} has driven itself to bits. Nobody laid a finger on it.",
    "And {who} is out — beaten by the wall, of all things.",
    "{who} goes out the embarrassing way, into the scenery.",
  ],
  limping: [
    "{who} is in real trouble — {hp} left.",
    "{who} is limping badly now.",
    "Not much left of {who}. {hp}, and fading.",
  ],
  advance: [
    "{who} goes through, past {over}. That is the {round} settled.",
    "And it is {who} who advances — {over} is out.",
    "{who} takes the {round} from {over}.",
  ],
  champion: [
    "And there it is — {who} wins the whole thing!",
    "{who}! Champion, and deservedly so.",
    "That is the tournament. {who} takes it all.",
  ],
  end: [
    "That is it! {winner} takes it.",
    "And it is over — {winner} wins it.",
    "{winner}! After {seconds} seconds, that is the match.",
  ],
};

/** What is left when there is nobody to declare. */
const MUTUAL: readonly string[] = [
  "Everybody is out. Nobody wins that one.",
  "And they have wiped each other out. No winner.",
];

/**
 * A small deterministic spread over the phrasings.
 *
 * Not `Math.random`: a replay has to say the same words twice, and the world's
 * own generator is off limits because drawing from it would change the match.
 */
function pick<T>(options: readonly T[], seed: number): T {
  const mixed = Math.abs(Math.imul(seed | 0, 2654435761) >>> 0);
  return options[mixed % options.length]!;
}

function slotsFor(beat: Beat): Slots {
  switch (beat.kind) {
    case "start":
      return { who: humanList(beat.names) };
    case "firstBlood":
      return { by: beat.by, on: beat.on };
    case "hit":
      return { by: beat.by, on: beat.on, damage: Math.round(beat.damage) };
    case "kill":
      return { by: beat.by, on: beat.on, remaining: beat.remaining };
    case "selfDestruct":
      return { who: beat.who };
    case "limping":
      // `hp` rather than `health`, which is a vocabulary word: `fillVocab`
      // runs first and would turn "{health} left" into "integrity left".
      return { who: beat.who, hp: beat.health };
    case "advance":
      return { who: beat.who, over: beat.over, round: beat.round };
    case "champion":
      return { who: beat.who };
    case "end":
      // Ticks are meaningless to a listener; seconds are not.
      return { winner: beat.winner ?? "", seconds: Math.round(beat.ticks / 30) };
  }
}

/** "A, B and C" — because "A, B, C" read aloud sounds like a list of parts. */
export function humanList(names: readonly string[]): string {
  if (names.length === 0) return "nobody";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Turn a beat into a sentence.
 *
 * `seed` should be the match seed combined with something that moves — the tick
 * will do — so that consecutive remarks of the same kind are not identical but
 * the same match always reads the same way.
 */
export function phrase(beat: Beat, theme: Theme, seed: number): string {
  const options = beat.kind === "end" && beat.winner === null ? MUTUAL : LINES[beat.kind];
  const template = pick(options, seed);
  const slots = slotsFor(beat);
  return fillVocab(template, theme).replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in slots ? String(slots[key]) : whole,
  );
}

/**
 * Every slot these templates use.
 *
 * Exported so a test can assert none of them is also a vocabulary placeholder,
 * which is a collision that produces plausible nonsense rather than an error.
 */
export const SLOT_NAMES: readonly string[] = [
  "who",
  "by",
  "on",
  "damage",
  "remaining",
  "hp",
  "over",
  "round",
  "winner",
  "seconds",
];

/** Every phrasing, for the tests that check all of them read correctly. */
export const ALL_LINES: readonly string[] = [...Object.values(LINES).flat(), ...MUTUAL];
