/**
 * Whether the {robot} will run, said the same way everywhere.
 *
 * This lived inside `CodeEditor`, which was right while typing was the only way
 * to write a {robot}. It is not any more, and the consequence was a dead end
 * with no way out of it: a script that will not compile disables the Start
 * button, and at the simple register there is no editor tab — so a child got a
 * button that would not press and a tooltip telling them to "fix the line the
 * editor is complaining about", about an editor they cannot open, concerning a
 * line they cannot see.
 *
 * Note what this deliberately does *not* do: reword the compiler. The
 * diagnostics in `lang/diagnostics.ts` are already first-person plain English
 * with a worked hint — "`set seen` needs an `=` and a value", "try `set seen =
 * 0`" — written in the author's own spelling. Rewriting those for a child would
 * be gilding, and would lose the one thing a message like that has, which is
 * being exactly about the thing that is wrong.
 *
 * What the simple register adds is the part the compiler cannot know: that the
 * reader may have built this by tapping, has never seen a line number, and
 * needs a way to get to the problem rather than a description of it.
 */

import { useMemo } from "react";
import { Prose } from "./Prose.js";
import { checkScript } from "../sim/world.js";
import type { Register } from "./level.js";

interface Props {
  source: string;
  register: Register;
  /** Take me to the problem. Absent when there is nowhere to go. */
  onShow?: (() => void) | undefined;
  /** What the button says, since where it goes differs by view. */
  showLabel?: string;
  /** Extra status text alongside the result — who else is editing, say. */
  suffix?: React.ReactNode;
  /** Offered next to a clean script in the editor only. */
  children?: React.ReactNode;
}

export function ScriptStatus({ source, register, onShow, showLabel, suffix, children }: Props) {
  // Compiling on every keystroke is what the editor already did; it is a few
  // hundred microseconds on a script this size.
  const check = useMemo(() => checkScript(source), [source]);
  const simple = register === "simple";

  if (check.ok) {
    /*
     * Nothing to say, so nothing said.
     *
     * "Ready to fight" is worth a line in the editor, where it is the answer to
     * "did that last keystroke break anything" and sits beside the suggestions
     * hint. Everywhere else it is a sixty-five pixel bar reporting the absence
     * of news, and it was taking that from the arena.
     */
    if (!children && !suffix) return null;
    return (
      <div className="diagnostic ok" role="status">
        {simple ? "Your robot is ready to fight." : "Ready to fight."}
        {children}
        {suffix}
      </div>
    );
  }

  const line = check.error?.line;
  return (
    <div className="diagnostic error" role="status">
      {simple ? (
        <>
          <strong>Something here does not make sense yet.</strong>{" "}
          <Prose text={check.error?.message ?? ""} />
          {check.error?.hint ? (
            <span className="hint">
              {" — "}
              <Prose text={check.error.hint} />
            </span>
          ) : null}
          {/*
            * A line number is the compiler's way of pointing, and it is no use
            * to somebody who has never seen the lines. The button is.
            */}
          {onShow ? (
            <button type="button" className="btn small" onClick={onShow}>
              {showLabel ?? "Show me"}
            </button>
          ) : null}
        </>
      ) : (
        <>
          <strong>Line {line}:</strong> <Prose text={check.error?.message ?? ""} />
          {check.error?.hint ? (
            <span className="hint">
              {" — "}
              <Prose text={check.error.hint} />
            </span>
          ) : null}
        </>
      )}
      {suffix}
    </div>
  );
}

/** Whether a script will run at all. Shared so nobody re-implements it. */
export function scriptRuns(source: string): boolean {
  return checkScript(source).ok;
}
