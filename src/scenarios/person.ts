import { Scenario } from './scenario';
import { Heavy, Sim } from '../physics/solver';

const WEIGHT = 250;   // 200 lb worker + tool belt
const RADIUS = 0.6;
const HOLD_S = 6;

/**
 * A worker STANDS on top of the structure (nobody strolls off a roof edge).
 * Click anywhere to move him — he drops onto whatever is below the click.
 */
export function makePerson(): Scenario {
  let hv: Heavy | null = null;
  let standT = 0;

  const spawnAt = (sim: Sim, x: number, y: number) => {
    if (hv) sim.removeHeavy(hv);
    hv = sim.addHeavy(x, y, WEIGHT, RADIUS, 'person', 'worker');
    hv.friction = 0.15;   // standing grip, no walking drive
    standT = 0;
  };

  const spawnOnTop = (sim: Sim, face: { widthFt: number }) => {
    // stand him over the middle of the structure's top surface
    const cx = face.widthFt / 2;
    let best = -1, bestScore = -Infinity;
    for (const s of sim.segs) {
      for (const idx of [s.p1, s.p2]) {
        const p = sim.parts[idx];
        const score = p.y - Math.abs(p.x - cx) * 0.4;
        if (score > bestScore) { bestScore = score; best = idx; }
      }
    }
    if (best < 0) return;
    const p = sim.parts[best];
    spawnAt(sim, p.x, p.y + RADIUS + 0.4);
  };

  return {
    id: 'person',
    label: 'Person',
    icon: '🧍',
    desc: `A ${WEIGHT} lb worker stands on top. Click to move him.`,
    goodFaces: ['roof', 'floor'],
    setup({ sim, face }) { spawnOnTop(sim, face); },
    tick({ sim }, dt) {
      if (!hv) return;
      const p = sim.parts[hv.p];
      if (hv.fell) return;
      if (p.y < sim.groundY + RADIUS + 0.1) { hv.fell = true; return; }
      standT += dt;
    },
    onClick({ sim }, x, y) {
      spawnAt(sim, x, Math.max(y + 1, sim.groundY + RADIUS + 1));
    },
    draw(g, toScreen, scale, { sim }) {
      if (!hv) return;
      const p = sim.parts[hv.p];
      const [sx, sy] = toScreen(p.x, p.y);
      const r = RADIUS * scale;
      g.font = `${Math.max(16, r * 2.6).toFixed(0)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(hv.fell ? '🤕' : '🧍', sx, sy - r * 0.2);
    },
    status({ sim }) {
      if (!hv) return { text: 'Nothing to stand on!', done: true, passed: false };
      if (hv.fell) return { text: 'He fell through! 🤕', done: true, passed: false };
      if (sim.breakCount > 0) {
        return { text: `Broke under the worker (${sim.breakCount} breaks)`, done: true, passed: false };
      }
      if (standT >= HOLD_S) {
        return { text: `Held the ${WEIGHT} lb worker, steady as a rock 🏆`, done: true, passed: true };
      }
      return { text: `Standing (${WEIGHT} lb)… ${Math.max(0, HOLD_S - standT).toFixed(0)}s to go`, done: false, passed: true };
    },
  };
}
