/**
 * One line of RoboScript, highlighted, outside the editor.
 *
 * The Behaviour Inspector shows the player their own script next to what it
 * did. Reading it in flat monochrome while the editor two panels away colours
 * every word makes it feel like a different language, so it reuses the
 * editor's own classification rather than approximating it: `scanLine` splits
 * the line and `styleFor` names the role, exactly as the CodeMirror theme
 * does. Only the painting differs — CSS classes here, highlight tags there —
 * and both take their colours from the same `--syn-*` tokens.
 *
 * Highlighting is per-line and stateless because RoboScript has no multi-line
 * constructs, so there is nothing to carry between lines.
 */

import { scanLine } from "../lang/scan.js";
import { styleFor } from "./roboscript-editor.js";

export interface ScriptPart {
  text: string;
  /** What `styleFor` called it, or null for the gaps between tokens. */
  style: string | null;
}

/**
 * Split a line into styled runs. The gaps between tokens — indentation and the
 * spaces between words — are not tokens, so they are carried through as
 * unstyled parts. Concatenating every part must reproduce the line exactly:
 * anything else would quietly delete a player's code from the display.
 */
export function scriptParts(text: string): ScriptPart[] {
  const tokens = scanLine(text);
  const parts: ScriptPart[] = [];
  let at = 0;
  tokens.forEach((token, index) => {
    if (token.start > at) parts.push({ text: text.slice(at, token.start), style: null });
    parts.push({ text: token.text, style: styleFor(token, tokens[index - 1]) });
    at = token.end;
  });
  if (at < text.length) parts.push({ text: text.slice(at), style: null });
  return parts;
}

export function ScriptLine({ text }: { text: string }) {
  // A blank line still has to occupy its row.
  if (text === "") return <code> </code>;
  const parts = scriptParts(text);

  return (
    <code>
      {parts.map((part, index) =>
        part.style
          ? <span key={index} className={`syn-${part.style}`}>{part.text}</span>
          : part.text,
      )}
    </code>
  );
}
