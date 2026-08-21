/**
 * Learn: the guide, the tutorial and the reference.
 *
 * Lessons are markdown. A ```try fence becomes a live editor and arena; every
 * other RoboScript block is rendered in the reader's world by the translator,
 * so an example is written once and read in whichever vocabulary they chose.
 */

import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { navigate } from "../router.js";
import { Playground, PlaygroundBoundary } from "../../learn/Playground.js";
import { translate } from "../../learn/translate.js";
import {
  lessonTeaches,
  lessonTitle,
  fillVocab,
  loadLessons,
  parseFenceInfo,
  selectWorld,
  SECTION_ORDER,
  type Lesson,
} from "../../learn/markdown.js";
import { Progress } from "../../store/progress.js";
import { BRANDING } from "../branding.js";
import type { Theme } from "../../lang/vocab.js";

/** Module level, so the array is not a new value on every render. */
const REMARK_PLUGINS = [remarkGfm];

interface Props {
  theme: Theme;
  /** Lesson id from the route, if any. */
  lessonId: string | null;
}

export function Learn({ theme, lessonId }: Props) {
  const lessons = useMemo(() => loadLessons(), []);
  const progress = useMemo(() => new Progress(), []);
  const [done, setDone] = useState<ReadonlySet<string>>(() => progress.done());

  const current = lessonId ? lessons.find((l) => l.id === lessonId.toLowerCase()) : undefined;

  if (!current) {
    return <LearnIndex lessons={lessons} theme={theme} done={done} progress={progress} />;
  }

  return (
    <LessonView
      lesson={current}
      lessons={lessons}
      theme={theme}
      isDone={done.has(current.id)}
      onDone={(value) => {
        if (value) progress.markDone(current.id);
        else progress.markUndone(current.id);
        setDone(progress.done());
      }}
    />
  );
}

// ---------------------------------------------------------------------------

function LearnIndex({
  lessons,
  theme,
  done,
  progress,
}: {
  lessons: Lesson[];
  theme: Theme;
  done: ReadonlySet<string>;
  progress: Progress;
}) {
  const brand = BRANDING[theme];
  const next = progress.next(lessons.map((l) => l.id));

  return (
    <div className="learn">
      <header className="screen-head">
        <button type="button" className="btn small" onClick={() => navigate("menu")}>
          ← Menu
        </button>
        <h2 className="screen-title">Learn</h2>
        <span className="spacer" />
        {next ? (
          <button type="button" className="btn small primary" onClick={() => navigate("learn", next)}>
            {done.size === 0 ? "Start" : "Continue"} →
          </button>
        ) : (
          <span className="roster-meta">All read</span>
        )}
      </header>

      <div className="learn-body">
        <p className="learn-lead">
          How {brand.full} works, and how to write a robot for it — one idea at a time, with
          something you can change and run on every page.
        </p>

        {SECTION_ORDER.map((section) => {
          const inSection = lessons.filter((l) => l.section === section);
          if (inSection.length === 0) return null;
          return (
            <section key={section} className="learn-section">
              <h3 className="silkscreen">{section}</h3>
              <ol className="learn-list">
                {inSection.map((lesson) => (
                  <li key={lesson.id}>
                    <button
                      type="button"
                      className={`learn-item${done.has(lesson.id) ? " done" : ""}`}
                      onClick={() => navigate("learn", lesson.id)}
                    >
                      <span className="learn-tick" aria-hidden="true">
                        {done.has(lesson.id) ? "✓" : "○"}
                      </span>
                      <span className="learn-item-title">{lessonTitle(lesson, theme)}</span>
                      <span className="roster-meta">{lessonTeaches(lesson, theme)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LessonView({
  lesson,
  lessons,
  theme,
  isDone,
  onDone,
}: {
  lesson: Lesson;
  lessons: Lesson[];
  theme: Theme;
  isDone: boolean;
  onDone: (value: boolean) => void;
}) {
  const index = lessons.findIndex((l) => l.id === lesson.id);
  const previous = index > 0 ? lessons[index - 1] : undefined;
  const next = index < lessons.length - 1 ? lessons[index + 1] : undefined;

  // Only the prose meant for this world survives; everything outside a
  // :::bot / :::bio block is shared.
  const body = useMemo(() => {
    try {
      return fillVocab(selectWorld(lesson.body, theme, lesson.id), theme);
    } catch (err) {
      return `> This lesson could not be read: ${(err as Error).message}`;
    }
  }, [lesson, theme]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [lesson.id]);

  // Both of these must keep the same identity between renders. react-markdown
  // builds its elements fresh every render, so if `code` is a new function each
  // time, React sees a new component TYPE and unmounts the old one — which
  // destroys the Pixi renderer inside every example on the page and starts it
  // again. The arena's init is async, so a remount that happens while it is
  // still initialising leaves a widget with no canvas at all: exactly the
  // flicker-then-nothing this used to do.
  const components = useMemo(
    () => ({
      // The custom block replaces the whole <pre>, so `pre` gets out of the
      // way and `code` decides what to render.
      pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
      code: (props: Omit<CodeProps, "theme">) => <CodeBlock {...props} theme={theme} />,
    }),
    [theme],
  );

  return (
    <div className="learn">
      <header className="screen-head">
        <button type="button" className="btn small" onClick={() => navigate("learn")}>
          ← All lessons
        </button>
        <h2 className="screen-title">{lessonTitle(lesson, theme)}</h2>
        <span className="spacer" />
        <label className="check">
          <input type="checkbox" checked={isDone} onChange={(e) => onDone(e.target.checked)} />
          Read
        </label>
      </header>

      <article className="learn-body prose">
        <Markdown remarkPlugins={REMARK_PLUGINS} components={components}>
          {body}
        </Markdown>

        <nav className="learn-nav">
          {previous ? (
            <button
              type="button"
              className="btn small"
              onClick={() => navigate("learn", previous.id)}
            >
              ← {lessonTitle(previous, theme)}
            </button>
          ) : (
            <span />
          )}
          {next ? (
            <button
              type="button"
              className="btn small primary"
              onClick={() => {
                onDone(true);
                navigate("learn", next.id);
              }}
            >
              {lessonTitle(next, theme)} →
            </button>
          ) : (
            <button
              type="button"
              className="btn small primary"
              onClick={() => {
                onDone(true);
                navigate("workshop");
              }}
            >
              Go and build one →
            </button>
          )}
        </nav>
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface CodeProps {
  className?: string | undefined;
  children?: React.ReactNode;
  node?: unknown;
  theme: Theme;
}

function CodeBlock({ className, children, node, theme }: CodeProps) {
  const text = String(children ?? "").replace(/\n$/, "");
  const language = /language-(\w+)/.exec(className ?? "")?.[1];

  // Inline code is RoboScript too — `chassis` should read as `body` in the
  // biological world, exactly as it does in the blocks.
  if (!language) return <code className="inline-code">{translate(text, theme)}</code>;

  // The fence's extra words (`try opponents=spinner`) ride along as meta.
  const meta = (node as { data?: { meta?: string } } | undefined)?.data?.meta ?? "";
  const { params } = parseFenceInfo(`${language} ${meta}`);

  if (language === "try") {
    return (
      <PlaygroundBoundary>
        <Playground
          source={translate(text, theme)}
          opponents={params["opponents"] ?? ""}
          theme={theme}
          cones={params["cones"] === "true"}
          fuel={params["fuel"] === "true"}
          terrain={params["terrain"] === "true"}
          maze={params["maze"] === "true"}
        />
      </PlaygroundBoundary>
    );
  }

  if (language === "robo") {
    return (
      <pre className="robo-block">
        <code>{translate(text, theme)}</code>
      </pre>
    );
  }

  return (
    <pre className="robo-block plain">
      <code>{text}</code>
    </pre>
  );
}
