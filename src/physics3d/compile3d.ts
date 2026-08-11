import { Face, Project, gridToWorld } from '../model/structure';
import {
  LUMBER_BY_ID, lumberAxialCap, lumberEA, lumberEI, lumberKappaCap,
} from '../model/lumber';
import { TUNE } from '../physics/tuning';
import { Sim3 } from './solver3d';

export const SHED_DEPTH = 8;   // ft (left/right wall width)
export const SPACING = 2;      // trusses / floor joists on-center

/**
 * Assemble the whole project into one 3D sim.
 *
 * - Walls are placed once via their plane transforms; the roof truss and
 *   floor deck faces are replicated along their normal at 2 ft on-center.
 * - Coincident stations from DIFFERENT members/faces weld into one shared
 *   particle: wall corners join, trusses actually bear on wall top plates,
 *   floor joists sit on the bottom plates. No walls under the roof = the
 *   roof falls. Physics, not diagrams.
 * - Only walls (slab faces) and the floor keep their anchors; the roof
 *   face's 2D anchors represented "the walls", which now really exist.
 */
export function compile3d(project: Project): Sim3 {
  const sim = new Sim3();
  // framing bottom plates sit at y=0 ON the slab; the collision ground is a
  // touch below so the ground clamp never fights members built at y=0
  sim.groundY = -0.4;

  interface MemberInst {
    face: Face;
    memberId: string;
    typeId: string;
    a: [number, number, number];
    b: [number, number, number];
  }
  interface PanelInst {
    face: Face;
    corners: [number, number, number][];
    areaFt2: number;
  }

  const members: MemberInst[] = [];
  const panelInsts: PanelInst[] = [];
  const anchorPts: [number, number, number][] = [];

  for (const face of project.faces) {
    const o = face.plane.origin, xa = face.plane.xAxis, ya = face.plane.yAxis;
    const nx = xa[1] * ya[2] - xa[2] * ya[1];
    const ny = xa[2] * ya[0] - xa[0] * ya[2];
    const nz = xa[0] * ya[1] - xa[1] * ya[0];
    const offsets = (face.id === 'roof' || face.id === 'floor')
      ? Array.from({ length: SHED_DEPTH / SPACING + 1 }, (_, k) => k * SPACING)
      : [0];

    for (const d of offsets) {
      const toWorld = (lx: number, ly: number): [number, number, number] => [
        o[0] + xa[0] * lx + ya[0] * ly + nx * d,
        o[1] + xa[1] * lx + ya[1] * ly + ny * d,
        o[2] + xa[2] * lx + ya[2] * ly + nz * d,
      ];
      for (const m of face.members) {
        if (!LUMBER_BY_ID[m.type]) continue;
        const a2 = gridToWorld(m.a), b2 = gridToWorld(m.b);
        members.push({
          face, memberId: `${face.id}${d}:${m.id}`, typeId: m.type,
          a: toWorld(a2.x, a2.y), b: toWorld(b2.x, b2.y),
        });
      }
      for (const pn of face.panels) {
        const a2 = gridToWorld(pn.a), b2 = gridToWorld(pn.b);
        const x0 = Math.min(a2.x, b2.x), x1 = Math.max(a2.x, b2.x);
        const y0 = Math.min(a2.y, b2.y), y1 = Math.max(a2.y, b2.y);
        panelInsts.push({
          face,
          corners: [
            toWorld(x0, y0), toWorld(x1, y0), toWorld(x1, y1), toWorld(x0, y1),
          ],
          areaFt2: (x1 - x0) * (y1 - y0),
        });
      }
      // anchors: real ground fastening only for slab walls and the floor
      // blocks; the roof's 2D anchors stood in for walls, which now exist
      if (face.groundDrop === 0 || face.id === 'floor') {
        for (const a of face.anchors) {
          const w2 = gridToWorld(a);
          anchorPts.push(toWorld(w2.x, w2.y));
        }
      }
    }
  }

  // ---- global weld map: any station/endpoint at the same 3D point is one
  // particle, so members from different faces genuinely connect
  const weldKey = (p: [number, number, number]) =>
    `${Math.round(p[0] * 20)},${Math.round(p[1] * 20)},${Math.round(p[2] * 20)}`;
  const weldAt = new Map<string, number>();
  const weld = (p: [number, number, number], faceId: string): number => {
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

  // connection candidates: every member endpoint + every anchor point
  const candidates: [number, number, number][] = [];
  {
    const seen = new Set<string>();
    const add = (p: [number, number, number]) => {
      const k = weldKey(p);
      if (seen.has(k)) return;
      seen.add(k);
      candidates.push(p);
    };
    for (const m of members) { add(m.a); add(m.b); }
    for (const a of anchorPts) add(a);
  }

  const jointUse = new Map<number, number>();
  const memberEnds: { segIdx: number; jointIdx: number }[] = [];
  // chains of replicated members, for auto-bracing between instances
  const chainsByMember = new Map<string, Map<number, number[]>>();

  for (const m of members) {
    const t = LUMBER_BY_ID[m.typeId];
    const dx = m.b[0] - m.a[0], dy = m.b[1] - m.a[1], dz = m.b[2] - m.a[2];
    const memberBase = m.memberId.replace(/^([a-z]+)\d+:/, '$1:');
    const instOffset = Number(m.memberId.match(/^[a-z]+(\d+):/)?.[1] ?? 0);
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-6) continue;

    // stations: endpoints + candidate points on this member's 3D line
    const mandatory: { u: number; p: [number, number, number] }[] = [
      { u: 0, p: m.a }, { u: 1, p: m.b },
    ];
    for (const c of candidates) {
      const u = ((c[0] - m.a[0]) * dx + (c[1] - m.a[1]) * dy + (c[2] - m.a[2]) * dz) / (L * L);
      if (u <= 1e-6 || u >= 1 - 1e-6) continue;
      const px = m.a[0] + u * dx, py = m.a[1] + u * dy, pz = m.a[2] + u * dz;
      if (Math.hypot(px - c[0], py - c[1], pz - c[2]) < 0.03) mandatory.push({ u, p: c });
    }
    mandatory.sort((a, b) => a.u - b.u);

    const chain: number[] = [weld(mandatory[0].p, m.face.id)];
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
        set.add(m.face.id);
        chain.push(idx);
        restList.push(spanL / nFill);
      }
      chain.push(weld(st.p, m.face.id));
      restList.push(spanL / nFill);
      prevU = st.u;
    }

    for (let k = 0; k < restList.length; k++) {
      const mSeg = t.massPerFt * restList[k];
      sim.parts[chain[k]].mass += mSeg / 2;
      sim.parts[chain[k + 1]].mass += mSeg / 2;
    }

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

    if (m.face.id === 'roof' || m.face.id === 'floor') {
      let byD = chainsByMember.get(memberBase);
      if (!byD) { byD = new Map(); chainsByMember.set(memberBase, byD); }
      byD.set(instOffset, chain);
    }

    if (restList.length > 0) {
      memberEnds.push({ segIdx: firstSeg, jointIdx: chain[0] });
      memberEnds.push({ segIdx: sim.segs.length - 1, jointIdx: chain[chain.length - 1] });
      jointUse.set(chain[0], (jointUse.get(chain[0]) ?? 0) + 1);
      const last = chain[chain.length - 1];
      jointUse.set(last, (jointUse.get(last) ?? 0) + 1);
      // welded T-stations also count as usage for the passing member
      for (let s = 1; s < mandatory.length - 1; s++) {
        const idx = weldAt.get(weldKey(mandatory[s].p))!;
        jointUse.set(idx, (jointUse.get(idx) ?? 0) + 1);
      }
    }
  }

  // ---- auto-bracing between replicated instances: real roofs get purlins &
  // sheathing, real floors get blocking. Purlin (i->i) + diagonal (i->i+1)
  // links between corresponding stations of adjacent trusses/joists stop them
  // pivoting about their own chord lines.
  const braceEA = TUNE.EA_BASE / 4;
  const addBrace = (a: number, b: number) => {
    const pa = sim.parts[a], pb = sim.parts[b];
    const rest = Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
    if (rest < 0.1) return;
    sim.parts[a].mass += rest * 0.25;
    sim.parts[b].mass += rest * 0.25;
    sim.segs.push({
      p1: a, p2: b, rest, alpha: rest / braceEA,
      typeId: 'brace', memberId: `brace:${a}-${b}`, halfDepth: 0.05,
      capStrain: 0.03, broken: false, damage: 0, stress: 0,
      axialStrain: 0, lambda: 0, connDamage: 0,
    });
  };
  for (const [, byD] of chainsByMember) {
    const ds = [...byD.keys()].sort((a, b) => a - b);
    for (let k = 0; k + 1 < ds.length; k++) {
      const A = byD.get(ds[k])!, B = byD.get(ds[k + 1])!;
      const n = Math.min(A.length, B.length);
      for (let i = 0; i < n; i++) {
        if (A[i] === B[i]) continue;             // merged (gable) stations
        addBrace(A[i], B[i]);                    // purlin / blocking
        if (i + 1 < n && A[i] !== B[i + 1]) addBrace(A[i], B[i + 1]); // diagonal
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

  // masses -> inverse masses, anchors pin
  for (const p of sim.parts) {
    p.w = TUNE.GRAVITY / Math.max(p.mass, TUNE.MIN_PART_MASS);
  }
  for (const a of anchorPts) {
    const idx = weldAt.get(weldKey(a));
    if (idx !== undefined) sim.parts[idx].w = 0;
  }

  // fastened member ends (per-face joint hardware setting)
  for (const e of memberEnds) {
    if (sim.parts[e.jointIdx].w === 0) continue;
    if ((jointUse.get(e.jointIdx) ?? 0) < 2) continue;
    const seg = sim.segs[e.segIdx];
    const face = members.find((m) => m.memberId === seg.memberId)?.face;
    seg.connCap = face?.joints === 'hardware'
      ? TUNE.CONN_CAP_HARDWARE : TUNE.CONN_CAP_NAILS;
    seg.connJoint = e.jointIdx;
  }
  return sim;
}
