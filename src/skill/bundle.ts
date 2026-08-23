/**
 * The language, packaged so somebody else's model can write it.
 *
 * A person who wants to vibe out a robot is usually somewhere else — in Claude,
 * in ChatGPT — and the model there has never heard of RoboScript. It will
 * cheerfully invent something that looks like it: `if (x > 3) { fire(); }`,
 * braces and semicolons and a `while` loop, none of which this language has.
 *
 * So the bundle below is generated from exactly the same sources the Reference
 * page reads: `ruleDocs()` for the shape of every rule, `EVENT_DOCS` for what
 * each event carries, `BUILTINS` for the functions, `simulationFacts()` for the
 * numbers, `SAMPLE_BOTS` for the worked examples. Nothing here is a second
 * description of the language that could drift from the first — which matters
 * more for this file than for any other, because a stale skill is a confident
 * liar and the reader has no way to check it.
 *
 * `tests/skill/bundle.test.ts` holds the line: every example in it compiles,
 * and it never names a word the lexer would reject.
 *
 * ## Why two shapes of the same thing
 *
 * `SKILL.md` and its two companions are a Claude Skill: a small always-loaded
 * card that says what the language is, with the reference and the examples in
 * separate files to be opened only when they are needed. That split is worth
 * having — the examples are twice the size of everything else put together, and
 * a model deciding whether `wait` exists should not have to read fourteen
 * robots to find out.
 *
 * `roboscript.md` is the same content in one file, for everywhere that has no
 * such convention: pasted into a Custom GPT, dropped in a project, or fetched
 * from its URL. Generated from the same parts rather than written twice.
 */

import { EVENT_NAMES } from "../lang/ast.js";
import { BUILTINS, signatureOf } from "../lang/builtins.js";
import { EVENT_DOCS, eventFields, renderDoc } from "../lang/events.js";
import { ruleDocs, SECTIONS, simulationFacts, syntaxLine } from "../lang/reference.js";
import { SYNONYMS } from "../lang/vocab.js";
import { SAMPLE_BOTS } from "../bots/index.js";

/** One file of the published bundle. */
export interface SkillFile {
  /** Path under the published `skill/` directory. */
  path: string;
  text: string;
}

/**
 * Mechanical throughout, with the other vocabulary described rather than
 * spoken.
 *
 * Generating both in full would nearly double the reference and hand a model
 * two names for every instruction to choose between while writing. One voice,
 * and a section saying the other exists, is what a person actually needs: they
 * meet `swim` in somebody else's script and want to know what it is.
 */
const THEME = "mechanical" as const;

const doc = (text: string) => renderDoc(text, THEME);

/** Where the bundle lives once it is published. */
export const SKILL_HOME = "https://mattoates.github.io/robotbattle";

// ---------------------------------------------------------------------------
// The parts
// ---------------------------------------------------------------------------

function grammarSection(): string {
  const rules = ruleDocs();
  const out: string[] = ["# The shape of the language", ""];
  for (const section of SECTIONS) {
    const inSection = rules.filter((r) => r.section === section.name);
    if (inSection.length === 0) continue;
    out.push(`## ${doc(section.title)}`, "", doc(section.blurb), "");
    for (const rule of inSection) {
      out.push(`### ${doc(rule.title)}`, "", "```", syntaxLine(rule.syntax, THEME), "```", "");
      if (rule.summary) out.push(doc(rule.summary), "");
      if (rule.example) out.push(`Example: \`${rule.example}\``, "");
    }
  }
  return out.join("\n").trim();
}

function eventsSection(): string {
  const out: string[] = [
    "# Events",
    "",
    "A robot does nothing on its own. Every instruction lives inside a block that",
    "waits for one of these, and `event.<field>` is how the block reads what",
    "happened. A field that is not listed here does not exist on that event, and",
    "the compiler will say so.",
    "",
  ];
  for (const name of EVENT_NAMES) {
    const fields = eventFields(name);
    out.push(`## on ${name}`, "", doc(EVENT_DOCS[name].summary), "");
    if (fields.length > 0) {
      for (const f of fields) out.push(`- \`event.${f.name}\` — ${doc(f.detail)}`);
      out.push("");
    } else {
      out.push("Carries nothing.", "");
    }
  }
  return out.join("\n").trim();
}

function functionsSection(): string {
  const out: string[] = [
    "# Functions",
    "",
    "The whole list. There are no others, and there is no way to define one —",
    "a reusable piece of behaviour is a `can` block, which is not a function and",
    "returns nothing.",
    "",
  ];
  for (const [name, fn] of Object.entries(BUILTINS)) {
    out.push(`## \`${signatureOf(name)}\``, "", doc(fn.summary), "");
    for (const p of fn.params) out.push(`- \`${p.name}\` — ${doc(p.detail)}`);
    out.push("", `Example: \`${fn.example}\``, "");
  }
  return out.join("\n").trim();
}

function factsSection(): string {
  const out: string[] = [
    "# How the world behaves",
    "",
    "Every number here is read out of the simulation itself, so it is what the",
    "game actually does rather than what somebody wrote down once.",
    "",
  ];
  for (const group of simulationFacts(THEME)) {
    out.push(`## ${doc(group.title)}`, "", doc(group.blurb), "");
    for (const f of group.facts) out.push(`- **${doc(f.label)}** — ${doc(f.value)}. ${doc(f.note)}`);
    out.push("");
  }
  return out.join("\n").trim();
}

/**
 * The other vocabulary, described rather than spoken.
 *
 * Generated from `SYNONYMS` so it cannot fall behind the lexer: a word added
 * there appears here without anybody remembering to add it.
 */
function vocabularySection(): string {
  const rows = SYNONYMS.filter((s) => s.mechanical !== s.biological).map(
    (s) => `| \`${s.mechanical}\` | \`${s.biological}\` |`,
  );
  return [
    "# The other vocabulary",
    "",
    "The same game can be played as robotics or as biology, and the biological",
    "spellings are not a different language — the lexer rewrites them into the",
    "words above, so a script written either way compiles to byte-identical",
    "bytecode and fights exactly the same match.",
    "",
    "**Write the mechanical words.** This table is for reading somebody else's",
    "script, not for choosing between them.",
    "",
    "| mechanical | biological |",
    "| --- | --- |",
    ...rows,
    "",
  ].join("\n").trim();
}

function examplesSection(): string {
  const out: string[] = [
    "# Worked examples",
    "",
    "Every one of these is a robot that runs in the real game today. They are the",
    "best guide to what idiomatic RoboScript looks like — read the shape of them",
    "before writing one.",
    "",
  ];
  for (const bot of SAMPLE_BOTS) {
    out.push(`## ${bot.title}`, "", `Teaches: ${bot.teaches}`, "", "```roboscript", bot.source.trim(), "```", "");
  }
  return out.join("\n").trim();
}

// ---------------------------------------------------------------------------
// How to write one at all
// ---------------------------------------------------------------------------

/**
 * The rules a model gets wrong when it has only seen the grammar.
 *
 * Written by hand, deliberately, and it is the one part of this file that is.
 * These are not facts about the grammar — the grammar is generated above and
 * says nothing about which mistakes are tempting. They are what a model trained
 * on C-like languages does the moment it is asked for a robot, and no amount of
 * railroad diagrams heads them off.
 */
const HOUSE_RULES = `## Writing a robot

RoboScript is line-based. No semicolons, no braces, no parentheses round a
condition. A block opens with a keyword and closes with \`end\`. Comments start
with \`--\`.

Things that are true here and are not true in most languages:

- **Nothing runs top to bottom.** A script is a set of blocks that wait. Only
  \`on start\` runs once at the beginning; everything else runs when its event
  happens. There is no \`main\`.
- **A condition must compare two things.** \`if event.friend then\` is rejected —
  write \`if event.friend is false then\`. There is no truthiness.
- **\`break\` only works inside a loop.** It is not an early return; there is no
  early return, so shape the block with \`if\` instead.
- **You cannot write two \`on tick\` blocks.** You can write as many
  \`can <name> given tick\` blocks as you like, and each keeps its own count —
  which is how one robot runs several behaviours at different cadences.
- **A \`can\` block returns nothing.** It reads and writes the script's variables;
  it does not hand a value back. \`var x = my_block()\` is not a thing.
- **Actions set a goal, they do not block.** \`turn to 90\` asks the chassis to
  come round over the following ticks and returns immediately. Nothing waits
  except \`wait\`.
- **Aiming takes time.** \`fire\` commits a shot that leaves when the turret has
  come round to where it was aimed, so leading a moving target is real work.
- **There are no lists, arrays or records.** A value is a number, a piece of
  text, true/false, or none. Several things travel in one message by way of
  \`pack\` and come back out with \`field\`.
- **Thinking is free; doing costs fuel.** Moving, turning, firing and pinging
  spend it. Running dry makes a robot slow, never dead.

Start every robot with \`name\` and \`chassis\` at the top, outside every block.
Both have defaults — an unnamed robot compiles and drives a tank — but a robot
with no name is a blank label in the arena and nobody can tell it from anyone
else's.`;

// ---------------------------------------------------------------------------
// The bundle
// ---------------------------------------------------------------------------

const DESCRIPTION =
  "Write, read and debug robots in RoboScript, the small line-based language " +
  "used by RoboBattle. Use whenever somebody asks for a RoboBattle robot, " +
  "mentions RoboScript, or shows code with `on tick`, `can ... given`, " +
  "`turret.aim at` or `chassis tank` in it.";

function skillCard(): string {
  return [
    "---",
    "name: roboscript",
    `description: ${DESCRIPTION}`,
    "---",
    "",
    "# RoboScript",
    "",
    "RoboScript programs a battle robot for [RoboBattle](" + SKILL_HOME + "),",
    "which runs in a browser with no account and nothing to install. A match is",
    "decided entirely by the scripts; there is no input once it starts.",
    "",
    HOUSE_RULES,
    "",
    "## A whole robot, to show the shape",
    "",
    "```roboscript",
    (SAMPLE_BOTS.find((b) => b.id === "hunter")?.source ?? "").trim(),
    "```",
    "",
    "## Where the rest is",
    "",
    "- `reference.md` — every rule of the grammar, every event and what it",
    "  carries, every function, and the numbers the world actually runs on.",
    "  Read it before claiming something exists.",
    "- `examples.md` — fourteen complete robots that run in the game today,",
    "  from a two-line one to a flock that co-ordinates over the radio.",
    "",
    "When you are unsure whether something is in the language, it is not. The",
    "grammar in `reference.md` is complete, and anything absent from it will be",
    "rejected by the compiler rather than ignored.",
    "",
  ].join("\n");
}

function referenceDoc(): string {
  return [
    "# RoboScript reference",
    "",
    "Generated from the game's own grammar and constants. If this disagrees with",
    "the game, the game is right and this is a bug.",
    "",
    grammarSection(),
    "",
    eventsSection(),
    "",
    functionsSection(),
    "",
    factsSection(),
    "",
    vocabularySection(),
  ].join("\n");
}

/** Every file of the bundle, ready to be written out or zipped. */
export function skillBundle(): SkillFile[] {
  const card = skillCard();
  const reference = referenceDoc();
  const examples = examplesSection();

  // The flat file is the same parts in one piece, for everywhere that has no
  // notion of a skill: a Custom GPT's knowledge, a project, or a URL somebody
  // pastes into a chat.
  const flat = [
    card.replace(/^---\n[\s\S]*?\n---\n\n/, ""),
    "",
    reference,
    "",
    examples,
  ].join("\n");

  const llms = [
    "# RoboBattle — RoboScript",
    "",
    "> A small line-based language for programming battle robots, run entirely in",
    "> the browser. These files describe it completely and are generated from the",
    "> game's own grammar, so they cannot fall behind it.",
    "",
    `- [Everything in one file](${SKILL_HOME}/skill/roboscript.md)`,
    `- [Skill card](${SKILL_HOME}/skill/SKILL.md)`,
    `- [Reference](${SKILL_HOME}/skill/reference.md)`,
    `- [Worked examples](${SKILL_HOME}/skill/examples.md)`,
    `- [Play it](${SKILL_HOME}/play/)`,
    "",
  ].join("\n");

  return [
    { path: "SKILL.md", text: card },
    { path: "reference.md", text: reference },
    { path: "examples.md", text: examples },
    { path: "roboscript.md", text: flat },
    { path: "llms.txt", text: llms },
  ];
}
