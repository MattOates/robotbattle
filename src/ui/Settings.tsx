/**
 * App-wide settings, reachable from every screen.
 *
 * Everything the welcome screen asked on a first visit lives here too, because
 * a choice you can only make once is a choice you will regret. It also owns the
 * things that have nowhere else to sit: how much has been stored, and how to
 * throw it away.
 */

import { useEffect, useRef, useState } from "react";
import { BRANDING } from "./branding.js";
import { openBugReport } from "./bugReport.js";
import { THEMES, type Theme } from "../lang/vocab.js";
import { assistantRuntime, downloadSizeGB, type AssistantModel } from "../assistant/runtime.js";
import { useAssistantUsable } from "../assistant/useAssistant.js";
import type { LibraryApi } from "./useLibrary.js";
import type { Profile } from "./useLibrary.js";

interface Props {
  profile: Profile;
  onName: (name: string) => void;
  onTheme: (theme: Theme) => void;
  onAssistantModel: (id: string) => void;
  lib: LibraryApi;
}

export function Settings({ profile, onName, onTheme, onAssistantModel, lib }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Close on Escape or a click elsewhere, the way any menu should.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const runtime = assistantRuntime();
  // Nothing about the assistant appears on a machine that cannot run one. An
  // option you can read but never use is worse than no option.
  const assistantUsable = useAssistantUsable() === true;

  /**
   * Which models are actually on the disk.
   *
   * Looked up when the panel opens rather than kept, because it changes
   * whenever somebody starts the assistant in another tab — and because the
   * only thing it drives is a line of text and a button.
   */
  const [downloaded, setDownloaded] = useState<AssistantModel[] | null>(null);
  useEffect(() => {
    if (!open || !runtime || !assistantUsable) return;
    let cancelled = false;
    void runtime.cached().then((models) => {
      if (!cancelled) setDownloaded(models);
    });
    return () => {
      cancelled = true;
    };
  }, [assistantUsable, open, runtime]);
  const usedKb = Math.round((lib.storage.used / 1024) * 10) / 10;
  const percent = Math.min(100, (lib.storage.used / lib.storage.budget) * 100);
  const words = THEMES[profile.theme];

  return (
    <div className="settings">
      <button
        ref={buttonRef}
        type="button"
        className="settings-cog"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Settings"
        onClick={() => setOpen((o) => !o)}
      >
        ⚙
      </button>

      {open ? (
        <div className="settings-panel" ref={panelRef} role="dialog" aria-label="Settings">
          <div className="panel-head">
            <span className="silkscreen">Settings</span>
            <span className="spacer" />
            <button type="button" className="btn small" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          <div className="settings-body">
            <label className="field">
              <span className="silkscreen">Your name</span>
              <input
                className="text-input"
                value={profile.name}
                maxLength={24}
                placeholder="Your name"
                onChange={(e) => onName(e.target.value)}
              />
              <span className="roster-meta">
                Shown to other people in battles, trades and shared editing.
              </span>
            </label>

            <div className="field">
              <span className="silkscreen">World</span>
              <div className="toggle" role="group" aria-label="World">
                {(["mechanical", "biological"] as Theme[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={profile.theme === option}
                    onClick={() => onTheme(option)}
                  >
                    {BRANDING[option].full}
                  </button>
                ))}
              </div>
              <span className="roster-meta">
                Words and artwork only — both worlds play identically. Right now a robot is
                a {words.robot}, and it fights in {words.arena}.
              </span>
            </div>

            {/* Only worth showing to a machine that could run one, and only
                when there is more than one to choose between. Otherwise it is
                a dropdown of things that will not happen. */}
            {assistantUsable && runtime && runtime.models.length > 1 ? (
              <div className="field">
                <span className="silkscreen">Assistant</span>
                <select
                  className="text-input"
                  value={profile.assistantModel}
                  onChange={(e) => onAssistantModel(e.target.value)}
                >
                  {runtime.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                      {model.vramMB > 0 ? ` — ${downloadSizeGB(model.id)} GB` : ""}
                    </option>
                  ))}
                </select>
                <span className="roster-meta">
                  {/* The chosen one described in full, since a dropdown can only
                      show a line and the difference between them is the whole
                      decision. */}
                  {runtime.models.find((m) => m.id === profile.assistantModel)?.blurb}
                </span>
              </div>
            ) : null}

            {/* Separate from the storage meter below on purpose. Model weights
                live in the browser's cache rather than in local storage, so
                they do not show up there at all — which meant the settings
                screen could report "77 kB used" with six gigabytes of model
                sitting next to it, invisible and with no way to remove it. */}
            {downloaded && downloaded.length > 0 ? (
              <div className="field">
                <span className="silkscreen">Assistant downloads</span>
                <span className="roster-meta">
                  {downloaded.map((m) => m.label).join(", ")} ·{" "}
                  {Math.round(downloaded.reduce((n, m) => n + m.vramMB, 0) / 102.4) / 10} GB kept in
                  this browser
                </span>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    void runtime?.forget().then(() => setDownloaded([]));
                  }}
                >
                  Delete downloaded models
                </button>
              </div>
            ) : null}

            <div className="field">
              <span className="silkscreen">Stored on this device</span>
              <div className="meter wide">
                <i style={{ width: `${percent}%` }} className={percent > 80 ? "poor" : "good"} />
              </div>
              <span className="roster-meta">
                {usedKb} kB used · {lib.robots.length} robots ·{" "}
                {lib.battles.list().length} battles kept
                {lib.storage.available ? "" : " · this browser is not saving anything"}
              </span>
            </div>

            <div className="field">
              <span className="silkscreen">Something wrong?</span>
              <button
                type="button"
                className="btn small"
                onClick={() =>
                  openBugReport({
                    theme: profile.theme,
                    robotCount: lib.robots.length,
                    storageBytes: lib.storage.used,
                  })
                }
              >
                Report a bug ↗
              </button>
              <span className="roster-meta">
                Opens GitHub with the version and browser details filled in. Your robots,
                chat and name are not included — check it over before you post.
              </span>
            </div>

            <div className="settings-danger">
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  if (!window.confirm("Forget every stored battle? Your robots are kept.")) return;
                  lib.clearHistory();
                }}
              >
                Clear battle history
              </button>
              <button
                type="button"
                className="btn small danger"
                onClick={() => {
                  if (
                    !window.confirm(
                      "Delete every robot, every saved version and every battle? This cannot be undone.",
                    )
                  ) {
                    return;
                  }
                  lib.clearAll();
                }}
              >
                Delete everything
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
