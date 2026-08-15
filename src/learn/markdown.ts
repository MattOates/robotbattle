/**
 * Turning lesson files into pages.
 *
 * Lessons are plain markdown so that writing a lot of them stays pleasant.
 * Three small conventions sit on top:
 *
 *  - frontmatter, for the title and where the lesson sits in the order
 *  - `:::bot` / `:::bio` blocks, for the places where the *explanation* and not
 *    just the vocabulary differs between the two worlds
 *  - a ```try fence, which becomes a live editor and arena
 *
 * The world blocks are filtered out of the raw text before the markdown parser
 * ever sees it. A string filter is far easier to reason about — and to test —
 * than a parser plugin, and it means an unclosed block is a loud failure rather
 * than a silently swallowed lesson.
 */

import { THEMES, type Theme } from "../lang/vocab.js";

export interface LessonMeta {
  id: string;
  title: string;
  /** Title to use in the biological world, where the framing differs. */
  titleBio?: string;
  /** One line for the index. */
  teaches: string;
  teachesBio?: string;
  section: string;
  order: number;
}

export interface Lesson extends LessonMeta {
  /** Raw markdown, world blocks still intact. */
  body: string;
}

export interface Frontmatter {
  meta: Record<string, string>;
  body: string;
}

/**
 * Read `key: value` frontmatter. Deliberately not YAML: a lesson header needs
 * six strings, and a YAML parser would be a dependency plus a surface for
 * surprises.
 */
export function parseFrontmatter(raw: string): Frontmatter {
  const normalised = raw.replace(/\r\n/g, "\n");
  if (!normalised.startsWith("---\n")) return { meta: {}, body: normalised };

  const end = normalised.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: normalised };

  const header = normalised.slice(4, end);
  const meta: Record<string, string> = {};
  for (const line of header.split("\n")) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    if (key) meta[key] = line.slice(at + 1).trim();
  }

  // Skip past the closing fence and the newline after it.
  const rest = normalised.slice(end + 4);
  return { meta, body: rest.startsWith("\n") ? rest.slice(1) : rest };
}

export class LessonError extends Error {}

const WORLD_OPEN = /^:::(bot|bio)\s*$/;
const WORLD_CLOSE = /^:::\s*$/;

/**
 * Keep only the prose meant for this world.
 *
 * Everything outside a block is shared, so a lesson's spine lives in one place
 * and only the parts that genuinely differ are written twice.
 */
export function selectWorld(body: string, theme: Theme, where = "a lesson"): string {
  const want = theme === "biological" ? "bio" : "bot";
  const out: string[] = [];
  let inside: string | null = null;
  let openedAt = 0;

  const lines = body.split("\n");
  lines.forEach((line, index) => {
    const open = WORLD_OPEN.exec(line);
    if (open && inside === null) {
      inside = open[1]!;
      openedAt = index + 1;
      return;
    }
    if (inside !== null && WORLD_CLOSE.test(line)) {
      inside = null;
      return;
    }
    if (inside === null || inside === want) out.push(line);
  });

  if (inside !== null) {
    throw new LessonError(
      `${where}: a :::${inside} block opened on line ${openedAt} is never closed with :::`,
    );
  }

  // Collapse the blank-line pile-up left where a block was removed.
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Fill in vocabulary placeholders in shared prose.
 *
 * A paragraph that is the same idea in both worlds still has to use the right
 * noun: "every {robot} is a list of things to do" reads as robot or organism
 * without being written twice. Where the *explanation* differs rather than the
 * noun, use a :::bot / :::bio block instead.
 */
export function fillVocab(body: string, theme: Theme): string {
  const w = THEMES[theme];
  const map: Record<string, string> = {
    robot: w.robot,
    robots: w.robotPlural,
    Robot: w.robot[0]!.toUpperCase() + w.robot.slice(1),
    Robots: w.robotPlural[0]!.toUpperCase() + w.robotPlural.slice(1),
    bullet: w.bullet,
    turret: w.weapon,
    arena: w.arena,
    health: w.health,
    fire: w.fireVerb,
    drive: w.driveVerb,
    skid: w.skidName,
    steered: w.steeredName,
  };
  return body.replace(/\{(\w+)\}/g, (whole, key: string) => map[key] ?? whole);
}

export interface FenceInfo {
  lang: string;
  params: Record<string, string>;
}

/** `try opponents=spinner,racer` → the language plus its settings. */
export function parseFenceInfo(info: string): FenceInfo {
  const parts = info.trim().split(/\s+/).filter(Boolean);
  const lang = parts.shift() ?? "";
  const params: Record<string, string> = {};
  for (const part of parts) {
    const at = part.indexOf("=");
    if (at === -1) params[part] = "true";
    else params[part.slice(0, at)] = part.slice(at + 1);
  }
  return { lang, params };
}

/** Every fenced block in a lesson, for validating lesson code in tests. */
export function extractCode(body: string): Array<{ info: FenceInfo; code: string }> {
  const out: Array<{ info: FenceInfo; code: string }> = [];
  const lines = body.split("\n");
  let open: { info: FenceInfo; lines: string[] } | null = null;

  for (const line of lines) {
    const fence = /^```(.*)$/.exec(line);
    if (fence && open === null) {
      open = { info: parseFenceInfo(fence[1] ?? ""), lines: [] };
      continue;
    }
    if (fence && open !== null) {
      out.push({ info: open.info, code: open.lines.join("\n") });
      open = null;
      continue;
    }
    if (open !== null) open.lines.push(line);
  }
  return out;
}

/** Languages whose contents are RoboScript and must therefore compile. */
export const CODE_LANGS = new Set(["try", "robo"]);

export function lessonTitle(lesson: LessonMeta, theme: Theme): string {
  return theme === "biological" && lesson.titleBio ? lesson.titleBio : lesson.title;
}

export function lessonTeaches(lesson: LessonMeta, theme: Theme): string {
  return theme === "biological" && lesson.teachesBio ? lesson.teachesBio : lesson.teaches;
}

/** Build a lesson from one file's raw text. */
export function toLesson(id: string, raw: string): Lesson {
  const { meta, body } = parseFrontmatter(raw);
  if (!meta["title"]) throw new LessonError(`${id}: frontmatter is missing a title`);
  if (!meta["section"]) throw new LessonError(`${id}: frontmatter is missing a section`);

  const lesson: Lesson = {
    id,
    title: meta["title"],
    teaches: meta["teaches"] ?? "",
    section: meta["section"],
    order: Number(meta["order"] ?? 0),
    body,
  };
  if (meta["titleBio"]) lesson.titleBio = meta["titleBio"];
  if (meta["teachesBio"]) lesson.teachesBio = meta["teachesBio"];
  return lesson;
}

/** Sections in the order they should be read. */
export const SECTION_ORDER = ["The game", "The language", "Reference"] as const;

export function sortLessons(lessons: readonly Lesson[]): Lesson[] {
  return [...lessons].sort((a, b) => {
    const sectionA = SECTION_ORDER.indexOf(a.section as (typeof SECTION_ORDER)[number]);
    const sectionB = SECTION_ORDER.indexOf(b.section as (typeof SECTION_ORDER)[number]);
    if (sectionA !== sectionB) return sectionA - sectionB;
    if (a.order !== b.order) return a.order - b.order;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Every lesson, discovered from the content folder. Adding a page is adding a
 * file — there is no registry to forget to update.
 */
export function loadLessons(): Lesson[] {
  const files = import.meta.glob("./content/*.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  const lessons = Object.entries(files).map(([path, raw]) => {
    const id = path.replace(/^.*\//, "").replace(/\.md$/, "");
    return toLesson(id, raw);
  });
  return sortLessons(lessons);
}
