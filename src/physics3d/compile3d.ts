import { Project } from '../model/structure';
import {
  FaceInstance, V3, faceInstances, gridWorld,
} from '../model/mapping3d';
import {
  LUMBER_BY_ID, lumberAxialCap, lumberEA, lumberEI, lumberKappaCap,
} from '../model/lumber';
import { TUNE } from '../physics/tuning';
import { Sim3 } from './solver3d';

export { SPACING } from '../model/mapping3d';

/**
 * Assemble the whole project into one 3D sim.
 *
 * Every face maps into world space through mapping3d (walls once, the roof
 * truss profile at 2 ft on-center, plan views draped flat / on the roof
 * surface). Members genuinely connect wherever they touch:
 *  - member ENDPOINTS and anchors landing on another member weld (T-joints)
 *  - member CROSSINGS weld (purlins nailed across rafters, plan joists over
 *    plates) — computed as closest points between 3D segments
 * No walls under the roof = the roof falls. No purlins across the trusses =
 * the trusses tip over. Physics, not diagrams.
 */
export function compile3d(project: Project): Sim3 {
  const sim = new Sim3();
  const dims = project.dims ?? { widthFt: 12, depthFt: 8, wallHFt: 8 };
  sim.footprint = dims.widthFt * dims.depthFt;
  // bottom plates sit at y=0 ON the slab; collision ground is a touch below
  // so the ground clamp never fights members built at y=0
  sim.groundY = -0.4;

  interface MemberInst {
    inst: FaceInstance;
    memberId: string;
    typeId: string;
    a: V3;
    b: V3;
  }

  const members: MemberInst[] = [];
  const panelInsts: { inst: FaceInstance; corners: V3[]; areaFt2: number }[] = [];
  const anchorPts: V3[] = [];
  const floorPlanChains: number[][] = [];   // slab-supported: pinned later

  for (const inst of faceInstances(project)) {
    const face = inst.face;
    for (const m of face.members) {
      if (!LUMBER_BY_ID[m.type]) continue;
      members.push({
        inst, memberId: `${face.id}${inst.offset}:${m.id}`, typeId: m.type,
        a: gridWorld(inst, m.a), b: gridWorld(inst, m.b),
      });
    }
    for (const pn of face.panels) {
      const i0 = Math.min(pn.a.i, pn.b.i), i1 = Math.max(pn.a.i, pn.b.i);
      const j0 = Math.min(pn.a.j, pn.b.j), j1 = Math.max(pn.a.j, pn.b.j);
      panelInsts.push({
        inst,
        corners: [
          gridWorld(inst, { i: i0, j: j0 }), gridWorld(inst, { i: i1, j: j0 }),
          gridWorld(inst, { i: i1, j: j1 }), gridWorld(inst, { i: i0, j: j1 }),
        ],
        areaFt2: ((i1 - i0) / 2) * ((j1 - j0) / 2),
      });
    }
    // real ground fastening: slab walls only (plan faces have no 2D anchors;
    // the roof's 2D anchors stood in for walls, which exist for real here)
    if (face.view === 'elevation' && face.groundDrop === 0) {
      for (const a of face.anchors) anchorPts.push(gridWorld(inst, a));
    }
  }

  // ---- global weld map
  const weldKey = (p: V3) =>
    `${Math.round(p[0] * 20)},${Math.round(p[1] * 20)},${Math.round(p[2] * 20)}`;
  const weldAt = new Map<string, number>();
  const weld = (p: V3, faceId: string): number => {
    const key = weldKey(p);
    let idx = weldAt.get(key);
    if (idx === undefined) {
      idx = sim.addParticle(p[0], p[1], p[2], 0);
      weldAt.set(key, idx);
    }
    let set = sim.faceOf.get(idx);
    if (!set) { set = new Set(); sim.faceOf.set(idx, set); }
    set.add(faceId);
    return idx;
  };

  // ---- connection candidates: endpoints + anchors + member crossings
  const candidates: V3[] = [];
  const candSeen = new Set<string>();
  const addCandidate = (p: V3) => {
    const k = weldKey(p);
    if (candSeen.has(k)) return;
    candSeen.add(k);
    candidates.push(p);
  };
  for (const m of members) { addCandidate(m.a); addCandidate(m.b); }
  for (const a of anchorPts) addCandidate(a);

  // crossings: closest points between member segments within nailing reach
  const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const A = members[i], B = members[j];
      const d1 = sub(A.b, A.a), d2 = sub(B.b, B.a), r = sub(A.a, B.a);
      const a11 = dot(d1, d1), a22 = dot(d2, d2), a12 = dot(d1, d2);
      const b1 = dot(d1, r), b2 = dot(d2, r);
      const den = a11 * a22 - a12 * a12;
      if (Math.abs(den) < 1e-9) continue;          // parallel: T-welds handle it
      const s = (-b1 * a22 + b2 * a12) / den;
      const t = (a11 * b2 - a12 * b1) / den;
      if (s < 0.02 || s > 0.98 || t < 0.02 || t > 0.98) continue;
      const pA: V3 = [A.a[0] + s * d1[0], A.a[1] + s * d1[1], A.a[2] + s * d1[2]];
      const pB: V3 = [B.a[0] + t * d2[0], B.a[1] + t * d2[1], B.a[2] + t * d2[2]];
      const gap = Math.hypot(pA[0] - pB[0], pA[1] - pB[1], pA[2] - pB[2]);
      if (gap < 0.12) {
        addCandidate([(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2, (pA[2] + pB[2]) / 2]);
      }
    }
  }

  const jointUse = new Map<number, number>();
  const memberEnds: { segIdx: number; jointIdx: number }[] = [];
  // joint -> adjacent chain particles, one per member touching it
  const jointAdj = new Map<number, { nbr: number; member: string; faceId: string }[]>();

  for (const m of members) {
    const t = LUMBER_BY_ID[m.typeId];
    const dx = m.b[0] - m.a[0], dy = m.b[1] - m.a[1], dz = m.b[2] - m.a[2];
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-6) continue;

    const mandatory: { u: number; p: V3 }[] = [
      { u: 0, p: m.a }, { u: 1, p: m.b },
    ];
    for (const c of candidates) {
      const u = ((c[0] - m.a[0]) * dx + (c[1] - m.a[1]) * dy + (c[2] - m.a[2]) * dz) / (L * L);
      if (u <= 1e-6 || u >= 1 - 1e-6) continue;
      const px = m.a[0] + u * dx, py = m.a[1] + u * dy, pz = m.a[2] + u * dz;
      if (Math.hypot(px - c[0], py - c[1], pz - c[2]) < 0.08) mandatory.push({ u, p: c });
    }
    mandatory.sort((a, b) => a.u - b.u);

    const chain: number[] = [weld(mandatory[0].p, m.inst.face.id)];
    const weldIdxs: number[] = [0];
    const restList: number[] = [];
    let prevU = 0;
    for (let s = 1; s < mandatory.length; s++) {
      const st = mandatory[s];
      const spanU = st.u - prevU;
      const spanL = spanU * L;
      if (spanL < 1e-6) continue;
      const nFill = Math.max(1, Math.round(spanL / TUNE.SEG_TARGET_FT));
      for (let k = 1; k < nFill; k++) {
        const u = prevU + (spanU * k) / nFill;
        const idx = sim.addParticle(m.a[0] + u * dx, m.a[1] + u * dy, m.a[2] + u * dz, 0);
        let set = sim.faceOf.get(idx);
        if (!set) { set = new Set(); sim.faceOf.set(idx, set); }
        set.add(m.inst.face.id);
        chain.push(idx);
        restList.push(spanL / nFill);
      }
      chain.push(weld(st.p, m.inst.face.id));
      weldIdxs.push(chain.length - 1);
      restList.push(spanL / nFill);
      prevU = st.u;
    }
    for (const wi of weldIdxs) {
      const nbr = chain[wi + 1] ?? chain[wi - 1];
      if (nbr === undefined) continue;
      const jIdx = chain[wi];
      let list = jointAdj.get(jIdx);
      if (!list) { list = []; jointAdj.set(jIdx, list); }
      list.push({ nbr, member: m.memberId, faceId: m.inst.face.id });
    }

    for (let k = 0; k < restList.length; k++) {
      const mSeg = t.massPerFt * restList[k];
      sim.parts[chain[k]].mass += mSeg / 2;
      sim.parts[chain[k + 1]].mass += mSeg / 2;
    }

    if (m.inst.face.id === 'floorplan') floorPlanChains.push(chain);

    const capStrain = lumberAxialCap(t);
    const halfDepth = (t.depthIn / 12) / 2;
    const firstSeg = sim.segs.length;
    for (let k = 0; k < restList.length; k++) {
      sim.segs.push({
        p1: chain[k], p2: chain[k + 1], rest: restList[k],
        alpha: restList[k] / lumberEA(t),
        typeId: t.id, memberId: m.memberId, halfDepth, capStrain,
        broken: false, damage: 0, stress: 0, axialStrain: 0, lambda: 0,
        connDamage: 0,
      });
    }

    for (let k = 0; k + 2 < chain.length; k++) {
      const r1 = restList[k], r2 = restList[k + 1];
      const sAvg = (r1 + r2) / 2;
      const thetaCap = lumberKappaCap(t) * sAvg;
      sim.bends.push({
        p0: chain[k], p1: chain[k + 1], p2: chain[k + 2],
        f: r1 / (r1 + r2),
        alpha: (sAvg * sAvg * sAvg) / (4 * lumberEI(t)),
        sagCap: (sAvg * thetaCap) / 2,
        segA: firstSeg + k, segB: firstSeg + k + 1,
        lx: 0, ly: 0, lz: 0,
      });
    }

    if (restList.length > 0) {
      memberEnds.push({ segIdx: firstSeg, jointIdx: chain[0] });
      memberEnds.push({ segIdx: sim.segs.length - 1, jointIdx: chain[chain.length - 1] });
      for (const st of mandatory) {
        const idx = weldAt.get(weldKey(st.p));
        if (idx !== undefined) jointUse.set(idx, (jointUse.get(idx) ?? 0) + 1);
      }
    }
  }

  // panels
  for (const pi of panelInsts) {
    const cornerIdx: number[] = [];
    for (const c of pi.corners) {
      let best = -1, bestD = 0.3;
      for (let k = 0; k < sim.parts.length; k++) {
        const p = sim.parts[k];
        const d = Math.hypot(p.x - c[0], p.y - c[1], p.z - c[2]);
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best < 0) break;
      cornerIdx.push(best);
    }
    if (cornerIdx.length !== 4) continue;
    const plyMass = pi.areaFt2 * TUNE.PANEL_MASS_PSF;
    for (const ci of cornerIdx) sim.parts[ci].mass += plyMass / 4;
    const panelIdx = sim.panels.length;
    sim.panels.push({
      corners: cornerIdx as [number, number, number, number],
      broken: false, damage: 0, stress: 0,
    });
    const addDiag = (a: number, b: number) => {
      const pa = sim.parts[a], pb = sim.parts[b];
      const rest = Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
      sim.diags.push({
        p1: a, p2: b, rest, alpha: rest / TUNE.PANEL_EA,
        capStrain: TUNE.PANEL_CAP_STRAIN, panelIdx, stress: 0, lambda: 0,
      });
    };
    addDiag(cornerIdx[0], cornerIdx[2]);
    addDiag(cornerIdx[1], cornerIdx[3]);
  }

  // masses -> inverse masses, then pin anchors + slab-supported floor plan
  for (const p of sim.parts) {
    p.w = TUNE.GRAVITY / Math.max(p.mass, TUNE.MIN_PART_MASS);
  }
  for (const a of anchorPts) {
    const idx = weldAt.get(weldKey(a));
    if (idx !== undefined) sim.parts[idx].w = 0;
  }
  for (const chain of floorPlanChains) {
    for (const idx of chain) sim.parts[idx].w = 0;
  }

  // nailed joints carry a small moment before yielding: knee springs between
  // members meeting at each joint (a real unbraced frame stands from a tap
  // but still racks in a storm). Weaker face's fastening governs.
  const faceJointsById = new Map(project.faces.map((f) => [f.id as string, f.joints]));
  for (const [jIdx, list] of jointAdj) {
    let made = 0;
    for (let i = 0; i < list.length && made < 6; i++) {
      for (let j = i + 1; j < list.length && made < 6; j++) {
        if (list[i].member === list[j].member) continue;
        const hw = faceJointsById.get(list[i].faceId) === 'hardware'
          && faceJointsById.get(list[j].faceId) === 'hardware';
        const K = hw ? TUNE.JOINT_K_HARDWARE : TUNE.JOINT_K_NAILS;
        const yieldTh = hw ? TUNE.JOINT_YIELD_HARDWARE : TUNE.JOINT_YIELD_NAILS;
        const J = sim.parts[jIdx];
        const A = sim.parts[list[i].nbr], B = sim.parts[list[j].nbr];
        const ax = A.x - J.x, ay = A.y - J.y, az = A.z - J.z;
        const bx = B.x - J.x, by = B.y - J.y, bz = B.z - J.z;
        const a = Math.hypot(ax, ay, az), b = Math.hypot(bx, by, bz);
        if (a < 1e-6 || b < 1e-6) continue;
        const cosT = (ax * bx + ay * by + az * bz) / (a * b);
        const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
        if (sinT < 0.25) continue;                     // near-collinear: skip
        const d = Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z);
        const dddTh = (a * b * sinT) / d;
        sim.springs.push({
          p1: list[i].nbr, p2: list[j].nbr, rest: d,
          alpha: (dddTh * dddTh) / K,
          yieldC: yieldTh * dddTh,
          dead: false, lambda: 0,
        });
        made++;
      }
    }
  }

  for (const e of memberEnds) {
    if (sim.parts[e.jointIdx].w === 0) continue;
    if ((jointUse.get(e.jointIdx) ?? 0) < 2) continue;
    const seg = sim.segs[e.segIdx];
    const faceId = seg.memberId.replace(/\d*:.*$/, '');
    seg.connCap = faceJointsById.get(faceId) === 'hardware'
      ? TUNE.CONN_CAP_HARDWARE : TUNE.CONN_CAP_NAILS;
    seg.connJoint = e.jointIdx;
  }
  return sim;
}
