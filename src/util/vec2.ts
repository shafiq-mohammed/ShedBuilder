export interface Vec2 { x: number; y: number }

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const dist = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Distance from point p to segment ab, and the parameter u of the closest point. */
export function pointSegDist(p: Vec2, a: Vec2, b: Vec2): { d: number; u: number } {
  const abx = b.x - a.x, aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return { d: dist(p, a), u: 0 };
  const u = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / len2, 0, 1);
  const cx = a.x + u * abx, cy = a.y + u * aby;
  return { d: Math.hypot(p.x - cx, p.y - cy), u };
}

/** Format feet as ft-in string, e.g. 7.5 -> 7' 6" */
export function ftIn(ft: number): string {
  const sign = ft < 0 ? '-' : '';
  ft = Math.abs(ft);
  const whole = Math.floor(ft + 1e-6);
  const inches = Math.round((ft - whole) * 12);
  if (inches === 0) return `${sign}${whole}'`;
  if (inches === 12) return `${sign}${whole + 1}'`;
  return `${sign}${whole}' ${inches}"`;
}
