import { CELL, Face, gridToWorld, ptKey } from '../model/structure';
import { LUMBER_BY_ID } from '../model/lumber';
import { Camera } from '../editor/camera';
import { Editor } from '../editor/editor';
import { Sim } from '../physics/solver';
import { Scenario, ScenarioCtx } from '../scenarios/scenario';
import { stressAlpha, stressColor } from '../util/colors';
import { ftIn } from '../util/vec2';

const COL = {
  paper: '#f5f2ea',
  grid: '#d8d2c2',
  gridFt: '#c4bda9',
  ground: '#d7cdb8',
  groundLine: '#8a8069',
  anchor: '#5b6770',
  joint: '#4a3d2c',
  ghostOk: 'rgba(60,160,70,0.55)',
  ghostBad: 'rgba(210,60,50,0.55)',
  panel: 'rgba(226,203,148,0.45)',
  panelEdge: 'rgba(160,135,80,0.8)',
  sky: '#eef3f5',
};

export interface RenderState {
  mode: 'build' | 'test';
  face: Face;
  cam: Camera;
  editor: Editor;
  sim: Sim | null;
  scenario: Scenario | null;
  shake: number;             // px of screen shake remaining
}

export function render(g: CanvasRenderingContext2D, viewW: number, viewH: number, st: RenderState) {
  const { cam, face } = st;
  g.save();
  if (st.shake > 0.5) {
    g.translate((Math.random() - 0.5) * st.shake, (Math.random() - 0.5) * st.shake);
  }
  g.fillStyle = st.mode === 'test' ? COL.sky : COL.paper;
  g.fillRect(-10, -10, viewW + 20, viewH + 20);

  const S = (x: number, y: number) => cam.toScreen(x, y, viewW, viewH);

  drawGround(g, S, viewW, viewH, st);
  if (st.mode === 'build') drawGrid(g, S, st);
  drawAnchors(g, S, st);

  if (st.mode === 'build' || !st.sim) {
    drawStructure(g, S, st);
    drawGhost(g, S, st);
    drawHoverPoint(g, S, st);
  } else {
    drawSim(g, S, st);
    if (st.sim.settling) {
      g.fillStyle = 'rgba(60,60,60,0.6)';
      g.font = '13px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('settling under self-weight…', viewW / 2, 24);
    }
  }
  g.restore();
}

function drawGround(g: CanvasRenderingContext2D, S: (x: number, y: number) => [number, number],
  viewW: number, viewH: number, st: RenderState) {
  const { face, cam } = st;
  if (face.view === 'plan') {
    // top-down layout: no ground line; just the slab footprint
    const [x0, y0] = S(0, face.heightFt);
    const [x1, y1] = S(face.widthFt, 0);
    g.fillStyle = 'rgba(185,179,166,0.35)';
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.fillStyle = '#8a8069';
    g.font = '12px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText('⬇ looking down from above', x0, y0 - 10);
    return;
  }
  const gy = -face.groundDrop;
  const [, syGround] = S(0, gy);
  // earth below actual ground line
  g.fillStyle = COL.ground;
  g.fillRect(0, syGround, viewW, viewH - syGround);
  g.strokeStyle = COL.groundLine;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, syGround);
  g.lineTo(viewW, syGround);
  g.stroke();

  if (face.groundDrop > 0) {
    // draw the supports (wall tops / foundation blocks) under the anchor points
    g.fillStyle = '#b9b0a0';
    const done = new Set<number>();
    for (const a of st.face.anchors) {
      if (done.has(a.i)) continue;
      done.add(a.i);
      const w = gridToWorld(a);
      const [sx, sy] = S(w.x, w.y);
      const [, syG] = S(0, gy);
      const wPx = Math.max(10, 0.6 * cam.scale);
      g.fillRect(sx - wPx / 2, sy, wPx, syG - sy);
      g.strokeStyle = '#948b7b';
      g.lineWidth = 1;
      g.strokeRect(sx - wPx / 2, sy, wPx, syG - sy);
    }
  } else {
    // slab face: hatch strip just below j=0
    const [, sy0] = S(0, 0);
    g.strokeStyle = '#c0b7a3';
    g.lineWidth = 1;
    for (let sx = 0; sx < viewW; sx += 14) {
      g.beginPath();
      g.moveTo(sx, sy0);
      g.lineTo(sx - 8, sy0 + 10);
      g.stroke();
    }
  }
}

function drawGrid(g: CanvasRenderingContext2D, S: (x: number, y: number) => [number, number], st: RenderState) {
  const { face, cam } = st;
  const nI = Math.round(face.widthFt / CELL);
  const nJ = Math.round(face.heightFt / CELL);
  for (let i = 0; i <= nI; i++) {
    for (let j = 0; j <= nJ; j++) {
      const [sx, sy] = S(i * CELL, j * CELL);
      const ft = i % 2 === 0 && j % 2 === 0;
      g.fillStyle = ft ? COL.gridFt : COL.grid;
      g.beginPath();
      g.arc(sx, sy, ft ? Math.max(2, cam.scale * 0.035) : Math.max(1.2, cam.scale * 0.02), 0, Math.PI * 2);
      g.fill();
    }
  }
  // face outline + dimension labels
  const [x0, y1] = S(0, 0);
  const [x1t, y0] = S(face.widthFt, face.heightFt);
  g.strokeStyle = 'rgba(150,140,120,0.5)';
  g.setLineDash([5, 5]);
  g.lineWidth = 1;
  g.strokeRect(x0, y0, x1t - x0, y1 - y0);
  g.setLineDash([]);
  g.fillStyle = '#8a8069';
  g.font = '12px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(`${ftIn(face.widthFt)} wide`, (x0 + x1t) / 2, y1 + 28);
  g.save();
  g.translate(x0 - 26, (y0 + y1) / 2);
  g.rotate(-Math.PI / 2);
  g.fillText(`${ftIn(face.heightFt)} tall`, 0, 0);
  g.restore();
}

function drawAnchors(g: CanvasRenderingContext2D, S: (x: number, y: number) => [number, number], st: RenderState) {
  const { face, cam } = st;
  if (face.view === 'plan') return;
  g.fillStyle = COL.anchor;
  const step = face.anchors.length > 8 ? 4 : 1;   // slab rows: draw every 2 ft
  face.anchors.forEach((a, idx) => {
    if (idx % step !== 0 && idx !== face.anchors.length - 1) return;
    const w = gridToWorld(a);
    const [sx, sy] = S(w.x, w.y);
    const r = Math.max(3.5, cam.scale * 0.07);
    g.beginPath();
    g.moveTo(sx - r, sy + r);
    g.lineTo(sx + r, sy + r);
    g.lineTo(sx, sy - r * 0.6);
    g.closePath();
    g.fill();
  });
}

function memberScreenWidth(typeId: string, scale: number): number {
  const t = LUMBER_BY_ID[typeId];
  const depthFt = (t?.depthIn ?? 3.5) / 12;
  return Math.max(3, depthFt * scale);
}

function drawWoodBar(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number,
  wPx: number, fill: string, outline = 'rgba(80,55,25,0.55)') {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  g.save();
  g.translate(x1, y1);
  g.rotate(Math.atan2(dy, dx));
  g.fillStyle = fill;
  g.fillRect(0, -wPx / 2, len, wPx);
  g.strokeStyle = outline;
  g.lineWidth = 1;
  g.strokeRect(0, -wPx / 2, len, wPx);
  g.restore();
}

function drawStructure(g: CanvasRenderingContext2D, S: (x: number, y: number) => [number, number], st: RenderState) {
  const { face, cam } = st;
  // panels behind members
  for (const pn of face.panels) {
    const a = gridToWorld(pn.a), b = gridToWorld(pn.b);
    const [x0, y0] = S(Math.min(a.x, b.x), Math.max(a.y, b.y));
    const [x1, y1] = S(Math.max(a.x, b.x), Math.min(a.y, b.y));
    g.fillStyle = COL.panel;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.strokeStyle = COL.panelEdge;
    g.lineWidth = 1.5;
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    g.beginPath();
    g.moveTo(x0, y0); g.lineTo(x1, y1);
    g.moveTo(x1, y0); g.lineTo(x0, y1);
    g.strokeStyle = 'rgba(160,135,80,0.35)';
    g.stroke();
  }
  for (const m of face.members) {
    const t = LUMBER_BY_ID[m.type];
    const a = gridToWorld(m.a), b = gridToWorld(m.b);
    const [x1, y1] = S(a.x, a.y);
    const [x2, y2] = S(b.x, b.y);
    drawWoodBar(g, x1, y1, x2, y2, memberScreenWidth(m.type, cam.scale), t?.color ?? '#caa');
  }
  // joints
  const seen = new Set<string>();
  g.fillStyle = COL.joint;
  for (const m of face.members) {
    for (const p of [m.a, m.b]) {
      const k = ptKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      const w = gridToWorld(p);
      const [sx, sy] = S(w.x, w.y);
      g.beginPath();
      g.arc(sx, sy, Math.max(2.5, cam.scale * 0.05), 0, Math.PI * 2);
      g.fill();
    }
  }
}

function drawGhost(g: CanvasRenderingContext2D, S: (x: number, y: number) => [number, number], st: RenderState) {
  const ghost = st.editor.ghost;
  if (!ghost) return;
  const a = gridToWorld(ghost.a), b = gridToWorld(ghost.b);
  const color = ghost.valid ? COL.ghostOk : COL.ghostBad;
  if (ghost.kind === 'member') {
    const [x1, y1] = S(a.x, a.y);
    const [x2, y2] = S(b.x, b.y);
    drawWoodBar(g, x1, y1, x2, y2, memberScreenWidth(st.editor.lumberId, st.cam.scale), color, 'rgba(0,0,0,0.25)');
    const lenFt = Math.hypot(b.x - a.x, b.y - a.y);
    if (lenFt > 0.1) {
      const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
      g.font = 'bold 13px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillStyle = '#333';
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 4;
      const label = ghost.valid ? ftIn(lenFt) : (ghost.reason ?? '');
      g.strokeText(label, midX, midY - 12);
      g.fillText(label, midX, midY - 12);
    }
  } else {
    const [x0, y0] = S(Math.min(a.x, b.x), Math.max(a.y, b.y));
    const [x1, y1] = S(Math.max(a.x, b.x), Math.min(a.y, b.y));
    g.fillStyle = color;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (!ghost.valid && ghost.reason) {
      g.font = 'bold 13px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillStyle = '#822';
      g.fillText(ghost.reason, (x0 + x1) / 2, (y0 + y1) / 2);
    }
  }
}

function drawHoverPoint(g: CanvasRenderingContext2D, S: (x: number, y: number) => [number, number], st: RenderState) {
  const hp = st.editor.hover;
  if (!hp || st.mode !== 'build') return;
  const w = gridToWorld(hp);
  const [sx, sy] = S(w.x, w.y);
  g.strokeStyle = st.editor.tool === 'erase' ? '#c0392b' : '#2c8a3d';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(sx, sy, Math.max(5, st.cam.scale * 0.09), 0, Math.PI * 2);
  g.stroke();
}

function drawSim(g: CanvasRenderingContext2D, S: (x: number, y: number) => [number, number], st: RenderState) {
  const sim = st.sim!;
  const { cam } = st;

  // panels (from live corner particles)
  for (const pn of sim.panels) {
    const pts = pn.corners.map((ci) => {
      const p = sim.parts[ci];
      return S(p.x, p.y);
    });
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < 4; k++) g.lineTo(pts[k][0], pts[k][1]);
    g.closePath();
    if (pn.broken) {
      g.fillStyle = 'rgba(160,135,80,0.12)';
      g.fill();
      g.setLineDash([4, 4]);
      g.strokeStyle = 'rgba(160,60,40,0.6)';
      g.stroke();
      g.setLineDash([]);
    } else {
      g.fillStyle = COL.panel;
      g.fill();
      const sa = stressAlpha(pn.stress);
      if (sa > 0) {
        g.fillStyle = stressColor(Math.min(pn.stress, 1));
        g.globalAlpha = sa * 0.6;
        g.fill();
        g.globalAlpha = 1;
      }
      g.strokeStyle = COL.panelEdge;
      g.lineWidth = 1.5;
      g.stroke();
    }
  }

  // lumber segments with stress tint
  for (const s of sim.segs) {
    if (s.broken) continue;
    const a = sim.parts[s.p1], b = sim.parts[s.p2];
    const [x1, y1] = S(a.x, a.y);
    const [x2, y2] = S(b.x, b.y);
    const t = LUMBER_BY_ID[s.typeId];
    const wPx = memberScreenWidth(s.typeId, cam.scale);
    drawWoodBar(g, x1, y1, x2, y2, wPx, t?.color ?? '#caa');
    const sa = stressAlpha(s.stress);
    if (sa > 0) {
      g.save();
      g.globalAlpha = sa;
      drawWoodBar(g, x1, y1, x2, y2, wPx, stressColor(Math.min(s.stress, 1)), 'transparent');
      g.restore();
    }
  }

  // jagged caps at fresh break points
  g.strokeStyle = '#6b4a26';
  g.lineWidth = 2;
  for (const s of sim.segs) {
    if (!s.broken) continue;
    // draw the two dangling half-segments' ends with a zigzag
    for (const [pi, other] of [[s.p1, s.p2], [s.p2, s.p1]] as const) {
      const p = sim.parts[pi], o = sim.parts[other];
      const [sx, sy] = S(p.x, p.y);
      const ang = Math.atan2(o.y - p.y, o.x - p.x);
      g.save();
      g.translate(sx, sy);
      g.rotate(-ang);
      g.beginPath();
      g.moveTo(0, -4);
      g.lineTo(4, -1);
      g.lineTo(0, 2);
      g.lineTo(4, 5);
      g.stroke();
      g.restore();
    }
  }

  // ropes
  g.strokeStyle = '#555';
  g.lineWidth = 2;
  for (const r of sim.ropes) {
    const a = sim.parts[r.p1], b = sim.parts[r.p2];
    const [x1, y1] = S(a.x, a.y);
    const [x2, y2] = S(b.x, b.y);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  }

  // heavies (bricks, weights, person handled by scenario draw)
  for (const hv of sim.heavies) {
    if (hv.kind === 'person') continue;
    const p = sim.parts[hv.p];
    if (p.frozen) continue;
    const [sx, sy] = S(p.x, p.y);
    const r = hv.r * cam.scale;
    g.fillStyle = hv.kind === 'brick' ? '#a5553a' : '#4a6b8a';
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.lineWidth = 1.5;
    const w = r * 1.8, h2 = r * 1.6;
    g.fillRect(sx - w / 2, sy - h2 / 2, w, h2);
    g.strokeRect(sx - w / 2, sy - h2 / 2, w, h2);
    g.fillStyle = '#fff';
    g.font = `bold ${Math.max(10, r * 0.55).toFixed(0)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(hv.label, sx, sy);
  }

  // scenario overlay (snow caps, wind streaks, person emoji)
  if (st.scenario?.draw) {
    const ctx: ScenarioCtx = { sim, face: st.face };
    st.scenario.draw(g, (x, y) => S(x, y), cam.scale, ctx);
  }

}
