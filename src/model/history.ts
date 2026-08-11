import { Face, FaceId, Member, Panel } from './structure';

interface Snapshot { members: Member[]; panels: Panel[] }

const clone = (s: Snapshot): Snapshot => JSON.parse(JSON.stringify(s));
const MAX = 100;

export class History {
  private undoStacks = new Map<FaceId, Snapshot[]>();
  private redoStacks = new Map<FaceId, Snapshot[]>();

  /** Call BEFORE mutating the face. */
  push(face: Face) {
    const u = this.undoStacks.get(face.id) ?? [];
    u.push(clone({ members: face.members, panels: face.panels }));
    if (u.length > MAX) u.shift();
    this.undoStacks.set(face.id, u);
    this.redoStacks.set(face.id, []);
  }

  undo(face: Face): boolean {
    const u = this.undoStacks.get(face.id) ?? [];
    const snap = u.pop();
    if (!snap) return false;
    (this.redoStacks.get(face.id) ?? this.redoStacks.set(face.id, []).get(face.id)!)
      .push(clone({ members: face.members, panels: face.panels }));
    face.members = snap.members;
    face.panels = snap.panels;
    return true;
  }

  redo(face: Face): boolean {
    const r = this.redoStacks.get(face.id) ?? [];
    const snap = r.pop();
    if (!snap) return false;
    const u = this.undoStacks.get(face.id) ?? [];
    u.push(clone({ members: face.members, panels: face.panels }));
    this.undoStacks.set(face.id, u);
    face.members = snap.members;
    face.panels = snap.panels;
    return true;
  }
}
