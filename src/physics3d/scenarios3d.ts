import { Sim3 } from './solver3d';
import { SHED_DEPTH } from './compile3d';
import { makeNoise1D } from '../util/noise';

const ROOF_FOOTPRINT_FT2 = 12 * SHED_DEPTH;

export interface Scenario3 {
  id: string;
  label: string;
  icon: string;
  desc: string;
  weights?: number[];
  defaultWeight?: number;
  tick(sim: Sim3, dt: number): void;
  onClick?(sim: Sim3, x: number, y: number, z: number, weight: number): void;
  status(sim: Sim3): string;
}

const failText = (sim: Sim3): string | null => {
  if (sim.breakCount > 0) return `${sim.breakCount} breaks!`;
  if (sim.maxDrift() > 2) return 'Collapsing…';
  return null;
};

export function makeGravity3(): Scenario3 {
  return {
    id: 'gravity', label: 'Self-weight', icon: '⚖️',
    desc: 'The assembled shed under gravity alone.',
    tick() {},
    status(sim) {
      const f = failText(sim);
      if (f) return f;
      return `Peak stress ${Math.round(sim.maxStress * 100)}% under self-weight`;
    },
  };
}

export function makeSnow3(): Scenario3 {
  const PSF = 40, RAMP = 12;
  let t = 0;
  let cols: { part: number }[] = [];
  let lastScan = -1;
  let total = 0;
  const scan = (sim: Sim3) => {
    // 1 ft (x) columns per truss line: highest particle wins
    const tops = new Map<string, number>();
    const consider = (idx: number) => {
      const p = sim.parts[idx];
      if (p.frozen) return;
      const key = `${Math.round(p.x)}|${Math.round(p.z)}`;
      const cur = tops.get(key);
      if (cur === undefined || p.y > sim.parts[cur].y) tops.set(key, idx);
    };
    for (const s of sim.segs) {
      if (s.broken) continue;
      consider(s.p1); consider(s.p2);
    }
    // only load the actual top of the building (skip floor-level surfaces)
    let maxY = 0;
    for (const idx of tops.values()) maxY = Math.max(maxY, sim.parts[idx].y);
    cols = [...tops.values()]
      .filter((idx) => sim.parts[idx].y > maxY * 0.5)
      .map((part) => ({ part }));
  };
  return {
    id: 'snow', label: 'Snow', icon: '❄️',
    desc: `Snow ramps to ${PSF} psf over the whole roof.`,
    tick(sim, dt) {
      t += dt;
      if (sim.time - lastScan > 0.5) { scan(sim); lastScan = sim.time; }
      const ramp = Math.min(t / RAMP, 1);
      // full design load spread over however many top-surface columns exist,
      // so total = psf x footprint whether or not the roof is fully decked
      const perCol = cols.length > 0
        ? (ramp * PSF * ROOF_FOOTPRINT_FT2) / cols.length : 0;
      total = 0;
      for (const c of cols) {
        sim.parts[c.part].fy -= perCol;
        total += perCol;
      }
    },
    status(sim) {
      const f = failText(sim);
      if (f) return `Roof failed under ${Math.round(total)} lb of snow — ${f}`;
      return t < RAMP
        ? `Snow: ${Math.round(total)} lb (piling up…)`
        : `Holding ${Math.round(total)} lb of snow 🏆`;
    },
  };
}

export function makeWind3(): Scenario3 {
  const PSF = 15, RAMP = 8;
  let t = 0;
  let weights: { part: number; area: number }[] = [];
  let computed = false;
  let total = 0;
  const noise = makeNoise1D(11);
  const compute = (sim: Sim3) => {
    // wind blows along +z at the front wall; each front-wall particle takes
    // its share of the vertical structure it belongs to (siding transfers)
    const area = new Map<number, number>();
    for (const s of sim.segs) {
      if (s.broken) continue;
      const fa = sim.faceOf.get(s.p1), fb = sim.faceOf.get(s.p2);
      if (!fa?.has('front') || !fb?.has('front')) continue;
      const a = sim.parts[s.p1], b = sim.parts[s.p2];
      const half = (Math.abs(b.y - a.y) * 2) / 2;   // 2 ft stud tributary
      area.set(s.p1, (area.get(s.p1) ?? 0) + half);
      area.set(s.p2, (area.get(s.p2) ?? 0) + half);
    }
    weights = [...area.entries()].map(([part, a]) => ({ part, area: a }));
    computed = true;
  };
  return {
    id: 'wind', label: 'Wind', icon: '💨',
    desc: `Gusts to ~${PSF} psf against the front wall.`,
    tick(sim, dt) {
      if (!computed) compute(sim);
      t += dt;
      const ramp = Math.min(t / RAMP, 1);
      const gust = Math.max(0, 1 + 0.35 * Math.sin(1.7 * t) + 0.25 * noise(t * 0.8));
      const psf = PSF * ramp * gust;
      total = 0;
      for (const w of weights) {
        const f = psf * w.area;
        sim.parts[w.part].fz += f;
        total += f;
      }
    },
    status(sim) {
      if (weights.length === 0 && computed) return 'No front wall to push on!';
      const f = failText(sim);
      if (f) return `Blown apart at ${Math.round(total)} lb — ${f}`;
      return t < RAMP
        ? `Wind: ${Math.round(total)} lb (building…)`
        : `Riding out ${Math.round(total)} lb gusts 🏆`;
    },
  };
}

export function makeBricks3(): Scenario3 {
  let total = 0;
  let lastSpawn = -1;
  return {
    id: 'bricks', label: 'Bricks', icon: '🧱',
    desc: 'Click the structure to drop a brick on it.',
    weights: [100, 200, 500, 1000],
    defaultWeight: 200,
    tick() {},
    onClick(sim, x, y, z, weight) {
      if (sim.time - lastSpawn < 0.3) return;
      lastSpawn = sim.time;
      const r = 0.5 * Math.cbrt(weight / 100);
      sim.addHeavy(x, y + 3, z, weight, r, `${weight}`);
      total += weight;
    },
    status(sim) {
      if (total === 0) return 'Pick a weight, click the shed to drop a brick';
      const f = failText(sim);
      if (f) return `Dropped ${total} lb — ${f}`;
      return `Dropped ${total} lb — nothing broke yet`;
    },
  };
}

export const SCENARIOS3 = [makeGravity3, makeSnow3, makeWind3, makeBricks3];
