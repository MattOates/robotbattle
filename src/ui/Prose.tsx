/**
 * Backticked spans as real code, without pulling in a markdown renderer.
 *
 * The prose in `reference.ts`, `EVENT_DOCS` and the rest is written the way the
 * completion popup wants it — plain text with backticks — because that is where
 * most of it is also shown. Rendering it as markdown here would mean the two
 * places disagreed about what is allowed in it; this way a backtick means the
 * one thing everywhere.
 */
export function Prose({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>,
      )}
    </>
  );
}
