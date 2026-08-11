import { Face, GridPt, Project, gridToWorld } from './structure';

/**
 * Shared 2D-face -> 3D-world mapping, used by both the 3D compiler and the
 * 3D preview so they can never disagree.
 *
 * - Elevation faces map through their plane transform (walls once, the roof
 *   truss profile replicated at 2 ft on-center across the shed depth).
 * - The floor plan maps flat at y=0 (on the slab).
 * - The roof plan drapes onto the roof surface: each point takes the height
 *   of the truss profile at its x, so purlins drawn in plan land exactly on
 *   the rafters they cross.
 */

export const SHED_DEPTH = 8;   // ft, left/right wall width
export const SPACING = 2;      // truss copies on-center
export const PLATE_H = 8;      // ft, wall top plate height (roof face origin)

export type V3 = [number, number, number];

/** Top surface of the roof truss design in face-local coords: ly at lx. */
export function roofProfile(project: Project): (lx: number) => number {
  const roof = project.faces.find((f) => f.id === 'roof');
  const lines: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const m of roof?.members ?? []) {
    const a = gridToWorld(m.a), b = gridToWorld(m.b);
    lines.push(
      a.x <= b.x
        ? { x0: a.x, y0: a.y, x1: b.x, y1: b.y }
        : { x0: b.x, y0: b.y, x1: a.x, y1: a.y },
    );
  }
  return (lx: number) => {
    let top = 0;   // no truss members here -> plate level
    for (const l of lines) {
      if (lx < l.x0 - 1e-6 || lx > l.x1 + 1e-6) continue;
      const t = l.x1 - l.x0 < 1e-9 ? 0 : (lx - l.x0) / (l.x1 - l.x0);
      const y = l.y0 + t * (l.y1 - l.y0);
      if (y > top) top = y;
    }
    return top;
  };
}

export interface FaceInstance {
  face: Face;
  /** replica offset along the face normal (roof truss copies) */
  offset: number;
  toWorld: (lx: number, ly: number) => V3;
}

/** All placed instances of every face in the project. */
export function faceInstances(project: Project): FaceInstance[] {
  const out: FaceInstance[] = [];
  const profile = roofProfile(project);
  for (const face of project.faces) {
    if (face.view === 'plan') {
      if (face.id === 'floorplan') {
        out.push({ face, offset: 0, toWorld: (lx, ly) => [lx, 0, ly] });
      } else {
        out.push({
          face, offset: 0,
          toWorld: (lx, ly) => [lx, PLATE_H + profile(lx), ly],
        });
      }
      continue;
    }
    const o = face.plane.origin, xa = face.plane.xAxis, ya = face.plane.yAxis;
    const nx = xa[1] * ya[2] - xa[2] * ya[1];
    const ny = xa[2] * ya[0] - xa[0] * ya[2];
    const nz = xa[0] * ya[1] - xa[1] * ya[0];
    const offsets = face.id === 'roof'
      ? Array.from({ length: SHED_DEPTH / SPACING + 1 }, (_, k) => k * SPACING)
      : [0];
    for (const d of offsets) {
      out.push({
        face, offset: d,
        toWorld: (lx, ly) => [
          o[0] + xa[0] * lx + ya[0] * ly + nx * d,
          o[1] + xa[1] * lx + ya[1] * ly + ny * d,
          o[2] + xa[2] * lx + ya[2] * ly + nz * d,
        ],
      });
    }
  }
  return out;
}

export const gridWorld = (inst: FaceInstance, p: GridPt): V3 => {
  const w = gridToWorld(p);
  return inst.toWorld(w.x, w.y);
};
