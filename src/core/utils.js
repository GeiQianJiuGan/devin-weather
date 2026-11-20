// Small math / random helpers shared by every system.

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const saturate = (x) => Math.min(1, Math.max(0, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential approach of `current` towards `target`. */
export const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));

/** Deterministic PRNG (mulberry32) so the city is identical between runs. */
export class Rng {
  constructor(seed = 1) {
    this.s = seed >>> 0;
  }
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }
  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }
  chance(p) {
    return this.next() < p;
  }
}

/**
 * Piecewise-linear lookup. `keys` is ascending, `values` holds numbers or
 * equally sized number arrays. Returns a number, or writes into `out`.
 */
export function sampleKeys(keys, values, x, out) {
  const n = keys.length;
  let i = 0;
  while (i < n - 2 && x > keys[i + 1]) i++;
  const t = saturate((x - keys[i]) / (keys[i + 1] - keys[i]));
  const a = values[i];
  const b = values[i + 1];
  if (typeof a === 'number') return a + (b - a) * t;
  for (let k = 0; k < a.length; k++) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export const formatHour = (hour) => {
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};