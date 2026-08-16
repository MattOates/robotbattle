/**
 * PixiJS arena renderer.
 *
 * Strictly a view: it reads snapshots and never writes simulation state, so
 * nothing here can affect the outcome of a match or desync a peer. Robot bodies
 * and turrets are drawn once into cached Graphics and then only moved; bullets,
 * effects and sense cones are cheap enough to redraw each frame.
 */

import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { DEG_TO_RAD } from "../sim/math.js";
import { RADAR, ROBOT_RADIUS, SENSE, MAX_HEALTH, type Effect, type World } from "../sim/types.js";
import { ART, hexToNumber, type ArenaTheme } from "./themes/index.js";
import type { Theme } from "../lang/vocab.js";
import { lerp, lerpAngle, snapshot, type Snapshot } from "./interpolate.js";

interface Particle {
  type: Effect["type"];
  x: number;
  y: number;
  heading: number;
  /** Frames lived so far, and total lifetime in frames. */
  age: number;
  life: number;
  /** How far a ping reached before it hit something. */
  range: number;
}

/** Frames between label rasterisations. Six is about five updates a second. */
const LABEL_INTERVAL = 6;

interface RobotView {
  root: Container;
  body: Graphics;
  turretPivot: Container;
  radarPivot: Container;
  label: Text;
  healthBar: Graphics;
  /** What the cached body Graphics was drawn for, so we redraw only on change. */
  drawnColor: string;
  drawnLabel: string;
  /** Frames since the label text was last replaced. */
  labelAge: number;
}

export interface ArenaOptions {
  theme: Theme;
  showSenseCones: boolean;
}

export class ArenaRenderer {
  private app: Application | null = null;
  private theme: ArenaTheme;
  private options: ArenaOptions;

  private backdrop = new Graphics();
  private cones = new Graphics();
  private bullets = new Graphics();
  private effects = new Graphics();
  private robotLayer = new Container();
  private views = new Map<number, RobotView>();
  private particles: Particle[] = [];

  /** Set when drawing has thrown; nothing is drawn afterwards. */
  private broken = false;
  private prev: Snapshot | null = null;
  private curr: Snapshot | null = null;
  private width = 0;
  private height = 0;

  constructor(options: ArenaOptions) {
    this.options = options;
    this.theme = ART[options.theme];
  }

  async init(parent: HTMLElement, width: number, height: number): Promise<void> {
    this.width = width;
    this.height = height;
    const app = new Application();
    await app.init({
      width,
      height,
      background: this.theme.background,
      antialias: true,
      // Cap at 2 so a 3x phone screen doesn't quadruple the fill cost.
      resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
      // Deliberately off: autoDensity writes inline width/height styles, which
      // would override the CSS that scales the arena to fit its bezel. Without
      // them the canvas keeps its intrinsic aspect ratio and CSS can letterbox
      // it freely.
      autoDensity: false,
      // Both deliberately off. Pixi's default is to add itself to the shared
      // ticker and render every frame on its own — but we already drive
      // rendering from our own loop, in `draw`, because rendering has to happen
      // at a known point relative to the simulation step. Left on, every arena
      // renders twice per frame, and an arena that is merely sitting on the
      // page renders sixty times a second while showing nothing new.
      autoStart: false,
      sharedTicker: false,
    });
    this.app = app;
    parent.appendChild(app.canvas);

    app.stage.addChild(this.backdrop);
    app.stage.addChild(this.cones);
    app.stage.addChild(this.bullets);
    app.stage.addChild(this.robotLayer);
    app.stage.addChild(this.effects);

    this.drawBackdrop();
  }

  destroy(): void {
    const app = this.app;
    // Cleared first: anything below that throws must not leave a half-torn-down
    // renderer that a later call would try to use again.
    this.app = null;
    if (app) {
      try {
        // Our own display objects go first, while the renderer is still alive.
        // Each robot's label is a Text, and destroying a Text hands its texture
        // back to the renderer's texture pool — so if Pixi is left to destroy
        // the children itself it has already torn that pool down, and the
        // return throws. Asking it to destroy children is the bug; doing it
        // ourselves in the right order is the fix.
        this.reset();
        app.stage.removeChildren();
        app.destroy(true);
      } catch {
        // Teardown runs inside a React cleanup. A throw there escapes into
        // React and unmounts the whole tree, which on a lesson page means
        // every other example on it disappears too. Nothing here is worth
        // that: the renderer is being thrown away regardless.
      }
    }
    this.views.clear();
    this.particles = [];
    this.prev = null;
    this.curr = null;
  }

  get ready(): boolean {
    return this.app !== null;
  }

  /** True while there is still something moving that no simulation step drives. */
  get animating(): boolean {
    return this.particles.length > 0;
  }

  setTheme(theme: Theme): void {
    this.theme = ART[theme];
    this.options = { ...this.options, theme };
    if (this.app) {
      this.app.renderer.background.color = this.theme.background;
      this.drawBackdrop();
      // Force every cached body to be redrawn in the new art pack.
      for (const view of this.views.values()) view.drawnColor = "";
    }
  }

  setShowSenseCones(show: boolean): void {
    this.options = { ...this.options, showSenseCones: show };
    if (!show) this.cones.clear();
  }

  /**
   * Throwing away one robot's view.
   *
   * Destroying a `Text` hands its texture back to the renderer's texture pool,
   * and Pixi's own garbage collector can get there first — so this throws with
   * "cannot read properties of undefined" on a pool that is gone or has already
   * taken the texture back. There is nothing to recover: the view is being
   * discarded either way. What matters is that it does not throw, because every
   * caller is inside a React effect, where an escaping error unmounts the tree
   * and takes the rest of the page with it. Detaching is the fallback; the
   * worst case is a little memory held until the app itself is destroyed.
   */
  private discard(view: RobotView): void {
    try {
      view.root.destroy({ children: true });
    } catch {
      try {
        view.root.removeFromParent();
      } catch {
        /* nothing left to try */
      }
    }
  }

  /** Discard all views — call when a new match starts. */
  reset(): void {
    for (const view of this.views.values()) this.discard(view);
    this.views.clear();
    this.particles = [];
    this.prev = null;
    this.curr = null;
    this.bullets.clear();
    this.effects.clear();
    this.cones.clear();
  }

  /** Called once per simulation tick, after the world has stepped. */
  onStep(world: World): void {
    this.prev = this.curr;
    this.curr = snapshot(world);
    for (const e of world.effects) {
      this.particles.push({
        type: e.type,
        x: e.x,
        y: e.y,
        heading: e.heading,
        age: 0,
        // A ping lingers a little longer than a muzzle flash: it is the only
        // way to see where somebody is looking, and it is worth catching.
        life: e.type === "explosion" ? 28 : e.type === "impact" ? 14 : e.type === "ping" ? 12 : 8,
        range: e.range ?? 0,
      });
    }
  }

  /**
   * Draw a frame. `alpha` is how far we are between the previous tick and the
   * current one, 0..1.
   */
  draw(alpha: number): void {
    if (!this.app || !this.curr || this.broken) return;
    const from = this.prev ?? this.curr;
    const to = this.curr;
    const t = this.prev ? Math.min(1, Math.max(0, alpha)) : 1;

    try {
      this.drawRobots(from, to, t);
      this.drawBullets(from, to, t);
      this.drawCones(from, to, t);
      this.drawParticles();
      this.app.render();
    } catch {
      // The GPU can take the context away underneath us — a lost WebGL context
      // leaves the renderer's targets dead, and drawing into them throws. This
      // runs on an animation frame owned by a React effect, so letting it out
      // would unmount the page. Stop drawing instead: the simulation keeps
      // running and the picture is stale, which is a far better failure than a
      // blank lesson. Retrying every frame would only throw sixty times a
      // second.
      this.broken = true;
    }
  }

  // ---- pieces -----------------------------------------------------------

  private drawBackdrop(): void {
    const g = this.backdrop;
    g.clear();
    this.theme.drawBackdrop?.(g, this.width, this.height);

    if (this.theme.gridSize > 0) {
      for (let x = this.theme.gridSize; x < this.width; x += this.theme.gridSize) {
        g.moveTo(x, 0).lineTo(x, this.height);
      }
      for (let y = this.theme.gridSize; y < this.height; y += this.theme.gridSize) {
        g.moveTo(0, y).lineTo(this.width, y);
      }
      g.stroke({ width: 1, color: this.theme.gridColor, alpha: this.theme.gridAlpha });
    }

    g.rect(0.5, 0.5, this.width - 1, this.height - 1).stroke({
      width: 2,
      color: this.theme.wallColor,
    });
  }

  private viewFor(snap: Snapshot["robots"][number]): RobotView {
    let view = this.views.get(snap.id);
    if (!view) {
      const root = new Container();
      const body = new Graphics();
      const turretPivot = new Container();
      const turret = new Graphics();
      turretPivot.addChild(turret);
      // A third independent heading, on its own pivot for the same reason the
      // turret has one: body, gun and radar each point where they were told.
      const radarPivot = new Container();
      const radar = new Graphics();
      radarPivot.addChild(radar);

      const label = new Text({
        text: snap.name,
        style: new TextStyle({
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 11,
          fill: this.theme.labelColor,
          stroke: { color: this.theme.labelStroke, width: 3 },
        }),
      });
      label.anchor.set(0.5, 0);
      label.y = ROBOT_RADIUS + 12;

      const healthBar = new Graphics();
      healthBar.y = ROBOT_RADIUS + 4;

      // Radar under the turret: when both point the same way, the gun is the
      // one that matters and should be on top.
      root.addChild(body, radarPivot, turretPivot, healthBar, label);
      this.robotLayer.addChild(root);
      view = {
        root,
        body,
        turretPivot,
        radarPivot,
        label,
        healthBar,
        drawnColor: "",
        drawnLabel: "",
        labelAge: LABEL_INTERVAL,
      };
      this.views.set(snap.id, view);
    }
    return view;
  }

  private drawRobots(from: Snapshot, to: Snapshot, t: number): void {
    for (let i = 0; i < to.robots.length; i++) {
      const now = to.robots[i]!;
      const was = from.robots[i] ?? now;
      const view = this.viewFor(now);

      // Redraw the cached art only when something about it actually changed.
      const key = `${now.color}|${now.locomotion}|${now.alive}`;
      if (view.drawnColor !== key) {
        const tint = hexToNumber(now.color);
        view.body.clear();
        this.theme.drawBody(view.body, tint, now.locomotion, ROBOT_RADIUS);
        const turret = view.turretPivot.children[0] as Graphics;
        turret.clear();
        this.theme.drawTurret(turret, tint, ROBOT_RADIUS);
        const radar = view.radarPivot.children[0] as Graphics;
        radar.clear();
        this.theme.drawRadar(radar, tint, ROBOT_RADIUS);
        view.drawnColor = key;
      }

      view.root.x = lerp(was.x, now.x, t);
      view.root.y = lerp(was.y, now.y, t);
      view.body.rotation = lerpAngle(was.heading, now.heading, t) * DEG_TO_RAD;
      // The turret carries an absolute heading, so it is NOT parented to the
      // body's rotation — that independence is the whole point of it.
      view.turretPivot.rotation = lerpAngle(was.turret, now.turret, t) * DEG_TO_RAD;
      view.radarPivot.rotation = lerpAngle(was.radar, now.radar, t) * DEG_TO_RAD;
      // Wrecks stay on the field, faded, so you can see where people died.
      view.root.alpha = now.alive ? 1 : 0.25;

      // Replacing the text throws away the old texture and rasterises a new
      // one, which is by far the most expensive thing a robot can ask the
      // renderer to do. A robot using its name as a debug readout changes it
      // thirty times a second, and at that rate the label is unreadable anyway
      // — so it is allowed to change a few times a second and no more.
      view.labelAge++;
      if (view.drawnLabel !== now.name && view.labelAge >= LABEL_INTERVAL) {
        view.label.text = now.name;
        view.drawnLabel = now.name;
        view.labelAge = 0;
      }

      const hb = view.healthBar;
      hb.clear();
      if (now.alive) {
        const w = ROBOT_RADIUS * 2;
        const frac = Math.max(0, now.health / MAX_HEALTH);
        hb.rect(-w / 2, 0, w, 3).fill({ color: 0x000000, alpha: 0.45 });
        hb.rect(-w / 2, 0, w * frac, 3).fill(
          frac > 0.5 ? 0x6ad98a : frac > 0.25 ? 0xffd166 : 0xff6b6b,
        );
      }
    }
  }

  private drawBullets(from: Snapshot, to: Snapshot, t: number): void {
    const g = this.bullets;
    g.clear();
    // Match bullets by id so a bullet that died this tick isn't interpolated
    // toward some unrelated new one.
    const previous = new Map(from.bullets.map((b) => [b.id, b]));
    for (const b of to.bullets) {
      const was = previous.get(b.id) ?? b;
      const x = lerp(was.x, b.x, t);
      const y = lerp(was.y, b.y, t);
      drawBulletAt(g, this.theme, x, y, b.heading, b.power);
    }
  }

  private drawCones(from: Snapshot, to: Snapshot, t: number): void {
    const g = this.cones;
    g.clear();
    if (!this.options.showSenseCones) return;
    for (let i = 0; i < to.robots.length; i++) {
      const now = to.robots[i]!;
      if (!now.alive) continue;
      const was = from.robots[i] ?? now;
      const x = lerp(was.x, now.x, t);
      const y = lerp(was.y, now.y, t);
      const heading = lerpAngle(was.heading, now.heading, t);

      const a0 = (heading - SENSE.halfAngle) * DEG_TO_RAD;
      const a1 = (heading + SENSE.halfAngle) * DEG_TO_RAD;
      g.moveTo(x, y);
      g.arc(x, y, SENSE.range, a0, a1);
      g.lineTo(x, y);
      g.fill({ color: hexToNumber(now.color), alpha: this.theme.senseConeAlpha });
    }
  }

  private drawParticles(): void {
    const g = this.effects;
    g.clear();
    for (const p of this.particles) {
      const k = p.age / p.life;
      const fade = 1 - k;
      if (p.type === "muzzle") {
        g.circle(p.x, p.y, 3 + k * 7).fill({ color: this.theme.impactColor, alpha: fade * 0.7 });
      } else if (p.type === "impact") {
        g.circle(p.x, p.y, 2 + k * 12).stroke({
          width: 2,
          color: this.theme.impactColor,
          alpha: fade,
        });
      } else if (p.type === "explosion") {
        g.circle(p.x, p.y, 4 + k * 34).stroke({
          width: 3,
          color: this.theme.explosionColor,
          alpha: fade,
        });
        g.circle(p.x, p.y, 2 + k * 18).fill({
          color: this.theme.explosionColor,
          alpha: fade * 0.35,
        });
      } else if (p.type === "ping") {
        // The beam itself, drawn as the thin wedge the simulation actually
        // tested: its length is how far the ping reached, so a ping that found
        // somebody visibly stops at them.
        const spread = (RADAR.halfAngle * Math.PI) / 180;
        const dir = (p.heading * Math.PI) / 180;
        const reach = p.range * (0.35 + 0.65 * Math.min(1, k * 2.2));
        g.moveTo(p.x, p.y)
          .lineTo(p.x + Math.cos(dir - spread) * reach, p.y + Math.sin(dir - spread) * reach)
          .lineTo(p.x + Math.cos(dir + spread) * reach, p.y + Math.sin(dir + spread) * reach)
          .fill({ color: this.theme.pingColor, alpha: fade * 0.28 });
        g.moveTo(p.x, p.y)
          .lineTo(p.x + Math.cos(dir) * reach, p.y + Math.sin(dir) * reach)
          .stroke({ width: 1.2, color: this.theme.pingColor, alpha: fade * 0.85 });
      } else {
        g.circle(p.x, p.y, 2 + k * 5).fill({ color: this.theme.wallColor, alpha: fade * 0.6 });
      }
      p.age++;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
  }
}

/**
 * Bullets are drawn directly into the shared Graphics at world coordinates.
 * Rotating a shape without a container means composing the rotation by hand,
 * which is cheap for something this small.
 */
function drawBulletAt(
  g: Graphics,
  theme: ArenaTheme,
  x: number,
  y: number,
  heading: number,
  power: number,
): void {
  const r = 3 * (0.8 + power * 0.25);
  const c = Math.cos(heading * DEG_TO_RAD);
  const s = Math.sin(heading * DEG_TO_RAD);
  // Elongating along the direction of travel reads as motion. The mechanical
  // theme keeps shots nearly round; biological darts are long and thin.
  const long = r * theme.bulletLength;
  const wide = r * theme.bulletWidth;
  g.poly([
    x + c * long,
    y + s * long,
    x - s * wide,
    y + c * wide,
    x - c * long,
    y - s * long,
    x + s * wide,
    y - c * wide,
  ]).fill(theme.bulletColor);
}
