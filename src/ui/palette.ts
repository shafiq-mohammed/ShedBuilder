import { h } from '../util/dom';
import { LUMBER } from '../model/lumber';
import { connectionCount, faceCost, HARDWARE_COST_PER_JOINT, projectCost } from '../model/structure';
import type { App } from '../app';

export function buildPalette(app: App): { el: HTMLElement; refresh: () => void } {
  const toolBtns: Record<string, HTMLButtonElement> = {};
  const cards: Record<string, HTMLElement> = {};

  const toolRow = h('div.toolrow', {},
    (toolBtns['place'] = h<'button'>('button.btn', {
      title: 'Place lumber (pick a size below)',
      onclick: () => app.setTool('place'),
    }, '🔨 Place') as HTMLButtonElement),
    (toolBtns['erase'] = h<'button'>('button.btn', {
      title: 'Erase (E) — right-click also erases',
      onclick: () => app.setTool('erase'),
    }, '🧹 Erase') as HTMLButtonElement),
    (toolBtns['panel'] = h<'button'>('button.btn', {
      title: 'Sheathing panel (P) — drag a rectangle over lumber',
      onclick: () => app.setTool('panel'),
    }, '🟫 Panel') as HTMLButtonElement),
  );

  const maxDepth = Math.max(...LUMBER.map((l) => l.depthIn));
  const maxBend = Math.max(...LUMBER.map((l) => l.bendCapRel));
  const maxAxial = Math.max(...LUMBER.map((l) => l.axialCapRel));

  const lumberList = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    ...LUMBER.map((l) => {
      const card = h('div.lumbercard', {
        onclick: () => { app.setLumber(l.id); },
        title: l.blurb,
      },
        h('div.swatch', {
          style: {
            width: '14px',
            height: `${8 + (l.depthIn / maxDepth) * 26}px`,
            background: l.color,
          },
        }),
        h('div.info', {},
          h('div.name', {}, l.label, h('span.price', {}, `$${l.costPerFt.toFixed(2)}/ft`)),
          h('div.blurb', {}, l.blurb),
          h('div.minibars', {},
            h('div.minibar', { title: 'bending strength' },
              h('div', { style: { width: `${(l.bendCapRel / maxBend) * 100}%`, background: '#7cb46b' } })),
            h('div.minibar', { title: 'axial (post) strength' },
              h('div', { style: { width: `${(l.axialCapRel / maxAxial) * 100}%`, background: '#6b93b4' } })),
          ),
        ),
        h('span.key', {}, l.key),
      );
      cards[l.id] = card;
      return card;
    }),
  );

  const supportNote = h('div.supportnote');
  const jointRow = h('div.toolrow');
  const jointBtns: Record<string, HTMLButtonElement> = {
    nails: h<'button'>('button.btn', {
      title: 'Toe-nailed joints: cheap, but pull out around 450 lb of tension',
      onclick: () => app.setJoints('nails'),
    }, '🔨 Nails') as HTMLButtonElement,
    hardware: h<'button'>('button.btn', {
      title: `Joist hangers & brackets: hold ~1500 lb, $${HARDWARE_COST_PER_JOINT.toFixed(2)} per joint`,
      onclick: () => app.setJoints('hardware'),
    }, '🔩 Hardware') as HTMLButtonElement,
  };
  jointRow.append(jointBtns.nails, jointBtns.hardware);
  const costBox = h('div.costbox');

  const el = h('div.palette', {},
    h('h3', {}, 'Tools'),
    toolRow,
    h('h3', {}, 'Lumber'),
    lumberList,
    h('h3', {}, 'Joints'),
    jointRow,
    h('h3', {}, 'This face'),
    supportNote,
    costBox,
  );

  const refresh = () => {
    for (const [tool, btn] of Object.entries(toolBtns)) {
      btn.classList.toggle('active', app.editor.tool === tool);
    }
    for (const [id, card] of Object.entries(cards)) {
      card.classList.toggle('active', app.editor.tool === 'place' && app.editor.lumberId === id);
    }
    const face = app.face;
    jointBtns.nails.classList.toggle('active', face.joints !== 'hardware');
    jointBtns.hardware.classList.toggle('active', face.joints === 'hardware');
    const nConn = connectionCount(face);
    jointBtns.hardware.textContent = face.joints === 'hardware'
      ? `🔩 Hardware ($${(nConn * HARDWARE_COST_PER_JOINT).toFixed(0)})`
      : '🔩 Hardware';
    supportNote.textContent = `⚓ ${face.supportLabel}.`;
    const fc = faceCost(face);
    const pc = projectCost(app.project);
    const over = fc > face.budget;
    costBox.innerHTML = '';
    costBox.append(
      h('div', {}, 'Face cost: ',
        h(`span.big${over ? '.over' : ''}`, {}, `$${fc.toFixed(0)}`),
        ` / $${face.budget} budget`),
      h('div', {}, `Whole shed: $${pc.toFixed(0)}`),
    );
    el.style.display = app.mode === 'build' ? '' : 'none';
  };

  return { el, refresh };
}
