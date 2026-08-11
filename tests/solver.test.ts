import { describe, expect, it } from 'vitest';
import { Face } from '../src/model/structure';
import { compileFace } from '../src/physics/compile';
import { lumberEA, LUMBER_BY_ID } from '../src/model/lumber';

/** Minimal face factory for physics tests. */
function testFace(partial: Partial<Face>): Face {
  return {
    id: 'roof', label: 'test', widthFt: 12, heightFt: 8, groundDrop: 8,
    supportLabel: '', anchors: [], budget: 999, joints: 'nails', members: [], panels: [],
    plane: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
    ...partial,
  };
}

function settle(sim: ReturnType<typeof compileFace>, seconds: number, extraForce?: (ramp: number) => void) {
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) {
    sim.clearForces();
    // ramp loads over 1s like the game scenarios do (instant force steps on
    // near-massless nodes cause unphysical single-frame stress spikes)
    extraForce?.(Math.min(1, (i * dt) / 1));
    sim.step(dt);
  }
}

describe('XPBD lumber physics', () => {
  it('a vertical 2x4 hung with a weight strains by ~F/EA', () => {
    // 4 ft 2x4 hanging from an anchor, 400 lb pulled down at the free end
    const face = testFace({
      anchors: [{ i: 0, j: 16 }],
      members: [{ id: 'm1', type: '2x4', a: { i: 0, j: 16 }, b: { i: 0, j: 8 } }],
    });
    const sim = compileFace(face);
    const F = 400;
    // find the bottom joint particle (at world y=4)
    const bottomIdx = sim.parts.findIndex((p) => Math.abs(p.y - 4) < 1e-6 && Math.abs(p.x) < 1e-6);
    expect(bottomIdx).toBeGreaterThanOrEqual(0);
    settle(sim, 4, (ramp) => { sim.parts[bottomIdx].fy -= F * ramp; });

    const expected = F / lumberEA(LUMBER_BY_ID['2x4']);
    // total strain = (current length - 4) / 4
    const top = sim.parts.find((p) => Math.abs(p.y - 8) < 1e-6)!;
    const bot = sim.parts[bottomIdx];
    const strain = (Math.hypot(top.x - bot.x, top.y - bot.y) - 4) / 4;
    // gravity adds a bit of self-weight strain, so allow generous tolerance
    expect(strain).toBeGreaterThan(expected * 0.5);
    expect(strain).toBeLessThan(expected * 2.0);
  });

  it('a 2x8 joist sags much less than a 2x4 over the same span', () => {
    const span = 24; // 12 ft in cells
    const mkSim = (type: string) => {
      const face = testFace({
        anchors: [{ i: 0, j: 0 }, { i: span, j: 0 }],
        members: [{ id: 'm1', type, a: { i: 0, j: 0 }, b: { i: span, j: 0 } }],
      });
      return compileFace(face);
    };
    const load = 100; // lb at midspan
    const midSag = (type: string) => {
      const sim = mkSim(type);
      const mid = sim.parts.reduce((best, p, i) =>
        Math.abs(p.x - 6) < Math.abs(sim.parts[best].x - 6) ? i : best, 0);
      settle(sim, 5, (ramp) => { sim.parts[mid].fy -= load * ramp; });
      return -sim.parts[mid].y; // downward sag in ft
    };
    const sag4 = midSag('2x4');
    const sag8 = midSag('2x8');
    expect(sag4).toBeGreaterThan(0.005);
    expect(sag8).toBeLessThan(sag4);
    // EI ratio is 8.9x; XPBD constraint coupling is approximate, so just
    // require clearly-stiffer behavior (>2.5x)
    expect(sag4 / sag8).toBeGreaterThan(2.5);
  });

  it('overloading a long 2x4 span breaks it; a light load does not', () => {
    const mkSim = () => {
      const face = testFace({
        anchors: [{ i: 0, j: 0 }, { i: 24, j: 0 }],
        members: [{ id: 'm1', type: '2x4', a: { i: 0, j: 0 }, b: { i: 24, j: 0 } }],
      });
      return compileFace(face);
    };

    const light = mkSim();
    const lightMid = light.parts.reduce((best, p, i) =>
      Math.abs(p.x - 6) < Math.abs(light.parts[best].x - 6) ? i : best, 0);
    settle(light, 6, (ramp) => { light.parts[lightMid].fy -= 30 * ramp; });
    expect(light.breakCount).toBe(0);

    const heavy = mkSim();
    const heavyMid = heavy.parts.reduce((best, p, i) =>
      Math.abs(p.x - 6) < Math.abs(heavy.parts[best].x - 6) ? i : best, 0);
    settle(heavy, 6, (ramp) => { heavy.parts[heavyMid].fy -= 1200 * ramp; });
    expect(heavy.breakCount).toBeGreaterThan(0);
  });

  it('anchored particles never move', () => {
    const face = testFace({
      anchors: [{ i: 0, j: 0 }, { i: 24, j: 0 }],
      members: [{ id: 'm1', type: '2x4', a: { i: 0, j: 0 }, b: { i: 24, j: 0 } }],
    });
    const sim = compileFace(face);
    settle(sim, 2);
    const left = sim.parts.find((p) => Math.abs(p.x) < 1e-9)!;
    expect(left.y).toBe(0);
    expect(left.x).toBe(0);
  });
});

describe('joint connections', () => {
  // A vertical 2x4 toe-nailed to the middle of a horizontal LVL beam,
  // with weight pulling down on its free end: nails pull out, hardware holds.
  const mkFace = (joints: 'nails' | 'hardware'): Face => ({
    id: 'roof', label: 'test', widthFt: 12, heightFt: 8, groundDrop: 8,
    supportLabel: '', anchors: [{ i: 0, j: 8 }, { i: 24, j: 8 }], budget: 999,
    joints,
    members: [
      { id: 'beam', type: 'lvl', a: { i: 0, j: 8 }, b: { i: 24, j: 8 } },
      { id: 'hanger', type: '4x4', a: { i: 12, j: 8 }, b: { i: 12, j: 4 } },
    ],
    panels: [],
    plane: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
  });

  const pullTest = (joints: 'nails' | 'hardware', pullLb: number) => {
    const sim = compileFace(mkFace(joints));
    const bottom = sim.parts.reduce((best, p, i) =>
      p.y < sim.parts[best].y ? i : best, 0);
    // hang the load the way the game does: a heavy particle on a rope
    const anchor = sim.parts[bottom];
    const hv = sim.addHeavy(anchor.x, anchor.y - 1.5, pullLb, 0.5, 'weight', `${pullLb}`);
    sim.ropes.push({ p1: bottom, p2: hv.p, rest: 1.5, alpha: 3e-4, lambda: 0 });
    const dt = 1 / 60;
    for (let i = 0; i < 6 * 60; i++) {
      sim.clearForces();
      sim.step(dt);
    }
    return sim.breakCount;
  };

  it('toe-nailed T-joint pulls out under an 800 lb hang', () => {
    expect(pullTest('nails', 800)).toBeGreaterThan(0);
  });

  it('the same joint with a joist hanger holds 800 lb', () => {
    expect(pullTest('hardware', 800)).toBe(0);
  });

  it('toe-nails are fine for light loads', () => {
    expect(pullTest('nails', 150)).toBe(0);
  });
});
