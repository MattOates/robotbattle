/**
 * What has changed lately, for the person playing rather than the person who
 * wrote it.
 *
 * Kept by hand rather than generated from the git log. The commit subjects in
 * this repository are decent prose, but they are addressed to whoever maintains
 * the simulation — they name files, they justify tuning, and there are a dozen
 * of them behind a single thing a player would notice. What belongs here is the
 * thing you would notice, dated to the day the work landed.
 *
 * The text is written with the same placeholders the language help uses, so a
 * player in the microcosm is told about food and goop rather than fuel and
 * hills. `tests/ui/news.test.ts` holds that line.
 */

import { renderDoc } from "../lang/events.js";
import type { Theme } from "../lang/vocab.js";

export interface NewsEntry {
  /** ISO date of the day the work landed, from the git history. */
  date: string;
  title: string;
  /** Placeholder template, rendered per theme. */
  body: string;
}

/** Newest first, which is the order they are shown in. */
export const NEWS: readonly NewsEntry[] = [
  {
    date: "2026-09-03",
    title: "A button that tidies up",
    body: "The block canvas remembers where you put things, and a Tidy up button lays them out the same way every time: the {robot} itself pinned top left as a heading, the starting work on the line beside it, then the behaviours other blocks call, then a row for each thing that can happen. Where the blocks sit is kept with the {robot} rather than written into the script, so it survives being put away and travels with a copy you give somebody \u2014 which means two people who changed different parts of the same {robot} can see at a glance which parts those were.",
  },
  {
    date: "2026-09-02",
    title: "Why the fight went that way, in pictures",
    body: "After a trial there is a reading of what happened rather than a table of numbers: four moments from the fight, drawn, with a line under each \u2014 and two or three things worth fixing, each with a button that adds the missing piece for you. If your {robot} never fired a shot, it says so, and it says which part was missing.",
  },
  {
    date: "2026-08-31",
    title: "Two people in one canvas",
    body: "Open a session and you can drag blocks around together. Everybody's cursor is on the canvas with their name on it, and the block somebody else is holding is outlined in their colour, so you can see what they are in the middle of instead of finding out afterwards.",
  },
  {
    date: "2026-08-31",
    title: "The whole language, as blocks",
    body: "There is a block editor between Code and Cards, built on Blockly \u2014 the same thing Scratch is made of. It is not a simplified version: everything the language can say has a block, including choosing, repeating, remembering, and behaviours of your own with names and things passed into them. Blocks and text are the same script seen two ways, so you can drag a {robot} together, read it as writing, and every {robot} that came with the game opens in either.",
  },
  {
    date: "2026-08-31",
    title: "Build a {robot} by tapping",
    body: "The youngest way in: a shelf of cards saying when something happens and what to do about it, assembled by tapping, with pickers instead of typing \u2014 a dial for how fast, a compass for which way. It writes the same script everybody else writes, so what a seven-year-old makes opens in the code editor unchanged.",
  },
  {
    date: "2026-08-31",
    title: "Quests, and how much to show",
    body: "It asks how old you are when you first arrive, and how much is on screen follows from the answer \u2014 bigger, brighter and plainer for the youngest, the full instrument for everybody else, and changeable in Settings whenever you like. Instead of six equal cards there is a run of quests that walk you from a sleepy {robot} to winning a fight, opening one part of the game at a time and saying why it was worth having.",
  },
  {
    date: "2026-08-23",
    title: "Sides, and something to say to them",
    body: "The Arena can be fought in sides now, not just everyone against everyone. On a side you can tell who is with you \u2014 every event that reports another {robot} says whether it is one of yours \u2014 and the host decides whether your shots pass through your own or not. The last side standing wins.",
  },
  {
    date: "2026-08-23",
    title: "Everybody can hear you",
    body: "There is a {radio}. One instruction sends a message to every {robot} left alive, and nothing in it says who sent it \u2014 your side hears it, and so does the other one. Telling your own side it was you, without also telling the people you are fighting, is the puzzle, and it is yours to solve. Speaking costs a little {fuel}; listening is free, and nothing you are sent is ever lost.",
  },
  {
    date: "2026-08-23",
    title: "A flock that has never seen itself",
    body: "Two new {robots} to read. Wingman marks its call-outs with a word its side agrees on. Boid is a whole flock: it obeys the three rules that make starlings turn together \u2014 do not crowd, head the way they head, drift towards the middle \u2014 and it does it without ever looking at a single one of them. It knows where they all are because they say so. There is a lesson on each.",
  },
  {
    date: "2026-08-23",
    title: "The bench can field a team",
    body: "The test bench and the Trial will both put several copies of your {robot} on one side now. Some {robots} cannot be measured one at a time: a flock of one does not flock, and one that calls out what it has found has nobody to call to.",
  },
  {
    date: "2026-08-22",
    title: "A book of the rules",
    body: "There is a Reference next to Learn now. Learn takes one idea at a time; the Reference is for when you already know what you want and need to look it up \u2014 every word the language has, drawn as a little map of what may follow what, with what each event tells you, what every function takes, and the numbers behind the world: how long a tick is, how far you can see, how much a shot hurts.",
  },
  {
    date: "2026-08-22",
    title: "The editor shows you the way",
    body: "Under the Workshop editor there is a strip that follows what you are typing. It names the instruction you are part-way through, says what it is for, and lights up the words that could come next \u2014 and you can click one to type it. It reads the same rules the game uses to run your script, so it can never offer you something that would not work.",
  },
  {
    date: "2026-08-21",
    title: "Someone to ask",
    body: "There is a helper in the Workshop now, in a tray that pulls out from the right. Ask it what a word does, what your {robot} does when something happens to it, or for an example you can copy, and it answers out of the lessons. It reads your script and it never changes it \u2014 it shows you what to type and leaves the typing to you. It runs on your own machine, so nothing you write is sent anywhere, and it downloads nothing until you ask it to.",
  },
  {
    date: "2026-08-20",
    title: "Mouse knows the way out",
    body: "A new {robot} to read: Mouse keeps its left hand on the wall and walks, which is the oldest maze rule there is and enough to get round almost all of a labyrinth with no map and no memory. It is the first one to point its {radar} at a wall instead of at people \u2014 a whisker rather than a way of finding someone.",
  },
  {
    date: "2026-08-20",
    title: "Somewhere to fight, not just something to fight with",
    body: "You can build an {arena} now and keep it, the way you keep a {robot}. Draw walls on it, pick its {ground}, or have it generate a whole labyrinth \u2014 then bring it to a Trial, an Arena or a Tournament, or hand it to somebody else. Walls only stop you moving: {bullet}s fly over them and a {ping} sees straight through, so a maze is somewhere you can see across but not drive across.",
  },
  {
    date: "2026-08-19",
    title: "The {ground} has a shape",
    body: "Matches can now be fought over real {ground} instead of a flat floor. Heading into the hard going is slow and expensive, coming back out of it is quick and nearly free, and cutting straight across costs no more than the easy stuff does. The host chooses how dramatic it is, or switches it off.",
  },
  {
    date: "2026-08-19",
    title: "Where you stand decides what you see",
    body: "Your {radar} beam is stopped by anything worse than what you are standing on. From the top it reaches everywhere; from the bottom of a hollow you are nearly blind, and a new event tells you what is in the way. A harder {ping} costs more and sees over more.",
  },
  {
    date: "2026-08-19",
    title: "{fuel}, and running out of it",
    body: "There is something to collect now. Moving, turning, {fire} and {ping} all spend {fuel}; thinking is still free. An empty {robot} is slow and clumsy rather than dead, so nothing you have already written can starve to death.",
  },
  {
    date: "2026-08-19",
    title: "Taking a shot changed",
    body: "{fire} no longer shoots along whatever way the {turret} happens to point at that instant. It commits the shot, which leaves as soon as the {turret} arrives where you aimed it — so you can aim and shoot in the same breath, and lead a moving target.",
  },
  {
    date: "2026-08-19",
    title: "Four {robots} to read and beat",
    body: "Hungry Hippo ignores the fight and eats. Goat climbs to the top of the nearest one and holds it. Apex hunts, feeds and budgets, and is the one to beat. The Racer learned to read the {ground} like a race track — and, at last, to see a wall coming.",
  },
  {
    date: "2026-08-16",
    title: "Behaviours you can name and share",
    body: "Write a `can ... given` block and you have a named piece of behaviour rather than one more handler. They can be filtered by count, dropped into other scripts, and passed to other people.",
  },
  {
    date: "2026-08-16",
    title: "A {radar} of your own",
    body: "A third thing you can point, beside your body and your {turret}. It reaches three times as far as the sense cone and is a fifth as wide, and it only looks when you {ping} it — so it finds what the cone never could, but only exactly where you send it.",
  },
  {
    date: "2026-08-16",
    title: "Tournaments",
    body: "A random draw from everything in the room. Every tie is settled over eleven matches, and you can watch the one that decided it.",
  },
  {
    date: "2026-08-15",
    title: "First light",
    body: "Write a {robot} in a small language of its own, watch it fight, and find out whose survives.",
  },
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "2026-08-19" -> "19 August 2026".
 *
 * Formatted by hand rather than with `toLocaleDateString`, which would print a
 * different string depending on where the player happens to be — and these
 * dates are facts about the project, not about the reader.
 */
export function formatNewsDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1];
  if (!y || !month || !d) return iso;
  return `${Number(d)} ${month} ${y}`;
}

export function newsTitle(entry: NewsEntry, theme: Theme): string {
  const rendered = renderDoc(entry.title, theme);
  return rendered.charAt(0).toUpperCase() + rendered.slice(1);
}

export function newsBody(entry: NewsEntry, theme: Theme): string {
  return renderDoc(entry.body, theme);
}
