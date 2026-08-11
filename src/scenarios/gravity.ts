import { Scenario } from './scenario';

/** Baseline: structure under its own weight only. */
export function makeGravity(): Scenario {
  return {
    id: 'gravity',
    label: 'Self-weight',
    icon: '⚖️',
    desc: 'Just gravity. Does your frame even hold itself up?',
    setup() {},
    tick() {},
    status({ sim }) {
      const pct = Math.round(sim.maxStress * 100);
      if (sim.breakCount > 0) {
        return { text: `Collapsed under its own weight (${sim.breakCount} breaks)`, done: true, passed: false };
      }
      if (sim.maxDrift() > 2) {
        return { text: 'Slumped over under its own weight', done: true, passed: false };
      }
      return { text: `Peak stress ${pct}% under self-weight`, done: sim.time > 4, passed: true };
    },
  };
}
