import { CELL, Face, FaceId, GridPt, Member, Project } from './structure';

const cells = (ft: number) => Math.round(ft / CELL);

function bottomRow(widthFt: number): GridPt[] {
  const pts: GridPt[] = [];
  for (let i = 0; i <= cells(widthFt); i++) pts.push({ i, j: 0 });
  return pts;
}

function endSupports(widthFt: number): GridPt[] {
  const n = cells(widthFt);
  return [{ i: 0, j: 0 }, { i: 1, j: 0 }, { i: n - 1, j: 0 }, { i: n, j: 0 }];
}

function wall(id: FaceId, label: string, widthFt: number, origin: [number, number, number],
  xAxis: [number, number, number]): Face {
  return {
    id, label, widthFt, heightFt: 10, groundDrop: 0,
    supportLabel: 'Bolted to the slab along the bottom',
    anchors: bottomRow(widthFt), budget: 260,
    joints: 'nails', members: [], panels: [],
    plane: { origin, xAxis, yAxis: [0, 1, 0] },
  };
}

const mem = (id: string, type: string, ai: number, aj: number, bi: number, bj: number): Member =>
  ({ id, type, a: { i: ai, j: aj }, b: { i: bi, j: bj } });

/** Framed 8-ft wall: plates, studs 2 ft on-center, and a let-in diagonal
 * brace — an unbraced stud wall is a parallelogram mechanism and racks flat. */
function frameWall(widthFt: number, prefix: string): Member[] {
  const n = cells(widthFt);
  const out: Member[] = [
    mem(`${prefix}_bp`, '2x4', 0, 0, n, 0),
    mem(`${prefix}_tp`, '2x4', 0, 16, n, 16),
  ];
  for (let i = 0; i <= n; i += 4) out.push(mem(`${prefix}_s${i}`, '2x4', i, 0, i, 16));
  out.push(mem(`${prefix}_brace`, '2x4', 0, 0, n, 16));
  out.push(mem(`${prefix}_brace2`, '2x4', 0, 16, n, 0));
  return out;
}

/** King-post truss: 2x6 chord + rafters, 2x4 post and struts. */
function starterTruss(prefix: string): Member[] {
  return [
    mem(`${prefix}_chord`, '2x6', 0, 0, 24, 0),
    mem(`${prefix}_rl`, '2x6', 0, 0, 12, 8),
    mem(`${prefix}_rr`, '2x6', 12, 8, 24, 0),
    mem(`${prefix}_king`, '2x4', 12, 0, 12, 8),
    mem(`${prefix}_sl`, '2x4', 6, 4, 12, 0),
    mem(`${prefix}_sr`, '2x4', 18, 4, 12, 0),
  ];
}

const findF = (faces: Face[], id: FaceId) => faces.find((f) => f.id === id)!;

export function defaultProject(): Project {
  const faces: Face[] = [
    wall('front', 'Front wall', 12, [0, 0, 0], [1, 0, 0]),
    wall('back', 'Back wall', 12, [12, 0, 8], [-1, 0, 0]),
    wall('left', 'Left wall', 8, [0, 0, 8], [0, 0, -1]),
    wall('right', 'Right wall', 8, [12, 0, 0], [0, 0, 1]),
    {
      id: 'roof', label: 'Roof truss', widthFt: 12, heightFt: 6, groundDrop: 8,
      supportLabel: 'Rests on the wall top plates at each end',
      anchors: endSupports(12), budget: 220,
      joints: 'nails', members: [], panels: [],
      plane: { origin: [0, 8, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
    },
    {
      id: 'floor', label: 'Floor deck', widthFt: 12, heightFt: 4, groundDrop: 2.5,
      supportLabel: 'Sits on foundation blocks at each end',
      anchors: endSupports(12), budget: 180,
      joints: 'nails', members: [], panels: [],
      plane: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
    },
  ];
  // starter design: a complete framed shed so Test-in-3D works out of the box
  findF(faces, 'front').members = frameWall(12, 'fw');
  findF(faces, 'back').members = frameWall(12, 'bw');
  findF(faces, 'left').members = frameWall(8, 'lw');
  findF(faces, 'right').members = frameWall(8, 'rw');
  const roof = findF(faces, 'roof');
  roof.members = starterTruss('tr');
  // factory trusses come with gang-nail plates: hardware, not toe-nails.
  // (Switch to nails and watch the rafter thrust rip the chords out.)
  roof.joints = 'hardware';
  findF(faces, 'floor').members = [mem('fl_joist', '2x10', 0, 0, 24, 0)];
  return { version: 1, faces };
}
