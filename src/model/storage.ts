import { Project } from './structure';
import { defaultProject } from './presets';

const KEY = 'shedbuilder.project.v1';
let saveTimer: number | undefined;

export function saveDebounced(project: Project) {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(project));
    } catch { /* storage full/unavailable: non-fatal */ }
  }, 400);
}

export function loadProject(): Project {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Project;
      if (p.version === 1 && Array.isArray(p.faces)) {
        // Merge with defaults so new preset fields survive old saves
        const def = defaultProject();
        for (const face of def.faces) {
          const saved = p.faces.find((f) => f.id === face.id);
          if (saved) {
            face.members = saved.members ?? [];
            face.panels = saved.panels ?? [];
            face.joints = saved.joints ?? 'nails';
          }
        }
        return def;
      }
    }
  } catch { /* corrupted save: start fresh */ }
  return defaultProject();
}

export function exportProject(project: Project) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'my-shed.json';
  a.click();
  URL.revokeObjectURL(url);
}

export function importProject(onLoad: (p: Project) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const p = JSON.parse(await file.text()) as Project;
      if (p.version === 1 && Array.isArray(p.faces)) onLoad(p);
      else alert('Not a ShedBuilder project file.');
    } catch {
      alert('Could not read that file.');
    }
  };
  input.click();
}
