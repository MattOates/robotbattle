/**
 * The RoboScript editor.
 *
 * Syntax highlighting, inline error squiggles and a completion popup that knows
 * where the cursor is — so `on` offers the eleven events, `on sense` narrows to
 * three, and `event.` inside `on sense wall` offers only the two things a wall
 * can actually tell you.
 */

import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { startCompletion } from "@codemirror/autocomplete";
import { completionCompartment, completionExtension, roboExtensions } from "./roboscript-editor.js";
import { checkScript } from "../sim/world.js";
import type { Theme } from "../lang/vocab.js";

interface Props {
  source: string;
  theme: Theme;
  onChange: (source: string) => void;
}

export function CodeEditor({ source, theme, onChange }: Props) {
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
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === source) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: source },
      // Park the cursor at the end rather than wherever it happened to be in
      // the previous robot's script.
      selection: { anchor: Math.min(source.length, source.length) },
    });
  }, [source]);

  // Swapping vocabulary reconfigures only the completion source.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: completionCompartment.reconfigure(completionExtension(theme)),
    });
  }, [theme]);

  const check = checkScript(source);

  return (
    <>
      <div className="code-editor" ref={hostRef} />
      <div className={`diagnostic ${check.ok ? "ok" : "error"}`} role="status">
        {check.ok ? (
          <>
            Ready to fight.
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
          </>
        ) : (
          <>
            <strong>Line {check.error?.line}:</strong> {check.error?.message}
            {check.error?.hint ? <span className="hint"> — {check.error.hint}</span> : null}
          </>
        )}
      </div>
    </>
  );
}
