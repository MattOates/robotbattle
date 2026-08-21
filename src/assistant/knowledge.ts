/**
 * Teaching the model RoboScript, in the space available.
 *
 * The budget is the whole problem. Every model WebLLM will do tool calling with
 * has a 4096 token context window, and that window also has to hold the tool
 * definitions, the player's script and the conversation. Meanwhile the Learn
 * chapters plus the completion documentation come to something like 28,000
 * tokens. So the language cannot be *given* to the model; it has to be
 * condensed, and then topped up per question with the one lesson that bears on
 * what was asked.
 *
 * The condensed part is generated, never written by hand. `referenceTables`
 * reads the same tables the parser and compiler use, which means the card
 * cannot describe a word the compiler would reject, and cannot go stale when
 * somebody adds an event. That is the same guarantee the completion popup
 * already makes to the player, extended to the assistant.
 */

import { referenceTables } from "../lang/complete.js";
import {
  ARENA_SIZE,
} from "../net/matchsetup.js";
import { BULLET, MAX_HEALTH, RADAR, SENSE, TICK_RATE, TURRET } from "../sim/types.js";
import { EVENT_NAMES } from "../lang/ast.js";
import { EVENT_DOCS, eventFields, renderDoc } from "../lang/events.js";
import { healthPropertyFor, THEMES, wordFor, type Theme } from "../lang/vocab.js";
import type { PromptBudget } from "./runtime.js";
import {
  CODE_LANGS,
  extractCode,
  fillVocab,
  loadLessons,
  selectWorld,
  type Lesson,
} from "../learn/markdown.js";

/** Strip a `Suggestion` down to one line the model can skim. */
function line(label: string, detail?: string): string {
  return detail ? `- ${label} — ${sentence(detail)}` : `- ${label}`;
}

/**
 * The first sentence only.
 *
 * The documentation tables are written for a player reading at leisure in the
 * completion popup, and several entries run to a paragraph explaining the
 * tactics. The model needs to know what a thing *is*; the nuance is what the
 * lesson retrieval is for. Keeping the whole of every entry cost about half the
 * context window on its own.
 */
function sentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const stop = flat.search(/\.(\s|$)/);
  return stop === -1 ? flat : flat.slice(0, stop + 1);
}

/**
 * The permanent part of the prompt: what RoboScript is, in about 800 tokens.
 *
 * Written in the player's own vocabulary, so a biological player's assistant
 * suggests `swim` and `sting` rather than translating in its head and getting
 * it wrong half the time.
 */
export function languageCard(theme: Theme): string {
  const t = referenceTables(theme);
  const turret = wordFor("turret", theme);
  const radar = wordFor("radar", theme);

  const events = EVENT_NAMES.map((name) => {
    const fields = eventFields(name).map((f) => f.name);
    const carries = fields.length ? ` (event.${fields.join(", event.")})` : "";
    return `- on ${name}${carries} — ${sentence(renderDoc(EVENT_DOCS[name].summary, theme))}`;
  });

  return [
    "# RoboScript",
    "",
    "RoboScript programs a battle robot. It is line-based: no semicolons, no braces.",
    "Blocks open with a keyword and close with `end`. Comments start with `--`.",
    "A program is a few settings, then handlers that react to things.",
    "",
    "## Shape of a program",
    "```",
    'name "Sparky"',
    "chassis tank",
    "color #ff8800",
    "",
    "on start",
    `  ${turret}.sweep 90`,
    "end",
    "",
    "on sense robot",
    `  ${turret}.aim at event.bearing`,
    `  ${wordFor("fire", theme)} 2`,
    "end",
    "```",
    "",
    "## Top level",
    ...t.keywords.map((s) => line(s.label, s.detail)),
    "",
    "## Handlers (`on <event> ... end`)",
    ...events,
    "",
    "## How often a handler runs",
    "Said on the `on` line itself, not built out of loops.",
    "- on tick every 30 — one time in 30, so once a second",
    "- on tick before 90 — only for the first 90 ticks",
    "- on hit wall after 2 — from the third bump onward",
    "- on hit by bullet at 3 — on the third hit, once",
    "`every`, `after` and `before` combine; `at` goes alone. A `can` block takes",
    "the same words after `given <event>`.",
    "",
    "## Statements",
    "These all finish inside one tick. None of them schedules anything.",
    ...t.statements.map((s) => line(s.label, s.detail)),
    "",
    "## Actions",
    ...t.actions.map((s) => line(s.label, s.detail)),
    `- ${turret}.${t.turret.map((s) => s.label).join(`, ${turret}.`)}`,
    `- ${radar}.${t.radar.map((s) => s.label).join(`, ${radar}.`)}`,
    "",
    "## Reading your own state (`me.`)",
    ...t.me.map((s) => line(`me.${s.label}`, s.detail)),
    "",
    "## Reading the arena (`arena.`)",
    ...t.arena.map((s) => line(`arena.${s.label}`, s.detail)),
    "",
    "## Functions",
    ...t.builtins.map((s) => line(`${s.label}()`, s.detail)),
    "",
    "## Values",
    ...t.literals.map((s) => line(s.label, s.detail)),
    "",
    worldFacts(theme),
    "",
    "Only the words above exist. Do not invent commands, and do not write",
    "anything from another language — there are no `if (...)` brackets, no `{`,",
    "no `def`, no `function`, no `return`.",
  ].join("\n");
}

/**
 * How the world behaves, as against how the language reads.
 *
 * Read out of the simulation's own constants rather than written down, for the
 * same reason the rest of the card is generated: a number typed here would be
 * true until somebody tuned the balance, and then it would be a lie nobody
 * noticed. `TICK_RATE` moving retunes every sentence below it.
 *
 * These are the questions a card about syntax cannot answer — how long a tick
 * is, how far you can see, how much a shot hurts. Without them the advice is
 * shaped right and numbered by guesswork.
 */
export function worldFacts(theme: Theme): string {
  const cone = SENSE.halfAngle * 2;
  const beam = RADAR.halfAngle * 2;
  return [
    "## How the world works",
    // Plain lines rather than a bulleted list. A `- ` bullet in this card is a
    // claim about a RoboScript word, and a test lexes every one of them; these
    // are sentences about the world, and would fail it for being English.
    `There are ${TICK_RATE} ticks in a second, so \`wait 15 ticks\` is half a second.`,
    `The ${THEMES[theme].arena} is ${ARENA_SIZE.width} across and ${ARENA_SIZE.height} down. You start with ${MAX_HEALTH} ${healthPropertyFor(theme)}.`,
    `Your sense cone is ${cone} degrees wide and reaches ${SENSE.range}. It is always on and costs nothing.`,
    `The ${wordFor("radar", theme)} beam is ${beam} degrees wide and reaches ${RADAR.range} — but only where you point it, and only when you ${wordFor("ping", theme)}, with ${RADAR.cooldown} ticks between one and the next.`,
    `Shots are power 1 to 3. Stronger hurts more, ${BULLET.damagePerPower} a power, and flies slower: ${BULLET.baseSpeed} less ${BULLET.speedPerPower} a power.`,
    `The ${wordFor("turret", theme)} turns ${TURRET.slewRate} degrees a second and the ${wordFor("radar", theme)} ${RADAR.slewRate}, so aiming is never instant.`,
    `Moving, turning, ${wordFor("fire", theme)} and ${wordFor("ping", theme)} all spend ${wordFor("fuel", theme)}. Thinking is free.`,
  ].join("\n");
}

/**
 * The same language, for a runtime that cannot afford the full card.
 *
 * Roughly a quarter of the size: no per-event summaries, no per-property
 * explanations, no worked descriptions — names, shapes and one example. It
 * teaches far less, and the retrieval step has to carry more of the weight.
 *
 * The cut is by *detail* and never by *coverage*. Dropping half the events
 * would leave the model confidently writing `on sense enemy`, whereas dropping
 * the sentence that explains an event still leaves it with the correct name to
 * copy. A short list of true things beats a long list with holes in it.
 */
export function briefCard(theme: Theme): string {
  const t = referenceTables(theme);
  const names = (list: { label: string }[]) => list.map((s) => s.label).join(", ");
  const turret = wordFor("turret", theme);

  return [
    "# RoboScript",
    "",
    "Line-based. No semicolons, no braces, no brackets round conditions.",
    "Blocks end with `end`. Comments start with `--`.",
    "",
    "```",
    'name "Sparky"',
    "chassis tank",
    "",
    "on sense robot",
    `  ${turret}.aim at event.bearing`,
    `  ${wordFor("fire", theme)} 2`,
    "end",
    "```",
    "",
    // The one shape worth spelling out. Given only the word `if` in a list, a
    // small model writes `if x then ... else ... end` on a single line, which
    // is how the language it learned elsewhere looks. RoboScript is
    // line-based, so that does not parse.
    "Every block is over several lines, `if` included:",
    "```",
    "if me.slope > 12 then",
    "  turn chassis to me.downhill",
    "else",
    `  ${wordFor("drive", theme)} forward 80`,
    "end",
    "```",
    "",
    "",
    // The part nobody guesses, and the part it kept getting wrong. Asked how to
    // do something on a cadence it reached for `repeat`, because `repeat` was
    // the only word on this card that looked periodic — and `repeat` is a loop
    // that runs inside a single tick. How often a handler runs is a property of
    // the handler, not something you build out of control flow, and that is the
    // genuinely unusual thing about this language.
    "## How often a handler runs",
    "",
    "Say it on the `on` line. Nothing else schedules anything:",
    "",
    "```",
    "on tick every 30      -- once a second (there are 30 ticks in a second)",
    "on tick before 90     -- only for the first three seconds",
    "on tick every 5 after 60   -- every 5 ticks, once 60 have passed",
    "on hit by bullet at 3 -- on the third hit, once, and never again",
    "```",
    "",
    "`every`, `after` and `before` combine. `at` goes on its own.",
    "",
    "`loop`, `for` and `repeat` are NOT how you do something periodically —",
    "they all run to completion inside one tick. Use `every` for a cadence.",
    "",
    `Top level: ${names(t.keywords)}`,
    `Statements: ${names(t.statements)}`,
    `Actions: ${names(t.actions)}`,
    `Turret: ${t.turret.map((s) => `${turret}.${s.label}`).join(", ")}`,
    `Events: ${EVENT_NAMES.map((n) => `on ${n}`).join(", ")}`,
    `Your state: ${t.me.map((s) => `me.${s.label}`).join(", ")}`,
    `The arena: ${t.arena.map((s) => `arena.${s.label}`).join(", ")}`,
    `Functions: ${t.builtins.map((s) => `${s.label}()`).join(", ")}`,
    `Values: ${names(t.literals)}`,
    "",
    "",
    "",
    worldFacts(theme),
    "",
    "Inside a handler, `event.` carries what happened — usually `event.bearing`",
    "and `event.distance`.",
    "",
    "A `can` block is a named handler you can also call by name, and it takes",
    "the same `given <event>` and cadence:",
    "",
    "```",
    "can rally given hit wall after 2",
    "  turn chassis by 150",
    "end",
    "```",
    "",
    "Use only the words above.",
  ].join("\n");
}

/**
 * The permanent instructions, kept apart from the language so each can be
 * changed without disturbing the other.
 *
 * `budget` is the runtime's answer to how much prompt it can take, not a
 * quality dial. See `PromptBudget`.
 */
export function systemPrompt(theme: Theme, budget: PromptBudget = "roomy"): string {
  if (budget === "tight") {
    // Written for a model that can explain and cannot edit. It is told to
    // answer in words and to quote rather than compose, because the one thing
    // it reliably gets wrong is writing RoboScript of its own — see
    // `EXPLAINER_TOOL_NAMES`.
    return [
      "You help someone understand RoboScript, the language their robot is",
      "written in. Many of them are children, and some have never programmed.",
      "",
      "Answer in plain words, in a sentence or two. Be kind and concrete.",
      "Answer the question. Never repeat it back, and never ask it again.",
      "",
      // Both halves are needed and each was learned the hard way. Told only to
      // use the lesson, it answered a question about itself out of a chapter on
      // sense cones. Told only that the lesson might be irrelevant, it stopped
      // using the lesson at all and echoed questions back instead.
      "If a lesson is quoted below and it answers the question, use it, and",
      "prefer its words to your own. If it plainly does not, ignore it and",
      "answer from what you know. If you do not know, say so.",
      "",
      "Their script is below. When they ask what THEIR robot does, answer from",
      "that script and quote the lines that do it — not from a lesson, and not",
      "from what a robot usually does.",
      "",
      "An example is what they came for. Whenever the answer involves writing",
      "anything, put it in `code` and keep `say` to one short sentence about",
      "it. A description helps nobody who cannot spell it.",
      "",
      "Leave `code` empty when they did not ask how to write anything.",
      "Make `code` complete and ready to paste — a whole `on ... end` handler,",
      "not a fragment and not a line of prose. Only use words from the",
      "reference below, and check each one is really there before you use it.",
      "",
      "You can read their script. You CANNOT change it, and you have no way to",
      "add anything to it. Never say you have added, changed, fixed or built",
      "anything — you have not. Say what to type and where, and let them type",
      "it. Only ever show RoboScript from the reference or the lesson below;",
      "never invent a command, and never guess at spelling.",
      "",
      briefCard(theme),
    ].join("\n");
  }

  return [
    "You are the workshop assistant in RoboBattle, a game where people learn to",
    "program by writing robots. Many of your players are children, and for some",
    "of them this is the first code they have ever written. Be brief, be kind,",
    "and explain in plain words rather than jargon.",
    "",
    "You have tools for reading and editing the script in the player's editor.",
    "Rules for using them:",
    "- Call `say` to tell the player anything. It is the only way you can speak.",
    "- Call `read_script` before editing, so you are changing what is really there.",
    "- After any edit, call `check_script`. If it reports an error, fix it and",
    "  check again before you say you are done.",
    "- Change as little as possible. Do not rewrite a script that mostly works.",
    "- Never invent RoboScript that is not in the reference below.",
    "",
    languageCard(theme),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

/**
 * Words too common to tell one lesson from another. Scoring on them would rank
 * every chapter equally, which is the same as not retrieving at all.
 */
const STOP_WORDS = new Set([
  "a", "about", "an", "and", "any", "are", "as", "at", "be", "but", "by", "can",
  "do", "does", "for", "from", "get", "have", "how", "i", "if", "in", "is", "it",
  "make", "me", "my", "not", "of", "on", "or", "robot", "should", "so", "that",
  "the", "then", "there", "this", "to", "use", "want", "what", "when", "why",
  "will", "with", "you", "your",
]);

/**
 * Does this question name anything of its own?
 *
 * "Can you give an example?" does not — it is only meaningful as a follow-up,
 * and has to borrow its subject from the question before it. "Can I ping them
 * twice and diff the x,y?" plainly does, and must never borrow, because a
 * borrowed subject from three questions ago is how a question about tracking
 * an enemy gets answered with "change the colour of your robot".
 */
export function hasSubject(question: string): boolean {
  return keywords(question).length > 0;
}

/**
 * Does this text mention the word, allowing for a plural?
 *
 * Substring matching on the raw word misses more than it has any right to.
 * "Dodge bullets" found nothing, because the lessons say `bullet`; "avoid
 * hills" found nothing, because they say `hill`. Trimming one trailing `s` is
 * not stemming and does not want to be — it is the one ending that separates
 * how people ask questions from how documentation is written.
 */
function mentions(haystack: string, word: string): boolean {
  if (haystack.includes(word)) return true;
  return word.endsWith("s") && word.length > 3 && haystack.includes(word.slice(0, -1));
}

function keywords(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/** Lesson text with the theme resolved and the live-editor fences taken out. */
function readable(lesson: Lesson, theme: Theme): string {
  const body = fillVocab(selectWorld(lesson.body, theme, lesson.id), theme);
  // A ```try fence is an interactive widget in the Learn screen. To the model it
  // is just an example, so the fence marker goes but the code stays.
  return body.replace(/```try[^\n]*\n/g, "```\n");
}

/**
 * How much lesson to quote.
 *
 * Generous, because the assistant cannot edit anything and so has no tool
 * schemas worth speaking of to pay for — that budget goes here instead. What
 * the model can say is now almost entirely a function of what it was handed,
 * which makes this the most valuable text in the prompt.
 */
const CHARS_PER_SNIPPET = 2200;

/**
 * The part of a lesson that is actually about the question.
 *
 * Taking the opening of the chapter was the obvious thing and quietly the wrong
 * one: lessons open with scene-setting, so a question about `me.gunHeat` would
 * be answered from four paragraphs about what a robot is. This slides a window
 * over the paragraphs and keeps the densest run of them instead, which is
 * usually the passage that actually explains the thing.
 */
function bestWindow(text: string, words: readonly string[], budget: number): string {
  const paragraphs = text.split(/\n{2,}/);
  const hits = paragraphs.map((p) => {
    const lower = p.toLowerCase();
    return words.reduce((n, word) => n + (lower.includes(word) ? 1 : 0), 0);
  });

  let best = { start: 0, end: 0, score: -1 };
  for (let start = 0; start < paragraphs.length; start++) {
    let length = 0;
    let score = 0;
    for (let end = start; end < paragraphs.length; end++) {
      length += paragraphs[end]!.length + 2;
      if (length > budget && end > start) break;
      score += hits[end]!;
      // Ties go to the earlier, shorter window: lessons are written in order,
      // so the first good explanation is usually the introductory one.
      if (score > best.score) best = { start, end, score };
      if (length > budget) break;
    }
  }

  const window = paragraphs.slice(best.start, best.end + 1).join("\n\n");
  const prefix = best.start > 0 ? "…" : "";
  const suffix = best.end < paragraphs.length - 1 ? "…" : "";
  return `${prefix}${window}${suffix}`.slice(0, budget);
}

export interface Quotation {
  code: string;
  /** The lesson it came out of, so it can be attributed rather than claimed. */
  from: string;
}

/**
 * A real example out of the lessons, for a model that should not write its own.
 *
 * The point is that this code is *known good*. Every example in every lesson is
 * compiled by `tests/learn/content.test.ts`, in both worlds, on every run — so
 * quoting one cannot produce the invented commands and one-line `if` blocks a
 * small model writes when asked to compose. It is somebody else's answer to a
 * neighbouring question rather than an answer to this one, which is a fair
 * trade when the alternative is a confident wrong one.
 */
export function retrieveExample(question: string, theme: Theme): Quotation | null {
  const words = keywords(question);
  if (words.length === 0) return null;

  let best: { quote: Quotation; score: number } | null = null;
  for (const lesson of loadLessons()) {
    const body = readable(lesson, theme);
    const title = renderDoc(lesson.title, theme);
    // The chapter counts as well as the code. Someone asking how to "shoot"
    // will not find the word anywhere in an example that says `fire` — but the
    // lesson it sits in is called "Shooting", and that is the connection they
    // are making. Code hits still count double: an example about turning is
    // one that actually turns.
    const around = `${title} ${lesson.teaches}`.toLowerCase();
    for (const { info, code } of extractCode(body)) {
      if (!CODE_LANGS.has(info.lang)) continue;
      const trimmed = code.trim();
      if (!trimmed) continue;
      const haystack = trimmed.toLowerCase();
      const score = words.reduce(
        (n, word) => n + (mentions(haystack, word) ? 2 : 0) + (mentions(around, word) ? 1 : 0),
        0,
      );
      if (score > 0 && (!best || score > best.score)) {
        best = { quote: { code: trimmed, from: title }, score };
      }
    }
  }
  return best?.quote ?? null;
}

/**
 * The lessons that bear on what was asked.
 *
 * Scoring is deliberately crude — word overlap against the title, the one-line
 * summary and the body. An embedding model would score better, but it would be
 * a second model to download, and at this corpus size (seventeen lessons) the
 * crude version picks the right chapter for the kind of question people
 * actually ask: "how do I turn", "what is a bearing", "why is my radar empty".
 *
 * Two by default rather than one. The assistant has nothing else to go on now
 * that it cannot look at anything for itself, and a second chapter is cheap
 * insurance against the first one having been the wrong guess.
 */
export function retrieve(question: string, theme: Theme, limit = 2): string[] {
  const words = keywords(question);
  if (words.length === 0) return [];

  const scored = loadLessons().map((lesson) => {
    const title = (theme === "biological" ? (lesson.titleBio ?? lesson.title) : lesson.title).toLowerCase();
    const teaches = (theme === "biological" ? (lesson.teachesBio ?? lesson.teaches) : lesson.teaches).toLowerCase();
    // The rendered text, not the source. A lesson is written with `{ground}`
    // placeholders and world blocks in it, so the words a player actually reads
    // — hill, goop, ground — are not in the file. Scoring the source meant
    // "avoiding hills" and "terrain" matched the terrain chapter no better than
    // anything else did, which is exactly the complaint that found this.
    const rendered = readable(lesson, theme);
    const body = rendered.toLowerCase();
    let score = 0;
    for (const word of words) {
      // A hit in the title is worth far more than a hit buried in prose: the
      // chapter called "Turning" is about turning, whereas half the chapters
      // mention it.
      if (mentions(title, word)) score += 10;
      if (mentions(teaches, word)) score += 4;
      if (mentions(body, word)) score += 1;
    }
    return { lesson, rendered, score };
  });

  // Scoring stays generous on purpose. Deciding whether a question wants a
  // lesson at all is triage's job now, and a threshold here was a poor
  // substitute for it: strict enough to keep "can you see my script" out, it
  // also threw away "how do I turn".
  const chosen = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // The best match gets the whole budget; a second opinion gets half of it.
  return chosen.map(({ lesson, rendered }, i) => {
    const budget = i === 0 ? CHARS_PER_SNIPPET : Math.round(CHARS_PER_SNIPPET / 2);
    const text = bestWindow(rendered, words, budget);
    return `From the lesson "${renderDoc(lesson.title, theme)}":\n\n${text}`;
  });
}
