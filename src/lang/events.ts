/**
 * What each event tells you.
 *
 * This is the single source of truth for `event.<field>`, and it is used three
 * ways:
 *
 *  - the compiler rejects `event.power` inside `on sense wall`, because a wall
 *    has no firing power;
 *  - autocomplete offers exactly the fields the current handler really carries;
 *  - a test asserts that what `step.ts` actually emits matches this table, so
 *    the help can never drift away from the simulation.
 *
 * The descriptions are written for someone who has not programmed before, since
 * this text is what appears in the editor's completion popup.
 */

import type { EventName } from "./ast.js";
import { THEMES, type Theme } from "./vocab.js";

/**
 * Help text is written with placeholders so it can be read back in either
 * vocabulary — a biological player is told about darts and organisms, not
 * bullets and robots.
 */
export function renderDoc(text: string, theme: Theme = "mechanical"): string {
  const words = THEMES[theme];
  return text
    .replace(/\{robot\}/g, words.robot)
    .replace(/\{robots\}/g, words.robotPlural)
    .replace(/\{bullet\}/g, words.bullet)
    .replace(/\{health\}/g, words.health)
    .replace(/\{turret\}/g, words.weapon)
    .replace(/\{radar\}/g, words.scanner)
    .replace(/\{ping\}/g, words.pingVerb)
    .replace(/\{fire\}/g, words.fireVerb)
    .replace(/\{drive\}/g, words.driveVerb)
    .replace(/\{fuel\}/g, words.fuel)
    .replace(/\{slope\}/g, words.slope)
    .replace(/\{ground\}/g, words.ground)
    .replace(/\{uphill\}/g, words.uphill)
    .replace(/\{downhill\}/g, words.downhill)
    .replace(/\{broadcast\}/g, words.broadcastVerb)
    .replace(/\{radio\}/g, words.radio)
    .replace(/\{ally\}/g, words.ally)
    .replace(/\{team\}/g, words.team)
    .replace(/\{arena\}/g, words.arena);
}

export interface FieldDoc {
  name: string;
  detail: string;
}

/** Fields shared by most events, described once. */
const BEARING: FieldDoc = {
  name: "bearing",
  detail:
    "Which way to turn to face it, in degrees, measured from straight ahead. Negative is left, positive is right.",
};
const DISTANCE: FieldDoc = { name: "distance", detail: "How far away it is, in steps." };
const HEADING: FieldDoc = { name: "heading", detail: "The direction it is facing." };
const SPEED: FieldDoc = { name: "speed", detail: "How fast it is going." };
const HEALTH: FieldDoc = { name: "health", detail: "How much {health} it has left, out of 100." };
const POWER: FieldDoc = { name: "power", detail: "How strong the shot was, from 1 to 3." };
const NAME: FieldDoc = { name: "name", detail: "The label it is showing." };
const AMOUNT: FieldDoc = {
  name: "amount",
  detail: "How much {fuel} you get for driving over it.",
};
const FUEL: FieldDoc = {
  name: "fuel",
  detail: "How much {fuel} you have after collecting it, out of 100.",
};
const RISE: FieldDoc = {
  name: "rise",
  detail:
    "How much harder the {ground} is out there than right here, from -100 to 100. Positive means it gets worse that way.",
};
const HEIGHT: FieldDoc = {
  name: "height",
  detail: "How bad the {ground} is out there on its own, 0 for the easiest and 100 for the worst.",
};
/**
 * Whose side it is on.
 *
 * A plain yes-or-no rather than a team number, and that is deliberate. Which
 * side somebody is on is a fact about the lobby; whether they are on YOURS is
 * the only part of it the arena has any business telling you. It also means the
 * field says the same thing however many teams there are.
 *
 * The consequence, which is a decision and not an oversight: with three or more
 * sides you cannot tell one enemy team from another. That is what the radio is
 * for — work it out and tell your own side.
 */
const FRIEND: FieldDoc = {
  name: "friend",
  detail:
    "True when it is on your side. Always false when everyone is fighting for themselves.",
};
const DATA: FieldDoc = {
  name: "data",
  detail: "Whatever was broadcast, exactly as it was sent.",
};
const X: FieldDoc = { name: "x", detail: "Its position across the arena." };
const Y: FieldDoc = { name: "y", detail: "Its position down the arena." };

export interface EventDoc {
  /** What this event means, in plain words. */
  summary: string;
  fields: readonly FieldDoc[];
}

export const EVENT_DOCS: Readonly<Record<EventName, EventDoc>> = {
  start: {
    summary: "Runs once, at the very beginning of the match. Set things up here.",
    fields: [],
  },
  tick: {
    summary: "Runs over and over, 30 times a second, for the whole match.",
    fields: [],
  },
  "sense robot": {
    summary: "Another {robot} has come into your sense cone.",
    fields: [BEARING, DISTANCE, HEADING, SPEED, HEALTH, NAME, FRIEND, X, Y],
  },
  "sense bullet": {
    // Deliberately no `friend`. A {bullet} in the cone does have somebody's
    // name on it, but being told one is friendly would hand a team free
    // dodging every time it fired through its own line — and the whole cost of
    // fighting shoulder to shoulder is that you have to watch where you shoot.
    // A {bullet} is a {bullet}.
    summary: "A {bullet} is flying through your sense cone. Time to dodge.",
    fields: [BEARING, DISTANCE, HEADING, SPEED, POWER, X, Y],
  },
  "sense wall": {
    summary: "There is a wall ahead of you.",
    fields: [BEARING, DISTANCE],
  },
  "sense fuel": {
    summary:
      "There is {fuel} in your sense cone. Driving over it fills your tank; moving, turning, {fire} and {ping} are what empty it.",
    fields: [BEARING, DISTANCE, AMOUNT, X, Y],
  },
  "fuel collected": {
    summary: "You drove over {fuel} and collected it. This is the moment to choose what to do with the energy you gained.",
    fields: [AMOUNT, FUEL],
  },
  "ping robot": {
    summary:
      "Your {radar} beam found a {robot}. The beam is narrow and reaches much further than the cone, so this is a {robot} you could not otherwise see \u2014 as long as nothing higher than you was in the way.",
    fields: [BEARING, DISTANCE, HEADING, SPEED, HEALTH, NAME, FRIEND, X, Y],
  },
  "ping fuel": {
    summary:
      "Your {radar} beam found {fuel} far away. The beam only reports this when it found no {robot}, since a {robot} is always the more urgent news.",
    fields: [BEARING, DISTANCE, AMOUNT, X, Y],
  },
  "ping wall": {
    summary:
      "Your {radar} beam went all the way to a wall and found nothing on the way. Nothing higher than you was in the way either, or you would have heard about that instead.",
    fields: [BEARING, DISTANCE],
  },
  "ping slope": {
    summary:
      "Your {radar} beam read the {ground} between you and wherever it is pointing. This one arrives as well as anything else the beam found, not instead of it \u2014 the {ground} is everywhere, so it never has to take its turn.",
    fields: [BEARING, DISTANCE, RISE, HEIGHT],
  },
  "ping ridge": {
    summary:
      "Your {radar} beam ran into {ground} higher than you are standing on, and stopped there. You cannot see past it \u2014 so either go round, climb it, or {ping} harder, which costs more but sees over more.",
    fields: [BEARING, DISTANCE, RISE, HEIGHT],
  },
  "hit wall": {
    summary: "You drove into a wall. It costs you a little health.",
    fields: [BEARING, DISTANCE],
  },
  "hit robot": {
    summary: "You bumped into another {robot}.",
    fields: [BEARING, DISTANCE, NAME, HEALTH, FRIEND, X, Y],
  },
  "hit by bullet": {
    // Here `friend` is about the SHOOTER: somebody on your own side hit you.
    summary: "Someone shot you. The bearing points back at where it came from.",
    fields: [BEARING, DISTANCE, POWER, HEALTH, FRIEND, X, Y],
  },
  "bullet hit": {
    summary: "One of your shots hit someone.",
    fields: [BEARING, DISTANCE, NAME, HEALTH, POWER, FRIEND, X, Y],
  },
  "bullet missed": {
    summary: "One of your shots flew off the edge of the arena without hitting anything.",
    fields: [POWER, X, Y],
  },
  "robot destroyed": {
    summary: "Any {robot} has been destroyed — possibly by you, possibly not.",
    fields: [BEARING, DISTANCE, NAME, FRIEND, X, Y],
  },
  radio: {
    summary:
      "Somebody broadcast something, and every {robot} alive heard it. It does not say who sent it or where they are \u2014 so if you want your own side to know it was you, put that in the message, knowing the other side is reading it too.",
    fields: [DATA],
  },
};

/** Field names available on `event` inside a given handler. */
export function eventFields(event: EventName | null): readonly FieldDoc[] {
  if (!event) return [];
  return EVENT_DOCS[event].fields;
}

export function hasEventField(event: EventName, field: string): boolean {
  return EVENT_DOCS[event].fields.some((f) => f.name === field);
}
