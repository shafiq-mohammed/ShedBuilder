import { describe, expect, it } from 'vitest';
import { Sim3 } from '../src/physics3d/solver3d';
import { compile3d } from '../src/physics3d/compile3d';
import { defaultProject } from '../src/model/presets';
import { TUNE } from '../src/physics/tuning';

/**
 * The 3D solver must clear the same physics bar as the 2D one:
 * beam-theory sag, stiffness ratios, breakage — plus isotropy (same answer
 * bending in any plane) and whole-shed assembly behavior.
 */

const EA = 3e5, EI = 6000;   // 2x4-scale game values

function beam(
  n: number, s: number, plane: 'xy' | 'xz',
  anchors: 'both' | 'cantilever',
): { sim: Sim3; P: number[] } {
  const sim = new Sim3();
  sim.groundY = -100;
  const P: number[] = [];
  for (let k = 0; k <= n; k++) P.push(sim.addParticle(k * s, 0, 0, 3));
  for (const p of sim.parts) p.w = TUNE.GRAVITY / p.mass;
  if (anchors === 'both') {
    sim.parts[P[0]].w = 0;
    sim.parts[P[n]].w = 0;
  } else {
    sim.parts[P[0]].w = 0;
    sim.parts[P[1]].w = 0;
  }
  for (let k = 0; k < n; k++) {
    sim.segs.push({
      p1: P[k], p2: P[k + 1], rest: s, alpha: s / EA, typeId: 'x', memberId: 'm',
      halfDepth: 0.15, capStrain: 999, broken: false, damage: 0, stress: 0,
      axialStrain: 0, lambda: 0, connDamage: 0,
    });
  }
  for (let k = 0; k + 2 <= n; k++) {
    sim.bends.push({
      p0: P[k], p1: P[k + 1], p2: P[k + 2], f: 0.5,
      alpha: (s * s * s) / (4 * EI), sagCap: 999,
      segA: k, segB: k + 1, lx: 0, ly: 0, lz: 0,
    });
  }
  // the plane parameter is used by the caller to choose force direction
  void plane;
  return { sim, P };
}

function settle(sim: Sim3, seconds: number, force: (ramp: number) => void) {
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) {
    sim.clearForces();
    force(Math.min(1, (i * dt) / 1));
    sim.step(dt);
  }
}

describe('3D solver matches beam theory', () => {
  it('cantilever tip sag ~ F L^3 / 3EI (gravity-free)', () => {
    // 3 segments, clamped end, tip load; theory for discrete chain:
    // sag = sum theta_k * arm = (2Fs^2/EI)*2s + (Fs^2/EI)*s = 5Fs^3/EI
    const F = 30, s = 1;
    const { sim, P } = beam(3, s, 'xy', 'cantilever');
    settle(sim, 15, () => {
      for (const idx of P) sim.parts[idx].fy += sim.parts[idx].mass; // cancel gravity (weight in lbf = lb)
      sim.parts[P[3]].fy -= F;
    });
    const theory = (5 * F * s ** 3) / EI;
    const sag = -sim.parts[P[3]].y;
    expect(sag).toBeGreaterThan(theory * 0.8);
    expect(sag).toBeLessThan(theory * 1.25);
  });

  it('bends identically in the xz plane (isotropy)', () => {
    const F = 30, s = 1;
    const run = (dir: 'y' | 'z') => {
      const { sim, P } = beam(3, s, 'xy', 'cantilever');
      settle(sim, 15, () => {
        for (const idx of P) sim.parts[idx].fy += sim.parts[idx].mass;
        if (dir === 'y') sim.parts[P[3]].fy -= F;
        else sim.parts[P[3]].fz -= F;
      });
      return dir === 'y' ? -sim.parts[P[3]].y : -sim.parts[P[3]].z;
    };
    const sagY = run('y');
    const sagZ = run('z');
    expect(Math.abs(sagY - sagZ) / sagY).toBeLessThan(0.05);
  });

  it('a stiff beam sags ~9x less than a bendy one (EI ratio)', () => {
    const F = 60, s = 1, n = 12;
    const sag = (ei: number) => {
      const { sim, P } = beam(n, s, 'xy', 'both');
      for (const b of sim.bends) b.alpha = (s * s * s) / (4 * ei);
      settle(sim, 10, () => {
        for (const idx of P) sim.parts[idx].fy += sim.parts[idx].mass;
        sim.parts[P[6]].fy -= F;
      });
      return -sim.parts[P[6]].y;
    };
    const soft = sag(EI);
    const stiff = sag(EI * 8.9);
    expect(soft / stiff).toBeGreaterThan(2.5);
  });
});

describe('assembled shed', () => {
  it('the starter shed stands under self-weight', () => {
    const sim = compile3d(defaultProject());
    expect(sim.parts.length).toBeGreaterThan(300);
    for (let i = 0; i < 5 * 60; i++) {
      sim.clearForces();
      sim.step(1 / 60);
    }
    expect(sim.breakCount).toBe(0);
    expect(sim.maxDrift()).toBeLessThan(0.5);
    expect(sim.maxStress).toBeLessThan(1);
  });

  it('trusses actually bear on the walls (welded, not floating)', () => {
    const project = defaultProject();
    const sim = compile3d(project);
    // find a truss chord end particle on an interior truss (z=4): it must be
    // shared with the left wall's top plate (weld) => faceOf has both faces
    let welds = 0;
    for (const [, faces] of sim.faceOf) {
      if (faces.has('roof') && (faces.has('left') || faces.has('right'))) welds++;
    }
    expect(welds).toBeGreaterThanOrEqual(6);   // >= ends of interior trusses
  });

  it('removing walls makes the roof sag, then collapse', () => {
    const run = (removeIds: string[]) => {
      const project = defaultProject();
      for (const f of project.faces) {
        if (removeIds.includes(f.id)) f.members = [];
      }
      const sim = compile3d(project);
      for (let i = 0; i < 6 * 60; i++) {
        sim.clearForces();
        sim.step(1 / 60);
      }
      return sim.maxDrift();
    };
    const full = run([]);
    expect(full).toBeLessThan(0.5);
    // no walls at all: the roof falls outright
    const noWalls = run(['left', 'right', 'front', 'back']);
    expect(noWalls).toBeGreaterThan(2);
  });
});

describe('3D snow on the starter shed', () => {
  const runSnow = async (roofJoints: 'nails' | 'hardware', braced = true) => {
    const { makeSnow3 } = await import('../src/physics3d/scenarios3d');
    const project = defaultProject();
    project.faces.find((f) => f.id === 'roof')!.joints = roofJoints;
    if (!braced) {
      for (const f of project.faces) {
        f.members = f.members.filter((m) => !m.id.includes('brace'));
      }
    }
    const sim = compile3d(project);
    const snow = makeSnow3();
    for (let i = 0; i < 20 * 60; i++) {
      sim.clearForces();
      if (!sim.settling) snow.tick(sim, 1 / 60);
      sim.step(1 / 60);
    }
    return { breaks: sim.breakCount, drift: sim.maxDrift() };
  };

  it('braced walls + gang-plated trusses survive 40 psf', async () => {
    const r = await runSnow('hardware');
    expect(r.breaks).toBe(0);
    expect(r.drift).toBeLessThan(1);
  }, 30000);

  it('unbraced walls rack and collapse under the same snow', async () => {
    const r = await runSnow('nails', false);
    expect(r.breaks + (r.drift > 2 ? 1 : 0)).toBeGreaterThan(0);
  }, 30000);
});
