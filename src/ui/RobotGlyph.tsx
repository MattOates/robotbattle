/**
 * A still portrait of a robot, in SVG.
 *
 * People recognise their own robots by look long before they read the name —
 * the colour they picked and the shape of the thing they chose to drive. A
 * trading table listing "My First Robot, My First Robot (2), Untitled" is a
 * table nobody can use.
 *
 * Deliberately a second, smaller implementation of the arena's silhouettes
 * rather than a reuse of them: the real renderer is Pixi, and a WebGL context
 * per card in a scrolling grid is absurd for something that never moves. It
 * follows the same four shapes — the two chassis, in both worlds — closely
 * enough that a robot is recognisable in a card and in a battle.
 */

import { darken, hexToNumber, lighten } from "../render/themes/index.js";
import type { Locomotion } from "../lang/ast.js";
import type { Theme } from "../lang/vocab.js";

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

interface Props {
  color: string;
  locomotion: Locomotion;
  theme: Theme;
  /** Rendered size in pixels; the drawing scales to fit. */
  size?: number;
  /** Name, for the accessible label — the portrait is not decoration. */
  name?: string;
}

/** Radius the shapes are drawn against, matching the arena's proportions. */
const R = 13;

export function RobotGlyph({ color, locomotion, theme, size = 40, name }: Props) {
  const tint = hexToNumber(color);
  const shade = hex(darken(tint, 0.45));
  const deep = hex(darken(tint, 0.7));
  const sheen = hex(lighten(tint, 0.5));
  const body = hex(tint);

  return (
    <svg
      className="robot-glyph"
      width={size}
      height={size}
      viewBox="-16 -16 32 32"
      role="img"
      aria-label={name ? `${name}, drawn` : "robot"}
      // Facing +x in arena coordinates; turned to face the reader's right and
      // tipped slightly, which reads as a portrait rather than a schematic.
      style={{ transform: "rotate(-20deg)" }}
    >
      {theme === "biological" ? (
        <BiologicalBody locomotion={locomotion} body={body} shade={shade} sheen={sheen} />
      ) : (
        <MechanicalBody
          locomotion={locomotion}
          body={body}
          shade={shade}
          deep={deep}
          sheen={sheen}
        />
      )}
      <Turret body={body} shade={shade} sheen={sheen} biological={theme === "biological"} />
    </svg>
  );
}

function MechanicalBody({
  locomotion,
  body,
  shade,
  deep,
  sheen,
}: {
  locomotion: Locomotion;
  body: string;
  shade: string;
  deep: string;
  sheen: string;
}) {
  if (locomotion === "skid") {
    return (
      <g>
        {/* Tracks outside the hull, so the two chassis differ at a glance. */}
        <rect x={-R * 0.95} y={-R} width={R * 1.9} height={R * 0.42} fill={shade} />
        <rect x={-R * 0.95} y={R * 0.58} width={R * 1.9} height={R * 0.42} fill={shade} />
        {[-3, -2, -1, 0, 1, 2, 3].map((i) => (
          <g key={i} fill={deep}>
            <rect x={i * R * 0.26} y={-R} width={R * 0.09} height={R * 0.42} />
            <rect x={i * R * 0.26} y={R * 0.58} width={R * 0.09} height={R * 0.42} />
          </g>
        ))}
        <rect x={-R * 0.82} y={-R * 0.6} width={R * 1.64} height={R * 1.2} rx={3} fill={body} />
        <rect x={R * 0.55} y={-R * 0.28} width={R * 0.16} height={R * 0.56} fill={sheen} />
      </g>
    );
  }
  const wheels: Array<[number, number]> = [
    [-R * 0.55, -R * 0.78],
    [-R * 0.55, R * 0.78],
    [R * 0.62, -R * 0.72],
    [R * 0.62, R * 0.72],
  ];
  return (
    <g>
      {wheels.map(([x, y]) => (
        <rect
          key={`${x},${y}`}
          x={x - R * 0.2}
          y={y - R * 0.12}
          width={R * 0.4}
          height={R * 0.24}
          rx={2}
          fill={shade}
        />
      ))}
      {/* Wedge hull: the point marks the front, which is where a car must go. */}
      <polygon
        points={`${R * 0.95},0 ${R * 0.35},${-R * 0.66} ${-R * 0.85},${-R * 0.52} ${-R * 0.85},${R * 0.52} ${R * 0.35},${R * 0.66}`}
        fill={body}
      />
      <rect x={R * 0.55} y={-R * 0.28} width={R * 0.16} height={R * 0.56} fill={sheen} />
    </g>
  );
}

function BiologicalBody({
  locomotion,
  body,
  shade,
  sheen,
}: {
  locomotion: Locomotion;
  body: string;
  shade: string;
  sheen: string;
}) {
  if (locomotion === "skid") {
    // Ciliate: cilia are what let it pivot on the spot, as tracks are.
    const cilia = Array.from({ length: 18 }, (_, i) => {
      const a = (i / 18) * Math.PI * 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      return (
        <line
          key={i}
          x1={cx * R * 0.9}
          y1={cy * R * 0.78}
          x2={cx * R * 1.22}
          y2={cy * R * 1.1}
          stroke={sheen}
          strokeWidth={1.2}
          opacity={0.85}
        />
      );
    });
    return (
      <g>
        {cilia}
        <ellipse rx={R * 0.92} ry={R * 0.78} fill={body} stroke={sheen} strokeWidth={1.5} />
        <ellipse cx={R * 0.2} rx={R * 0.3} ry={R * 0.26} fill={shade} />
        <ellipse cx={R * 0.66} rx={R * 0.14} ry={R * 0.3} fill={sheen} />
      </g>
    );
  }
  // Flagellate: one long tail, and it can only steer while swimming.
  const tail = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    return `${-R * (0.8 + t * 1.1)},${Math.sin(t * Math.PI * 2.2) * R * 0.34}`;
  }).join(" ");
  return (
    <g>
      <polyline points={tail} fill="none" stroke={sheen} strokeWidth={1.5} opacity={0.9} />
      <ellipse
        cx={R * 0.05}
        rx={R * 0.95}
        ry={R * 0.62}
        fill={body}
        stroke={sheen}
        strokeWidth={1.5}
      />
      <ellipse cx={R * 0.35} rx={R * 0.26} ry={R * 0.22} fill={shade} />
      <ellipse cx={R * 0.66} rx={R * 0.14} ry={R * 0.3} fill={sheen} />
    </g>
  );
}

/** Identical for both chassis, as in the arena. */
function Turret({
  body,
  shade,
  sheen,
  biological,
}: {
  body: string;
  shade: string;
  sheen: string;
  biological: boolean;
}) {
  if (biological) {
    return (
      <g>
        <circle r={R * 0.34} fill={shade} />
        <polygon
          points={`${R * 0.2},${-R * 0.16} ${R * 1.02},0 ${R * 0.2},${R * 0.16}`}
          fill={sheen}
          opacity={0.9}
        />
      </g>
    );
  }
  return (
    <g>
      <circle r={R * 0.46} fill={shade} />
      <circle r={R * 0.3} fill={body} opacity={0.9} />
      <rect x={R * 0.2} y={-R * 0.13} width={R * 1.05} height={R * 0.26} fill={shade} />
      <rect x={R * 1.05} y={-R * 0.17} width={R * 0.18} height={R * 0.34} fill={sheen} />
    </g>
  );
}
