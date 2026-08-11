import { CELL, DEFAULT_DIMS, Face, FaceId, GridPt, Member, Project, ShedDims, clampDims } from './structure';

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

function wall(id: FaceId, label: string, widthFt: number, wallHFt: number,
  origin: [number, number, number], xAxis: [number, number, number]): Face {
  return {
    id, label, widthFt, heightFt: wallHFt + 2, groundDrop: 0, view: 'elevation',
    supportLabel: 'Bolted to the slab along the bottom',
    anchors: bottomRow(widthFt), budget: 30 + widthFt * 20,
    joints: 'nails', members: [], panels: [],
    plane: { origin, xAxis, yAxis: [0, 1, 0] },
  };
}

const mem = (id: string, type: string, ai: number, aj: number, bi: number, bj: number): Member =>
  ({ id, type, a: { i: ai, j: aj }, b: { i: bi, j: bj } });

/** Framed wall: plates, studs 2 ft on-center, and let-in diagonal braces —
 * an unbraced stud wall stands (nailed joints carry a little moment) but
 * racks over in a storm. */
function frameWall(widthFt: number, wallHFt: number, prefix: string): Member[] {
  const n = cells(widthFt);
  const top = cells(wallHFt);
  const out: Member[] = [
    mem(`${prefix}_bp`, '2x4', 0, 0, n, 0),
    mem(`${prefix}_tp`, '2x4', 0, top, n, top),
  ];
  for (let i = 0; i <= n; i += 4) out.push(mem(`${prefix}_s${i}`, '2x4', i, 0, i, top));
  out.push(mem(`${prefix}_brace`, '2x4', 0, 0, n, top));
  out.push(mem(`${prefix}_brace2`, '2x4', 0, top, n, 0));
  return out;
}

/** King-post truss sized to the span: 2x6 chord + rafters, 2x4 post/struts. */
function starterTruss(widthFt: number, prefix: string): Member[] {
  const n = cells(widthFt);
  const mid = n / 2;
  const rise = 2 * Math.round(n / 6);
  const out: Member[] = [
    mem(`${prefix}_chord`, '2x6', 0, 0, n, 0),
    mem(`${prefix}_rl`, '2x6', 0, 0, mid, rise),
    mem(`${prefix}_rr`, '2x6', mid, rise, n, 0),
    mem(`${prefix}_king`, '2x4', mid, 0, mid, rise),
  ];
  if (mid % 2 === 0 && rise % 2 === 0) {
    out.push(mem(`${prefix}_sl`, '2x4', mid / 2, rise / 2, mid, 0));
    out.push(mem(`${prefix}_sr`, '2x4', mid + mid / 2, rise / 2, mid, 0));
  }
  return out;
}

const findF = (faces: Face[], id: FaceId) => faces.find((f) => f.id === id)!;

export function defaultProject(dimsIn?: Partial<ShedDims>): Project {
  const dims = clampDims(dimsIn ?? DEFAULT_DIMS);
  const W = dims.widthFt, D = dims.depthFt, H = dims.wallHFt;
  const rise = (2 * Math.round(cells(W) / 6)) * CELL;
  const faces: Face[] = [
    wall('front', 'Front wall', W, H, [0, 0, 0], [1, 0, 0]),
    wall('back', 'Back wall', W, H, [W, 0, D], [-1, 0, 0]),
    wall('left', 'Left wall', D, H, [0, 0, D], [0, 0, -1]),
    wall('right', 'Right wall', D, H, [W, 0, 0], [0, 0, 1]),
    {
      id: 'roof', label: 'Roof truss', widthFt: W, heightFt: rise + 2, groundDrop: H,
      view: 'elevation',
      supportLabel: `Built once, raised at 2' on-center along the ${D}' depth in 3D`,
      anchors: endSupports(W), budget: 30 + W * 16,
      joints: 'nails', members: [], panels: [],
      plane: { origin: [0, H, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
    },
    {
      id: 'roofplan', label: 'Roof plan', widthFt: W, heightFt: D, groundDrop: 0,
      view: 'plan',
      supportLabel: 'Top-down: purlins nail across the truss tops and brace them',
      anchors: [], budget: 20 + W * 8,
      joints: 'nails', members: [], panels: [],
      plane: { origin: [0, H, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1] },
    },
    {
      id: 'floorplan', label: 'Floor plan', widthFt: W, heightFt: D, groundDrop: 0,
      view: 'plan',
      supportLabel: 'Top-down: joists and rims resting on the slab',
      anchors: [], budget: 30 + W * 12,
      joints: 'nails', members: [], panels: [],
      plane: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1] },
    },
  ];
  // starter design: a complete framed shed so Test-in-3D works out of the box
  const nW = cells(W), nD = cells(D), mid = nW / 2;
  findF(faces, 'front').members = frameWall(W, H, 'fw');
  findF(faces, 'back').members = frameWall(W, H, 'bw');
  findF(faces, 'left').members = frameWall(D, H, 'lw');
  findF(faces, 'right').members = frameWall(D, H, 'rw');
  const roof = findF(faces, 'roof');
  roof.members = starterTruss(W, 'tr');
  // factory trusses come with gang-nail plates: hardware, not toe-nails.
  // (Switch to nails and watch the rafter thrust rip the chords out.)
  roof.joints = 'hardware';
  // roof plan: purlins across the truss tops (delete them and the trusses
  // tip over like real unbraced framing)
  const rp = findF(faces, 'roofplan');
  rp.members = [];
  for (let i = 1; i < nW; i += 4) {
    rp.members.push(mem(`rp_purlin${i}`, '2x4', i, 0, i, nD));
  }
  rp.members.push(mem('rp_ridge', '2x4', mid, 0, mid, nD));
  // diagonal wind bracing, an X per slope: purlins alone leave the whole
  // roof plane free to rotate about the chord lines and slide off
  rp.members.push(
    mem('rp_bx_l1', '2x4', 0, 0, mid, nD),
    mem('rp_bx_l2', '2x4', 0, nD, mid, 0),
    mem('rp_bx_r1', '2x4', nW, 0, mid, nD),
    mem('rp_bx_r2', '2x4', nW, nD, mid, 0),
  );
  // floor plan: rims + joists on the slab
  const fp = findF(faces, 'floorplan');
  fp.members = [
    mem('fp_rim0', '2x8', 0, 0, nW, 0),
    mem('fp_rim1', '2x8', 0, nD, nW, nD),
  ];
  for (let i = 0; i <= nW; i += 4) fp.members.push(mem(`fp_j${i}`, '2x8', i, 0, i, nD));
  return { version: 1, dims, faces };
}
