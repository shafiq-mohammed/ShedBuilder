import { LUMBER_BY_ID, PANEL_COST_PER_SQFT } from './lumber';
import { pointSegDist } from '../util/vec2';

export type JointMode = 'nails' | 'hardware';
export const HARDWARE_COST_PER_JOINT = 1.5;

export type FaceId =
  'front' | 'back' | 'left' | 'right' | 'roof' | 'floor' | 'roofplan' | 'floorplan';

/** World units are feet. Grid cell = 6 inches. */
export const CELL = 0.5;

export interface GridPt { i: number; j: number }

export interface Member {
  id: string;
  type: string;      // lumber type id
  a: GridPt;
  b: GridPt;
}

/** Sheathing rectangle, a/b are opposite corners on the grid. */
export interface Panel {
  id: string;
  a: GridPt;
  b: GridPt;
}

export interface Face {
  id: FaceId;
  label: string;
  widthFt: number;
  heightFt: number;
  groundDrop: number;      // ft the real ground sits below grid j=0 (0 = slab face)
  /** elevation faces are vertical planes; plan faces are top-down layouts */
  view: 'elevation' | 'plan';
  supportLabel: string;    // what the anchors represent, shown in UI
  anchors: GridPt[];
  budget: number;
  joints: JointMode;       // how member ends are fastened
  members: Member[];
  panels: Panel[];
  /** 3D placement for a future assembled preview; unused in v1. */
  plane: { origin: [number, number, number]; xAxis: [number, number, number]; yAxis: [number, number, number] };
}

export interface Project {
  version: 1;
  faces: Face[];
}

let idCounter = 1;
export const nextId = () => `m${Date.now().toString(36)}_${idCounter++}`;

export const gridToWorld = (p: GridPt) => ({ x: p.i * CELL, y: p.j * CELL });
export const samePt = (a: GridPt, b: GridPt) => a.i === b.i && a.j === b.j;
export const ptKey = (p: GridPt) => `${p.i},${p.j}`;

export function memberLengthFt(m: Member): number {
  return Math.hypot(m.b.i - m.a.i, m.b.j - m.a.j) * CELL;
}

export function panelSizeFt(p: Panel): { w: number; h: number } {
  return { w: Math.abs(p.b.i - p.a.i) * CELL, h: Math.abs(p.b.j - p.a.j) * CELL };
}

/** Member ends that land on another member (shared endpoint or T-joint). */
export function connectionCount(face: Face): number {
  let n = 0;
  for (const m of face.members) {
    for (const end of [m.a, m.b]) {
      const w = gridToWorld(end);
      const touches = face.members.some((o) =>
        o !== m && pointSegDist(w, gridToWorld(o.a), gridToWorld(o.b)).d < 0.08);
      if (touches) n++;
    }
  }
  return n;
}

export function faceCost(face: Face): number {
  let c = 0;
  for (const m of face.members) {
    const t = LUMBER_BY_ID[m.type];
    if (t) c += memberLengthFt(m) * t.costPerFt;
  }
  for (const p of face.panels) {
    const s = panelSizeFt(p);
    c += s.w * s.h * PANEL_COST_PER_SQFT;
  }
  if (face.joints === 'hardware') c += connectionCount(face) * HARDWARE_COST_PER_JOINT;
  return c;
}

export function projectCost(project: Project): number {
  return project.faces.reduce((s, f) => s + faceCost(f), 0);
}

export function findFace(project: Project, id: FaceId): Face {
  const f = project.faces.find((f) => f.id === id);
  if (!f) throw new Error(`no face ${id}`);
  return f;
}

export function duplicateMember(face: Face, a: GridPt, b: GridPt): boolean {
  return face.members.some(
    (m) => (samePt(m.a, a) && samePt(m.b, b)) || (samePt(m.a, b) && samePt(m.b, a)),
  );
}
