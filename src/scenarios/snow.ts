import { Scenario } from './scenario';
import { Sim } from '../physics/solver';

const TARGET_PSF = 40;      // heavy snow country design load
const TRIB_FT = 2;          // trusses at 2 ft on-center carry a 2 ft strip
const RAMP_S = 12;
const HOLD_S = 5;
const COL_W = 1.0;   // matches ~1 ft chain particle spacing

interface Col { part: number; x: number }

/** Snow piles onto the top surface, ramping to 40 psf over 12 s. */
export function makeSnow(): Scenario {
  let t = 0;
  let cols: Col[] = [];
  let lastScan = -1;
  let totalLb = 0;

  const scan = (sim: Sim) => {
    // structural particles = every particle referenced by an unbroken segment
    const tops = new Map<number, Col>();
    const consider = (idx: number) => {
      const p = sim.parts[idx];
      if (p.frozen) return;
      const bucket = Math.round(p.x / COL_W);
      const cur = tops.get(bucket);
      if (!cur || p.y > sim.parts[cur.part].y) tops.set(bucket, { part: idx, x: p.x });
    };
    for (const s of sim.segs) {
      if (s.broken) continue;
      consider(s.p1); consider(s.p2);
    }
    cols = [...tops.values()];
  };

  return {
    id: 'snow',
    label: 'Snow',
    icon: '❄️',
    desc: `Snow ramps up to ${TARGET_PSF} psf (trusses 2' on-center).`,
    goodFaces: ['roof'],
    setup({ sim }) { scan(sim); },
    tick({ sim }, dt) {
      t += dt;
      if (sim.time - lastScan > 0.5) { scan(sim); lastScan = sim.time; }
      const ramp = Math.min(t / RAMP_S, 1);
      const perCol = ramp * TARGET_PSF * COL_W * TRIB_FT;   // lb per column
      totalLb = 0;
      for (const c of cols) {
        sim.parts[c.part].fy -= perCol;
        totalLb += perCol;
      }
    },
    draw(g, toScreen, scale, { sim }) {
      const ramp = Math.min(t / RAMP_S, 1);
      if (ramp <= 0.01) return;
      g.fillStyle = 'rgba(255,255,255,0.92)';
      for (const c of cols) {
        const p = sim.parts[c.part];
        const [sx, sy] = toScreen(p.x, p.y);
        const hPx = ramp * 0.9 * scale;
        const wPx = COL_W * scale * 1.1;
        g.beginPath();
        g.ellipse(sx, sy - hPx * 0.35, wPx * 0.6, hPx * 0.5, 0, Math.PI, 0);
        g.fill();
      }
    },
    status({ sim }) {
      const lb = Math.round(totalLb);
      if (sim.breakCount > 0) {
        return { text: `Roof failed at ${lb} lb of snow (${sim.breakCount} breaks)`, done: true, passed: false };
      }
      if (sim.maxDrift() > 2) {
        return { text: `Roof caved in under ${lb} lb of snow`, done: true, passed: false };
      }
      if (t >= RAMP_S + HOLD_S) {
        return { text: `Survived ${TARGET_PSF} psf — ${lb} lb of snow! 🏆`, done: true, passed: true };
      }
      return { text: `Snow: ${lb} lb ${t < RAMP_S ? '(piling up…)' : '(holding…)'}`, done: false, passed: true };
    },
  };
}
