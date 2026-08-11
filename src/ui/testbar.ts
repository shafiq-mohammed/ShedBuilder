import { h } from '../util/dom';
import { SCENARIOS } from '../scenarios/index';
import type { App } from '../app';

export function buildTestbar(app: App): { el: HTMLElement; refresh: () => void } {
  const scenBtns: Record<string, HTMLButtonElement> = {};
  const chipsWrap = h('div.chips');
  const status = h('div.status');
  const slowBtn = h<'button'>('button.btn', {
    title: 'Slow motion (S)',
    onclick: () => app.toggleSlowmo(),
  }, '🐌 ¼×') as HTMLButtonElement;

  const el = h('div.testbar', {},
    h('button.btn', { onclick: () => app.exitTest(), title: 'Back to building (Esc)' }, '← Build'),
    h('span', {
      style: { fontSize: '11px', color: '#8fa1ad', maxWidth: '130px', lineHeight: '1.2' },
      title: 'This tests one face by itself, like framing on the ground. The assembled building (corners, roof, all walls together) is tested in the 3D view.',
    }, 'bench test: this face alone — whole building in 🧊 3D'),
    ...SCENARIOS.map(({ id }) => {
      const proto = SCENARIOS.find((s) => s.id === id)!.make();
      const btn = h<'button'>('button.btn', {
        title: proto.desc,
        onclick: () => app.setScenario(id),
      }, `${proto.icon} ${proto.label}`) as HTMLButtonElement;
      scenBtns[id] = btn;
      return btn;
    }),
    chipsWrap,
    h('button.btn', { onclick: () => app.resetSim(), title: 'Reset this test' }, '↻ Reset'),
    slowBtn,
    status,
  );

  let chipScenario = '';
  const refresh = () => {
    el.style.display = app.mode === 'test' ? '' : 'none';
    if (app.mode !== 'test') return;
    for (const [id, btn] of Object.entries(scenBtns)) {
      btn.classList.toggle('active', app.scenarioId === id);
    }
    slowBtn.classList.toggle('active', app.slowmo);

    const sc = app.scenario;
    if ((sc?.id ?? '') !== chipScenario) {
      chipScenario = sc?.id ?? '';
      chipsWrap.innerHTML = '';
      if (sc?.weights) {
        for (const w of sc.weights) {
          chipsWrap.append(h('button.chip', {
            dataset: { w: String(w) },
            onclick: () => { app.clickWeight = w; refresh(); },
          }, `${w} lb`));
        }
      }
    }
    for (const chip of Array.from(chipsWrap.children) as HTMLElement[]) {
      chip.classList.toggle('active', Number(chip.dataset.w) === app.clickWeight);
    }

    if (app.sim && sc) {
      const st = sc.status({ sim: app.sim, face: app.face });
      status.textContent = st.text;
      status.className = 'status' + (st.done ? (st.passed ? ' pass' : ' fail') : '');
    } else {
      status.textContent = '';
      status.className = 'status';
    }
  };

  return { el, refresh };
}
