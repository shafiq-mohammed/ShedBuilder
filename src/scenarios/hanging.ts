import { Scenario } from './scenario';
import { Heavy } from '../physics/solver';

const DROP_FT = 1.5;

/** Click joints to hang storage weights (bikes, kayaks, shelves) below them. */
export function makeHanging(): Scenario {
  const hung: Heavy[] = [];
  let total = 0;

  return {
    id: 'hanging',
    label: 'Hang storage',
    icon: '🪝',
    desc: 'Click a joint to hang a weight from it. Click a weight to remove it.',
    weights: [50, 100, 250],
    defaultWeight: 100,
    goodFaces: ['roof', 'floor'],
    setup() {},
    tick() {},
    onClick({ sim }, x, y, weight) {
      // clicking an existing weight removes it
      for (const hv of hung) {
        const p = sim.parts[hv.p];
        if (Math.hypot(p.x - x, p.y - y) < hv.r + 0.35) {
          sim.removeHeavy(hv);
          hung.splice(hung.indexOf(hv), 1);
          total -= hv.weightLb;
          return;
        }
      }
      // otherwise find nearest joint-ish structural particle and hang from it
      let best = -1, bestD = 1.2;
      for (const s of sim.segs) {
        if (s.broken) continue;
        for (const idx of [s.p1, s.p2]) {
          const p = sim.parts[idx];
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bestD) { bestD = d; best = idx; }
        }
      }
      if (best < 0) return;
      const anchor = sim.parts[best];
      const r = 0.3 + 0.2 * Math.cbrt(weight / 50);
      const hv = sim.addHeavy(anchor.x, anchor.y - DROP_FT, weight, r, 'weight', `${weight}`);
      sim.ropes.push({ p1: best, p2: hv.p, rest: DROP_FT, alpha: 3e-4, lambda: 0 });
      hung.push(hv);
      total += weight;
    },
    status({ sim }) {
      if (total === 0) return { text: 'Click a joint to hang a weight', done: false, passed: true };
      return {
        text: `Hanging ${total} lb — ${sim.breakCount === 0 ? 'holding' : `${sim.breakCount} breaks!`}`,
        done: false,
        passed: sim.breakCount === 0,
      };
    },
  };
}
