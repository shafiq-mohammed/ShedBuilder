import { TUNE } from '../physics/tuning';

/**
 * 3D port of the 2D XPBD solver. Same architecture, same tuning constants,
 * same lambda-based force readout — validated against the same physics tests.
 *
 * Bending uses a "sagitta" constraint instead of the 2D angle constraint:
 * C = p1 - lerp(p0, p2, f)  (3 components, constant gradients, no
 * degeneracy near straight). For equal spans s and kink angle theta,
 * |C| = s*theta/2 and compliance alpha = s^3/(4*EI) reproduces the same
 * bending stiffness as the 2D angular formulation.
 *
 * Simplification (documented): members bend isotropically at strong-axis EI —
 * we assume the builder orients lumber correctly, and nailed joints carry no
 * torsion.
 */

export interface P3 {
  x: number; y: number; z: number;
  px: number; py: number; pz: number;
  rx: number; ry: number; rz: number;   // as-built position (drift detection)
  w: number;                            // inverse mass, slugs^-1 (0 = anchored)
  mass: number;                         // lb, display
  fx: number; fy: number; fz: number;   // external force, lbf
  frozen: boolean;
}

export interface Seg3 {
  p1: number; p2: number;
  rest: number;
  alpha: number;
  typeId: string;
  memberId: string;
  halfDepth: number;
  capStrain: number;
  broken: boolean;
  damage: number;
  stress: number;
  axialStrain: number;
  lambda: number;
  connCap?: number;
  connJoint?: number;
  connDamage: number;
  connStressEma?: number;
}

/** Sagitta bend: keeps p1 on the segment p0..p2 at fraction f. */
export interface Bend3 {
  p0: number; p1: number; p2: number;
  f: number;                 // rest interpolation fraction r1/(r1+r2)
  alpha: number;             // ft/lbf  (= sAvg^3 / (4 EI))
  sagCap: number;            // |C| at 100% bend stress
  segA: number; segB: number;
  lx: number; ly: number; lz: number;   // per-component lambdas
}

/** Nailed-joint moment spring (see 2D JointSpring): chord-distance spring
 * across the knee of two members at a joint; yields into a pin past limit. */
export interface Spring3 {
  p1: number; p2: number;
  rest: number;
  alpha: number;
  yieldC: number;
  dead: boolean;
  lambda: number;
}

export interface Diag3 {
  p1: number; p2: number;
  rest: number;
  alpha: number;
  capStrain: number;
  panelIdx: number;
  stress: number;
  lambda: number;
}

export interface Panel3 {
  corners: [number, number, number, number];
  broken: boolean;
  damage: number;
  stress: number;
}

export interface Heavy3 {
  p: number;
  r: number;
  weightLb: number;
  label: string;
  friction: number;
}

export interface BreakEvent3 { x: number; y: number; z: number; t: number }

export class Sim3 {
  parts: P3[] = [];
  segs: Seg3[] = [];
  bends: Bend3[] = [];
  springs: Spring3[] = [];
  diags: Diag3[] = [];
  panels: Panel3[] = [];
  heavies: Heavy3[] = [];
  /** face ids each particle belongs to (for wind loading) */
  faceOf = new Map<number, Set<string>>();
  /** roof footprint area for snow loading, ft^2 */
  footprint = 96;
  groundY = 0;
  time = 0;
  settleLeft = TUNE.SETTLE_TIME;
  breaks: BreakEvent3[] = [];
  breakCount = 0;
  maxStress = 0;

  addParticle(x: number, y: number, z: number, mass = 0): number {
    this.parts.push({
      x, y, z, px: x, py: y, pz: z, rx: x, ry: y, rz: z,
      w: 0, mass, fx: 0, fy: 0, fz: 0, frozen: false,
    });
    return this.parts.length - 1;
  }

  addHeavy(x: number, y: number, z: number, weightLb: number, r: number, label: string): Heavy3 {
    const idx = this.addParticle(x, y, z, weightLb);
    this.parts[idx].w = TUNE.GRAVITY / weightLb;
    const hv: Heavy3 = { p: idx, r, weightLb, label, friction: TUNE.HEAVY_FRICTION };
    this.heavies.push(hv);
    return hv;
  }

  clearForces() {
    for (const p of this.parts) { p.fx = 0; p.fy = 0; p.fz = 0; }
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
      let vz = (p.z - p.pz) / h + p.fz * p.w * h;
      vx *= damp; vy *= damp; vz *= damp;
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.x += vx * h; p.y += vy * h; p.z += vz * h;
    }
    for (const s of this.segs) s.lambda = 0;
    for (const b of this.bends) { b.lx = 0; b.ly = 0; b.lz = 0; }
    for (const d of this.diags) d.lambda = 0;
    for (const sp of this.springs) sp.lambda = 0;

    const h2 = h * h;
    for (let it = 0; it < TUNE.ITERS; it++) {
      this.solveSegs(h2);
      this.solveBends(h2);
      this.solveDiags(h2);
      this.solveSprings(h2);
      this.solveHeavyCollisions();
      this.solveGround();
    }
  }

  private solveSegs(h2: number) {
    const parts = this.parts;
    for (const s of this.segs) {
      if (s.broken) continue;
      const a = parts[s.p1], b = parts[s.p2];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const C = d - s.rest;
      const at = s.alpha / h2;
      const wsum = a.w + b.w + at;
      if (wsum < 1e-12) continue;
      const dl = (-C - at * s.lambda) / wsum;
      s.lambda += dl;
      const nx = dx / d, ny = dy / d, nz = dz / d;
      a.x -= dl * a.w * nx; a.y -= dl * a.w * ny; a.z -= dl * a.w * nz;
      b.x += dl * b.w * nx; b.y += dl * b.w * ny; b.z += dl * b.w * nz;
      s.axialStrain = C / s.rest;
    }
  }

  private solveBends(h2: number) {
    const parts = this.parts;
    for (const b of this.bends) {
      if (this.segs[b.segA].broken || this.segs[b.segB].broken) continue;
      const p0 = parts[b.p0], p1 = parts[b.p1], p2 = parts[b.p2];
      const f = b.f, g0 = 1 - f;
      const at = b.alpha / h2;
      const wsum = p1.w + p0.w * g0 * g0 + p2.w * f * f + at;
      if (wsum < 1e-12) continue;
      // three independent scalar constraints with constant gradients
      {
        const C = p1.x - (g0 * p0.x + f * p2.x);
        const dl = (-C - at * b.lx) / wsum;
        b.lx += dl;
        p1.x += dl * p1.w; p0.x -= dl * p0.w * g0; p2.x -= dl * p2.w * f;
      }
      {
        const C = p1.y - (g0 * p0.y + f * p2.y);
        const dl = (-C - at * b.ly) / wsum;
        b.ly += dl;
        p1.y += dl * p1.w; p0.y -= dl * p0.w * g0; p2.y -= dl * p2.w * f;
      }
      {
        const C = p1.z - (g0 * p0.z + f * p2.z);
        const dl = (-C - at * b.lz) / wsum;
        b.lz += dl;
        p1.z += dl * p1.w; p0.z -= dl * p0.w * g0; p2.z -= dl * p2.w * f;
      }
    }
  }

  private solveDiags(h2: number) {
    const parts = this.parts;
    for (const dg of this.diags) {
      if (this.panels[dg.panelIdx].broken) continue;
      const a = parts[dg.p1], b = parts[dg.p2];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const C = d - dg.rest;
      const at = dg.alpha / h2;
      const wsum = a.w + b.w + at;
      if (wsum < 1e-12) continue;
      const dl = (-C - at * dg.lambda) / wsum;
      dg.lambda += dl;
      const nx = dx / d, ny = dy / d, nz = dz / d;
      a.x -= dl * a.w * nx; a.y -= dl * a.w * ny; a.z -= dl * a.w * nz;
      b.x += dl * b.w * nx; b.y += dl * b.w * ny; b.z += dl * b.w * nz;
      dg.stress = Math.abs(C / dg.rest) / dg.capStrain;
    }
  }

  private solveSprings(h2: number) {
    const parts = this.parts;
    for (const sp of this.springs) {
      if (sp.dead) continue;
      const a = parts[sp.p1], b = parts[sp.p2];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const C = d - sp.rest;
      if (Math.abs(C) > sp.yieldC) { sp.dead = true; continue; }  // nails let go
      const at = sp.alpha / h2;
      const wsum = a.w + b.w + at;
      if (wsum < 1e-12) continue;
      const dl = (-C - at * sp.lambda) / wsum;
      sp.lambda += dl;
      const nx = dx / d, ny = dy / d, nz = dz / d;
      a.x -= dl * a.w * nx; a.y -= dl * a.w * ny; a.z -= dl * a.w * nz;
      b.x += dl * b.w * nx; b.y += dl * b.w * ny; b.z += dl * b.w * nz;
    }
  }

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
            hp.y < Math.min(a.y, b.y) - minR || hp.y > Math.max(a.y, b.y) + minR ||
            hp.z < Math.min(a.z, b.z) - minR || hp.z > Math.max(a.z, b.z) + minR) continue;
        const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
        const len2 = abx * abx + aby * aby + abz * abz;
        let u = len2 < 1e-12 ? 0 :
          ((hp.x - a.x) * abx + (hp.y - a.y) * aby + (hp.z - a.z) * abz) / len2;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const cx = a.x + u * abx, cy = a.y + u * aby, cz = a.z + u * abz;
        let nx = hp.x - cx, ny = hp.y - cy, nz = hp.z - cz;
        let d = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (d >= minR) continue;
        if (d < 1e-9) { nx = 0; ny = 1; nz = 0; d = 1e-9; } else { nx /= d; ny /= d; nz /= d; }
        const pen = minR - d;
        const wEdge = a.w * (1 - u) * (1 - u) + b.w * u * u;
        const wsum = hp.w + wEdge + atContact;
        if (wsum < 1e-12) continue;
        const corr = pen / wsum;
        hp.x += nx * corr * hp.w; hp.y += ny * corr * hp.w; hp.z += nz * corr * hp.w;
        a.x -= nx * corr * a.w * (1 - u); a.y -= ny * corr * a.w * (1 - u); a.z -= nz * corr * a.w * (1 - u);
        b.x -= nx * corr * b.w * u; b.y -= ny * corr * b.w * u; b.z -= nz * corr * b.w * u;
        // friction on the heavy's tangential motion
        const tvx = hp.x - hp.px, tvy = hp.y - hp.py, tvz = hp.z - hp.pz;
        const vn = tvx * nx + tvy * ny + tvz * nz;
        hp.px += (tvx - vn * nx) * hv.friction;
        hp.py += (tvy - vn * ny) * hv.friction;
        hp.pz += (tvz - vn * nz) * hv.friction;
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
        p.py = p.y;
        p.px += (p.x - p.px) * TUNE.GROUND_FRICTION;
        p.pz += (p.z - p.pz) * TUNE.GROUND_FRICTION;
      }
    }
    for (const p of this.parts) {
      if (p.w === 0 || p.frozen) continue;
      if (p.y < gy + 0.05) {
        p.y = gy + 0.05;
        p.py = p.y;
        p.px += (p.x - p.px) * TUNE.GROUND_FRICTION;
        p.pz += (p.z - p.pz) * TUNE.GROUND_FRICTION;
      }
      if (p.y < gy - TUNE.FREEZE_BELOW) p.frozen = true;
    }
  }

  private updateStressAndDamage(dt: number) {
    this.maxStress = 0;
    const h = dt / TUNE.SUBSTEPS;
    const invH2 = 1 / (h * h);
    const ema = Math.min(1, dt / 0.12);
    for (const s of this.segs) {
      if (s.broken) { s.stress = 0; continue; }
      const force = Math.abs(s.lambda) * invH2;
      const capForce = (s.capStrain * s.rest) / s.alpha;
      (s as any)._raw = force / capForce;
    }
    const parts = this.parts;
    for (const b of this.bends) {
      const sa = this.segs[b.segA], sb = this.segs[b.segB];
      if (sa.broken || sb.broken) continue;
      // geometric sagitta = fiber-strain proxy (like geometric theta in 2D)
      const p0 = parts[b.p0], p1 = parts[b.p1], p2 = parts[b.p2];
      const g0 = 1 - b.f, f = b.f;
      const cx = p1.x - (g0 * p0.x + f * p2.x);
      const cy = p1.y - (g0 * p0.y + f * p2.y);
      const cz = p1.z - (g0 * p0.z + f * p2.z);
      const bendStress = Math.sqrt(cx * cx + cy * cy + cz * cz) / b.sagCap;
      if (bendStress > (sa as any)._raw) (sa as any)._raw = bendStress;
      if (bendStress > (sb as any)._raw) (sb as any)._raw = bendStress;
    }
    for (const s of this.segs) {
      if (s.broken) continue;
      s.stress += ((s as any)._raw - s.stress) * ema;
    }
    const accrue = !this.settling;
    for (const s of this.segs) {
      if (s.broken || s.connCap === undefined || s.connJoint === undefined) continue;
      const tension = Math.max(0, -s.lambda) * invH2;
      const raw = tension / s.connCap;
      s.connStressEma = (s.connStressEma ?? 0) + (raw - (s.connStressEma ?? 0)) * ema;
      const ratio = s.connStressEma;
      if (ratio > s.stress) s.stress = ratio;
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
        s.damage += Math.min(s.stress - 1, 2) * TUNE.DMG_RATE * dt;
        if (s.damage >= 1) this.breakSegment(s);
      } else if (s.damage > 0 && s.stress <= 1) {
        s.damage = Math.max(0, s.damage - 0.5 * dt);
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
      if (pn.stress > 1 && accrue) {
        pn.damage += Math.min(pn.stress - 1, 2) * TUNE.DMG_RATE * dt;
        if (pn.damage >= 1) {
          pn.broken = true;
          const c = this.parts[pn.corners[0]];
          this.breaks.push({ x: c.x, y: c.y, z: c.z, t: this.time });
          this.breakCount++;
        }
      }
    }
  }

  private detachConnection(seg: Seg3) {
    const j = seg.connJoint!;
    const jp = this.parts[j];
    const clone = this.addParticle(jp.x, jp.y, jp.z, TUNE.MIN_PART_MASS);
    const cp = this.parts[clone];
    cp.px = jp.px; cp.py = jp.py; cp.pz = jp.pz;
    cp.rx = jp.rx; cp.ry = jp.ry; cp.rz = jp.rz;
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
    this.breaks.push({ x: jp.x, y: jp.y, z: jp.z, t: this.time });
    this.breakCount++;
  }

  private breakSegment(s: Seg3) {
    s.broken = true;
    const a = this.parts[s.p1], b = this.parts[s.p2];
    this.breaks.push({
      x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, t: this.time,
    });
    this.breakCount++;
  }

  drainBreaks(): BreakEvent3[] {
    const out = this.breaks;
    this.breaks = [];
    return out;
  }

  maxDrift(): number {
    let worst = 0;
    for (const s of this.segs) {
      if (s.broken) continue;
      for (const idx of [s.p1, s.p2]) {
        const p = this.parts[idx];
        const d = Math.hypot(p.x - p.rx, p.y - p.ry, p.z - p.rz);
        if (d > worst) worst = d;
      }
    }
    return worst;
  }
}
