/**
 * "You are here" — the rule you are typing, drawn as track.
 *
 * The hardest moment for somebody learning this language is the one the editor
 * used to say least about: the cursor is after `turn ` and nothing on screen
 * says what may come next. The completion popup knows, but only if you know the
 * popup exists and press the key that opens it.
 *
 * So this sits under the editor and answers without being asked. It shows the
 * rule the cursor is inside, what that rule is for, and its railroad diagram
 * with the track already typed dimmed and the words that could come next lit
 * up. The lit words are buttons: clicking one types it.
 *
 * All of it comes from the grammar the parser runs, by way of
 * `pathAt` in `complete.ts` and `reference.ts` — so it cannot suggest a word
 * the parser would then refuse.
 */

import { useMemo } from "react";
import type { EditorView } from "@codemirror/view";
import { completionKeepsGoing, pathAt } from "../lang/complete.js";
import { renderDoc } from "../lang/events.js";
import { railroad } from "./railroad.js";
import { Prose } from "./Prose.js";
import { wordFor, type Theme } from "../lang/vocab.js";

interface Props {
  source: string;
  /** Cursor offset, from the editor. */
  pos: number;
  theme: Theme;
  /**
   * The editor, as a ref rather than a value.
   *
   * It is created in an effect after the first render, and a ref filling in
   * does not re-render anything — so a value captured here would have been
   * `null` for the lifetime of the component and every click would have done
   * nothing at all.
   */
  viewRef: React.RefObject<EditorView | null>;
  open: boolean;
  onOpen: (open: boolean) => void;
}

export function GrammarGuide({ source, pos, theme, viewRef, open, onOpen }: Props) {
  const path = useMemo(() => pathAt(source, pos), [source, pos]);
  // No diagram while the line could still be anything: `statement` covers every
  // instruction there is, and its picture is a wall of boxes that answers
  // nothing. The list of next words in the header is the useful answer there.
  const svg = useMemo(
    () =>
      path && !path.broad
        ? railroad(path.rule.syntax, theme, { done: path.done, next: path.next })
        : "",
    [path, theme],
  );

  // Nothing sensible to say about a line the language cannot read. Saying so
  // would only add noise to a screen that already has an error on it.
  if (!path) return null;

  const type = (word: string) => {
    const view = viewRef.current;
    if (!view) return;
    const spaced = completionKeepsGoing(word) ? `${word} ` : word;
    const at = view.state.selection.main.head;
    // A space in front unless the line already ends in one, so clicking two
    // words in a row does not produce `turnto`.
    const before = view.state.sliceDoc(Math.max(0, at - 1), at);
    const lead = at > 0 && before !== " " && before !== "\n" ? " " : "";
    view.dispatch({
      changes: { from: at, insert: lead + spaced },
      selection: { anchor: at + lead.length + spaced.length },
    });
    view.focus();
  };

  return (
    <div className={`guide${open ? " open" : ""}`}>
      <button
        type="button"
        className="guide-head"
        onClick={() => onOpen(!open)}
        aria-expanded={open}
      >
        <span className="guide-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="guide-title">{renderDoc(path.rule.title, theme)}</span>
        <span className="guide-hint">
          {path.words.length > 0
            ? `next: ${path.words.map((w) => wordFor(w, theme)).join(", ")}`
            : path.wantsValue
              ? "a value goes here"
              : path.complete
                ? "this line is finished"
                : ""}
        </span>
      </button>

      {open ? (
        <div className="guide-body">
          <p className="guide-summary">
            <Prose text={renderDoc(path.rule.summary, theme)} />
          </p>
          {/* Always the chips, not only when there is no diagram. A word can be
              named in the header and still have no box of its own on the
              picture — `to` and `by` live inside the `to or by` rule, which
              draws as one box — so the chips are the one place every next word
              is reliably clickable. */}
          {path.words.length > 0 ? (
            <div className="guide-words">
              {path.words.map((word) => (
                <button
                  key={word}
                  type="button"
                  className="guide-word"
                  onClick={() => type(word)}
                >
                  {wordFor(word, theme)}
                </button>
              ))}
            </div>
          ) : null}
          <div
            className="guide-diagram"
            onClick={(event) => {
              const box = (event.target as Element).closest?.("[data-insert]");
              const word = box?.getAttribute("data-insert");
              if (word) type(word);
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          {path.wantsValue ? (
            <p className="guide-note">
              A value goes here: a number, a variable, or something like{" "}
              <code>me.heading</code>.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
