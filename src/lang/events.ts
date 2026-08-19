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
    .replace(/\{fuel\}/g, words.fuel);
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
    fields: [BEARING, DISTANCE, HEADING, SPEED, HEALTH, NAME, X, Y],
  },
  "sense bullet": {
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
  "ping robot": {
    summary:
      "Your {radar} beam found a {robot}. The beam is narrow and reaches much further than the cone, so this is a {robot} you could not otherwise see.",
    fields: [BEARING, DISTANCE, HEADING, SPEED, HEALTH, NAME, X, Y],
  },
  "ping fuel": {
    summary:
      "Your {radar} beam found {fuel} far away. The beam only reports this when it found no {robot}, since a {robot} is always the more urgent news.",
    fields: [BEARING, DISTANCE, AMOUNT, X, Y],
  },
  "ping wall": {
    summary:
      "Your {radar} beam reached a wall instead of a {robot}. The distance is how far the wall is in the direction the {radar} points.",
    fields: [BEARING, DISTANCE],
  },
  "hit wall": {
    summary: "You drove into a wall. It costs you a little health.",
    fields: [BEARING, DISTANCE],
  },
  "hit robot": {
    summary: "You bumped into another {robot}.",
    fields: [BEARING, DISTANCE, NAME, HEALTH, X, Y],
  },
  "hit by bullet": {
    summary: "Someone shot you. The bearing points back at where it came from.",
    fields: [BEARING, DISTANCE, POWER, HEALTH, X, Y],
  },
  "bullet hit": {
    summary: "One of your shots hit someone.",
    fields: [BEARING, DISTANCE, NAME, HEALTH, POWER, X, Y],
  },
  "bullet missed": {
    summary: "One of your shots flew off the edge of the arena without hitting anything.",
    fields: [POWER, X, Y],
  },
  "robot destroyed": {
    summary: "Any {robot} has been destroyed — possibly by you, possibly not.",
    fields: [BEARING, DISTANCE, NAME, X, Y],
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
