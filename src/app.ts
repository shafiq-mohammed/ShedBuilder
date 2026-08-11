import { Face, FaceId, Project, findFace } from './model/structure';
import { LUMBER_BY_ID } from './model/lumber';
import { History } from './model/history';
import { exportProject, importProject, loadProject, saveDebounced } from './model/storage';
import { defaultProject } from './model/presets';
import { Camera } from './editor/camera';
import { Editor } from './editor/editor';
import { compileFace } from './physics/compile';
import { Sim } from './physics/solver';
import { Scenario } from './scenarios/scenario';
import { SCENARIOS } from './scenarios/index';
import { render } from './render/renderer';
import { h } from './util/dom';
import { buildPalette } from './ui/palette';
import { buildTabs } from './ui/tabs';
import { buildTestbar } from './ui/testbar';
import { initAudioOnGesture, playCrack, playThud } from './ui/audio';

export class App {
  project: Project = loadProject();
  faceId: FaceId = 'front';
  mode: 'build' | 'test' = 'build';
  history = new History();
  cam = new Camera();
  editor: Editor;

  sim: Sim | null = null;
  scenario: Scenario | null = null;
  scenarioId = 'gravity';
  clickWeight = 200;
  slowmo = false;
  shake = 0;
  private bannerShownAt = -1;

  canvas!: HTMLCanvasElement;
  private g!: CanvasRenderingContext2D;
  private viewW = 800;
  private viewH = 600;
  private refreshFns: (() => void)[] = [];
  private banner!: HTMLElement;
  private panning = false;
  private lastPointer = { x: 0, y: 0 };
  private lastTime = 0;

  constructor() {
    this.editor = new Editor({
      beforeMutate: () => this.history.push(this.face),
      afterMutate: () => { saveDebounced(this.project); this.refreshUI(); },
    });
  }

  get face(): Face { return findFace(this.project, this.faceId); }

  // ---------- mounting ----------

  mount(root: HTMLElement) {
    const tabs = buildTabs(this);
    const palette = buildPalette(this);
    const testbar = buildTestbar(this);
    this.refreshFns = [tabs.refresh, palette.refresh, testbar.refresh];

    this.canvas = h<'canvas'>('canvas') as HTMLCanvasElement;
    this.banner = h('div.banner');
    const canvaswrap = h('div.canvaswrap', {}, this.canvas, this.banner);

    const testBtn = h('button.btn.primary', {
      onclick: () => (this.mode === 'build' ? this.enterTest() : this.exitTest()),
      title: 'Space',
    }, '▶ Test it');
    this.refreshFns.push(() => {
      testBtn.textContent = this.mode === 'build' ? '▶ Test it' : '✎ Keep building';
    });

    const topbar = h('div.topbar', {},
      h('div.logo', {}, 'Shed', h('em', {}, 'Builder')),
      tabs.el,
      h('div.spacer'),
      h('button.btn', { onclick: () => this.undo(), title: 'Undo (Ctrl/Cmd+Z)' }, '↶'),
      h('button.btn', { onclick: () => this.redo(), title: 'Redo (Ctrl/Cmd+Shift+Z)' }, '↷'),
      h('button.btn', { onclick: () => this.clearFace(), title: 'Clear this face' }, '🗑 Face'),
      h('button.btn', {
        onclick: async () => {
          if (this.mode === 'test') this.exitTest();
          const { openView3D } = await import('./view3d/view3d');
          openView3D(this.project);
        },
        title: 'See all faces assembled into a 3D shed',
      }, '🧊 3D'),
      h('button.btn', { onclick: () => exportProject(this.project), title: 'Download design as JSON' }, '⇩'),
      h('button.btn', {
        onclick: () => importProject((p) => { this.project = p; this.exitTest(); saveDebounced(p); this.refreshUI(); this.fitCamera(); }),
        title: 'Load design from JSON',
      }, '⇧'),
      testBtn,
    );

    root.append(topbar, testbar.el, h('div.main', {}, palette.el, canvaswrap));

    this.g = this.canvas.getContext('2d')!;
    const ro = new ResizeObserver(() => this.resize(canvaswrap));
    ro.observe(canvaswrap);
    this.resize(canvaswrap);

    this.bindPointer();
    this.bindKeys();
    initAudioOnGesture();
    this.fitCamera();
    this.refreshUI();
    requestAnimationFrame((t) => this.frame(t));
  }

  private resize(wrap: HTMLElement) {
    const dpr = window.devicePixelRatio || 1;
    this.viewW = wrap.clientWidth;
    this.viewH = wrap.clientHeight;
    this.canvas.width = Math.max(1, this.viewW * dpr);
    this.canvas.height = Math.max(1, this.viewH * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  refreshUI() { for (const f of this.refreshFns) f(); }

  fitCamera() { this.cam.fitFace(this.face, this.viewW, this.viewH); }

  // ---------- state changes ----------

  setFace(id: FaceId) {
    if (this.mode === 'test') this.exitTest();
    this.faceId = id;
    this.editor.cancelDrag();
    this.fitCamera();
    this.refreshUI();
  }

  setTool(tool: 'place' | 'erase' | 'panel') {
    this.editor.tool = tool;
    this.editor.cancelDrag();
    this.refreshUI();
  }

  setLumber(id: string) {
    this.editor.lumberId = id;
    this.editor.tool = 'place';
    this.refreshUI();
  }

  setJoints(mode: 'nails' | 'hardware') {
    if (this.mode !== 'build') return;
    this.face.joints = mode;
    saveDebounced(this.project);
    this.refreshUI();
  }

  undo() { if (this.mode === 'build' && this.history.undo(this.face)) { saveDebounced(this.project); this.refreshUI(); } }
  redo() { if (this.mode === 'build' && this.history.redo(this.face)) { saveDebounced(this.project); this.refreshUI(); } }

  clearFace() {
    if (this.mode !== 'build') return;
    if (this.face.members.length === 0 && this.face.panels.length === 0) return;
    if (!confirm(`Clear everything on the ${this.face.label.toLowerCase()}?`)) return;
    this.history.push(this.face);
    this.face.members = [];
    this.face.panels = [];
    saveDebounced(this.project);
    this.refreshUI();
  }

  // ---------- test mode ----------

  enterTest() {
    this.mode = 'test';
    this.setScenario(this.scenarioId);
    this.refreshUI();
  }

  exitTest() {
    this.mode = 'build';
    this.sim = null;
    this.scenario = null;
    this.shake = 0;
    this.hideBanner();
    this.refreshUI();
  }

  setScenario(id: string) {
    this.scenarioId = id;
    this.sim = compileFace(this.face);
    const entry = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
    this.scenario = entry.make();
    this.clickWeight = this.scenario.defaultWeight ?? this.clickWeight;
    this.scenario.setup({ sim: this.sim, face: this.face });
    this.bannerShownAt = -1;
    this.hideBanner();
    this.refreshUI();
  }

  resetSim() { if (this.mode === 'test') this.setScenario(this.scenarioId); }

  toggleSlowmo() { this.slowmo = !this.slowmo; this.refreshUI(); }

  private showBanner(text: string, passed: boolean) {
    this.banner.textContent = text;
    this.banner.className = `banner show ${passed ? 'pass' : 'fail'}`;
  }

  private hideBanner() { this.banner.className = 'banner'; }

  // ---------- main loop ----------

  private frame(t: number) {
    const dt = Math.min((t - this.lastTime) / 1000, 1 / 30) || 1 / 60;
    this.lastTime = t;

    if (this.mode === 'test' && this.sim && this.scenario) {
      const sim = this.sim;
      sim.clearForces();
      const ctx = { sim, face: this.face };
      if (!sim.settling) this.scenario.tick(ctx, dt * (this.slowmo ? 0.25 : 1));
      sim.step(dt * (this.slowmo ? 0.25 : 1));

      // break effects
      const events = sim.drainBreaks();
      if (events.length > 0) {
        this.shake = Math.min(10, this.shake + events.length * 4);
        playCrack(Math.min(events.length, 3));
      }
      this.detectThuds(sim);

      // status / banner
      const st = this.scenario.status(ctx);
      if (st.done && this.bannerShownAt < 0) {
        this.bannerShownAt = sim.time;
        this.showBanner(st.text, st.passed);
      }
      if (this.bannerShownAt >= 0 && sim.time - this.bannerShownAt > 4) this.hideBanner();
      this.refreshTestStatus();
    }
    this.shake *= 0.86;

    render(this.g, this.viewW, this.viewH, {
      mode: this.mode,
      face: this.face,
      cam: this.cam,
      editor: this.editor,
      sim: this.sim,
      scenario: this.scenario,
      shake: this.shake,
    });
    requestAnimationFrame((tt) => this.frame(tt));
  }

  private lastStatusRefresh = 0;
  private refreshTestStatus() {
    const now = performance.now();
    if (now - this.lastStatusRefresh > 150) {
      this.lastStatusRefresh = now;
      this.refreshFns[2]?.();     // testbar only
    }
  }

  private thudVy = new Map<number, number>();
  private detectThuds(sim: Sim) {
    for (const hv of sim.heavies) {
      const p = sim.parts[hv.p];
      const vy = (p.y - p.py) * 60;
      const last = this.thudVy.get(hv.p) ?? 0;
      if (last < -6 && vy > -1.5) playThud();
      this.thudVy.set(hv.p, vy);
    }
  }

  // ---------- input ----------

  private bindPointer() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const [wx, wy] = this.cam.toWorld(e.offsetX, e.offsetY, this.viewW, this.viewH);
      this.lastPointer = { x: e.offsetX, y: e.offsetY };
      if (e.button === 1) { this.panning = true; e.preventDefault(); return; }
      if (this.mode === 'build') {
        if (e.button === 2) { this.editor.eraseAt(this.face, wx, wy); return; }
        if (e.button === 0) this.editor.down(this.face, wx, wy);
      } else if (e.button === 0 && this.sim && this.scenario?.onClick) {
        this.scenario.onClick({ sim: this.sim, face: this.face }, wx, wy, this.clickWeight);
      }
    });

    c.addEventListener('pointermove', (e) => {
      const [wx, wy] = this.cam.toWorld(e.offsetX, e.offsetY, this.viewW, this.viewH);
      if (this.panning) {
        this.cam.panPx(e.offsetX - this.lastPointer.x, e.offsetY - this.lastPointer.y);
      } else if (this.mode === 'build') {
        this.editor.move(this.face, wx, wy);
        if (this.editor.tool === 'erase' && (e.buttons & 1)) {
          this.editor.eraseAt(this.face, wx, wy);
        }
        if ((e.buttons & 2)) this.editor.eraseAt(this.face, wx, wy);
      }
      this.lastPointer = { x: e.offsetX, y: e.offsetY };
    });

    c.addEventListener('pointerup', (e) => {
      if (e.button === 1) { this.panning = false; return; }
      if (this.mode === 'build' && e.button === 0) {
        const [wx, wy] = this.cam.toWorld(e.offsetX, e.offsetY, this.viewW, this.viewH);
        this.editor.up(this.face, wx, wy, e.shiftKey);
      }
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0012);
      this.cam.zoomAt(e.offsetX, e.offsetY, factor, this.viewW, this.viewH);
    }, { passive: false });
  }

  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const key = e.key.toLowerCase();

      if ((e.metaKey || e.ctrlKey) && key === 'z') {
        e.preventDefault();
        e.shiftKey ? this.redo() : this.undo();
        return;
      }
      if (key === ' ') {
        e.preventDefault();
        this.mode === 'build' ? this.enterTest() : this.exitTest();
        return;
      }
      if (key === 'escape') {
        if (this.editor.dragStart) this.editor.cancelDrag();
        else if (this.mode === 'test') this.exitTest();
        return;
      }
      if (this.mode === 'build') {
        const byKey = Object.values(LUMBER_BY_ID).find((l) => l.key === key);
        if (byKey) { this.setLumber(byKey.id); return; }
        if (key === 'e') this.setTool('erase');
        if (key === 'p') this.setTool('panel');
      } else {
        if (key === 's') this.toggleSlowmo();
        if (key === 'r') this.resetSim();
      }
    });
  }
}
