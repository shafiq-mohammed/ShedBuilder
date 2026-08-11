import { clamp } from './vec2';

/**
 * Stress 0..1 -> green -> yellow -> red (Bridge Builder style).
 * Returns a CSS hsl() string.
 */
export function stressColor(s: number): string {
  s = clamp(s, 0, 1);
  const hue = 120 * (1 - s); // 120 green -> 0 red
  return `hsl(${hue.toFixed(0)}, 85%, 48%)`;
}

/** Alpha for the stress overlay: invisible when relaxed, strong when loaded. */
export function stressAlpha(s: number): number {
  if (s < 0.04) return 0;
  return clamp(0.15 + s * 0.65, 0, 0.8);
}
