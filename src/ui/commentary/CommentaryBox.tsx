/**
 * The commentator's corner: a face and the last few things said.
 *
 * Sits over the arena rather than beside it, because every screen that wants
 * one is already full and a caption belongs near the thing it is describing.
 * It does not intercept clicks — a match has controls underneath it.
 */

import { Avatar } from "../character/Avatar.js";
import type { CommentaryApi } from "./useCommentator.js";

export function CommentaryBox({
  commentary,
  inline = false,
}: {
  commentary: CommentaryApi;
  /**
   * Sit in the layout rather than over the arena.
   *
   * For the bracket, where there is no match on screen to lie on top of but
   * plenty to announce — who went through, and who won the whole thing.
   */
  inline?: boolean;
}) {
  if (!commentary.on || commentary.captions.length === 0) return null;

  return (
    <div className={`commentary${inline ? " inline" : ""}`} aria-live="polite">
      <Avatar theme={commentary.presenterTheme} state="talking" size={30} />
      <div className="commentary-lines">
        <span className="silkscreen commentary-who">{commentary.presenter.name}</span>
        {commentary.captions.map((caption, i) => (
          <span
            key={caption.id}
            className="commentary-line"
            // The newest line is the one being said; the older ones are there
            // to catch up on, and fade back so the eye finds the current one.
            style={{ opacity: 0.35 + (0.65 * (i + 1)) / commentary.captions.length }}
          >
            {caption.text}
          </span>
        ))}
      </div>
    </div>
  );
}
