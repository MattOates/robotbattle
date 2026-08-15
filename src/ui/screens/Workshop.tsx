/**
 * The Workshop: where robots are built, versioned, tried and measured.
 *
 * Three panes down the right — Trial, Test bench, History — because those are
 * the three questions in order: does it run, is it better, and what happened
 * last time.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor } from "../CodeEditor.js";
import { MatchCanvas, type MatchOutcome, type MatchStatus } from "../MatchCanvas.js";
import { Standings } from "../Standings.js";
import { navigate } from "../router.js";
import type { LibraryApi } from "../useLibrary.js";
import { SAMPLE_BOTS } from "../../bots/index.js";
import { makeManifest, type MatchManifest } from "../../sim/world.js";
import { THEMES, type Theme } from "../../lang/vocab.js";
import { accuracy, executionWarning } from "../../sim/telemetry.js";
import type { Contender, TrialReport } from "../../workshop/trials.js";
import type { TrialWorkerIn, TrialWorkerOut } from "../../workshop/trials.worker.js";
import type { BattleRecord, StoredRobot } from "../../store/types.js";

interface Props {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  lib: LibraryApi;
}

type RightPane = "trial" | "bench" | "history";

export function Workshop({ theme, onThemeChange, lib }: Props) {
  const { library, robots, refresh } = lib;
  const [selectedId, setSelectedId] = useState<string | null>(robots[0]?.id ?? null);
  const [pane, setPane] = useState<RightPane>("trial");
  const [showCones, setShowCones] = useState(true);

  const selected = robots.find((r) => r.id === selectedId) ?? robots[0] ?? null;

  useEffect(() => {
    if (!selected && robots.length > 0) setSelectedId(robots[0]!.id);
  }, [robots, selected]);

  const updateSource = useCallback(
    (source: string) => {
      if (!selected) return;
      library.updateSource(selected.id, source);
      refresh();
    },
    [library, refresh, selected],
  );

  const words = THEMES[theme];

  return (
    <div className="workshop">
      <header className="screen-head">
        <button type="button" className="btn small" onClick={() => navigate("menu")}>
          ← Menu
        </button>
        <h2 className="screen-title">Workshop</h2>
        <span className="spacer" />
        <div className="toggle" role="group" aria-label="Theme">
          <button
            type="button"
            aria-pressed={theme === "mechanical"}
            onClick={() => onThemeChange("mechanical")}
          >
            Mechanical
          </button>
          <button
            type="button"
            aria-pressed={theme === "biological"}
            onClick={() => onThemeChange("biological")}
          >
            Biological
          </button>
        </div>
      </header>

      <div className="workshop-body">
        <div className="column">
          <RobotLibrary
            lib={lib}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            theme={theme}
          />

          <section className="panel editor-panel">
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
          <div className="pane-tabs" role="tablist">
            {(["trial", "bench", "history"] as RightPane[]).map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={pane === name}
                className="pane-tab"
                onClick={() => setPane(name)}
              >
                {name === "trial" ? "Trial" : name === "bench" ? "Test bench" : "History"}
              </button>
            ))}
          </div>

          {pane === "trial" ? (
            <TrialPane
              robot={selected}
              theme={theme}
              showCones={showCones}
              onShowCones={setShowCones}
              lib={lib}
              words={words}
            />
          ) : null}
          {pane === "bench" ? <BenchPane robot={selected} robots={robots} /> : null}
          {pane === "history" ? <HistoryPane robot={selected} lib={lib} theme={theme} /> : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Library pane
// ---------------------------------------------------------------------------

function RobotLibrary({
  lib,
  selectedId,
  onSelect,
  theme,
}: {
  lib: LibraryApi;
  selectedId: string | null;
  onSelect: (id: string) => void;
  theme: Theme;
}) {
  const { library, robots, refresh, storage } = lib;
  const [expanded, setExpanded] = useState<string | null>(null);
  const words = THEMES[theme];

  const selected = robots.find((r) => r.id === selectedId);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="silkscreen">Your {words.robotPlural}</span>
        <span className="spacer" />
        <span className="roster-meta">
          {Math.round((storage.used / 1024) * 10) / 10} kB used
        </span>
      </div>

      <div className="panel-body flush">
        {robots.map((robot) => (
          <div key={robot.id}>
            <div className="roster-item" aria-current={robot.id === selectedId ? "true" : undefined}>
              <button
                type="button"
                className="roster-select"
                onClick={() => onSelect(robot.id)}
              >
                <span className="chip" style={{ background: robot.color }} />
                <span className="roster-name">{robot.name}</span>
                <span className="roster-meta">
                  {robot.snapshots.length > 0 ? `${robot.snapshots.length} saved` : "no versions"}
                </span>
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => setExpanded(expanded === robot.id ? null : robot.id)}
                aria-expanded={expanded === robot.id}
              >
                Versions
              </button>
            </div>

            {expanded === robot.id ? (
              <SnapshotList robot={robot} lib={lib} onRestored={refresh} />
            ) : null}
          </div>
        ))}

        <div className="roster-actions">
          <button
            type="button"
            className="btn small"
            onClick={() => {
              const created = library.create();
              refresh();
              onSelect(created.id);
            }}
          >
            New robot
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              const copy = library.duplicate(selected.id);
              refresh();
              if (copy) onSelect(copy.id);
            }}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              const label = window.prompt(
                `Save a version of ${selected.name}. What should it be called?`,
                `v${selected.snapshots.length + 1}`,
              );
              if (label === null) return;
              library.saveSnapshot(selected.id, label);
              refresh();
              setExpanded(selected.id);
            }}
          >
            Save version
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!selected || robots.length <= 1}
            onClick={() => {
              if (!selected) return;
              if (!window.confirm(`Delete ${selected.name} and all its versions?`)) return;
              library.remove(selected.id);
              refresh();
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </section>
  );
}

function SnapshotList({
  robot,
  lib,
  onRestored,
}: {
  robot: StoredRobot;
  lib: LibraryApi;
  onRestored: () => void;
}) {
  const { library, refresh } = lib;
  if (robot.snapshots.length === 0) {
    return (
      <div className="empty small">
        No saved versions yet. Save one before a big change, so you can always compare.
      </div>
    );
  }
  return (
    <div className="snapshots">
      {robot.snapshots.map((snap) => (
        <div key={snap.id} className="snapshot">
          <button
            type="button"
            className={`pin${snap.pinned ? " on" : ""}`}
            title={snap.pinned ? "Unpin" : "Pin so it is offered as an opponent"}
            onClick={() => {
              library.togglePin(robot.id, snap.id);
              refresh();
            }}
          >
            ★
          </button>
          <span className="snapshot-label">{snap.label}</span>
          <span className="roster-meta">{new Date(snap.createdAt).toLocaleDateString()}</span>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              if (!window.confirm(`Replace the working copy with "${snap.label}"?`)) return;
              library.restoreSnapshot(robot.id, snap.id);
              onRestored();
            }}
          >
            Restore
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              library.removeSnapshot(robot.id, snap.id);
              refresh();
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trial pane — watch a match against the built-in arena bots
// ---------------------------------------------------------------------------

function TrialPane({
  robot,
  theme,
  showCones,
  onShowCones,
  lib,
  words,
}: {
  robot: StoredRobot | null;
  theme: Theme;
  showCones: boolean;
  onShowCones: (show: boolean) => void;
  lib: LibraryApi;
  words: { arena: string };
}) {
  const [opponents, setOpponents] = useState<string[]>(["spinner", "racer"]);
  const [manifest, setManifest] = useState<MatchManifest | null>(null);
  const [running, setRunning] = useState(false);
  const [stepSignal, setStepSignal] = useState(0);
  const [status, setStatus] = useState<MatchStatus | null>(null);

  const start = () => {
    if (!robot) return;
    const chosen = SAMPLE_BOTS.filter((b) => opponents.includes(b.id));
    setManifest(
      makeManifest(
        [{ source: robot.source }, ...chosen.map((b) => ({ source: b.source }))],
        { seed: (Date.now() % 2147483647) | 0 },
      ),
    );
    setRunning(true);
  };

  const onFinished = useCallback(
    (outcome: MatchOutcome) => {
      if (!robot || !manifest) return;
      lib.battles.record({
        mode: "trial",
        manifest,
        result: outcome.result,
        telemetry: outcome.telemetry,
        myRobotId: robot.id,
        myEntryIndex: 0,
      });
    },
    [lib.battles, manifest, robot],
  );

  return (
    <>
      <section className="panel arena-panel">
        <div className="panel-head">
          <span className="silkscreen">{words.arena}</span>
          <span className="spacer" />
          <label className="check">
            <input
              type="checkbox"
              checked={showCones}
              onChange={(e) => onShowCones(e.target.checked)}
            />
            Show sense cones
          </label>
        </div>

        <MatchCanvas
          manifest={manifest}
          theme={theme}
          showCones={showCones}
          running={running}
          stepSignal={stepSignal}
          onStatus={setStatus}
          onFinished={onFinished}
        />

        <div className="readout">
          <span
            className={`lamp ${!manifest ? "" : status?.over ? "done" : running ? "live" : "held"}`}
          >
            {!manifest ? "Idle" : status?.over ? "Finished" : running ? "Running" : "Paused"}
          </span>
          <span className="field">
            <span className="field-label">Tick</span>
            <span className="field-value">{String(status?.tick ?? 0).padStart(5, "0")}</span>
          </span>
          <span className="field">
            <span className="field-label">State hash</span>
            <span className={`field-value${manifest ? "" : " dim"}`}>{status?.hash ?? "—"}</span>
          </span>
          <span className="spacer" />
          <span className="transport">
            <button type="button" className="btn primary" onClick={start} disabled={!robot}>
              {manifest ? "Restart" : "Start trial"}
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
          <span className="silkscreen">Who to fight</span>
        </div>
        <div className="panel-body">
          <div className="chip-row">
            {SAMPLE_BOTS.map((bot) => (
              <label key={bot.id} className="opponent-chip">
                <input
                  type="checkbox"
                  checked={opponents.includes(bot.id)}
                  onChange={(e) =>
                    setOpponents((prev) =>
                      e.target.checked ? [...prev, bot.id] : prev.filter((id) => id !== bot.id),
                    )
                  }
                />
                {bot.title}
              </label>
            ))}
          </div>
          <Standings status={status} theme={theme} />
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Test bench — headless N trials
// ---------------------------------------------------------------------------

function BenchPane({ robot, robots }: { robot: StoredRobot | null; robots: StoredRobot[] }) {
  const [trials, setTrials] = useState(50);
  const [picked, setPicked] = useState<string[]>(["spinner", "racer"]);
  const [report, setReport] = useState<TrialReport | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const contenders = useMemo<Contender[]>(() => {
    const out: Contender[] = SAMPLE_BOTS.map((b) => ({
      id: b.id,
      label: b.title,
      source: b.source,
      kind: "arena",
    }));
    for (const other of robots) {
      if (other.id !== robot?.id) {
        out.push({ id: other.id, label: other.name, source: other.source, kind: "library" });
      }
      for (const snap of other.snapshots) {
        out.push({
          id: snap.id,
          label: `${other.name} · ${snap.label}`,
          source: snap.source,
          kind: "snapshot",
        });
      }
    }
    return out;
  }, [robots, robot?.id]);

  const run = () => {
    if (!robot) return;
    workerRef.current?.terminate();
    const worker = new Worker(new URL("../../workshop/trials.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    setReport(null);
    setProgress({ done: 0, total: trials * picked.length });

    worker.onmessage = (event: MessageEvent<TrialWorkerOut>) => {
      const message = event.data;
      if (message.type === "progress") setProgress(message.progress);
      if (message.type === "done") {
        setReport(message.report);
        setProgress(null);
      }
      if (message.type === "failed") {
        setReport({ rows: [], totalMatches: 0, overallWinRate: 0, error: message.message });
        setProgress(null);
      }
    };

    const request: TrialWorkerIn = {
      type: "run",
      request: {
        subject: { label: robot.name, source: robot.source },
        opponents: contenders.filter((c) => picked.includes(c.id)),
        trials,
        seedBase: 1234,
      },
    };
    worker.postMessage(request);
  };

  return (
    <section className="panel bench">
      <div className="panel-head">
        <span className="silkscreen">Test bench</span>
        <span className="spacer" />
        <label className="check">
          Trials each
          <input
            className="num-input"
            type="number"
            min={1}
            max={500}
            value={trials}
            onChange={(e) => setTrials(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
          />
        </label>
        <button
          type="button"
          className="btn primary small"
          disabled={!robot || picked.length === 0 || progress !== null}
          onClick={run}
        >
          {progress ? "Running…" : "Run"}
        </button>
      </div>

      <div className="panel-body">
        <p className="empty small">
          Every trial is a different battle, and your robot swaps sides each time, so the result
          measures the robot rather than where it happened to start.
        </p>

        <div className="chip-row">
          {contenders.map((c) => (
            <label key={c.id} className={`opponent-chip kind-${c.kind}`}>
              <input
                type="checkbox"
                checked={picked.includes(c.id)}
                onChange={(e) =>
                  setPicked((prev) =>
                    e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id),
                  )
                }
              />
              {c.label}
            </label>
          ))}
        </div>

        {progress ? (
          <div className="progress">
            <div className="progress-bar">
              <i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
            </div>
            <span className="roster-meta">
              {progress.done} / {progress.total} battles
            </span>
          </div>
        ) : null}

        {report?.error ? <div className="notice bad">{report.error}</div> : null}

        {report && report.rows.length > 0 ? (
          <div className="matchups">
            {report.rows.map((row) => (
              <div key={row.opponentId} className="matchup">
                <span className="matchup-name">
                  vs {row.label}
                  {row.kind !== "arena" ? <span className="roster-meta"> (yours)</span> : null}
                </span>
                <span className="meter wide">
                  <i
                    style={{ width: `${row.winRate}%` }}
                    className={row.winRate >= 50 ? "good" : "poor"}
                  />
                </span>
                <span className="tally">{Math.round(row.winRate)}%</span>
                <span className="tally dim">{row.avgTicks} ticks</span>
              </div>
            ))}
            <div className="matchup overall">
              <span className="matchup-name">Overall</span>
              <span className="spacer" />
              <span className="tally">{Math.round(report.overallWinRate)}%</span>
              <span className="tally dim">{report.totalMatches} battles</span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function HistoryPane({
  robot,
  lib,
  theme,
}: {
  robot: StoredRobot | null;
  lib: LibraryApi;
  theme: Theme;
}) {
  const [replay, setReplay] = useState<BattleRecord | null>(null);
  const records = robot ? lib.battles.forRobot(robot.id) : [];
  const h2h = robot ? lib.battles.headToHead(robot.id) : [];

  if (replay) {
    return (
      <section className="panel arena-panel">
        <div className="panel-head">
          <span className="silkscreen">Replay</span>
          <span className="spacer" />
          <button type="button" className="btn small" onClick={() => setReplay(null)}>
            Back to history
          </button>
        </div>
        <MatchCanvas manifest={replay.manifest} theme={theme} showCones running />
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="silkscreen">History</span>
        <span className="spacer" />
        <span className="roster-meta">{records.length} battles kept</span>
      </div>
      <div className="panel-body">
        {h2h.length > 0 ? (
          <>
            <div className="silkscreen">Record</div>
            <div className="matchups">
              {h2h.map((h) => (
                <div key={h.opponent} className="matchup">
                  <span className="matchup-name">vs {h.opponent}</span>
                  <span className="spacer" />
                  <span className="tally">
                    {h.wins}W {h.losses}L{h.draws > 0 ? ` ${h.draws}D` : ""}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {records.length === 0 ? (
          <div className="empty small">
            No battles yet. Run a trial and every one is kept here, replayable.
          </div>
        ) : null}

        {records.map((record) => {
          const mine = record.telemetry.find((t) => t.robotId === record.myEntryIndex);
          const warning = mine ? executionWarning(mine) : null;
          return (
            <div key={record.id} className="history-row">
              <div className="history-head">
                <span className={`place p${mine?.place ?? 0}`}>#{mine?.place ?? "—"}</span>
                <span className="who">{record.result.winnerName ?? "No winner"} won</span>
                <span className="roster-meta">{new Date(record.at).toLocaleString()}</span>
                <button type="button" className="btn small" onClick={() => setReplay(record)}>
                  Watch
                </button>
              </div>
              {mine ? (
                <div className="history-stats">
                  <span>{Math.round(mine.damageDealt)} damage dealt</span>
                  <span>{Math.round(accuracy(mine))}% accuracy</span>
                  <span>{mine.kills} kills</span>
                  <span>{Math.round(mine.survivedTicks / 30)}s alive</span>
                </div>
              ) : null}
              {warning ? <div className="history-warning">{warning}</div> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
