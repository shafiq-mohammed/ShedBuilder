import { Face, gridToWorld, ptKey } from '../model/structure';
import {
  LUMBER_BY_ID, lumberAxialCap, lumberEA, lumberEI, lumberKappaCap,
} from '../model/lumber';
import { TUNE } from './tuning';
import { Sim } from './solver';

/**
 * Compile an editor Face into a fresh Sim.
 * - Member endpoints sharing a grid point become one shared joint particle (pin joint).
 * - Each member is subdivided into ~1 ft segments (axial sticks) with bend sticks
 *   between alternate particles so sag/buckling emerge.
 * - Anchored grid points get invMass 0.
 * - Panels add mass + two diagonal shear constraints between the nearest particles.
 */
export function compileFace(face: Face): Sim {
  const sim = new Sim();
  sim.groundY = -face.groundDrop;

  const jointAt = new Map<string, number>();
  const joint = (i: number, j: number): number => {
    const key = `${i},${j}`;
    let idx = jointAt.get(key);
    if (idx === undefined) {
      const w = gridToWorld({ i, j });
      idx = sim.addParticle(w.x, w.y, 0);
      jointAt.set(key, idx);
    }
    return idx;
  };

  // connection points: every member endpoint + every anchor. When one of
  // these lands ON another member's line (T-joint: stud on plate, king post
  // on chord), the passing member gets a mandatory station there sharing the
  // same joint particle — so framing actually connects.
  const connects: { i: number; j: number; x: number; y: number }[] = [];
  {
    const seen = new Set<string>();
    const addPt = (p: { i: number; j: number }) => {
      const key = ptKey(p);
      if (seen.has(key)) return;
      seen.add(key);
      const w = gridToWorld(p);
      connects.push({ i: p.i, j: p.j, x: w.x, y: w.y });
    };
    for (const m of face.members) { addPt(m.a); addPt(m.b); }
    for (const a of face.anchors) addPt(a);
  }

  const jointUse = new Map<number, number>();       // particle -> member count
  const memberEnds: { segIdx: number; jointIdx: number }[] = [];
  // joint -> adjacent chain particles, one per member touching it
  const jointAdj = new Map<number, { nbr: number; member: string }[]>();

  for (const m of face.members) {
    const t = LUMBER_BY_ID[m.type];
    if (!t) continue;
    const wa = gridToWorld(m.a), wb = gridToWorld(m.b);
    const dx = wb.x - wa.x, dy = wb.y - wa.y;
    const L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;

    // stations along the member: connection points (welded, shared particles)
    // plus uniform fill between them at ~SEG_TARGET_FT
    const mandatory: { u: number; i: number; j: number }[] = [
      { u: 0, i: m.a.i, j: m.a.j },
      { u: 1, i: m.b.i, j: m.b.j },
    ];
    for (const c of connects) {
      const u = ((c.x - wa.x) * dx + (c.y - wa.y) * dy) / (L * L);
      if (u <= 1e-6 || u >= 1 - 1e-6) continue;
      const px = wa.x + u * dx, py = wa.y + u * dy;
      if (Math.hypot(px - c.x, py - c.y) < 0.02) mandatory.push({ u, i: c.i, j: c.j });
    }
    mandatory.sort((a, b) => a.u - b.u);

    const chain: number[] = [joint(mandatory[0].i, mandatory[0].j)];
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
        chain.push(sim.addParticle(wa.x + u * dx, wa.y + u * dy, 0));
        restList.push(spanL / nFill);
      }
      chain.push(joint(st.i, st.j));
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
      list.push({ nbr, member: m.id });
    }
    // this member touches every mandatory station (ends + welded T-joints)
    for (const st of mandatory) {
      const idx = jointAt.get(`${st.i},${st.j}`)!;
      jointUse.set(idx, (jointUse.get(idx) ?? 0) + 1);
    }

    // distribute member mass: half a segment's worth to each segment endpoint
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
        typeId: t.id, memberId: m.id, halfDepth, capStrain,
        broken: false, damage: 0, stress: 0, axialStrain: 0, lambda: 0,
        connDamage: 0,
      });
    }
    if (restList.length > 0) {
      memberEnds.push({ segIdx: firstSeg, jointIdx: chain[0] });
      memberEnds.push({ segIdx: sim.segs.length - 1, jointIdx: chain[chain.length - 1] });
    }

    // angular bend constraints at each interior particle (theta = M*s/EI);
    // the member is continuous through welded T-joints, so bends span them
    for (let k = 0; k + 2 < chain.length; k++) {
      const sAvg = (restList[k] + restList[k + 1]) / 2;
      sim.bends.push({
        p0: chain[k], p1: chain[k + 1], p2: chain[k + 2],
        alpha: sAvg / lumberEI(t),
        thetaCap: lumberKappaCap(t) * sAvg,
        segA: firstSeg + k, segB: firstSeg + k + 1,
        lambda: 0, theta: 0,
      });
    }
  }

  // panels: attach corners to nearest existing particle, add ply mass + diagonals
  for (const pn of face.panels) {
    const i0 = Math.min(pn.a.i, pn.b.i), i1 = Math.max(pn.a.i, pn.b.i);
    const j0 = Math.min(pn.a.j, pn.b.j), j1 = Math.max(pn.a.j, pn.b.j);
    const cornersGrid = [
      { i: i0, j: j0 }, { i: i1, j: j0 }, { i: i1, j: j1 }, { i: i0, j: j1 },
    ];
    const cornerIdx: number[] = [];
    for (const cg of cornersGrid) {
      const w = gridToWorld(cg);
      let best = -1, bestD = 0.3;
      for (let k = 0; k < sim.parts.length; k++) {
        const p = sim.parts[k];
        const d = Math.hypot(p.x - w.x, p.y - w.y);
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best < 0) break;
      cornerIdx.push(best);
    }
    if (cornerIdx.length !== 4) continue; // corner not on structure: not simulated

    const wFt = (i1 - i0) * 0.5, hFt = (j1 - j0) * 0.5;
    const plyMass = wFt * hFt * TUNE.PANEL_MASS_PSF;
    for (const ci of cornerIdx) sim.parts[ci].mass += plyMass / 4;

    const panelIdx = sim.panels.length;
    sim.panels.push({
      corners: cornerIdx as [number, number, number, number],
      broken: false, damage: 0, stress: 0,
    });
    const addDiag = (a: number, b: number) => {
      const pa = sim.parts[a], pb = sim.parts[b];
      const rest = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      sim.diags.push({
        p1: a, p2: b, rest, alpha: rest / TUNE.PANEL_EA,
        capStrain: TUNE.PANEL_CAP_STRAIN, panelIdx, stress: 0, lambda: 0,
      });
    };
    addDiag(cornerIdx[0], cornerIdx[2]);
    addDiag(cornerIdx[1], cornerIdx[3]);
  }

  // finalize masses -> inverse masses (slugs, so m*g is honest lbf), pin anchors
  for (const p of sim.parts) {
    p.w = TUNE.GRAVITY / Math.max(p.mass, TUNE.MIN_PART_MASS);
  }
  for (const a of face.anchors) {
    const idx = jointAt.get(ptKey(a));
    if (idx !== undefined) sim.parts[idx].w = 0;
  }

  // nailed joints carry a small moment before yielding: knee springs between
  // the members meeting at each joint (this is why a real unbraced frame
  // stands from a tap but still racks in a storm)
  const K = face.joints === 'hardware' ? TUNE.JOINT_K_HARDWARE : TUNE.JOINT_K_NAILS;
  const yieldTh = face.joints === 'hardware' ? TUNE.JOINT_YIELD_HARDWARE : TUNE.JOINT_YIELD_NAILS;
  for (const [jIdx, list] of jointAdj) {
    let made = 0;
    for (let i = 0; i < list.length && made < 6; i++) {
      for (let j = i + 1; j < list.length && made < 6; j++) {
        if (list[i].member === list[j].member) continue;
        const J = sim.parts[jIdx];
        const A = sim.parts[list[i].nbr], B = sim.parts[list[j].nbr];
        const a = Math.hypot(A.x - J.x, A.y - J.y);
        const b = Math.hypot(B.x - J.x, B.y - J.y);
        if (a < 1e-6 || b < 1e-6) continue;
        const cosT = ((A.x - J.x) * (B.x - J.x) + (A.y - J.y) * (B.y - J.y)) / (a * b);
        const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
        if (sinT < 0.25) continue;                     // near-collinear: skip
        const d = Math.hypot(B.x - A.x, B.y - A.y);
        const dddTh = (a * b * sinT) / d;              // chord length per radian
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

  // member ends fastened to another member (shared joint or T-joint) can pull
  // out under tension; anchored joints are bolted and never fail
  const connCap = face.joints === 'hardware' ? TUNE.CONN_CAP_HARDWARE : TUNE.CONN_CAP_NAILS;
  for (const e of memberEnds) {
    if (sim.parts[e.jointIdx].w === 0) continue;
    if ((jointUse.get(e.jointIdx) ?? 0) < 2) continue;
    const seg = sim.segs[e.segIdx];
    seg.connCap = connCap;
    seg.connJoint = e.jointIdx;
  }
  return sim;
}
