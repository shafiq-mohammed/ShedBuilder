import { Scenario } from './scenario';

/** Droppable bricks: pick a weight, click to drop, watch the stress. */
export function makeBricks(): Scenario {
  let total = 0;
  let lastSpawn = -1;
  return {
    id: 'bricks',
    label: 'Bricks',
    icon: '🧱',
    desc: 'Click to drop a brick on the structure.',
    weights: [100, 200, 500, 1000],
    defaultWeight: 200,
    setup() {},
    tick() {},
    onClick({ sim }, x, y, weight) {
      if (sim.time - lastSpawn < 0.3) return;   // spawn cooldown
      lastSpawn = sim.time;
      const r = 0.5 * Math.cbrt(weight / 100);  // 100lb->0.5ft ... 1000lb->1.08ft
      sim.addHeavy(x, Math.max(y, sim.groundY + r + 0.1), weight, r, 'brick', `${weight}`);
      total += weight;
    },
    status({ sim }) {
      const t = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : `${total}`;
      return {
        text: total === 0
          ? 'Pick a weight, then click to drop a brick'
          : `Dropped ${t} lb — ${sim.breakCount === 0 ? 'nothing broke yet' : `${sim.breakCount} breaks`}`,
        done: false,
        passed: sim.breakCount === 0,
      };
    },
  };
}
