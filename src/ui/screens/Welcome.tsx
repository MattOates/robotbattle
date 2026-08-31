/**
 * First visit: how old you are, which world, and what to call you.
 *
 * Asked once, and only once, because the answers are needed everywhere —
 * which words the editor suggests, what the arena looks like, and what other
 * people see you called in chat, trades and shared editing. Getting them here
 * is what lets someone follow a shared link straight into a room instead of
 * filling in a form first.
 *
 * Age comes first and is the only one of the three that changes the shape of
 * what follows, so asking it after the others would mean rebuilding the screen
 * underneath somebody mid-form. It is asked in bands, the answer is thrown away
 * the moment it has chosen a level, and the card says plainly what the level
 * does — so it reads as picking how you want to play rather than as a test.
 * "Show me everything" is there for the adult who resents being asked at all.
 */

import { useEffect, useState } from "react";
import { BRANDING } from "../branding.js";
import { AGE_BANDS, LEVEL_SPECS, levelForAge, type AgeBand, type Level } from "../level.js";
import { THEMES, type Theme } from "../../lang/vocab.js";

interface Props {
  /** Where they were heading, if they arrived on a shared link. */
  invitedTo: string | null;
  /** `tour` is false when they would rather just get on with it. */
  onDone: (name: string, theme: Theme, level: Level, tour: boolean) => void;
}

export function Welcome({ invitedTo, onDone }: Props) {
  const [theme, setTheme] = useState<Theme>("mechanical");
  const [name, setName] = useState("");
  // Null until answered. An invitation skips the question — somebody arriving
  // on a friend's link is mid-conversation with that friend, and three
  // questions before the door is two too many — and lands on Builder, which
  // has the rooms in it.
  const [band, setBand] = useState<AgeBand | null>(null);
  const level: Level = band ? levelForAge(band) : "builder";
  const chosen = BRANDING[theme];
  const words = THEMES[theme];

  // Preview the whole palette, not just the name — the colour is most of what
  // distinguishes the two worlds, and choosing blind would be odd.
  useEffect(() => {
    document.documentElement.dataset["arena"] = theme;
  }, [theme]);

  // And preview the level the same way, for a stronger reason. The Explorer
  // card promises big buttons and plain words; leaving the screen small and
  // dark underneath that promise makes the card a claim to be taken on trust
  // rather than a choice you can see. Nothing is committed until `onDone` —
  // this only dresses the welcome screen — but a seven-year-old picking their
  // own band should watch the game become theirs while they do it.
  useEffect(() => {
    if (!band) return;
    const root = document.documentElement;
    const chosenLevel = levelForAge(band);
    root.dataset["level"] = chosenLevel;
    root.dataset["skin"] = LEVEL_SPECS[chosenLevel].skin;
  }, [band]);

  const submit = (tour: boolean) => onDone(name, theme, level, tour);

  // Nothing below the age question until it is answered: the world cards and
  // the name field are written in one register, and which register depends on
  // this answer.
  const asked = band !== null || invitedTo !== null;

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1 className="welcome-title">
          {chosen.prefix}
          <span>{chosen.suffix}</span>
        </h1>
        <p className="welcome-strap">{chosen.strap}</p>

        {invitedTo ? (
          <div className="notice">
            You have been invited to room <strong>{invitedTo}</strong>. Answer these two
            questions and you will go straight in.
          </div>
        ) : null}

        {invitedTo ? null : (
          <>
            <fieldset className="age-choice">
              <legend className="silkscreen">How old are you?</legend>
              {AGE_BANDS.map((option) => {
                const spec = LEVEL_SPECS[option.level];
                return (
                  <button
                    key={option.id}
                    type="button"
                    className="age-card"
                    aria-pressed={band === option.id}
                    onClick={() => setBand(option.id)}
                  >
                    <span className="age-range">{option.label}</span>
                    <span className="age-level">{spec.label}</span>
                  </button>
                );
              })}
            </fieldset>
            {/* What the answer actually did, in the answer's own words. An age
                question with an invisible consequence is the kind a child
                learns to lie to. */}
            <p className="welcome-note">
              {band ? (
                LEVEL_SPECS[level].blurb
              ) : (
                <>It decides how much is on screen at once. You can change it whenever you like.</>
              )}
            </p>
            {band === null ? (
              <div className="join-actions">
                <button
                  type="button"
                  className="menu-link"
                  onClick={() => setBand("15+")}
                >
                  Just show me everything
                </button>
              </div>
            ) : null}
          </>
        )}

        {asked ? (
        <>
        <fieldset className="world-choice">
          <legend className="silkscreen">Which world?</legend>
          {(["mechanical", "biological"] as Theme[]).map((option) => {
            const brand = BRANDING[option];
            const vocab = THEMES[option];
            return (
              <button
                key={option}
                type="button"
                className="world-card"
                aria-pressed={theme === option}
                onClick={() => setTheme(option)}
              >
                <span className="world-name">
                  {brand.prefix}
                  <em>{brand.suffix}</em>
                </span>
                <span className="world-blurb">{brand.blurb}</span>
                <span className="world-words">
                  {vocab.skidName} · {vocab.steeredName} · {vocab.weapon} · {vocab.fireVerb}
                </span>
              </button>
            );
          })}
        </fieldset>
        <p className="welcome-note">
          You can change this whenever you like. It only changes the words and the
          artwork — both worlds play exactly the same.
        </p>

        <label className="field">
          <span className="silkscreen">What should people call you?</span>
          <input
            className="text-input"
            value={name}
            maxLength={24}
            autoFocus
            placeholder="Your name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) submit(!invitedTo);
            }}
          />
          <span className="roster-meta">
            Shown to other people in {words.arena} battles, trades and shared editing.
          </span>
        </label>

        {invitedTo ? (
          <div className="join-actions">
            <button
              type="button"
              className="btn primary"
              disabled={name.trim() === ""}
              onClick={() => submit(false)}
            >
              Join the room
            </button>
          </div>
        ) : (
          <>
            <div className="join-actions">
              <button
                type="button"
                className="btn primary"
                disabled={name.trim() === ""}
                onClick={() => submit(true)}
              >
                Show me how it works
              </button>
              <button
                type="button"
                className="btn"
                disabled={name.trim() === ""}
                onClick={() => submit(false)}
              >
                I'll find my own way
              </button>
            </div>
            <p className="welcome-note">
              {chosen.character.name} will walk you through building a {words.robot} that
              wins a fight — about five minutes. Skip it and you still get the finished{" "}
              {words.robot}; you just get to take it apart yourself.
            </p>
          </>
        )}
        </>
        ) : null}
      </div>
    </div>
  );
}
