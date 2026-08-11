import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Face, Project, gridToWorld } from '../model/structure';
import { LUMBER_BY_ID } from '../model/lumber';
import { h } from '../util/dom';

/**
 * Read-only assembled view: every face is placed in 3D via its plane
 * transform. The roof truss and floor joists are replicated at 2 ft
 * on-center across the shed depth, which is how the 2D physics loads
 * (tributary width) assume they're built.
 */

const SHED_DEPTH = 8;      // ft, left/right wall width
const SPACING = 2;         // trusses / joists on-center

const v3 = (a: [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2]);

function faceGroup(face: Face): THREE.Group {
  const group = new THREE.Group();
  const origin = v3(face.plane.origin);
  const xAxis = v3(face.plane.xAxis).normalize();
  const yAxis = v3(face.plane.yAxis).normalize();
  const normal = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();

  const toWorld = (x: number, y: number) =>
    origin.clone().addScaledVector(xAxis, x).addScaledVector(yAxis, y);

  for (const m of face.members) {
    const t = LUMBER_BY_ID[m.type];
    if (!t) continue;
    const a2 = gridToWorld(m.a), b2 = gridToWorld(m.b);
    const a = toWorld(a2.x, a2.y);
    const b = toWorld(b2.x, b2.y);
    const len = a.distanceTo(b);
    if (len < 1e-6) continue;

    const dir = b.clone().sub(a).normalize();
    const inPlane = new THREE.Vector3().crossVectors(normal, dir).normalize();
    const geo = new THREE.BoxGeometry(len, t.depthIn / 12, t.thickIn / 12);
    const mat = new THREE.MeshLambertMaterial({ color: t.color });
    const mesh = new THREE.Mesh(geo, mat);
    const basis = new THREE.Matrix4().makeBasis(dir, inPlane, normal);
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  for (const pn of face.panels) {
    const a2 = gridToWorld(pn.a), b2 = gridToWorld(pn.b);
    const cx = (a2.x + b2.x) / 2, cy = (a2.y + b2.y) / 2;
    const w = Math.abs(b2.x - a2.x), hgt = Math.abs(b2.y - a2.y);
    const geo = new THREE.BoxGeometry(w, hgt, 0.045);
    const mat = new THREE.MeshLambertMaterial({ color: '#d8c391' });
    const mesh = new THREE.Mesh(geo, mat);
    const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, normal);
    mesh.quaternion.setFromRotationMatrix(basis);
    // sheathing sits just outside the framing
    mesh.position.copy(toWorld(cx, cy).addScaledVector(normal, -0.1));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

export function openView3D(project: Project): void {
  const wrap = h('div', {
    style: {
      position: 'fixed', inset: '0', zIndex: '50', background: '#1d2126',
      display: 'flex', flexDirection: 'column',
    },
  });
  const bar = h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px',
      background: '#12161a', color: '#ece7dc', fontSize: '14px',
    },
  },
    h('strong', {}, '🧊 Assembled shed'),
    h('span', { style: { color: '#8fa1ad', fontSize: '12px' } },
      'Drag to orbit, scroll to zoom, right-drag to pan. Trusses & joists shown 2\' on-center.'),
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
  scene.fog = new THREE.Fog('#cfe0ea', 60, 140);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
  camera.position.set(24, 14, 22);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(6, 4, 4);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.minDistance = 4;
  controls.maxDistance = 90;

  // lights
  scene.add(new THREE.HemisphereLight('#e8f2ff', '#8a7a5c', 0.9));
  const sun = new THREE.DirectionalLight('#fff4e0', 1.6);
  sun.position.set(30, 40, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -25; sun.shadow.camera.right = 25;
  sun.shadow.camera.top = 25; sun.shadow.camera.bottom = -25;
  scene.add(sun);

  // ground
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(80, 48),
    new THREE.MeshLambertMaterial({ color: '#9aa76f' }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  // slab
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(13, 0.35, 9),
    new THREE.MeshLambertMaterial({ color: '#b9b3a6' }),
  );
  slab.position.set(6, -0.18, 4);
  slab.receiveShadow = true;
  scene.add(slab);

  // faces
  for (const face of project.faces) {
    const g = faceGroup(face);
    if (face.id === 'roof' || face.id === 'floor') {
      const normal = new THREE.Vector3()
        .crossVectors(v3(face.plane.xAxis), v3(face.plane.yAxis)).normalize();
      for (let d = 0; d <= SHED_DEPTH; d += SPACING) {
        const copy = g.clone();
        copy.position.addScaledVector(normal, d);
        scene.add(copy);
      }
    } else {
      scene.add(g);
    }
  }

  const resize = () => {
    const w = canvasHost.clientWidth, hh = canvasHost.clientHeight;
    renderer.setSize(w, hh);
    camera.aspect = w / hh;
    camera.updateProjectionMatrix();
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
    controls.dispose();
    renderer.dispose();
    wrap.remove();
  }

  const animate = () => {
    if (!open) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  };
  animate();
}
