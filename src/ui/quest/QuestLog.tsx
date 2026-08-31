/**
 * The map of the game, for somebody who cannot read the menu.
 *
 * The menu describes six modes in a paragraph each and leaves the choosing to
 * you. That works if you already know what a tournament is for. The quest log
 * answers a smaller and much more useful question — *what do I do now* — with
 * one sentence and a button that goes there.
 *
 * Finished quests stay, collapsed, because the list of things you have done is
 * the only record this game keeps of getting better at it.
 */

import { isQuestDone, stepKey, type Quest, type Step } from "../../workshop/quests.js";
import { navigate } from "../router.js";
import type { QuestApi } from "./useQuests.js";

interface Props {
  quests: QuestApi;
  open: boolean;
  onClose: () => void;
  say: (both: { full: string; simple: string }) => string;
  fill: (text: string) => string;
}

export function QuestLog({ quests, open, onClose, say, fill }: Props) {
  if (!open) return null;

  const todo = quests.quests.filter((q) => !isQuestDone(q, quests.done));
  const doneQuests = quests.quests.filter((q) => isQuestDone(q, quests.done));

  return (
    <div className="quest-log" role="dialog" aria-label="Your quests">
      <div className="panel-head">
        <span className="silkscreen">Your quests</span>
        <span className="spacer" />
        <button type="button" className="btn small" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="quest-log-body">
        {todo.length === 0 ? (
          <p className="empty">
            Everything here is done. {quests.offeringLevelUp ? "There is more — say the word." : ""}
          </p>
        ) : null}

        {todo.map((quest, index) => (
          <QuestCard
            key={quest.id}
            quest={quest}
            quests={quests}
            say={say}
            fill={fill}
            /* Only the first is opened. The rest are a promise that there is
               more, not a list to plan against. */
            current={index === 0}
            onGo={onClose}
          />
        ))}

        {doneQuests.length > 0 ? (
          <div className="quest-trophies">
            <span className="silkscreen">Done</span>
            <ul>
              {doneQuests.map((quest) => (
                <li key={quest.id}>
                  <span aria-hidden="true">{quest.icon}</span> {say(quest.title)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function QuestCard({
  quest,
  quests,
  say,
  fill,
  current,
  onGo,
}: {
  quest: Quest;
  quests: QuestApi;
  say: (both: { full: string; simple: string }) => string;
  fill: (text: string) => string;
  current: boolean;
  onGo: () => void;
}) {
  const firstUnmet: Step | undefined = quest.steps.find(
    (s) => !quests.done.has(stepKey(quest, s)),
  );

  return (
    <section className={`quest-card${current ? " current" : " later"}`}>
      <h3 className="quest-title">
        <span aria-hidden="true">{quest.icon}</span> {say(quest.title)}
      </h3>

      {current ? (
        <ol className="quest-steps">
          {quest.steps.map((step) => {
            const met = quests.done.has(stepKey(quest, step));
            const next = step === firstUnmet;
            return (
              <li key={step.id} className={met ? "met" : next ? "next" : ""}>
                <span className="quest-tick" aria-hidden="true">
                  {met ? "✓" : "○"}
                </span>
                <span>{fill(say(step.say))}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {/* One button, pointing at one place. The whole reason the log exists is
          that "what do I do now" should be answerable by pressing something. */}
      {current && firstUnmet?.goTo ? (
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            navigate(firstUnmet.goTo!.screen);
            onGo();
          }}
        >
          Take me there
        </button>
      ) : null}
    </section>
  );
}
