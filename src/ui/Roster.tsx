/**
 * The list of robots entered into the match.
 *
 * Each row shows the robot's declared name, its colour and its locomotion in
 * the wording of the current theme — so a tank is listed as "tracks" in the
 * mechanical arena and "cilia" in the biological one, while being the very same
 * robot underneath.
 */

import { parse } from "../lang/parser.js";
import { THEMES, type Theme } from "../lang/vocab.js";

export interface RosterEntry {
  id: string;
  source: string;
}

interface Props {
  entries: RosterEntry[];
  selectedId: string;
  theme: Theme;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}

interface Summary {
  name: string;
  color: string;
  locomotion: string;
  broken: boolean;
}

function summarise(source: string, theme: Theme): Summary {
  const words = THEMES[theme];
  try {
    const program = parse(source);
    return {
      name: program.name,
      color: program.color,
      locomotion: program.locomotion === "skid" ? words.skidName : words.steeredName,
      broken: false,
    };
  } catch {
    // A half-typed script is the normal state of an editor, not an error worth
    // shouting about here — the editor's own panel says what is wrong.
    return { name: "unfinished", color: "#8a8f98", locomotion: "—", broken: true };
  }
}

export function Roster({ entries, selectedId, theme, onSelect, onRemove, onAdd }: Props) {
  return (
    <div className="roster">
      {entries.map((entry) => {
        const info = summarise(entry.source, theme);
        return (
          <div
            key={entry.id}
            className="roster-item"
            aria-current={entry.id === selectedId ? "true" : undefined}
          >
            <button
              type="button"
              className="roster-select"
              onClick={() => onSelect(entry.id)}
            >
              <span className="chip" style={{ background: info.color }} />
              <span className="roster-name">{info.name}</span>
              <span className={`roster-meta${info.broken ? " bad" : ""}`}>
                {info.broken ? "won't compile" : info.locomotion}
              </span>
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => onRemove(entry.id)}
              aria-label={`Remove ${info.name}`}
            >
              Remove
            </button>
          </div>
        );
      })}
      <div className="roster-actions">
        <button type="button" className="btn small" onClick={onAdd}>
          Add robot
        </button>
      </div>
    </div>
  );
}
