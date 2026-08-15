/**
 * The workbench.
 *
 * Left: the roster and the script editor. Right: the arena, its readout, and
 * the standings. Everything is local — a match is built from a manifest and run
 * entirely in this tab, which is exactly the shape milestone 2 needs when the
 * manifest starts arriving over WebRTC instead of being assembled here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArenaStage, type MatchStatus } from "./ArenaStage.js";
import { CodeEditor } from "./CodeEditor.js";
import { Roster, type RosterEntry } from "./Roster.js";
import { Standings } from "./Standings.js";
import { SAMPLE_BOTS } from "../bots/index.js";
import { checkScript, makeManifest, type MatchManifest } from "../sim/world.js";
import { THEMES, type Theme } from "../lang/vocab.js";

const ARENA_WIDTH = 900;
const ARENA_HEIGHT = 620;

let nextId = 1;
const makeId = () => `bot-${nextId++}`;

/** A blank robot for the "Add robot" button — enough to run, and to read. */
const STARTER_SCRIPT = `name "New Robot"
chassis tank
color #7fd1e0

on start
  turret.sweep 45
  drive forward 60
end

on sense robot
  turret.aim at event.bearing
  fire 2
end

on hit wall
  turn body by 150
end
`;

export function App() {
  const [entries, setEntries] = useState<RosterEntry[]>(() =>
    // Open on a real fight rather than an empty page.
    ["hunter", "racer", "spinner"].map((id) => ({
      id: makeId(),
      source: SAMPLE_BOTS.find((b) => b.id === id)!.source,
    })),
  );
  const [selectedId, setSelectedId] = useState<string>("bot-1");
  const [theme, setTheme] = useState<Theme>("mechanical");
  const [showCones, setShowCones] = useState(true);
  const [manifest, setManifest] = useState<MatchManifest | null>(null);
  const [running, setRunning] = useState(false);
  const [stepSignal, setStepSignal] = useState(0);
  const [status, setStatus] = useState<MatchStatus | null>(null);

  // The instrument's own colours follow the arena theme.
  useEffect(() => {
    document.documentElement.dataset["arena"] = theme;
  }, [theme]);

  const selected = entries.find((e) => e.id === selectedId) ?? entries[0];

  const problems = useMemo(
    () => entries.filter((e) => !checkScript(e.source).ok).length,
    [entries],
  );
  const canStart = entries.length >= 1 && problems === 0;

  const startMatch = useCallback(() => {
    if (!canStart) return;
    setManifest(
      makeManifest(
        entries.map((e) => ({ source: e.source })),
        {
          // A fresh seed each time, so repeated runs of the same roster are not
          // identical replays — while any one seed stays perfectly reproducible.
          seed: (Date.now() % 2147483647) | 0,
          width: ARENA_WIDTH,
          height: ARENA_HEIGHT,
        },
      ),
    );
    setRunning(true);
  }, [canStart, entries]);

  const updateSource = useCallback(
    (source: string) => {
      if (!selected) return;
      setEntries((prev) => prev.map((e) => (e.id === selected.id ? { ...e, source } : e)));
    },
    [selected],
  );

  const words = THEMES[theme];

  return (
    <div className="app">
      <header className="masthead">
        <h1 className="wordmark">
          Robo<span>Battle</span>
        </h1>
        <span className="tagline">
          program a robot · watch it fight · every screen sees the same match
        </span>
        <span className="spacer" />
        <div className="toggle" role="group" aria-label="Arena theme">
          <button
            type="button"
            aria-pressed={theme === "mechanical"}
            onClick={() => setTheme("mechanical")}
          >
            Mechanical
          </button>
          <button
            type="button"
            aria-pressed={theme === "biological"}
            onClick={() => setTheme("biological")}
          >
            Biological
          </button>
        </div>
      </header>

      <div className="layout">
        <div className="column">
          <section className="panel">
            <div className="panel-head">
              <span className="silkscreen">Roster</span>
              <span className="spacer" />
              <span className="roster-meta">
                {entries.length} {entries.length === 1 ? words.robot : words.robotPlural}
              </span>
            </div>
            <div className="panel-body flush">
              <Roster
                entries={entries}
                selectedId={selected?.id ?? ""}
                theme={theme}
                onSelect={setSelectedId}
                onRemove={(id) =>
                  setEntries((prev) => prev.filter((e) => e.id !== id))
                }
                onAdd={() => {
                  const entry = { id: makeId(), source: STARTER_SCRIPT };
                  setEntries((prev) => [...prev, entry]);
                  setSelectedId(entry.id);
                }}
              />
            </div>
          </section>

          <section className="panel" style={{ flex: 1 }}>
            <div className="panel-head">
              <span className="silkscreen">RoboScript</span>
              <span className="spacer" />
              <select
                className="btn small"
                value=""
                aria-label="Load an example"
                onChange={(e) => {
                  const sample = SAMPLE_BOTS.find((b) => b.id === e.target.value);
                  if (sample) updateSource(sample.source);
                  e.target.value = "";
                }}
              >
                <option value="">Load an example…</option>
                {SAMPLE_BOTS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title} — {b.teaches}
                  </option>
                ))}
              </select>
            </div>
            {selected ? (
              <CodeEditor
                key={selected.id}
                source={selected.source}
                theme={theme}
                onChange={updateSource}
              />
            ) : (
              <div className="empty">Add a robot to start writing.</div>
            )}
          </section>
        </div>

        <div className="column">
          <section className="panel arena-panel">
            <div className="panel-head">
              <span className="silkscreen">{words.arena}</span>
              <span className="spacer" />
              <label className="check">
                <input
                  type="checkbox"
                  checked={showCones}
                  onChange={(e) => setShowCones(e.target.checked)}
                />
                Show sense cones
              </label>
            </div>

            <ArenaStage
              manifest={manifest}
              theme={theme}
              showCones={showCones}
              running={running}
              stepSignal={stepSignal}
              onStatus={setStatus}
            />

            {/*
              The readout. The state hash is the number every peer must agree
              on for a shared match to be a shared match, so it is shown as
              plainly as the clock rather than hidden in a debug menu.
            */}
            <div className="readout">
              <span
                className={`lamp ${
                  !manifest ? "" : status?.over ? "done" : running ? "live" : "held"
                }`}
              >
                {!manifest ? "Idle" : status?.over ? "Finished" : running ? "Running" : "Paused"}
              </span>
              <span className="field">
                <span className="field-label">Tick</span>
                <span className="field-value">
                  {String(status?.tick ?? 0).padStart(5, "0")}
                </span>
              </span>
              <span className="field">
                <span className="field-label">State hash</span>
                <span className={`field-value${manifest ? "" : " dim"}`}>
                  {status?.hash ?? "—"}
                </span>
              </span>
              <span className="spacer" />
              <span className="transport">
                <button
                  type="button"
                  className="btn primary"
                  onClick={startMatch}
                  disabled={!canStart}
                  title={problems > 0 ? "Fix the script errors first" : undefined}
                >
                  {manifest ? "Restart" : "Start match"}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!manifest || status?.over}
                  onClick={() => setRunning((r) => !r)}
                >
                  {running ? "Pause" : "Resume"}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!manifest || running || status?.over}
                  onClick={() => setStepSignal((s) => s + 1)}
                >
                  Step
                </button>
              </span>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="silkscreen">Standings</span>
              <span className="spacer" />
              {problems > 0 ? (
                <span className="roster-meta bad">
                  {problems} script{problems === 1 ? "" : "s"} won&rsquo;t compile
                </span>
              ) : null}
            </div>
            <div className="panel-body flush">
              <Standings status={status} theme={theme} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
