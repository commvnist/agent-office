import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { Layout } from "@agent-office/core";
import { T } from "./actor.ts";
import { mix } from "./pixel.ts";
import { roleColor, setRoles, theme } from "./theme.ts";
import { settings } from "./settings.ts";
import { carpetTex, chairTex, coffeeTex, coolerTex, couchTex, deskTex, laptopTex, plantTex, shelfTex, wallTex, woodTex } from "./sprites.ts";

const hexNum = (h: string) => parseInt(h.slice(1), 16);

export type SeatState = { used: boolean; working: boolean };

type Desk = { s: Sprite; accent: string; chair: Sprite | null; overflowTier: number | null };

/** Static office furniture + the small amount of ambient animation (windows, clock, whiteboard). */
export class Scene {
  floor = new Container();
  walls = new Container();
  sky = new Graphics();
  clock = new Graphics();
  night = new Graphics();
  boardText: Text;
  desks = new Map<string, Desk>();
  state = new Map<string, SeatState>();
  coffee: { x: number; y: number };
  private skyHour = -1;

  constructor(private l: Layout, world: Container, ysort: Container, ui: Container) {
    setRoles(l.zones.map((z) => z.role)); // stable role colours/badges: sorted name order
    world.addChild(this.floor, this.walls, this.sky, this.clock, ysort, this.night);
    this.buildFloor();
    this.buildWalls();
    this.buildFurniture(ysort);
    const c = l.decor.find((d) => d.kind === "coffee")!;
    this.coffee = { x: c.x * T + 8, y: c.y * T + 2 };
    this.boardText = new Text({
      text: "",
      style: { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 11, fill: 0x1d2a44, lineHeight: 14, wordWrap: true, wordWrapWidth: 150 },
    });
    ui.addChild(this.boardText);
    this.night.rect(0, 0, l.cols * T, l.rows * T).fill(0x0b1030);
    this.night.eventMode = "none";
  }

  private buildFloor() {
    const l = this.l;
    const carpet = new Map<string, number>();
    for (const z of l.zones) {
      const tint = hexNum(mix(roleColor(z.role), "#ffffff", theme().carpet.zoneMix));
      for (let y = z.y - 1; y <= z.y + 7; y++) for (let x = z.x - 1; x <= z.x + z.w - 1; x++) carpet.set(`${x},${y}`, tint);
    }
    const lobbyTint = hexNum(theme().carpet.lobby);
    for (let y = l.lobby[0].y - 1; y <= l.lobby[0].y + 2; y++) for (let x = 1; x < l.cols - 1; x++) carpet.set(`${x},${y}`, lobbyTint);
    for (let y = l.wallRows; y < l.rows; y++)
      for (let x = 0; x < l.cols; x++) {
        const tint = carpet.get(`${x},${y}`);
        const s = new Sprite(tint ? carpetTex(x + y) : woodTex(x + y));
        s.position.set(x * T, y * T);
        if (tint) s.tint = tint;
        this.floor.addChild(s);
      }
    const door = new Graphics().rect(l.door.x * T - 4, l.door.y * T + 6, T + 8, 10).fill(0x3b2b1a).rect(l.door.x * T - 4, l.door.y * T + 6, T + 8, 2).fill(0xc9a46a);
    this.floor.addChild(door);
  }

  private buildWalls() {
    for (let x = 0; x < this.l.cols; x++) {
      const s = new Sprite(wallTex());
      s.position.set(x * T, 0);
      this.walls.addChild(s);
    }
    // whiteboard frame (text is drawn in the screen-space overlay)
    const b = this.l.board;
    const g = new Graphics();
    g.roundRect(b.x * T, 3, b.w * T, 24, 2).fill(0xe9edf5).stroke({ width: 2, color: 0x8b93ad });
    g.rect(b.x * T + 4, 27, b.w * T - 8, 2).fill(0x8b93ad);
    this.walls.addChild(g);
  }

  private buildFurniture(ysort: Container) {
    const l = this.l;
    const add = (tex: Sprite["texture"], x: number, y: number, z: number) => {
      const s = new Sprite(tex);
      s.position.set(x, y);
      s.zIndex = z;
      ysort.addChild(s);
      return s;
    };
    for (const p of l.props) {
      const accent = mix(roleColor(p.role), "#ffffff", 0.25);
      const seat = p.kind === "permanent"
        ? `${p.role}#${(p.x - l.zones.find((z) => z.role === p.role)!.x) / 2}`
        : `${p.role}+${p.tier}`;
      const chair = add(chairTex(), p.x * T, (p.y - 1) * T, p.y * T - 0.5);
      const s = p.kind === "permanent" ? add(deskTex(accent, 0), p.x * T, p.y * T, p.y * T + T) : add(laptopTex(p.tier), p.x * T, p.y * T, p.y * T + T);
      s.visible = p.kind === "permanent";
      chair.visible = p.kind === "permanent";
      this.desks.set(seat, { s, accent, chair, overflowTier: p.kind === "overflow" ? p.tier : null });
    }
    l.lobby.forEach((t, i) => {
      const chair = add(chairTex(), t.x * T, t.y * T, (t.y + 1) * T - 0.5);
      const s = add(deskTex("#f4f1ff", 0), t.x * T, (t.y + 1) * T, (t.y + 2) * T);
      this.desks.set(`lobby#${i}`, { s, accent: "#f4f1ff", chair, overflowTier: null });
    });
    for (const d of l.decor) {
      const z = d.y * T + T;
      if (d.kind === "plant") add(plantTex(), d.x * T, d.y * T, z);
      else if (d.kind === "coffee") add(coffeeTex(), d.x * T, d.y * T, z);
      else if (d.kind === "cooler") add(coolerTex(), d.x * T, d.y * T, z);
      else if (d.kind === "bookshelf") add(shelfTex(), d.x * T, d.y * T, z);
      else if (d.kind === "couch") add(couchTex(), d.x * T, d.y * T, z);
    }
  }

  destroy() {
    this.boardText.destroy();
  }

  setSeats(m: Map<string, SeatState>) {
    this.state = m;
    for (const [id, d] of this.desks) {
      const st = m.get(id);
      if (d.overflowTier !== null) {
        d.s.visible = !!st?.used;
        if (d.chair) d.chair.visible = !!st?.used;
      }
    }
  }

  /** Per-frame: monitor flicker, sky, clock, night tint, whiteboard position. */
  tick(now: number, ox: number, oy: number, sc: number, lines: string[]) {
    const flick = settings.reducedMotion ? 0 : Math.floor(now / 260) % 2;
    for (const [id, d] of this.desks) {
      if (d.overflowTier !== null) continue;
      const st = this.state.get(id);
      d.s.texture = deskTex(d.accent, st?.used ? (st.working ? ((1 + flick) as 1 | 2) : 3) : 0);
    }
    const dt = new Date(now);
    const hour = dt.getHours() + dt.getMinutes() / 60;
    const hk = Math.floor(hour * 4);
    if (hk !== this.skyHour) { this.skyHour = hk; this.drawSky(hour); }
    this.drawClock(dt);
    this.night.alpha = this.nightAlpha(hour);
    const b = this.l.board;
    const fs = Math.max(8, Math.min(13, sc * 3.6)), lh = fs * 1.3;
    const n = Math.max(1, Math.floor((22 * sc) / lh));
    this.boardText.style.fontSize = fs;
    this.boardText.style.lineHeight = lh;
    this.boardText.style.wordWrap = false;
    const maxChars = Math.max(8, Math.floor(((b.w * T - 10) * sc) / (fs * 0.62)));
    const fit = (l: string) => (l.length > maxChars ? l.slice(0, maxChars - 1) + "…" : l);
    this.boardText.text = lines.length ? lines.slice(0, n).map(fit).join("\n") : "No tasks yet";
    this.boardText.position.set(ox + (b.x * T + 5) * sc, oy + 5 * sc);
  }

  private nightAlpha(h: number) {
    const max = theme().nightMax; // capped by theme so alert cues in the world layer stay readable; UI layer is above this overlay
    if (h >= 8 && h < 18) return 0;
    if (h >= 18 && h < 21) return ((h - 18) / 3) * max;
    if (h >= 21 || h < 5) return max;
    return (1 - (h - 5) / 3) * max;
  }

  private drawSky(hour: number) {
    const day = hour >= 7 && hour < 18, dusk = (hour >= 18 && hour < 20) || (hour >= 5 && hour < 7);
    const top = day ? 0x7ec8f5 : dusk ? 0xf0925a : 0x0e1535;
    const bottom = day ? 0xcdeaff : dusk ? 0xffd08a : 0x1f2a5a;
    this.sky.clear();
    const l = this.l;
    for (let x = 3; x < l.cols - 4; x += 4) {
      if (x + 2 > l.board.x - 1 && x < l.board.x + l.board.w + 1) continue;
      const wx = x * T, w = 2 * T;
      this.sky.rect(wx - 2, 2, w + 4, 26).fill(0x2a263e);
      this.sky.rect(wx, 4, w, 11).fill(top).rect(wx, 15, w, 11).fill(bottom);
      if (!day && !dusk) for (let i = 0; i < 4; i++) this.sky.rect(wx + 4 + ((i * 9 + x * 3) % 24), 6 + ((i * 5) % 12), 1, 1).fill(0xffffff);
      if (day) this.sky.roundRect(wx + 6, 7, 10, 3, 1).fill(0xffffff);
      this.sky.rect(wx + T - 1, 4, 2, 22).fill(0x2a263e).rect(wx, 14, w, 2).fill(0x2a263e);
    }
  }

  private drawClock(d: Date) {
    const b = this.l.board, cx = (b.x + b.w + 1) * T + 4, cy = 14;
    const g = this.clock;
    g.clear().circle(cx, cy, 9).fill(0xf4f1ff).stroke({ width: 2, color: 0x2a263e });
    const m = d.getMinutes() + d.getSeconds() / 60, h = (d.getHours() % 12) + m / 60;
    const hand = (a: number, len: number, w: number) =>
      g.moveTo(cx, cy).lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len).stroke({ width: w, color: 0x2a263e });
    hand((h / 12) * Math.PI * 2, 4, 2);
    hand((m / 60) * Math.PI * 2, 6.5, 1);
  }
}
