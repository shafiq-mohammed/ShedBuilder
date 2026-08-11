/** Seeded 1D value noise for deterministic wind gusts. */
export function makeNoise1D(seed = 1234): (t: number) => number {
  const rand = mulberry32(seed);
  const table: number[] = [];
  for (let i = 0; i < 256; i++) table.push(rand() * 2 - 1);
  return (t: number) => {
    const i0 = Math.floor(t) & 255;
    const i1 = (i0 + 1) & 255;
    const f = t - Math.floor(t);
    const s = f * f * (3 - 2 * f);
    return table[i0] + (table[i1] - table[i0]) * s;
  };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
