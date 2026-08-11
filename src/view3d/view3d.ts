import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Project } from '../model/structure';
import { FaceInstance, faceInstances, gridWorld } from '../model/mapping3d';
import { LUMBER_BY_ID } from '../model/lumber';
import { h } from '../util/dom';
import { Sim3 } from '../physics3d/solver3d';
import { compile3d } from '../physics3d/compile3d';
import { SCENARIOS3, Scenario3 } from '../physics3d/scenarios3d';
import { playCrack, playThud } from '../ui/audio';
import { stressColor } from '../util/colors';

/**
 * Assembled 3D view with a full physics test mode: the whole shed is
 * simulated at once (walls + replicated trusses/joists welded together),
 * every stick tinted by live stress, breaking and collapsing in 3D.
 */

const v3a = (a: [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2]);
const UP0 = new THREE.Vector3(0, 1, 0);

/** Static preview of one face instance, using the shared 3D mapping. */
function instGroup(inst: FaceInstance): THREE.Group {
  const group = new THREE.Group();
  for (const m of inst.face.members) {
    const t = LUMBER_BY_ID[m.type];
    if (!t) continue;
    const a = v3a(gridWorld(inst, m.a));
    const b = v3a(gridWorld(inst, m.b));
    const len = a.distanceTo(b);
    if (len < 1e-6) continue;
    const dir = b.clone().sub(a).normalize();
    let z = new THREE.Vector3().crossVectors(UP0, dir);
    if (z.lengthSq() < 1e-6) z = new THREE.Vector3(0, 0, 1);
    z.normalize();
    const y = new THREE.Vector3().crossVectors(dir, z).negate().normalize();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(len, t.depthIn / 12, t.thickIn / 12),
      new THREE.MeshLambertMaterial({ color: t.color }),
    );
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, y, z));
    mesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  for (const pn of inst.face.panels) {
    const i0 = Math.min(pn.a.i, pn.b.i), i1 = Math.max(pn.a.i, pn.b.i);
    const j0 = Math.min(pn.a.j, pn.b.j), j1 = Math.max(pn.a.j, pn.b.j);
    const corners = [
      gridWorld(inst, { i: i0, j: j0 }), gridWorld(inst, { i: i1, j: j0 }),
      gridWorld(inst, { i: i1, j: j1 }), gridWorld(inst, { i: i0, j: j1 }),
    ];
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(12);
    corners.forEach((c, ix) => { arr[ix * 3] = c[0]; arr[ix * 3 + 1] = c[1]; arr[ix * 3 + 2] = c[2]; });
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      color: '#d8c391', side: THREE.DoubleSide,
    }));
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

export function openView3D(project: Project): void {
  // ---------- shell ----------
  const wrap = h('div', {
    style: {
      position: 'fixed', inset: '0', zIndex: '50', background: '#1d2126',
      display: 'flex', flexDirection: 'column',
    },
  });
  const status = h('span', {
    style: { color: '#cfe4f0', fontSize: '13px', marginLeft: '6px' },
  });
  const barButtons = h('div', {
    style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
  });
  const bar = h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px',
      background: '#12161a', color: '#ece7dc', fontSize: '14px', flexWrap: 'wrap',
    },
  },
    h('strong', {}, '🧊 Assembled shed'),
    barButtons,
    status,
    h('span', { style: { flex: '1' } }),
    h('button.btn', { onclick: () => close(), title: 'Close (Esc)' }, '✕ Close'),
  );
  const canvasHost = h('div', { style: { flex: '1', position: 'relative' } });
  wrap.append(bar, canvasHost);
  document.body.append(wrap);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasHost.append(renderer.domElement);
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.inset = '0';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfe0ea');
  scene.fog = new THREE.Fog('#cfe0ea', 110, 240);

  const dims0 = project.dims ?? { widthFt: 12, depthFt: 8, wallHFt: 8 };
  const center = new THREE.Vector3(dims0.widthFt / 2, dims0.wallHFt / 2 + 1, dims0.depthFt / 2);
  const persp = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
  persp.position.set(dims0.widthFt * 2, dims0.wallHFt + 8, dims0.depthFt * 2.6);
  const ortho = new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 300);
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = persp;
  type ViewName = 'orbit' | 'front' | 'back' | 'left' | 'right' | 'top';
  let currentView: ViewName = 'orbit';

  const makeControls = (cam: THREE.Camera) => {
    const c = new OrbitControls(cam as THREE.PerspectiveCamera, renderer.domElement);
    c.target.copy(center);
    c.enableDamping = true;
    c.minDistance = 4;
    c.maxDistance = 120;
    return c;
  };
  let controls = makeControls(persp);
  controls.maxPolarAngle = Math.PI * 0.52;

  const sizeOrtho = () => {
    const el = renderer.domElement;
    const aspect = el.clientWidth / Math.max(1, el.clientHeight);
    const half = Math.max(dims0.widthFt, dims0.depthFt, dims0.wallHFt + 8) * 0.72;
    ortho.left = -half * aspect;
    ortho.right = half * aspect;
    ortho.top = half;
    ortho.bottom = -half;
    ortho.updateProjectionMatrix();
  };

  /** True elevation/plan views of the running sim: read one side's strain
   * with the loads visible, like the 2D editor but live. */
  const setView = (v: ViewName) => {
    currentView = v;
    controls.dispose();
    if (v === 'orbit') {
      camera = persp;
      controls = makeControls(persp);
      controls.maxPolarAngle = Math.PI * 0.52;
    } else {
      const D = 80;
      const pos: Record<Exclude<ViewName, 'orbit'>, [number, number, number]> = {
        front: [center.x, center.y, center.z + D],
        back: [center.x, center.y, center.z - D],
        left: [center.x - D, center.y, center.z],
        right: [center.x + D, center.y, center.z],
        top: [center.x, center.y + D, center.z + 0.01],
      };
      ortho.position.set(...pos[v]);
      ortho.up.set(0, 1, 0);
      ortho.lookAt(center);
      sizeOrtho();
      camera = ortho;
      controls = makeControls(ortho);
      controls.enableRotate = false;   // stay a true side view; pan/zoom only
    }
    refreshBar();
  };

  scene.add(new THREE.HemisphereLight('#e8f2ff', '#8a7a5c', 0.9));
  const sun = new THREE.DirectionalLight('#fff4e0', 1.6);
  sun.position.set(30, 40, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -25; sun.shadow.camera.right = 25;
  sun.shadow.camera.top = 25; sun.shadow.camera.bottom = -25;
  scene.add(sun);

  const dims = project.dims ?? { widthFt: 12, depthFt: 8, wallHFt: 8 };
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(80, 48),
    new THREE.MeshLambertMaterial({ color: '#9aa76f' }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.42;
  ground.receiveShadow = true;
  scene.add(ground);
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(dims.widthFt + 1, 0.4, dims.depthFt + 1),
    new THREE.MeshLambertMaterial({ color: '#b9b3a6' }),
  );
  slab.position.set(dims.widthFt / 2, -0.2, dims.depthFt / 2);
  slab.receiveShadow = true;
  scene.add(slab);

  // ---------- static preview (shared mapping = matches the physics) ----------
  const staticGroup = new THREE.Group();
  for (const inst of faceInstances(project)) staticGroup.add(instGroup(inst));
  scene.add(staticGroup);

  // ---------- test mode ----------
  let sim: Sim3 | null = null;
  let scenario: Scenario3 | null = null;
  let clickWeight = 200;
  let slowmo = false;
  let inst: THREE.InstancedMesh | null = null;
  let panelMeshes: THREE.Mesh[] = [];
  let heavyMeshes: THREE.Mesh[] = [];
  const heavyGeo = new THREE.BoxGeometry(1, 1, 1);
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpBasis = new THREE.Matrix4();
  const tmpColor = new THREE.Color();
  const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  const disposeSim = () => {
    if (inst) { scene.remove(inst); inst.dispose(); inst = null; }
    for (const m of panelMeshes) { scene.remove(m); m.geometry.dispose(); }
    for (const m of heavyMeshes) scene.remove(m);
    panelMeshes = [];
    heavyMeshes = [];
    sim = null;
    scenario = null;
  };

  const startTest = (make: () => Scenario3) => {
    disposeSim();
    sim = compile3d(project);
    scenario = make();
    clickWeight = scenario.defaultWeight ?? clickWeight;
    staticGroup.visible = false;

    inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: '#ffffff' }),
      sim.segs.length,
    );
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(inst);

    for (const pn of sim.panels) {
      void pn;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
        color: '#d8c391', side: THREE.DoubleSide,
      }));
      mesh.castShadow = true;
      panelMeshes.push(mesh);
      scene.add(mesh);
    }
    refreshBar();
  };

  const stopTest = () => {
    disposeSim();
    staticGroup.visible = true;
    status.textContent = '';
    refreshBar();
  };

  const syncSimMeshes = () => {
    if (!sim || !inst) return;
    const parts = sim.parts;
    for (let i = 0; i < sim.segs.length; i++) {
      const s = sim.segs[i];
      if (s.broken) {
        tmpM.makeScale(0, 0, 0);
        inst.setMatrixAt(i, tmpM);
        continue;
      }
      const a = parts[s.p1], b = parts[s.p2];
      X.set(b.x - a.x, b.y - a.y, b.z - a.z);
      const len = X.length();
      if (len < 1e-6) continue;
      X.divideScalar(len);
      Z.copy(UP).cross(X);
      if (Z.lengthSq() < 1e-6) Z.set(0, 0, 1);
      Z.normalize();
      Y.copy(X).cross(Z).negate().normalize();
      tmpBasis.makeBasis(X, Y, Z);
      tmpQ.setFromRotationMatrix(tmpBasis);
      const t = LUMBER_BY_ID[s.typeId];
      const depth = t ? t.depthIn / 12 : 0.09;
      const thick = t ? t.thickIn / 12 : 0.09;
      tmpM.compose(
        new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2),
        tmpQ,
        new THREE.Vector3(len, depth, thick),
      );
      inst.setMatrixAt(i, tmpM);
      // color: wood tinted toward stress
      const base = t ? t.color : '#8a8a80';
      tmpColor.set(base);
      const st = Math.min(s.stress, 1);
      if (st > 0.05) tmpColor.lerp(new THREE.Color(stressColor(st)), Math.min(0.25 + st * 0.6, 0.85));
      inst.setColorAt(i, tmpColor);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;

    for (let k = 0; k < sim.panels.length; k++) {
      const pn = sim.panels[k];
      const mesh = panelMeshes[k];
      if (!mesh) continue;
      mesh.visible = !pn.broken;
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      pn.corners.forEach((ci, ix) => {
        const p = parts[ci];
        pos.setXYZ(ix, p.x, p.y, p.z);
      });
      pos.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      (mesh.material as THREE.MeshLambertMaterial).color
        .set('#d8c391')
        .lerp(new THREE.Color(stressColor(Math.min(pn.stress, 1))), Math.min(pn.stress * 0.6, 0.8));
    }

    while (heavyMeshes.length < sim.heavies.length) {
      const hv = sim.heavies[heavyMeshes.length];
      const mesh = new THREE.Mesh(
        heavyGeo,
        new THREE.MeshLambertMaterial({ color: '#a5553a' }),
      );
      mesh.scale.setScalar(hv.r * 1.7);
      mesh.castShadow = true;
      heavyMeshes.push(mesh);
      scene.add(mesh);
      playThud();
    }
    for (let k = 0; k < sim.heavies.length; k++) {
      const p = parts[sim.heavies[k].p];
      heavyMeshes[k].position.set(p.x, p.y, p.z);
    }
  };

  // ---------- bar UI ----------
  const viewChips = (): HTMLElement[] => {
    const views: [ViewName, string][] = [
      ['orbit', '🧭 Orbit'], ['front', 'Front'], ['back', 'Back'],
      ['left', 'Left'], ['right', 'Right'], ['top', 'Top'],
    ];
    return views.map(([v, label]) => h('button', {
      class: `chip${currentView === v ? ' active' : ''}`,
      onclick: () => setView(v),
      title: v === 'orbit' ? 'Free orbit' : `Flat ${v} view — read this side's strain`,
    }, label));
  };
  const refreshBar = () => {
    barButtons.innerHTML = '';
    if (!sim) {
      barButtons.append(
        h('button.btn.primary', {
          onclick: () => startTest(SCENARIOS3[0]),
          title: 'Simulate the whole assembled shed',
        }, '▶ Test in 3D'),
        ...viewChips(),
        h('span', { style: { color: '#8fa1ad', fontSize: '12px' } },
          'Trusses raise at 2\' on-center onto your wall plates; purlins & bracing come from your Roof plan'),
      );
      return;
    }
    for (const make of SCENARIOS3) {
      const proto = make();
      barButtons.append(h('button.btn', {
        onclick: () => startTest(make),
        title: proto.desc,
        style: scenario?.id === proto.id ? { borderColor: '#e0552c', background: '#55402f' } : {},
      }, `${proto.icon} ${proto.label}`));
    }
    if (scenario?.weights) {
      for (const w of scenario.weights) {
        barButtons.append(h('button.chip', {
          onclick: () => { clickWeight = w; refreshBar(); },
          class: `chip${clickWeight === w ? ' active' : ''}`,
        }, `${w} lb`));
      }
    }
    barButtons.append(
      h('button.btn', { onclick: () => scenario && startTest(SCENARIOS3.find((m) => m().id === scenario!.id)!), title: 'Restart this test' }, '↻'),
      h('button.btn', {
        onclick: () => { slowmo = !slowmo; refreshBar(); },
        style: slowmo ? { borderColor: '#e0552c' } : {},
        title: 'Slow motion',
      }, '🐌 ¼×'),
      ...viewChips(),
      h('button.btn', { onclick: () => stopTest() }, '⏹ Preview'),
    );
  };
  refreshBar();

  // ---------- clicks (bricks) ----------
  const raycaster = new THREE.Raycaster();
  let downPos: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    downPos = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downPos || !sim || !scenario?.onClick) return;
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    downPos = null;
    if (moved > 6) return;   // was an orbit drag
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const targets: THREE.Object3D[] = [ground, slab];
    if (inst) targets.push(inst);
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return;
    const p = hits[0].point;
    scenario.onClick(sim, p.x, Math.max(p.y, 0), p.z, clickWeight);
  });

  // ---------- lifecycle ----------
  const resize = () => {
    const w = canvasHost.clientWidth, hh = canvasHost.clientHeight;
    renderer.setSize(w, hh);
    persp.aspect = w / hh;
    persp.updateProjectionMatrix();
    sizeOrtho();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvasHost);
  resize();

  let open = true;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };
  window.addEventListener('keydown', onKey, true);

  function close() {
    open = false;
    window.removeEventListener('keydown', onKey, true);
    ro.disconnect();
    disposeSim();
    controls.dispose();
    renderer.dispose();
    wrap.remove();
  }

  // dev hook: lets tests pump the sim even when RAF is throttled
  (window as any).__view3d = {
    getSim: () => sim,
    getScenario: () => scenario,
    pump: (secs: number) => {
      if (!sim || !scenario) return 'no sim';
      for (let i = 0; i < secs * 60; i++) {
        sim.clearForces();
        if (!sim.settling) scenario.tick(sim, 1 / 60);
        sim.step(1 / 60);
      }
      syncSimMeshes();
      status.textContent = scenario.status(sim);
      return scenario.status(sim);
    },
    click: (x: number, y: number, z: number, w: number) =>
      scenario?.onClick && sim ? scenario.onClick(sim, x, y, z, w) : null,
  };

  let lastT = 0;
  let lastStatus = 0;
  const animate = (t: number) => {
    if (!open) return;
    const dt = Math.min((t - lastT) / 1000, 1 / 30) || 1 / 60;
    lastT = t;
    if (sim && scenario) {
      sim.clearForces();
      const sdt = dt * (slowmo ? 0.25 : 1);
      if (!sim.settling) scenario.tick(sim, sdt);
      sim.step(sdt);
      const events = sim.drainBreaks();
      if (events.length > 0) playCrack(Math.min(events.length, 3));
      syncSimMeshes();
      if (t - lastStatus > 150) {
        lastStatus = t;
        status.textContent = sim.settling ? 'settling…' : scenario.status(sim);
      }
    }
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}
