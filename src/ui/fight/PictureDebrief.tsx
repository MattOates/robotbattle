/**
 * What happened, as two or three cards rather than a table.
 *
 * `BattleDebrief` reports a finished match as numbers — shots fired, shots hit,
 * damage dealt and taken, accuracy, instructions, suspensions. All true, all
 * worth having, and none of it an answer to the question a beginner is actually
 * asking, which is *why did that happen*. The answer is usually not in the
 * numbers at all but in what the {robot} never did, and a table of what it did
 * cannot show that. `workshop/verdict.ts` works those out; this draws them.
 *
 * The fix button is the part that matters. A beginner who has just lost does
 * not need to be told to write something they have never seen — they need to
 * see it appear, and then be told what it does. It is the same bargain the
 * quest helper makes with its snippets, and the same one the tour made before
 * either existed.
 */

import { Prose } from "../Prose.js";
import { cardSpec, newCard, type Sketch } from "../../workshop/compose.js";
import { verdict, type Finding, type MatchFacts } from "../../workshop/verdict.js";

interface Props {
  facts: MatchFacts;
  say: (both: { full: string; simple: string }) => string;
  fill: (text: string) => string;
  /**
   * Put a suggested card into the script.
   *
   * Absent when there is nothing to put it in — a guest watching somebody
   * else's trial, say — and the button simply does not appear.
   */
  onFix?: ((cardId: string) => void) | undefined;
  /** The full numbers, for anyone who wants them. */
  onDetail?: (() => void) | undefined;
}

/**
 * How many findings to show.
 *
 * Three. Two is usually the whole story and four is the table this exists to
 * replace — and the list is sorted by usefulness, so the ones that fall off the
 * end are the ones nobody needed.
 */
const SHOW = 3;

export function PictureDebrief({ facts, say, fill, onFix, onDetail }: Props) {
  const findings = verdict(facts).slice(0, SHOW);

  return (
    <section className="picture-debrief">
      <ol className="findings">
        {findings.map((finding) => (
          <li key={finding.id}>
            <FindingCard finding={finding} say={say} fill={fill} onFix={onFix} />
          </li>
        ))}
      </ol>

      {onDetail ? (
        <button type="button" className="btn small" onClick={onDetail}>
          Show me the numbers
        </button>
      ) : null}
    </section>
  );
}

function FindingCard({
  finding,
  say,
  fill,
  onFix,
}: {
  finding: Finding;
  say: (both: { full: string; simple: string }) => string;
  fill: (text: string) => string;
  onFix?: ((cardId: string) => void) | undefined;
}) {
  const cardId = finding.fix?.cardId;
  const spec = cardId ? cardSpec(cardId) : undefined;

  return (
    <div className={`finding finding-${finding.id}`}>
      <span className="finding-icon" aria-hidden="true">
        {finding.icon}
      </span>
      <span className="finding-body">
        <span className="finding-say">
          <Prose text={fill(say(finding.say))} />
        </span>
        {finding.fix ? (
          <span className="finding-fix">
            <Prose text={fill(say(finding.fix.say))} />
          </span>
        ) : null}
        {spec && onFix ? (
          <button type="button" className="btn primary small" onClick={() => onFix(cardId!)}>
            {spec.icon} Add it for me
          </button>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Put a suggested card where it belongs.
 *
 * Not simply appended to the end of the script: a `fire` belongs inside the
 * handler that saw something, and a `turret.sweep` belongs at the start. The
 * card the verdict names carries its own sense of where it goes, and if the
 * right handler does not exist yet this returns null rather than putting the
 * card somewhere it would not run — the finding's own words already say to add
 * the handler.
 */
export function whereFixGoes(sketch: Sketch, cardId: string): string | null {
  const wants = cardId === "turret-sweep" ? "start" : "sense robot";
  const block = sketch.blocks.find((b) => b.event === wants);
  return block?.id ?? null;
}

export { newCard };
