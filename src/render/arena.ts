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
import type { TerrainField } from "../sim/terrain.js";
import type { Theme } from "../lang/vocab.js";
import { lerp, lerpAngle, snapshot, type Snapshot } from "./interpolate.js";

interface Particle {
  /**
   * `wake` is renderer-only: it is shed by a robot labouring against the
   * ground, frame by frame, rather than emitted by the simulation. That is
   * deliberate. The sim has no business knowing about dust, and because this
   * never crosses back into it the scatter below is free to use `Math.random`
   * \u2014 two peers can watch differently shaped dust clouds above a match that is
   * still bit-identical underneath.
   */
  type: Effect["type"] | "wake";
  x: number;
  y: number;
  heading: number;
  /** Frames lived so far, and total lifetime in frames. */
  age: number;
  life: number;
  /** How far a ping reached before it hit something. */
  range: number;
  /** Wake only: how hard the robot was working when it shed this, 0..1. */
  effort?: number;
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
  fuelBar: Graphics;
  /** Drawn under the body, rotated with it: the fluid or dirt being shoved aside. */
  strain: Graphics;
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

/**
 * The tank gauge, shared by both themes rather than taken from the art pack.
 *
 * The gauge's neighbour is the health bar, which runs green -> yellow -> red as
 * a robot is worn down, so the one thing this colour must never be is anywhere
 * in that range. The biological pack's own fuel colour is a lime that sits
 * squarely between its green and its yellow, and a half-dead organism would
 * have shown two near-identical stripes. Cells and the pickup ring still use
 * the themed colour: they sit on the arena floor, where the constraint is not
 * to look like a robot instead.
 */
export const FUEL_BAR_COLOR = 0x2fe0c8;

/**
 * Ceiling on shed wake particles. Eight robots all climbing at once would
 * otherwise spawn faster than they expire and quietly turn the arena into
 * fog \u2014 at which point the effect stops meaning anything anyway.
 */
const MAX_WAKE_PARTICLES = 220;

export class ArenaRenderer {
  private app: Application | null = null;
  private theme: ArenaTheme;
  private options: ArenaOptions;

  private backdrop = new Graphics();
  /** The shape of the ground. Static for a whole match, so drawn once. */
  private terrain = new Graphics();
  /** Grid and walls, above the terrain so the map reads as ground, not as paint. */
  private grid = new Graphics();
  private cones = new Graphics();
  private bullets = new Graphics();
  private fuel = new Graphics();
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
  /**
   * The ground for the current match, or null for a flat one. Taken from the
   * world on the first step rather than plumbed in separately: the renderer is
   * already handed the world, and one source beats two that can disagree.
   */
  private terrainField: TerrainField | null = null;
  private terrainKey = "";

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
    app.stage.addChild(this.terrain);
    app.stage.addChild(this.grid);
    app.stage.addChild(this.cones);
    // Under everything that moves: a cell is scenery until somebody reaches it,
    // and it must never hide a robot or a bullet.
    app.stage.addChild(this.fuel);
    app.stage.addChild(this.bullets);
    app.stage.addChild(this.robotLayer);
    app.stage.addChild(this.effects);

    this.drawBackdrop();
    this.drawTerrain();
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
      // The two art packs read the same field completely differently \u2014 one as
      // contoured ground, the other as pooled fluid \u2014 so a theme swap has to
      // redraw the map, not just recolour it.
      this.drawTerrain();
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
    this.fuel.clear();
    this.effects.clear();
    this.cones.clear();
    // Not the terrain: `reset` is for a rerun of the same match, and the ground
    // does not change between attempts. `onStep` redraws it if the map really
    // did change.
  }

  /** Called once per simulation tick, after the world has stepped. */
  onStep(world: World): void {
    // Cheap identity check on the map's recipe. A new match with different
    // ground redraws; the same match stepping again does not.
    const cfg = world.terrainConfig;
    const key = cfg.enabled ? `${cfg.seed}|${cfg.featureSize}|${cfg.amplitude}` : "";
    if (key !== this.terrainKey) {
      this.terrainKey = key;
      this.terrainField = cfg.enabled ? world.terrain : null;
      this.drawTerrain();
    }

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
      this.drawFuel(to);
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
    this.backdrop.clear();
    this.theme.drawBackdrop?.(this.backdrop, this.width, this.height);

    const g = this.grid;
    g.clear();
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

  /**
   * Redraw the ground.
   *
   * Once per match, not once per frame: terrain never changes while a match is
   * running, and sampling a noise field across the whole arena is far too much
   * work to repeat sixty times a second.
   */
  private drawTerrain(): void {
    const g = this.terrain;
    g.clear();
    const field = this.terrainField;
    if (!field || !this.theme.drawTerrain) return;
    this.theme.drawTerrain(
      g,
      (x: number, y: number) => field.heightAt(x, y),
      this.width,
      this.height,
    );
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

      // Directly under the health bar, thinner: the two read as one gauge, and
      // which is which stays obvious because they never share a colour.
      const fuelBar = new Graphics();
      fuelBar.y = ROBOT_RADIUS + 8;

      // Displaced ground or fluid, under everything: it is what the robot is
      // shoving through, so the robot has to be on top of it.
      const strain = new Graphics();

      // Radar under the turret: when both point the same way, the gun is the
      // one that matters and should be on top.
      root.addChild(strain, body, radarPivot, turretPivot, healthBar, fuelBar, label);
      this.robotLayer.addChild(root);
      view = {
        root,
        body,
        turretPivot,
        radarPivot,
        label,
        healthBar,
        fuelBar,
        strain,
        drawnColor: "",
        drawnLabel: "",
        labelAge: LABEL_INTERVAL,
      };
      this.views.set(snap.id, view);
    }
    return view;
  }

  /**
   * How hard a robot is visibly working: uphill, under power, right now.
   *
   * Both factors are needed. A robot parked on a hill is not straining, and a
   * robot flat out across a contour is not either \u2014 it is the product that
   * shows, which is also exactly what the fuel bill is proportional to.
   */
  private static effortOf(snap: Snapshot["robots"][number]): number {
    if (!snap.alive) return 0;
    const e = snap.climb * Math.abs(snap.speed);
    return e > 0 ? Math.min(1, e / 0.5) : 0;
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

      // --- fighting the ground ---
      const effort = ArenaRenderer.effortOf(now);
      const strain = view.strain;
      strain.clear();
      if (effort > 0 && this.theme.drawStrain) {
        // Rotated with the body: a bow wave piles up at the nose, and the nose
        // is wherever the chassis is pointing.
        strain.rotation = view.body.rotation;
        this.theme.drawStrain(strain, effort, now.speed, ROBOT_RADIUS);
      }
      if (effort > 0.12 && this.theme.drawWake && this.particles.length < MAX_WAKE_PARTICLES) {
        // Shed behind the robot, in world space, so it stays where it was made
        // while the robot drives on out of it.
        const heading = lerpAngle(was.heading, now.heading, t);
        const back = (heading + 180) * DEG_TO_RAD;
        const spread = (Math.random() - 0.5) * ROBOT_RADIUS * 1.4;
        this.particles.push({
          type: "wake",
          x: view.root.x + Math.cos(back) * ROBOT_RADIUS + Math.cos(back + Math.PI / 2) * spread,
          y: view.root.y + Math.sin(back) * ROBOT_RADIUS + Math.sin(back + Math.PI / 2) * spread,
          heading,
          age: 0,
          life: 16 + Math.floor(Math.random() * 10),
          range: 0,
          effort,
        });
      }

      const fb = view.fuelBar;
      fb.clear();
      if (now.alive && to.fuelEnabled) {
        const w = ROBOT_RADIUS * 2;
        const frac = Math.max(0, Math.min(1, now.fuel));
        fb.rect(-w / 2, 0, w, 2).fill({ color: 0x000000, alpha: 0.45 });
        fb.rect(-w / 2, 0, w * frac, 2).fill({ color: FUEL_BAR_COLOR, alpha: 0.95 });
      }
    }
  }

  /**
   * Cells are static, so there is nothing to interpolate and only the current
   * snapshot is needed. Redrawn each frame anyway: there are a handful at most,
   * and a cached container would have to be invalidated every time one is
   * eaten, which costs more thought than the redraw costs cycles.
   */
  private drawFuel(to: Snapshot): void {
    const g = this.fuel;
    g.clear();
    for (const f of to.fuel) {
      g.translateTransform(f.x, f.y);
      this.theme.drawFuel(g, to.fuelRadius);
      g.resetTransform();
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
      } else if (p.type === "wake") {
        this.theme.drawWake?.(g, p.x, p.y, p.heading, k, p.effort ?? 0);
      } else if (p.type === "pickup") {
        // An expanding ring where the cell was, so a pickup is legible even
        // when it happens off to the side of whatever you were watching.
        g.circle(p.x, p.y, 4 + k * 14).stroke({
          width: 2,
          color: this.theme.fuelColor,
          alpha: fade * 0.85,
        });
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
