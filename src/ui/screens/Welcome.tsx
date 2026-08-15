/**
 * First visit: pick a world, pick a name.
 *
 * Asked once, and only once, because the answers are needed everywhere —
 * which words the editor suggests, what the arena looks like, and what other
 * people see you called in chat, trades and shared editing. Getting them here
 * is what lets someone follow a shared link straight into a room instead of
 * filling in a form first.
 */

import { useEffect, useState } from "react";
import { BRANDING } from "../branding.js";
import { THEMES, type Theme } from "../../lang/vocab.js";

interface Props {
  /** Where they were heading, if they arrived on a shared link. */
  invitedTo: string | null;
  onDone: (name: string, theme: Theme) => void;
}

export function Welcome({ invitedTo, onDone }: Props) {
  const [theme, setTheme] = useState<Theme>("mechanical");
  const [name, setName] = useState("");
  const chosen = BRANDING[theme];
  const words = THEMES[theme];

  // Preview the whole palette, not just the name — the colour is most of what
  // distinguishes the two worlds, and choosing blind would be odd.
  useEffect(() => {
    document.documentElement.dataset["arena"] = theme;
  }, [theme]);

  const submit = () => onDone(name, theme);

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
              if (e.key === "Enter" && name.trim()) submit();
            }}
          />
          <span className="roster-meta">
            Shown to other people in {words.arena} battles, trades and shared editing.
          </span>
        </label>

        <div className="join-actions">
          <button
            type="button"
            className="btn primary"
            disabled={name.trim() === ""}
            onClick={submit}
          >
            {invitedTo ? "Join the room" : `Start playing ${chosen.full}`}
          </button>
        </div>
      </div>
    </div>
  );
}
