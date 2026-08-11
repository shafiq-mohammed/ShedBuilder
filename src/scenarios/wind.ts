import { Scenario } from './scenario';
import { makeNoise1D } from '../util/noise';
import { Sim } from '../physics/solver';

const TARGET_PSF = 15;    // ~ 75 mph gust pressure
const TRIB_FT = 2;        // studs at 2 ft on-center (siding transfers to frame)
const RAMP_S = 8;
const HOLD_S = 8;

/** Horizontal wind pressure with gusts, blowing left-to-right on the face. */
export function makeWind(): Scenario {
  let t = 0;
  let weights: { part: number; area: number }[] = [];
  let totalLb = 0;
  const noise = makeNoise1D(7);

  const computeWeights = (sim: Sim) => {
    // each particle catches wind for half the vertical extent of its segments
    const area = new Map<number, number>();
    for (const s of sim.segs) {
      if (s.broken) continue;
      const a = sim.parts[s.p1], b = sim.parts[s.p2];
      const dy = Math.abs(b.y - a.y);
      const half = (dy * TRIB_FT) / 2;
      area.set(s.p1, (area.get(s.p1) ?? 0) + half);
      area.set(s.p2, (area.get(s.p2) ?? 0) + half);
    }
    weights = [...area.entries()].map(([part, a]) => ({ part, area: a }));
  };

  return {
    id: 'wind',
    label: 'Wind',
    icon: '💨',
    desc: `Gusting wind up to ~${TARGET_PSF} psf pushes on the wall.`,
    goodFaces: ['front', 'back', 'left', 'right'],
    setup({ sim }) { computeWeights(sim); },
    tick({ sim }, dt) {
      t += dt;
      const ramp = Math.min(t / RAMP_S, 1);
      const gust = 1 + 0.35 * Math.sin(1.7 * t) + 0.25 * noise(t * 0.8);
      const psf = TARGET_PSF * ramp * Math.max(gust, 0);
      totalLb = 0;
      for (const w of weights) {
        const f = psf * w.area;
        sim.parts[w.part].fx += f;
        totalLb += f;
      }
    },
    draw(g, toScreen, scale) {
      // wind streaks
      const ramp = Math.min(t / RAMP_S, 1);
      if (ramp < 0.05) return;
      g.strokeStyle = 'rgba(120,160,200,0.4)';
      g.lineWidth = 1.5;
      for (let k = 0; k < 8; k++) {
        const yy = 1 + k * 1.1 + Math.sin(t * 2 + k) * 0.2;
        const xx = ((t * 6 + k * 3.1) % 18) - 3;
        const [sx, sy] = toScreen(xx, yy);
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(sx + 22 * ramp, sy);
        g.stroke();
      }
    },
    status({ sim }) {
      const lb = Math.round(totalLb);
      if (sim.breakCount > 0) {
        return { text: `Wall broke apart at ${lb} lb of wind (${sim.breakCount} breaks)`, done: true, passed: false };
      }
      if (sim.maxDrift() > 1.5) {
        return { text: 'The wall racked over! Add diagonal bracing or sheathing.', done: true, passed: false };
      }
      if (t >= RAMP_S + HOLD_S) {
        return { text: `Rode out the storm (peak ~${lb} lb)! 🏆`, done: true, passed: true };
      }
      return { text: `Wind: ${lb} lb ${t < RAMP_S ? '(building…)' : '(gusting…)'}`, done: false, passed: true };
    },
  };
}
