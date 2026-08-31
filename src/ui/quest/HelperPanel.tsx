/**
 * The helper, in the layout rather than on top of it.
 *
 * This replaces the coach-mark tour for the playground skin, and the reason is
 * structural rather than cosmetic. `tour/Tour.tsx` positions a floating card by
 * arithmetic over measured rectangles, and it has to know how big the card is
 * before rendering it — `const CARD = { width: 340, height: 260 }`. In the
 * instrument skin that constant is true. In this one the same card renders
 * about 570px tall, so every calculation built on it was wrong by more than
 * double: the overlay cleared the editor by its own reckoning while burying
 * the robot library, and ran under the journey bar.
 *
 * That is not a constant to correct. Measuring the card instead only moves the
 * problem — place it, it reflows, re-measure, place it again — and any future
 * change to type or spacing re-breaks it. A tutorial that floats over a layout
 * has to keep guessing about that layout.
 *
 * So this one is *in* the layout. It is a panel in the Workshop's right-hand
 * column, above the tabs, and it takes up real space: it reflows like anything
 * else, it can never cover the thing it is talking about, and it needs no
 * scrim, no portal, no anchors and no measurement.
 *
 * There was a second reason to stop running the tour here. The Explorer quest
 * arc *is* the workshop tour — the same five beats, ending at the same {robot}
 * — so a player was being taught the same lesson twice at once, with "Step 9 of
 * 20" in one corner disagreeing with "Quests 1/5" in the other.
 *
 * What is kept from the tour is the part a checklist genuinely cannot do:
 * being handed a working handler and *then* told what it does. `insert` and
 * `applySnippet` come across unchanged.
 */

import { Avatar } from "../character/Avatar.js";
import { Prose } from "../Prose.js";
import { applySnippet } from "../tour/steps.js";
import { stepKey, type Quest, type Step } from "../../workshop/quests.js";
import type { Theme } from "../../lang/vocab.js";

interface Props {
  quest: Quest;
  step: Step;
  theme: Theme;
  say: (both: { full: string; simple: string }) => string;
  fill: (text: string) => string;
  /** The script being edited, and how to change it. Absent outside the editor. */
  script: { source: string; onChange: (next: string) => void; editable: boolean } | null;
  /** How far through the quest, for the pips. */
  done: ReadonlySet<string>;
  speak?: (text: string) => void;
}

export function HelperPanel({ quest, step, theme, say, fill, script, done, speak }: Props) {
  const met = quest.steps.filter((s) => done.has(stepKey(quest, s))).length;
  const help = step.help ? fill(say(step.help)) : null;
  // Only offered where it can be applied: an insert button beside a script
  // somebody is not allowed to change is a button that does nothing.
  const canInsert = step.insert && script?.editable === true;

  return (
    <section className="helper">
      <span className="helper-face" aria-hidden="true">
        <Avatar theme={theme} state="talking" size={44} />
      </span>

      <div className="helper-body">
        <p className="helper-say">
          <span className="helper-icon" aria-hidden="true">
            {quest.icon}
          </span>
          {fill(say(step.say))}
        </p>

        {help ? (
          <p className="helper-help">
            <Prose text={help} />
          </p>
        ) : null}

        <div className="helper-actions">
          {canInsert ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => script!.onChange(applySnippet(script!.source, step.insert!))}
            >
              {step.insert!.label}
            </button>
          ) : null}

          {/* Reading it out is offered rather than automatic here. The toasts
              announce themselves; this panel is always on screen, and a voice
              that started every time the step changed would talk over the
              player working. */}
          {speak && help ? (
            <button
              type="button"
              className="btn small"
              onClick={() => speak(`${fill(say(step.say))}. ${help}`)}
              aria-label="Read this out"
            >
              🔊
            </button>
          ) : null}

          <span className="spacer" />
          <span className="quest-pips" aria-label={`${met} of ${quest.steps.length} done`}>
            {quest.steps.map((s, i) => (
              <i key={s.id} className={i < met ? "on" : ""} />
            ))}
          </span>
        </div>
      </div>
    </section>
  );
}
