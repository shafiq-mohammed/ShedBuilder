import {
  CELL, Face, GridPt, Member, Panel, duplicateMember, gridToWorld,
  memberLengthFt, nextId,
} from '../model/structure';
import { TUNE } from '../physics/tuning';
import { pointSegDist } from '../util/vec2';

export type Tool = 'place' | 'erase' | 'panel';

export interface Ghost {
  kind: 'member' | 'panel';
  a: GridPt;
  b: GridPt;
  valid: boolean;
  reason?: string;
}

export interface EditorCallbacks {
  beforeMutate(): void;      // push history
  afterMutate(): void;       // autosave + refresh HUD
}

/** Grid snapping + place/erase/panel mutation logic (pure of DOM). */
export class Editor {
  tool: Tool = 'place';
  lumberId = '2x4';
  hover: GridPt | null = null;
  dragStart: GridPt | null = null;
  ghost: Ghost | null = null;

  constructor(private cb: EditorCallbacks) {}

  snap(face: Face, wx: number, wy: number): GridPt | null {
    const i = Math.round(wx / CELL);
    const j = Math.round(wy / CELL);
    if (i < 0 || i > Math.round(face.widthFt / CELL)) return null;
    if (j < 0 || j > Math.round(face.heightFt / CELL)) return null;
    const w = gridToWorld({ i, j });
    if (Math.hypot(w.x - wx, w.y - wy) > 0.38) return null;
    return { i, j };
  }

  move(face: Face, wx: number, wy: number) {
    this.hover = this.snap(face, wx, wy);
    if (this.dragStart) {
      const end = this.hover ?? this.clampToGrid(face, wx, wy);
      this.ghost = this.tool === 'panel'
        ? this.panelGhost(face, this.dragStart, end)
        : this.memberGhost(face, this.dragStart, end);
    }
  }

  private clampToGrid(face: Face, wx: number, wy: number): GridPt {
    const maxI = Math.round(face.widthFt / CELL);
    const maxJ = Math.round(face.heightFt / CELL);
    return {
      i: Math.max(0, Math.min(maxI, Math.round(wx / CELL))),
      j: Math.max(0, Math.min(maxJ, Math.round(wy / CELL))),
    };
  }

  down(face: Face, wx: number, wy: number): void {
    if (this.tool === 'erase') { this.eraseAt(face, wx, wy); return; }
    const pt = this.snap(face, wx, wy);
    if (!pt) return;
    this.dragStart = pt;
    this.ghost = null;
  }

  /** @returns end point if a member was placed (for shift-chaining) */
  up(face: Face, wx: number, wy: number, chain: boolean): GridPt | null {
    if (!this.dragStart) return null;
    const start = this.dragStart;
    const end = this.snap(face, wx, wy) ?? this.clampToGrid(face, wx, wy);
    this.dragStart = null;
    this.ghost = null;

    if (this.tool === 'panel') {
      const g = this.panelGhost(face, start, end);
      if (g.valid) {
        this.cb.beforeMutate();
        face.panels.push({ id: nextId(), a: start, b: end });
        this.cb.afterMutate();
      }
      return null;
    }

    const g = this.memberGhost(face, start, end);
    if (!g.valid) return null;
    this.cb.beforeMutate();
    face.members.push({ id: nextId(), type: this.lumberId, a: start, b: end });
    this.cb.afterMutate();
    if (chain) { this.dragStart = end; }
    return end;
  }

  cancelDrag() {
    this.dragStart = null;
    this.ghost = null;
  }

  memberGhost(face: Face, a: GridPt, b: GridPt): Ghost {
    const lenFt = Math.hypot(b.i - a.i, b.j - a.j) * CELL;
    let valid = true, reason: string | undefined;
    if (lenFt < CELL / 2) { valid = false; reason = 'too short'; }
    else if (lenFt > TUNE.MAX_STICK_FT) { valid = false; reason = `max ${TUNE.MAX_STICK_FT} ft`; }
    else if (duplicateMember(face, a, b)) { valid = false; reason = 'already a stick here'; }
    return { kind: 'member', a, b, valid, reason };
  }

  panelGhost(face: Face, a: GridPt, b: GridPt): Ghost {
    const wFt = Math.abs(b.i - a.i) * CELL;
    const hFt = Math.abs(b.j - a.j) * CELL;
    let valid = true, reason: string | undefined;
    if (wFt < 1 || hFt < 1) { valid = false; reason = 'too small'; }
    else if (Math.min(wFt, hFt) > 4 || Math.max(wFt, hFt) > 8) {
      valid = false; reason = 'max sheet 4×8 ft';
    } else {
      // all four corners must land on a member line or endpoint
      const corners: GridPt[] = [
        { i: a.i, j: a.j }, { i: b.i, j: a.j }, { i: b.i, j: b.j }, { i: a.i, j: b.j },
      ];
      for (const c of corners) {
        if (!this.pointOnStructure(face, c)) {
          valid = false; reason = 'corners must land on lumber';
          break;
        }
      }
    }
    return { kind: 'panel', a, b, valid, reason };
  }

  private pointOnStructure(face: Face, c: GridPt): boolean {
    const w = gridToWorld(c);
    for (const m of face.members) {
      const wa = gridToWorld(m.a), wb = gridToWorld(m.b);
      if (pointSegDist(w, wa, wb).d < 0.08) return true;
    }
    return false;
  }

  eraseAt(face: Face, wx: number, wy: number): boolean {
    const p = { x: wx, y: wy };
    // members first (topmost = last placed)
    for (let k = face.members.length - 1; k >= 0; k--) {
      const m = face.members[k];
      const wa = gridToWorld(m.a), wb = gridToWorld(m.b);
      if (pointSegDist(p, wa, wb).d < 0.28) {
        this.cb.beforeMutate();
        face.members.splice(k, 1);
        this.dropOrphanPanels(face);
        this.cb.afterMutate();
        return true;
      }
    }
    for (let k = face.panels.length - 1; k >= 0; k--) {
      const pn = face.panels[k];
      const x0 = Math.min(pn.a.i, pn.b.i) * CELL, x1 = Math.max(pn.a.i, pn.b.i) * CELL;
      const y0 = Math.min(pn.a.j, pn.b.j) * CELL, y1 = Math.max(pn.a.j, pn.b.j) * CELL;
      if (wx >= x0 && wx <= x1 && wy >= y0 && wy <= y1) {
        this.cb.beforeMutate();
        face.panels.splice(k, 1);
        this.cb.afterMutate();
        return true;
      }
    }
    return false;
  }

  /** Remove panels whose corners no longer sit on lumber. */
  private dropOrphanPanels(face: Face) {
    face.panels = face.panels.filter((pn) => {
      const corners: GridPt[] = [
        { i: pn.a.i, j: pn.a.j }, { i: pn.b.i, j: pn.a.j },
        { i: pn.b.i, j: pn.b.j }, { i: pn.a.i, j: pn.b.j },
      ];
      return corners.every((c) => this.pointOnStructure(face, c));
    });
  }

  ghostLengthLabel(): string | null {
    if (!this.ghost || this.ghost.kind !== 'member') return null;
    const g = this.ghost;
    const lenFt = Math.hypot(g.b.i - g.a.i, g.b.j - g.a.j) * CELL;
    return lenFt > 0 ? `${memberLengthFt({ id: '', type: '', a: g.a, b: g.b })}` : null;
  }
}
