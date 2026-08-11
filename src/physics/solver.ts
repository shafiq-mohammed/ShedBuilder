import { TUNE } from './tuning';

export interface Particle {
  x: number; y: number;
  px: number; py: number;    // previous position (Verlet)
  rx: number; ry: number;    // rest (as-built) position, for drift detection
  w: number;                 // inverse mass (0 = anchored)
  mass: number;
  fx: number; fy: number;    // external force accumulator (lbf), reset each frame
  frozen: boolean;
}

/** One axial stick = one drawable chunk of lumber. */
export interface Segment {
  p1: number; p2: number;
  rest: number;
  alpha: number;             // XPBD compliance (ft/lbf)
  typeId: string;
  memberId: string;
  halfDepth: number;         // ft, half the in-plane depth (collision + drawing)
  capStrain: number;
  broken: boolean;
  damage: number;
  stress: number;            // display stress 0..1+ (max of axial & adjacent bend)
  axialStrain: number;
  lambda: number;
  /** joint pull-out: set on member-end segments that are nailed/bracketed to
   * another member. Tension beyond cap detaches the end at runtime. */
  connCap?: number;          // lbf
  connJoint?: number;        // particle index of the joint this end grips
  connDamage: number;
  connStressEma?: number;
}

/**
 * Angular bend constraint over a particle triple (p0,p1,p2) of a member chain.
 * C = kink angle at p1 (rest = straight). Linear restoring torque ~ EI, so
 * beam-like sag and Euler buckling emerge naturally.
 */
export interface BendAngle {
  p0: number; p1: number; p2: number;
  alpha: number;             // rad per lbf*ft (= s/EI)
  thetaCap: number;          // kink angle at 100% bend stress
  segA: number; segB: number;
  lambda: number;
  theta: number;             // last solved angle (for stress display)
}

export interface Rope {
  p1: number; p2: number;
  rest: number;
  alpha: number;
  lambda: number;
}

export interface PanelDiag {
  p1: number; p2: number;
  rest: number;
  alpha: number;
  capStrain: number;
  panelIdx: number;
  stress: number;
  lambda: number;
}

export interface SimPanel {
  corners: [number, number, number, number];
  broken: boolean;
  damage: number;
  stress: number;
}

export type HeavyKind = 'brick' | 'person' | 'weight';

export interface Heavy {
  p: number;
  r: number;
  weightLb: number;
  kind: HeavyKind;
  label: string;
  friction: number;
  passed?: boolean;
  fell?: boolean;
}

export interface BreakEvent { x: number; y: number; t: number; kind: 'lumber' | 'panel' }

export class Sim {
  parts: Particle[] = [];
  segs: Segment[] = [];
  bends: BendAngle[] = [];
  ropes: Rope[] = [];
  diags: PanelDiag[] = [];
  panels: SimPanel[] = [];
  heavies: Heavy[] = [];
  groundY = 0;
  time = 0;
  settleLeft = TUNE.SETTLE_TIME;
  breaks: BreakEvent[] = [];
  breakCount = 0;
  maxStress = 0;

  addParticle(x: number, y: number, mass = 0): number {
    this.parts.push({ x, y, px: x, py: y, rx: x, ry: y, w: 0, mass, fx: 0, fy: 0, frozen: false });
    return this.parts.length - 1;
  }

  addHeavy(x: number, y: number, weightLb: number, r: number, kind: HeavyKind, label: string): Heavy {
    const idx = this.addParticle(x, y, weightLb);
    // mass field stores lb (display); dynamics use slugs so forces are lbf
    this.parts[idx].w = TUNE.GRAVITY / weightLb;
    const hv: Heavy = {
      p: idx, r, weightLb, kind, label,
      friction: kind === 'person' ? TUNE.PERSON_FRICTION : TUNE.HEAVY_FRICTION,
    };
    this.heavies.push(hv);
    return hv;
  }

  removeHeavy(hv: Heavy) {
    const i = this.heavies.indexOf(hv);
    if (i >= 0) this.heavies.splice(i, 1);
    this.ropes = this.ropes.filter((r) => r.p1 !== hv.p && r.p2 !== hv.p);
    this.parts[hv.p].frozen = true;
  }

  clearForces() {
    for (const p of this.parts) { p.fx = 0; p.fy = 0; }
  }

  get settling(): boolean { return this.settleLeft > 0; }

  step(dt: number) {
    if (dt <= 0) return;
    const sub = TUNE.SUBSTEPS;
    const h = dt / sub;
    const damp = this.settling ? TUNE.SETTLE_DAMP : TUNE.DAMP;
    for (let s = 0; s < sub; s++) this.substep(h, damp);
    this.time += dt;
    if (this.settleLeft > 0) this.settleLeft -= dt;
    this.updateStressAndDamage(dt);
  }

  private substep(h: number, damp: number) {
    const g = TUNE.GRAVITY;
    for (const p of this.parts) {
      if (p.w === 0 || p.frozen) continue;
      let vx = (p.x - p.px) / h + p.fx * p.w * h;
      let vy = (p.y - p.py) / h + (p.fy * p.w - g) * h;
      vx *= damp; vy *= damp;
      p.px = p.x; p.py = p.y;
      p.x += vx * h; p.y += vy * h;
    }
    // XPBD: lambdas reset each substep, accumulated across iterations
    for (const s of this.segs) s.lambda = 0;
    for (const b of this.bends) b.lambda = 0;
    for (const d of this.diags) d.lambda = 0;
    for (const r of this.ropes) r.lambda = 0;

    const h2 = h * h;
    for (let it = 0; it < TUNE.ITERS; it++) {
      this.solveSegs(h2);
      this.solveBends(h2);
      this.solveDiags(h2);
      this.solveRopes(h2);
      this.solveHeavyCollisions();
      this.solveGround();
    }
  }

  private solveSegs(h2: number) {
    const parts = this.parts;
    for (const s of this.segs) {
      if (s.broken) continue;
      const a = parts[s.p1], b = parts[s.p2];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-9) continue;
      const C = d - s.rest;
      const at = s.alpha / h2;
      const wsum = a.w + b.w + at;
      if (wsum < 1e-12) continue;
      const dl = (-C - at * s.lambda) / wsum;
      s.lambda += dl;
      const nx = dx / d, ny = dy / d;
      // grad wrt a is -n, wrt b is +n
      a.x -= dl * a.w * nx; a.y -= dl * a.w * ny;
      b.x += dl * b.w * nx; b.y += dl * b.w * ny;
      s.axialStrain = C / s.rest;
    }
  }

  private solveBends(h2: number) {
    const parts = this.parts;
    for (const b of this.bends) {
      if (this.segs[b.segA].broken || this.segs[b.segB].broken) continue;
      const p0 = parts[b.p0], p1 = parts[b.p1], p2 = parts[b.p2];
      const ux = p1.x - p0.x, uy = p1.y - p0.y;
      const vx = p2.x - p1.x, vy = p2.y - p1.y;
      const lu2 = ux * ux + uy * uy;
      const lv2 = vx * vx + vy * vy;
      if (lu2 < 1e-12 || lv2 < 1e-12) continue;
      const theta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      b.theta = theta;
      const C = theta;
      const at = b.alpha / h2;
      // gradients of theta
      const g0x = -uy / lu2, g0y = ux / lu2;           // perp(u)/|u|^2
      const g2x = -vy / lv2, g2y = vx / lv2;           // perp(v)/|v|^2
      const g1x = -g0x - g2x, g1y = -g0y - g2y;
      const wsum =
        p0.w * (g0x * g0x + g0y * g0y) +
        p1.w * (g1x * g1x + g1y * g1y) +
        p2.w * (g2x * g2x + g2y * g2y) + at;
      if (wsum < 1e-12) continue;
      const dl = (-C - at * b.lambda) / wsum;
      b.lambda += dl;
      p0.x += dl * p0.w * g0x; p0.y += dl * p0.w * g0y;
      p1.x += dl * p1.w * g1x; p1.y += dl * p1.w * g1y;
      p2.x += dl * p2.w * g2x; p2.y += dl * p2.w * g2y;
    }
  }

  private solveDiags(h2: number) {
    const parts = this.parts;
    for (const dg of this.diags) {
      if (this.panels[dg.panelIdx].broken) continue;
      const a = parts[dg.p1], b = parts[dg.p2];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-9) continue;
      const C = d - dg.rest;
      const at = dg.alpha / h2;
      const wsum = a.w + b.w + at;
      if (wsum < 1e-12) continue;
      const dl = (-C - at * dg.lambda) / wsum;
      dg.lambda += dl;
      const nx = dx / d, ny = dy / d;
      a.x -= dl * a.w * nx; a.y -= dl * a.w * ny;
      b.x += dl * b.w * nx; b.y += dl * b.w * ny;
      dg.stress = Math.abs(C / dg.rest) / dg.capStrain;
    }
  }

  private solveRopes(h2: number) {
    const parts = this.parts;
    for (const r of this.ropes) {
      const a = parts[r.p1], b = parts[r.p2];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d <= r.rest || d < 1e-9) continue;   // rope: only resists stretch
      const C = d - r.rest;
      const at = r.alpha / h2;
      const wsum = a.w + b.w + at;
      if (wsum < 1e-12) continue;
      const dl = (-C - at * r.lambda) / wsum;
      r.lambda += dl;
      const nx = dx / d, ny = dy / d;
      a.x -= dl * a.w * nx; a.y -= dl * a.w * ny;
      b.x += dl * b.w * nx; b.y += dl * b.w * ny;
      // straps are lossy: bleed off relative radial velocity while taut
      const rvx = (b.x - b.px) - (a.x - a.px);
      const rvy = (b.y - b.py) - (a.y - a.py);
      const vr = rvx * nx + rvy * ny;
      const D = 0.2;
      const wt = a.w + b.w;
      if (wt > 1e-12) {
        b.px += nx * vr * D * (b.w / wt); b.py += ny * vr * D * (b.w / wt);
        a.px -= nx * vr * D * (a.w / wt); a.py -= ny * vr * D * (a.w / wt);
      }
    }
  }

  /** Heavy circle particles (bricks, person, weights) vs lumber segments. */
  private solveHeavyCollisions() {
    const parts = this.parts;
    const h = 1 / (60 * TUNE.SUBSTEPS);
    const atContact = TUNE.CONTACT_ALPHA / (h * h);
    for (const hv of this.heavies) {
      const hp = parts[hv.p];
      if (hp.frozen) continue;
      for (const s of this.segs) {
        if (s.broken) continue;
        const a = parts[s.p1], b = parts[s.p2];
        const minR = hv.r + s.halfDepth;
        if (hp.x < Math.min(a.x, b.x) - minR || hp.x > Math.max(a.x, b.x) + minR ||
            hp.y < Math.min(a.y, b.y) - minR || hp.y > Math.max(a.y, b.y) + minR) continue;
        const abx = b.x - a.x, aby = b.y - a.y;
        const len2 = abx * abx + aby * aby;
        let u = len2 < 1e-12 ? 0 :
          ((hp.x - a.x) * abx + (hp.y - a.y) * aby) / len2;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const cx = a.x + u * abx, cy = a.y + u * aby;
        let nx = hp.x - cx, ny = hp.y - cy;
        let d = Math.hypot(nx, ny);
        if (d >= minR) continue;
        if (d < 1e-9) { nx = 0; ny = 1; d = 1e-9; } else { nx /= d; ny /= d; }
        const pen = minR - d;
        const wEdge = a.w * (1 - u) * (1 - u) + b.w * u * u;
        const wsum = hp.w + wEdge + atContact;
        if (wsum < 1e-12) continue;
        const corr = pen / wsum;
        hp.x += nx * corr * hp.w; hp.y += ny * corr * hp.w;
        a.x -= nx * corr * a.w * (1 - u); a.y -= ny * corr * a.w * (1 - u);
        b.x -= nx * corr * b.w * u; b.y -= ny * corr * b.w * u;
        // friction: kill part of the heavy's tangential motion
        const tvx = (hp.x - hp.px), tvy = (hp.y - hp.py);
        const vn = tvx * nx + tvy * ny;
        const tx = tvx - vn * nx, ty = tvy - vn * ny;
        hp.px += tx * hv.friction;
        hp.py += ty * hv.friction;
      }
    }
  }

  private solveGround() {
    const gy = this.groundY;
    for (const hv of this.heavies) {
      const p = this.parts[hv.p];
      if (p.frozen) continue;
      if (p.y < gy + hv.r) {
        p.y = gy + hv.r;
        p.py = p.y;                              // no bounce
        p.px += (p.x - p.px) * TUNE.GROUND_FRICTION;
      }
    }
    for (const p of this.parts) {
      if (p.w === 0 || p.frozen) continue;
      if (p.y < gy + 0.05) {
        p.y = gy + 0.05;
        p.py = p.y;
        p.px += (p.x - p.px) * TUNE.GROUND_FRICTION;
      }
      if (p.y < gy - TUNE.FREEZE_BELOW) p.frozen = true;
    }
  }

  private updateStressAndDamage(dt: number) {
    this.maxStress = 0;
    // Stress from XPBD lambda multipliers (the constraint's actually-applied
    // force) rather than geometric strain: strain readings on lightly-massed
    // nodes carry a solver chase artifact; lambda impulses balance real loads.
    // lambda is from the last substep: force = |lambda| / h^2.
    const h = dt / TUNE.SUBSTEPS;
    const invH2 = 1 / (h * h);
    // smoothed over ~0.12 s (EMA) so damage responds to sustained overload,
    // not single-frame transients (rope catches, impacts, whip)
    const ema = Math.min(1, dt / 0.12);
    for (const s of this.segs) {
      if (s.broken) { s.stress = 0; continue; }
      const force = Math.abs(s.lambda) * invH2;
      const capForce = (s.capStrain * s.rest) / s.alpha;
      (s as any)._raw = force / capForce;
    }
    for (const b of this.bends) {
      const sa = this.segs[b.segA], sb = this.segs[b.segB];
      if (sa.broken || sb.broken) continue;
      // bending failure is fiber strain = curvature-driven, so use the
      // GEOMETRIC kink angle (a chain-deep sag snaps wood even at low moment)
      const bendStress = Math.abs(b.theta) / b.thetaCap;
      if (bendStress > (sa as any)._raw) (sa as any)._raw = bendStress;
      if (bendStress > (sb as any)._raw) (sb as any)._raw = bendStress;
    }
    for (const s of this.segs) {
      if (s.broken) continue;
      s.stress += ((s as any)._raw - s.stress) * ema;
    }
    const accrue = !this.settling;   // grace period: no damage while settling
    // joint pull-out: tension in a fastened member-end vs connection capacity
    for (const s of this.segs) {
      if (s.broken || s.connCap === undefined || s.connJoint === undefined) continue;
      const tension = Math.max(0, -s.lambda) * invH2;   // lambda<0 = stretched
      const raw = tension / s.connCap;
      s.connStressEma = (s.connStressEma ?? 0) + (raw - (s.connStressEma ?? 0)) * ema;
      const ratio = s.connStressEma;
      if (ratio > s.stress) s.stress = ratio;   // glowing joint = nails creaking
      if (ratio > 1 && accrue) {
        s.connDamage += Math.min(ratio - 1, 2) * TUNE.DMG_RATE * dt;
        if (s.connDamage >= 1) this.detachConnection(s);
      } else if (s.connDamage > 0 && ratio <= 1) {
        s.connDamage = Math.max(0, s.connDamage - 0.5 * dt);
      }
    }
    for (const s of this.segs) {
      if (s.broken) continue;
      if (s.stress > this.maxStress) this.maxStress = s.stress;
      if (s.stress > 1 && accrue) {
        // cap the overstress term so single-frame numeric spikes can't
        // instantly snap a member that statically holds
        s.damage += Math.min(s.stress - 1, 2) * TUNE.DMG_RATE * dt;
        if (s.damage >= 1) this.breakSegment(s);
      } else if (s.damage > 0 && s.stress <= 1) {
        s.damage = Math.max(0, s.damage - 0.5 * dt); // slow self-heal below cap
      }
    }
    for (const pn of this.panels) if (!pn.broken) pn.stress = 0;
    for (const dg of this.diags) {
      const pn = this.panels[dg.panelIdx];
      if (!pn.broken && dg.stress > pn.stress) pn.stress = dg.stress;
    }
    for (const pn of this.panels) {
      if (pn.broken) continue;
      if (pn.stress > this.maxStress) this.maxStress = pn.stress;
      if (pn.stress > 1 && !this.settling) {
        pn.damage += Math.min(pn.stress - 1, 2) * TUNE.DMG_RATE * dt;
        if (pn.damage >= 1) {
          pn.broken = true;
          const c = this.parts[pn.corners[0]];
          this.breaks.push({ x: c.x, y: c.y, t: this.time, kind: 'panel' });
          this.breakCount++;
        }
      }
    }
  }

  /** A fastened member-end pulls off its joint: clone the joint particle and
   * rewire this member's constraints onto the clone, so the member swings free
   * while everything else stays attached to the original joint. */
  private detachConnection(seg: Segment) {
    const j = seg.connJoint!;
    const jp = this.parts[j];
    const clone = this.addParticle(jp.x, jp.y, TUNE.MIN_PART_MASS);
    const cp = this.parts[clone];
    cp.px = jp.px; cp.py = jp.py;
    cp.rx = jp.rx; cp.ry = jp.ry;
    cp.w = TUNE.GRAVITY / TUNE.MIN_PART_MASS;
    const mid = seg.memberId;
    for (const s of this.segs) {
      if (s.memberId !== mid) continue;
      if (s.p1 === j) s.p1 = clone;
      if (s.p2 === j) s.p2 = clone;
    }
    for (const b of this.bends) {
      if (this.segs[b.segA].memberId !== mid) continue;
      if (b.p0 === j) b.p0 = clone;
      if (b.p1 === j) b.p1 = clone;
      if (b.p2 === j) b.p2 = clone;
    }
    seg.connCap = undefined;
    seg.connJoint = undefined;
    this.breaks.push({ x: jp.x, y: jp.y, t: this.time, kind: 'lumber' });
    this.breakCount++;
  }

  private breakSegment(s: Segment) {
    s.broken = true;
    const a = this.parts[s.p1], b = this.parts[s.p2];
    this.breaks.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: this.time, kind: 'lumber' });
    this.breakCount++;
  }

  /**
   * Largest displacement of any particle still attached to intact lumber,
   * relative to its as-built position. Detects racking/collapse that happens
   * without anything actually breaking (pin-jointed frames fold flat).
   */
  maxDrift(): number {
    let worst = 0;
    for (const s of this.segs) {
      if (s.broken) continue;
      for (const idx of [s.p1, s.p2]) {
        const p = this.parts[idx];
        const d = Math.hypot(p.x - p.rx, p.y - p.ry);
        if (d > worst) worst = d;
      }
    }
    return worst;
  }

  /** Recent break events (for screen shake / audio), pruned as consumed. */
  drainBreaks(): BreakEvent[] {
    const out = this.breaks;
    this.breaks = [];
    return out;
  }
}
