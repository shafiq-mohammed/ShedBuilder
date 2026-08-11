import { Scenario } from './scenario';
import { Heavy, Sim } from '../physics/solver';

const WEIGHT = 250;   // 200 lb worker + tool belt
const SPEED = 2;         // ft/s target
const RADIUS = 0.6;   // rides the top surface without snagging web members below

/** A 200 lb worker walks across the top of the structure, left to right. */
export function makePerson(): Scenario {
  let hv: Heavy | null = null;

  const spawn = (sim: Sim, face: { widthFt: number }) => {
    // find the highest structural point near the left edge to start on
    let topY = 0;
    for (const s of sim.segs) {
      const a = sim.parts[s.p1], b = sim.parts[s.p2];
      for (const p of [a, b]) {
        if (p.x < 2.5 && p.y > topY) topY = p.y;
      }
    }
    hv = sim.addHeavy(0.3, topY + RADIUS + 0.5, WEIGHT, RADIUS, 'person', 'worker');
  };

  return {
    id: 'person',
    label: 'Person',
    icon: '🚶',
    desc: `A ${WEIGHT} lb worker walks across the top.`,
    goodFaces: ['roof', 'floor'],
    setup({ sim, face }) { spawn(sim, face); },
    tick({ sim, face }, dt) {
      if (!hv) return;
      const p = sim.parts[hv.p];
      if (hv.passed || hv.fell) return;
      if (p.x > face.widthFt - 0.3) { hv.passed = true; return; }
      if (p.y < sim.groundY + RADIUS + 0.1) { hv.fell = true; return; }
      if (p.x < -1) { hv.fell = true; return; }   // slid off the left edge
      // drive toward the right at walking speed. Walking grip is strong: he
      // can climb a steep rafter, but not a vertical wall.
      const vx = (p.x - p.px) / Math.max(dt, 1e-6);
      if (vx < SPEED) {
        p.fx += Math.min((SPEED - vx) * hv.weightLb * 0.8, hv.weightLb * 0.9);
      }
    },
    draw(g, toScreen, scale, { sim }) {
      if (!hv) return;
      const p = sim.parts[hv.p];
      const [sx, sy] = toScreen(p.x, p.y);
      const r = RADIUS * scale;
      g.font = `${Math.max(16, r * 2.4).toFixed(0)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(hv.fell ? '🤕' : '🚶', sx, sy - r * 0.2);
    },
    status({ sim, face }) {
      if (!hv) return { text: 'No structure to walk on!', done: true, passed: false };
      if (hv.fell || (sim.breakCount > 0 && !hv.passed)) {
        return { text: hv.fell ? 'The worker fell through! 🤕' : `Broke under the worker (${sim.breakCount} breaks)`, done: hv.fell === true, passed: false };
      }
      if (hv.passed) {
        return { text: `Made it across, ${sim.breakCount === 0 ? 'no damage' : `${sim.breakCount} breaks`}! 🏆`, done: true, passed: sim.breakCount === 0 };
      }
      const p = sim.parts[hv.p];
      return { text: `Walking… ${Math.round((p.x / face.widthFt) * 100)}% across`, done: false, passed: true };
    },
  };
}
