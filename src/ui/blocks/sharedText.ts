/**
 * Writing a regenerated script into a shared document.
 *
 * The block editor produces a whole script each time anything changes, and the
 * obvious way to store that in a `Y.Text` — delete everything, insert the new
 * everything — is the wrong way. To a CRDT that is not "this line changed", it
 * is "the entire document was replaced", and two people editing different
 * handlers would each replace the other's work rather than merging with it.
 *
 * So the whole-document write is turned back into the small edit it really
 * was. That works here specifically because the block view round-trips
 * verbatim: everything nobody touched serialises to the identical characters,
 * so the difference between before and after really is just the part that
 * changed. Dragging a block in one handler produces a diff the length of that
 * handler, and somebody else's edit elsewhere merges cleanly beside it.
 *
 * Pure, so `tests/workshop/sharedText.test.ts` can assert the property that
 * matters without a peer or a browser.
 */

export interface Edit {
  at: number;
  remove: number;
  insert: string;
}

/**
 * The one contiguous edit that turns `before` into `after`.
 *
 * Longest common prefix, longest common suffix, and whatever is left in the
 * middle. Not a minimal diff in the general sense — two edits far apart come
 * out as one span covering both — but the block editor changes one thing at a
 * time, so in practice the span is the thing that changed.
 */
export function diff(before: string, after: string): Edit | null {
  if (before === after) return null;

  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start++;

  let end = 0;
  while (
    end < max - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }

  return {
    at: start,
    remove: before.length - start - end,
    insert: after.slice(start, after.length - end),
  };
}

/** What a `Y.Text` looks like from here. Kept narrow so the tests need no Yjs. */
export interface SharedText {
  toString(): string;
  delete(index: number, length: number): void;
  insert(index: number, text: string): void;
  doc: { transact(f: () => void): void } | null;
}

/**
 * Apply a regenerated script to a shared text as one small edit.
 *
 * Wrapped in a transaction so peers see one change rather than a delete
 * followed by an insert — without it a remote editor briefly renders the
 * document with a hole in it.
 */
export function writeShared(text: SharedText, next: string): boolean {
  const edit = diff(text.toString(), next);
  if (!edit) return false;
  const run = () => {
    if (edit.remove > 0) text.delete(edit.at, edit.remove);
    if (edit.insert !== "") text.insert(edit.at, edit.insert);
  };
  if (text.doc) text.doc.transact(run);
  else run();
  return true;
}
