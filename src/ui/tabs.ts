import { h } from '../util/dom';
import { CELL, Face, faceCost, gridToWorld } from '../model/structure';
import { LUMBER_BY_ID } from '../model/lumber';
import type { App } from '../app';

const THUMB_W = 66, THUMB_H = 40;

function drawThumb(canvas: HTMLCanvasElement, face: Face) {
  const g = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = THUMB_W * dpr;
  canvas.height = THUMB_H * dpr;
  canvas.style.width = `${THUMB_W}px`;
  canvas.style.height = `${THUMB_H}px`;
  g.scale(dpr, dpr);
  g.fillStyle = '#f5f2ea';
  g.fillRect(0, 0, THUMB_W, THUMB_H);
  const pad = 4;
  const scale = Math.min((THUMB_W - pad * 2) / face.widthFt, (THUMB_H - pad * 2) / face.heightFt);
  const ox = (THUMB_W - face.widthFt * scale) / 2;
  const S = (x: number, y: number): [number, number] =>
    [ox + x * scale, THUMB_H - pad - y * scale];

  // ground
  g.strokeStyle = '#b8ae99';
  g.beginPath();
  const [gx0, gy0] = S(-1, 0);
  const [gx1] = S(face.widthFt + 1, 0);
  g.moveTo(gx0, gy0);
  g.lineTo(gx1, gy0);
  g.stroke();

  for (const pn of face.panels) {
    const a = gridToWorld(pn.a), b = gridToWorld(pn.b);
    const [x0, y0] = S(Math.min(a.x, b.x), Math.max(a.y, b.y));
    const [x1, y1] = S(Math.max(a.x, b.x), Math.min(a.y, b.y));
    g.fillStyle = 'rgba(226,203,148,0.55)';
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  for (const m of face.members) {
    const t = LUMBER_BY_ID[m.type];
    const a = gridToWorld(m.a), b = gridToWorld(m.b);
    const [x1, y1] = S(a.x, a.y);
    const [x2, y2] = S(b.x, b.y);
    g.strokeStyle = t?.color ?? '#caa';
    g.lineWidth = Math.max(1.2, ((t?.depthIn ?? 3.5) / 12) * scale);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  }
}

export function buildTabs(app: App): { el: HTMLElement; refresh: () => void } {
  const tabs: { faceId: string; el: HTMLElement; canvas: HTMLCanvasElement; cost: HTMLElement }[] = [];

  const el = h('div.tabs', {},
    ...app.project.faces.map((face) => {
      const canvas = h<'canvas'>('canvas') as HTMLCanvasElement;
      const cost = h('span.tabcost');
      const tab = h('div.tab', { onclick: () => app.setFace(face.id) },
        canvas, h('span', {}, face.label), cost);
      tabs.push({ faceId: face.id, el: tab, canvas, cost });
      return tab;
    }),
  );

  const refresh = () => {
    for (const t of tabs) {
      const face = app.project.faces.find((f) => f.id === t.faceId)!;
      t.el.classList.toggle('active', app.faceId === t.faceId);
      t.cost.textContent = `$${faceCost(face).toFixed(0)}`;
      drawThumb(t.canvas, face);
    }
    el.style.display = app.mode === 'build' ? '' : 'none';
  };

  return { el, refresh };
}
