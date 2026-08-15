/**
 * Friendly errors.
 *
 * The audience includes children, so an error is a teaching moment, not a stack
 * trace. Every error carries a source position and, where we can, a hint about
 * what to do rather than only what went wrong.
 */

export interface SourcePos {
  line: number;
  col: number;
}

export class RoboScriptError extends Error {
  readonly line: number;
  readonly col: number;
  readonly hint: string | undefined;

  constructor(message: string, pos: SourcePos, hint?: string) {
    super(message);
    this.name = "RoboScriptError";
    this.line = pos.line;
    this.col = pos.col;
    this.hint = hint;
  }

  /** Single-line form for logs and test snapshots. */
  format(): string {
    const base = `line ${this.line}: ${this.message}`;
    return this.hint ? `${base}\n  hint: ${this.hint}` : base;
  }
}

/**
 * Render an error against the source with a caret, the way a good compiler does.
 * Used by the editor's error panel.
 */
export function formatWithSource(err: RoboScriptError, source: string): string {
  const lines = source.split("\n");
  const lineText = lines[err.line - 1] ?? "";
  const caret = " ".repeat(Math.max(0, err.col - 1)) + "^";
  const parts = [
    `line ${err.line}: ${err.message}`,
    "",
    `  ${lineText}`,
    `  ${caret}`,
  ];
  if (err.hint) parts.push("", `  hint: ${err.hint}`);
  return parts.join("\n");
}
