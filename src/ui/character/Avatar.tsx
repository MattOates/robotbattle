/**
 * The helper's face.
 *
 * One component, two characters, chosen by world: Sprocket is a small tracked
 * machine with a lens for an eye, Pip is a cell with a fringe of cilia and a
 * nucleus that reads as one. Inline SVG rather than shipped artwork — it is a
 * few hundred bytes, it inherits the instrument's colour tokens, and it can be
 * animated by CSS like anything else on the page.
 *
 * Deliberately not `RobotGlyph`: that draws a robot from above for the arena,
 * and a thing with no front and no eyes cannot look at you.
 *
 * The state is a string union rather than a set of booleans because this is
 * meant to grow. Wincing at a loss, cheering a win and glancing at whatever the
 * player just clicked are all wanted eventually; each of those is a new arm of
 * the switch and a new keyframe, and `look` is already carried so that the eye
 * can be re-aimed without re-cutting the artwork.
 */

import type { Theme } from "../../lang/vocab.js";

export type AvatarState = "idle" | "talking" | "pleased" | "thinking";

interface Props {
  theme: Theme;
  state: AvatarState;
  /**
   * How loud the voice is right now, 0 to 1.
   *
   * Fed from an analyser on the audio that is actually playing, so the mouth
   * moves with the words rather than to a timer that only looks synchronised.
   *
   * Usually left unset: the tour writes `--amp` to an ancestor sixty times a
   * second and the jaw inherits it, because passing it as a prop would mean
   * re-rendering the screen on every frame.
   */
  amplitude?: number;
  /** Where to point the eye. Reserved: nothing sets it yet. */
  look?: { x: number; y: number };
  size?: number;
}

export function Avatar({ theme, state, amplitude, look, size = 48 }: Props) {
  const style = {
    ...(amplitude === undefined
      ? {}
      : { "--amp": Math.max(0, Math.min(1, amplitude)).toFixed(3) }),
    "--look-x": `${look?.x ?? 0}`,
    "--look-y": `${look?.y ?? 0}`,
  } as React.CSSProperties;

  return (
    <svg
      className="avatar"
      data-state={state}
      data-world={theme}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-hidden="true"
    >
      {theme === "biological" ? <Pip /> : <Sprocket />}
    </svg>
  );
}

function Sprocket() {
  return (
    <g>
      {/* Antenna: the part that spins while it is thinking. */}
      <g className="avatar-antenna">
        <line x1="32" y1="18" x2="32" y2="7" />
        <circle className="avatar-bulb" cx="32" cy="6" r="3" />
      </g>

      {/* Tracks, drawn behind the hull so the hull reads as sitting on them. */}
      <rect className="avatar-track" x="8" y="44" width="48" height="11" rx="5" />
      <circle className="avatar-wheel" cx="17" cy="49.5" r="3" />
      <circle className="avatar-wheel" cx="32" cy="49.5" r="3" />
      <circle className="avatar-wheel" cx="47" cy="49.5" r="3" />

      <rect className="avatar-hull" x="11" y="17" width="42" height="30" rx="7" />

      {/* One big lens, because one eye is friendlier than two on a machine. */}
      <g className="avatar-eye">
        <circle className="avatar-lens" cx="32" cy="30" r="10" />
        <circle className="avatar-pupil" cx="32" cy="30" r="4.5" />
        <circle className="avatar-glint" cx="28.5" cy="26.5" r="1.8" />
      </g>

      {/* The jaw opens with the voice. */}
      <rect className="avatar-jaw" x="24" y="40" width="16" height="4" rx="2" />
    </g>
  );
}

function Pip() {
  // A ring of cilia. Generated rather than written out: twenty-eight hand-typed
  // line elements would be unreadable and impossible to adjust.
  const cilia = Array.from({ length: 28 }, (_, i) => {
    const angle = (i / 28) * Math.PI * 2;
    const cx = 32;
    const cy = 33;
    const rx = 21;
    const ry = 19;
    const x1 = cx + Math.cos(angle) * rx;
    const y1 = cy + Math.sin(angle) * ry;
    const x2 = cx + Math.cos(angle) * (rx + 5);
    const y2 = cy + Math.sin(angle) * (ry + 5);
    return (
      <line
        key={i}
        x1={x1.toFixed(2)}
        y1={y1.toFixed(2)}
        x2={x2.toFixed(2)}
        y2={y2.toFixed(2)}
        style={{ animationDelay: `${((i / 28) * 1.2).toFixed(2)}s` }}
      />
    );
  });

  return (
    <g>
      {/* The fringe beats in a travelling wave, which is what cilia actually do. */}
      <g className="avatar-fringe">{cilia}</g>

      <ellipse className="avatar-membrane" cx="32" cy="33" rx="21" ry="19" />

      <g className="avatar-eye">
        <circle className="avatar-lens" cx="32" cy="30" r="9" />
        <circle className="avatar-pupil" cx="32" cy="30" r="4" />
        <circle className="avatar-glint" cx="29" cy="27" r="1.6" />
      </g>

      {/* A vacuole that widens with the voice — Pip's equivalent of a jaw. */}
      <ellipse className="avatar-jaw" cx="32" cy="43" rx="6" ry="2.5" />
    </g>
  );
}
