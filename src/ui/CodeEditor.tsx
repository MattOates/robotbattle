/**
 * The RoboScript editor.
 *
 * Syntax highlighting, inline error squiggles and a completion popup that knows
 * where the cursor is — so `on` offers the eleven events, `on sense` narrows to
 * three, and `event.` inside `on sense wall` offers only the two things a wall
 * can actually tell you.
 */

import { useEffect, useRef } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { startCompletion } from "@codemirror/autocomplete";
import { completionCompartment, completionExtension, roboExtensions } from "./roboscript-editor.js";
import { checkScript } from "../sim/world.js";
import type { Theme } from "../lang/vocab.js";

const readOnlyCompartment = new Compartment();

interface Props {
  source: string;
  theme: Theme;
  onChange: (source: string) => void;
  /**
   * Shared-editing extension (yCollab). When present the document belongs to
   * the CRDT, so this component stops pushing `source` into the editor — two
   * writers fighting over the same document is exactly the bug Yjs exists to
   * prevent.
   */
  collab?: Extension | undefined;
  /**
   * Shown but not editable — the host is browsing another robot mid-session.
   * Only the session robot is editable, so that showing someone a script does
   * not quietly fork it.
   */
  readOnly?: boolean;
  /**
   * Someone else's script, shown for reading and nothing else: not editable,
   * not selectable, no caret, no compile status.
   *
   * Stronger than `readOnly`, and for a different reason. `readOnly` stops you
   * changing your own document by accident; this stops a script leaving its
   * owner's hands at all. In a trade the whole transaction is "you may have
   * this if I say yes", and a preview you could select and copy out would make
   * that agreement decorative. It is not a lock — anyone determined can read it
   * off the wire — but it means the only route into a library is the one with
   * consent in it.
   */
  preview?: boolean;
  /** Extra status text alongside the compile result, e.g. who else is editing. */
  statusSuffix?: React.ReactNode;
}

/** Swallow an event that would carry text out of the editor. */
function refuse(event: Event): boolean {
  event.preventDefault();
  return true;
}

export function CodeEditor({
  source,
  theme,
  onChange,
  collab,
  readOnly = false,
  preview = false,
  statusSuffix,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Read inside the update listener without re-creating the editor.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source,
        extensions: [
          ...roboExtensions(theme),
          ...(collab ? [collab] : []),
          readOnlyCompartment.of(EditorState.readOnly.of(readOnly || preview)),
          // `editable` false is what actually removes the caret and keeps the
          // browser from treating the content as a text field; the rest closes
          // the ordinary ways text walks out of one.
          ...(preview
            ? [
                EditorView.editable.of(false),
                EditorView.domEventHandlers({
                  copy: refuse,
                  cut: refuse,
                  dragstart: refuse,
                  contextmenu: refuse,
                }),
              ]
            : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // Built once. Content and theme are applied below without losing history
    // or cursor position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adopt a new script when the player switches robot or loads an example.
  // Skipped entirely while collaborating: there, the document is the CRDT's.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || collab) return;
    const current = view.state.doc.toString();
    if (current === source) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: source },
      // Park the cursor at the end rather than wherever it happened to be in
      // the previous robot's script.
      selection: { anchor: Math.min(source.length, source.length) },
    });
  }, [source]);

  // Read-only is toggled in place rather than by rebuilding the editor, so
  // scroll position and history survive browsing away and back.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly || preview)),
    });
  }, [preview, readOnly]);

  // Swapping vocabulary reconfigures only the completion source.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: completionCompartment.reconfigure(completionExtension(theme)),
    });
  }, [theme]);

  // Someone else's script gets no verdict from us. Whether it compiles is
  // their business, and a status line under a preview reads as a review.
  if (preview) {
    return <div className="code-editor no-copy" ref={hostRef} />;
  }

  const check = checkScript(source);

  return (
    <>
      <div className="code-editor" ref={hostRef} />
      <div className={`diagnostic ${check.ok ? "ok" : "error"}`} role="status">
        {check.ok ? (
          <>
            Ready to fight.
            {/* Not offered on a script you cannot type into — someone else's,
                or one you are only being shown. */}
            {readOnly ? null : (
              <button
                type="button"
                className="ghost-hint"
                onClick={() => {
                  const view = viewRef.current;
                  if (!view) return;
                  view.focus();
                  startCompletion(view);
                }}
              >
                Press Ctrl-Space for suggestions
              </button>
            )}
          </>
        ) : (
          <>
            <strong>Line {check.error?.line}:</strong> {check.error?.message}
            {check.error?.hint ? <span className="hint"> — {check.error.hint}</span> : null}
          </>
        )}
        {statusSuffix}
      </div>
    </>
  );
}
