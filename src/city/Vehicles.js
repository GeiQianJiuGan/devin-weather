import {
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
} from 'three';
import { DecalBatch } from './Decals.js';
import { ext } from './sharedUniforms.js';

// Procedural vehicles: lofted car bodies and a boxier bus. Every vertex carries a "part"
// id so a single instanced material can shade paint, glass, tyres and lamps;
// each vehicle type is one InstancedMesh (one draw call per type).
// Local frame: +X forward, +Y up, +Z right-hand side.

const PART = { PAINT: 0, GLASS: 1, TRIM: 2, HEAD: 3, TAIL: 4, HUB: 5, SIGN: 6, CABIN: 7, BLINK_L: 8, BLINK_R: 9 };

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

class PartBuilder {
  constructor() {
    this.p = [];
    this.n = [];
    this.t = [];
  }

  tri(a, b, c, part) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const q of [a, b, c]) {
      this.p.push(q[0], q[1], q[2]);
      this.n.push(nx, ny, nz);
      this.t.push(part);
    }
  }

  /** a, b, c, d counter-clockwise when seen from outside. */
  quad(a, b, c, d, part) {
    this.tri(a, b, c, part);
    this.tri(a, c, d, part);
  }

  /** Truncated pyramid between two rectangles ([x0, x1, z0, z1]) at y0 / y1. Returns its side faces. */
  frustum(y0, y1, b, t, part, { noBottom = false } = {}) {
    const B00 = [b[0], y0, b[2]];
    const B10 = [b[1], y0, b[2]];
    const B11 = [b[1], y0, b[3]];
    const B01 = [b[0], y0, b[3]];
    const T00 = [t[0], y1, t[2]];
    const T10 = [t[1], y1, t[2]];
    const T11 = [t[1], y1, t[3]];
    const T01 = [t[0], y1, t[3]];
    const faces = {
      front: [B10, T10, T11, B11],
      back: [B01, T01, T00, B00],
      right: [B11, T11, T01, B01],
      left: [B00, T00, T10, B10],
    };
    for (const key of Object.keys(faces)) this.quad(...faces[key], part);
    this.quad(T00, T01, T11, T10, part);
    if (!noBottom) this.quad(B00, B10, B11, B01, PART.TRIM);
    return faces;
  }

  /** Panel inset in a face: s runs along the bottom edge, t from bottom to top. */
  panel(face, s0, s1, t0, t1, part, lift = 0.014) {
    const [a, b, c, d] = face;
    const at = (s, t) => lerp3(lerp3(a, d, s), lerp3(b, c, s), t);
    const q = [at(s0, t0), at(s0, t1), at(s1, t1), at(s1, t0)];
    const u = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]];
    const v = [q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const k of q) {
      k[0] += (n[0] / l) * lift;
      k[1] += (n[1] / l) * lift;
      k[2] += (n[2] / l) * lift;
    }
    this.quad(q[0], q[1], q[2], q[3], part);
  }

  /** Triangle wound so that it faces `dir`. */
  triFacing(a, b, c, dir, part) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] >= 0) this.tri(a, b, c, part);
    else this.tri(a, c, b, part);
  }

  quadFacing(a, b, c, d, dir, part) {
    this.triFacing(a, b, c, dir, part);
    this.triFacing(a, c, d, dir, part);
  }

  /** Quad with explicit per-corner normals (smooth shading across a lofted surface). */
  smoothQuad(q, n, part) {
    const u = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]];
    const v = [q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2]];
    const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const flip = f[0] * n[0][0] + f[1] * n[0][1] + f[2] * n[0][2] < 0;
    for (const i of flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]) {
      this.p.push(q[i][0], q[i][1], q[i][2]);
      this.n.push(n[i][0], n[i][1], n[i][2]);
      this.t.push(part);
    }
  }

  /** Rectangle in a plane of constant x, facing +x or -x. */
  capRect(x, dir, y0, y1, z0, z1, part) {
    this.quadFacing([x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1], [dir, 0, 0], part);
  }

  /** Dark wheel-arch opening on the body side. */
  arch(cx, cy, z, r, yMin, side, segments = 18) {
    const at = (i) => {
      const a = (i / segments) * Math.PI * 2;
      return [cx + Math.cos(a) * r, Math.max(yMin, cy + Math.sin(a) * r), z];
    };
    const centre = [cx, Math.max(yMin, cy), z];
    for (let i = 0; i < segments; i++) this.triFacing(centre, at(i), at(i + 1), [0, 0, side], PART.TRIM);
  }

  /** Wheel with its axis along Z; `side` is +1 / -1 for the outward direction. */
  wheel(cx, cy, cz, r, halfW, side, segments = 20) {
    const zIn = cz - side * halfW;
    const zOut = cz + side * halfW;
    const out = [0, 0, side];
    const ring = (i, radius, z) => {
      const a = (i / segments) * Math.PI * 2;
      return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, z];
    };
    const radial = (i) => {
      const a = (i / segments) * Math.PI * 2;
      return [Math.cos(a), Math.sin(a), 0];
    };
    const zShoulder = zOut - side * 0.03;
    for (let i = 0; i < segments; i++) {
      const n0 = radial(i);
      const n1 = radial(i + 1);
      this.smoothQuad([ring(i, r, zIn), ring(i + 1, r, zIn), ring(i + 1, r, zShoulder), ring(i, r, zShoulder)], [n0, n1, n1, n0], PART.TRIM);
      // rounded shoulder, sidewall, recessed alloy rim
      const s0 = [n0[0] * 0.5, n0[1] * 0.5, side * 0.87];
      const s1 = [n1[0] * 0.5, n1[1] * 0.5, side * 0.87];
      this.smoothQuad(
        [ring(i, r, zShoulder), ring(i + 1, r, zShoulder), ring(i + 1, r * 0.93, zOut), ring(i, r * 0.93, zOut)], [n0, n1, s1, s0], PART.TRIM,
      );
      this.quadFacing(ring(i, r * 0.93, zOut), ring(i + 1, r * 0.93, zOut), ring(i + 1, r * 0.68, zOut), ring(i, r * 0.68, zOut), out, PART.TRIM);
      this.quadFacing(
        ring(i, r * 0.68, zOut), ring(i + 1, r * 0.68, zOut), ring(i + 1, r * 0.62, zOut - side * 0.025), ring(i, r * 0.62, zOut - side * 0.025),
        out, PART.HUB,
      );
      this.triFacing([cx, cy, zOut - side * 0.025], ring(i, r * 0.62, zOut - side * 0.025), ring(i + 1, r * 0.62, zOut - side * 0.025), out, PART.HUB);
    }
    // dark openings between five spokes
    const zGap = zOut - side * 0.02;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      const pt = (da, radius) => [cx + Math.cos(a + da) * radius, cy + Math.sin(a + da) * radius, zGap];
      this.quadFacing(pt(-0.16, r * 0.2), pt(-0.42, r * 0.56), pt(0.42, r * 0.56), pt(0.16, r * 0.2), out, PART.TRIM);
    }
  }

  build() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.n, 3));
    g.setAttribute('aPart', new Float32BufferAttribute(this.t, 1));
    return g;
  }
}

// Passenger vehicles are lofted: a side-view roofline (`profile`) is swept through
// rounded cross-sections, with smooth normals, so bonnet, windscreen, roof and
// boot flow into each other. Glass, pillars and sills are picked per grid cell.
const CAR_SPECS = {
  sedan: {
    length: 4.7, width: 1.84, clear: 0.2, mid: 0.56, belt: 0.93, tumble: 0.2,
    profile: [[-2.35, 0.9], [-2.22, 1.0], [-1.5, 1.03], [-0.8, 1.43], [-0.1, 1.46], [0.4, 1.41], [1.1, 0.99], [1.95, 0.88], [2.24, 0.8], [2.35, 0.7]],
    wind: [1.1, 0.4], rear: [-1.5, -0.8], side: [-1.22, 0.86], pillars: [-0.14], wheelR: 0.33, wheelX: 1.42,
  },
  hatch: {
    length: 4.15, width: 1.78, clear: 0.2, mid: 0.56, belt: 0.95, tumble: 0.18,
    profile: [[-2.075, 0.92], [-2.0, 1.05], [-1.72, 1.42], [-1.2, 1.5], [-0.1, 1.5], [0.45, 1.44], [1.1, 1.0], [1.8, 0.9], [1.98, 0.82], [2.075, 0.7]],
    wind: [1.1, 0.45], rear: [-2.0, -1.72], side: [-1.56, 0.86], pillars: [-0.1, -1.05], wheelR: 0.32, wheelX: 1.3,
  },
  coupe: {
    length: 4.5, width: 1.86, clear: 0.17, mid: 0.5, belt: 0.85, tumble: 0.24,
    profile: [[-2.25, 0.8], [-2.14, 0.93], [-1.7, 0.97], [-0.75, 1.27], [-0.15, 1.3], [0.3, 1.26], [1.0, 0.91], [1.9, 0.79], [2.15, 0.71], [2.25, 0.6]],
    wind: [1.0, 0.3], rear: [-1.7, -0.75], side: [-1.05, 0.78], pillars: [], wheelR: 0.34, wheelX: 1.38,
  },
  suv: {
    length: 4.8, width: 1.94, clear: 0.28, mid: 0.68, belt: 1.12, tumble: 0.16,
    profile: [[-2.4, 1.0], [-2.33, 1.2], [-2.08, 1.68], [-1.4, 1.74], [0.0, 1.74], [0.55, 1.68], [1.2, 1.2], [2.0, 1.1], [2.3, 1.0], [2.4, 0.86]],
    wind: [1.2, 0.55], rear: [-2.33, -2.08], side: [-1.92, 0.96], pillars: [-0.05, -1.15], wheelR: 0.38, wheelX: 1.48,
  },
  pickup: {
    length: 5.3, width: 1.98, clear: 0.3, mid: 0.7, belt: 1.14, tumble: 0.14,
    profile: [[-2.65, 1.0], [-2.6, 1.12], [-0.78, 1.12], [-0.6, 1.74], [0.0, 1.8], [0.6, 1.74], [1.25, 1.22], [2.1, 1.12], [2.52, 1.02], [2.65, 0.88]],
    wind: [1.25, 0.6], rear: [-0.78, -0.6], side: [-0.5, 1.0], pillars: [0.2], wheelR: 0.4, wheelX: 1.68,
  },
  van: {
    length: 5.4, width: 2.0, clear: 0.28, mid: 0.75, belt: 1.25, tumble: 0.1,
    profile: [[-2.7, 1.2], [-2.66, 2.05], [-2.4, 2.22], [0.9, 2.22], [1.45, 2.12], [2.1, 1.3], [2.55, 1.12], [2.7, 0.9]],
    wind: [2.1, 1.45], rear: null, side: [1.05, 1.96], pillars: [], wheelR: 0.37, wheelX: 1.78,
  },
};
CAR_SPECS.taxi = { ...CAR_SPECS.sedan, roofSign: true };

function rawProfileY(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
    }
  }
  return pts[pts.length - 1][1];
}

/** Roofline with its corners eased, so panels flow into each other. */
function profileY(pts, x) {
  return (rawProfileY(pts, x - 0.14) + 2 * rawProfileY(pts, x) + rawProfileY(pts, x + 0.14)) / 4;
}

function carStations(s) {
  const keys = new Set(s.profile.map((p) => p[0]));
  for (const x of [...s.wind, ...(s.rear || []), ...s.side]) keys.add(x);
  for (const p of s.pillars) {
    keys.add(p - 0.05);
    keys.add(p + 0.05);
  }
  const sorted = [...keys].sort((a, b) => a - b).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 0.02);
  const xs = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const gap = sorted[i] - sorted[i - 1];
      const n = Math.ceil(gap / 0.2);
      for (let k = 1; k < n; k++) xs.push(sorted[i - 1] + (gap * k) / n);
    }
    xs.push(sorted[i]);
  }
  return xs;
}

/** Cross-section at x as a ring of 15 points, right sill -> roof centre -> left sill. */
function carSection(s, x, roofH) {
  const hw = s.width / 2;
  const top = profileY(s.profile, x);
  const u = Math.abs(x) / (s.length / 2);
  const w = hw * (u < 0.7 ? 1 : 1 - 0.17 * ((u - 0.7) / 0.3) ** 2);
  const t = Math.max(0, top - s.belt) / (roofH - s.belt);
  const beltY = Math.min(s.belt, top - 0.1);
  const midY = Math.min(s.mid, beltY - 0.12);
  const wr = w - 0.03 - s.tumble * t;
  const crown = 0.04 * (wr / hw);
  const half = [
    [top + crown, 0], [top + crown * 0.85, wr * 0.5], [top + crown * 0.3, wr * 0.88], [top - 0.035, wr],
    [beltY, w - 0.05], [midY, w], [s.clear + 0.1, w - 0.03], [s.clear, w - 0.11],
  ];
  const ring = [];
  for (let k = 7; k >= 0; k--) ring.push([x, half[k][0], half[k][1]]);
  for (let k = 1; k <= 7; k++) ring.push([x, half[k][0], -half[k][1]]);
  return ring;
}

function carGeometry(s) {
  const b = new PartBuilder();
  const hw = s.width / 2;
  const roofH = Math.max(...s.profile.map((p) => p[1]));
  const xs = carStations(s);
  const rings = xs.map((x) => carSection(s, x, roofH));
  // bevelled bumpers: two shrinking rings past each end
  const bevel = (ring, dir) => [[0.045, 0.95, 0.02], [0.1, 0.84, 0.05]].map(([dx, kz, dy]) => {
    const yTop = ring[7][1];
    return ring.map((p) => [p[0] + dir * dx, p[1] - dy * Math.max(0, (p[1] - s.clear) / (yTop - s.clear)) + dy * 0.4 * (p[1] < s.clear + 0.05 ? 1 : 0), p[2] * kz]);
  });
  rings.unshift(...bevel(rings[0], -1).reverse());
  rings.push(...bevel(rings[rings.length - 1], 1));
  xs.unshift(xs[0] - 0.1, xs[0] - 0.045);
  xs.push(xs[xs.length - 1] + 0.045, xs[xs.length - 1] + 0.1);
  const R = rings[0].length;

  // smooth normals from the grid
  const normals = rings.map((ring, i) => ring.map((p, j) => {
    const a = rings[Math.max(i - 1, 0)][j];
    const c = rings[Math.min(i + 1, rings.length - 1)][j];
    const d = ring[Math.max(j - 1, 0)];
    const e = ring[Math.min(j + 1, R - 1)];
    const ux = c[0] - a[0];
    const uy = c[1] - a[1];
    const uz = c[2] - a[2];
    const vy = e[1] - d[1];
    const vz = e[2] - d[2];
    let n = [uy * vz - uz * vy, -ux * vz, ux * vy];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / l, n[1] / l, n[2] / l];
    const out = [0, p[1] - (s.clear + roofH) * 0.45, p[2]];
    if (n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
    return n;
  }));

  const inside = (x, range) => range && x > Math.min(...range) && x < Math.max(...range);
  for (let i = 0; i < rings.length - 1; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2;
    for (let j = 0; j < R - 1; j++) {
      const cell = j < 7 ? 6 - j : j - 7;
      let part = PART.PAINT;
      if (cell === 6) part = PART.TRIM;
      else if (cell === 3) {
        if (inside(cx, s.side) && !s.pillars.some((p) => Math.abs(cx - p) < 0.05)) part = PART.GLASS;
      } else if (cell < 2 && (inside(cx, s.wind) || inside(cx, s.rear))) part = PART.GLASS;
      b.smoothQuad(
        [rings[i][j], rings[i + 1][j], rings[i + 1][j + 1], rings[i][j + 1]],
        [normals[i][j], normals[i + 1][j], normals[i + 1][j + 1], normals[i][j + 1]],
        part,
      );
    }
    b.quadFacing(rings[i][0], rings[i + 1][0], rings[i + 1][R - 1], rings[i][R - 1], [0, -1, 0], PART.TRIM);
  }

  // nose and tail
  for (const [ring, dir] of [[rings[0], -1], [rings[rings.length - 1], 1]]) {
    const centre = [ring[0][0], 0, 0];
    for (const p of ring) centre[1] += p[1] / R;
    for (let j = 0; j < R; j++) b.triFacing(centre, ring[j], ring[(j + 1) % R], [dir, 0, 0], PART.PAINT);
  }
  const x1 = s.length / 2 + 0.112;
  const wc = hw * 0.83 * 0.84 - 0.04;
  const topF = profileY(s.profile, s.length / 2) - 0.05;
  const topR = profileY(s.profile, -s.length / 2) - 0.05;
  for (const side of [-1, 1]) {
    b.capRect(x1, 1, topF - 0.15, topF - 0.04, side * 0.44 * wc, side * 0.86 * wc, PART.HEAD);
    b.capRect(x1, 1, topF - 0.15, topF - 0.04, side * 0.88 * wc, side * 0.99 * wc, side < 0 ? PART.BLINK_L : PART.BLINK_R);
    b.capRect(-x1, -1, topR - 0.17, topR - 0.04, side * 0.4 * wc, side * 0.86 * wc, PART.TAIL);
    b.capRect(-x1, -1, topR - 0.17, topR - 0.04, side * 0.88 * wc, side * 0.99 * wc, side < 0 ? PART.BLINK_L : PART.BLINK_R);
  }
  b.capRect(x1, 1, topF - 0.16, topF - 0.06, -0.38 * wc, 0.38 * wc, PART.TRIM);
  b.capRect(x1, 1, s.clear + 0.05, s.clear + 0.2, -0.78 * wc, 0.78 * wc, PART.TRIM);
  b.capRect(-x1, -1, s.clear + 0.03, s.clear + 0.17, -0.9 * wc, 0.9 * wc, PART.TRIM);
  b.capRect(-x1, -1, topR - 0.36, topR - 0.25, -0.26, 0.26, PART.HUB);

  // door mirrors
  const mx = s.wind[0] - 0.22;
  for (const side of [-1, 1]) {
    const z0 = side * (hw - 0.04);
    const z1 = side * (hw + 0.13);
    const rect = [mx - 0.05, mx + 0.05, Math.min(z0, z1), Math.max(z0, z1)];
    b.frustum(s.belt + 0.02, s.belt + 0.13, rect, rect, PART.PAINT);
  }

  for (const wx of [-s.wheelX, s.wheelX]) {
    for (const side of [-1, 1]) {
      b.arch(wx, s.wheelR, side * (hw + 0.004), s.wheelR * 1.17, s.clear + 0.02, side);
      b.wheel(wx, s.wheelR, side * (hw - 0.1), s.wheelR, 0.11, side);
    }
  }
  if (s.roofSign) {
    const y = profileY(s.profile, -0.3) + 0.03;
    b.frustum(y, y + 0.15, [-0.46, -0.14, -0.26, 0.26], [-0.44, -0.16, -0.23, 0.23], PART.SIGN, { noBottom: true });
  }
  return b.build();
}

function addLamps(b, front, back) {
  b.panel(front, 0.015, 0.075, 0.3, 0.72, PART.BLINK_L);
  b.panel(front, 0.085, 0.32, 0.3, 0.72, PART.HEAD);
  b.panel(front, 0.68, 0.915, 0.3, 0.72, PART.HEAD);
  b.panel(front, 0.925, 0.985, 0.3, 0.72, PART.BLINK_R);
  b.panel(front, 0.37, 0.63, 0.2, 0.66, PART.TRIM);
  b.panel(back, 0.04, 0.29, 0.38, 0.8, PART.TAIL);
  b.panel(back, 0.3, 0.36, 0.38, 0.8, PART.BLINK_R);
  b.panel(back, 0.64, 0.7, 0.38, 0.8, PART.BLINK_L);
  b.panel(back, 0.71, 0.96, 0.38, 0.8, PART.TAIL);
}

const BUS = { length: 11.6, width: 2.54, height: 3.05 };

function busGeometry() {
  const b = new PartBuilder();
  const hw = BUS.width / 2;
  const x0 = -BUS.length / 2;
  const x1 = BUS.length / 2;
  const skirt = b.frustum(0.32, 1.25, [x0 + 0.05, x1 - 0.05, -hw + 0.04, hw - 0.04], [x0, x1, -hw, hw], PART.PAINT);
  const body = b.frustum(1.25, BUS.height, [x0, x1, -hw, hw], [x0 + 0.08, x1 - 0.25, -hw + 0.06, hw - 0.06], PART.PAINT, { noBottom: true });
  const panes = 8;
  for (let i = 0; i < panes; i++) {
    const a = 0.03 + (i * 0.94) / panes;
    const c = a + 0.94 / panes - 0.012;
    b.panel(body.right, a, c, 0.1, 0.62, PART.CABIN);
    b.panel(body.left, 1 - c, 1 - a, 0.1, 0.62, PART.CABIN);
  }
  b.panel(body.front, 0.05, 0.95, 0.02, 0.66, PART.GLASS);
  b.panel(body.front, 0.2, 0.8, 0.72, 0.9, PART.SIGN);
  b.panel(body.back, 0.1, 0.9, 0.25, 0.62, PART.CABIN);
  b.panel(skirt.right, 0.0, 1.0, 0.0, 0.3, PART.TRIM, 0.01);
  b.panel(skirt.left, 0.0, 1.0, 0.0, 0.3, PART.TRIM, 0.01);
  addLamps(b, skirt.front, skirt.back);
  for (const wx of [-3.7, 3.6]) {
    b.wheel(wx, 0.5, hw - 0.12, 0.5, 0.14, 1);
    b.wheel(wx, 0.5, -hw + 0.12, 0.5, 0.14, -1);
  }
  return b.build();
}

export const VEHICLE_TYPES = {
  sedan: { length: 4.7, width: 1.84, speed: 1.0 },
  hatch: { length: 4.15, width: 1.78, speed: 1.02 },
  coupe: { length: 4.5, width: 1.86, speed: 1.08 },
  suv: { length: 4.8, width: 1.94, speed: 0.98 },
  pickup: { length: 5.3, width: 1.98, speed: 0.95 },
  van: { length: 5.4, width: 2.0, speed: 0.92 },
  taxi: { length: 4.7, width: 1.84, speed: 1.05 },
  bus: { length: BUS.length, width: BUS.width, speed: 0.8 },
};

const FLEET_PATTERN = [
  'sedan', 'suv', 'hatch', 'taxi', 'coupe', 'van', 'suv', 'sedan', 'pickup', 'bus', 'sedan', 'taxi', 'suv', 'hatch', 'coupe', 'sedan',
];

const PAINTS = [
  [0.82, 0.82, 0.8], [0.82, 0.82, 0.8], [0.5, 0.52, 0.55], [0.5, 0.52, 0.55], [0.2, 0.21, 0.23], [0.2, 0.21, 0.23],
  [0.03, 0.03, 0.035], [0.03, 0.03, 0.035], [0.05, 0.09, 0.22], [0.42, 0.04, 0.04], [0.07, 0.2, 0.46], [0.06, 0.18, 0.13],
  [0.55, 0.47, 0.36], [0.62, 0.22, 0.05], [0.36, 0.02, 0.05], [0.05, 0.22, 0.26], [0.7, 0.55, 0.08], [0.6, 0.62, 0.66],
];
const BUS_PAINTS = [[0.08, 0.26, 0.55], [0.7, 0.1, 0.08], [0.8, 0.8, 0.78], [0.1, 0.42, 0.3]];
const VAN_PAINTS = [[0.85, 0.85, 0.83], [0.85, 0.85, 0.83], [0.45, 0.47, 0.5], [0.12, 0.2, 0.4]];
const TAXI_PAINT = [0.9, 0.6, 0.04];

const VERT_PARS = /* glsl */ `
attribute float aPart;
attribute vec3 aPaint;
attribute vec4 aState;
varying float vPart;
varying vec3 vPaint;
varying vec4 vState;
`;

const FRAG_PARS = /* glsl */ `
uniform float uHeadOn;
uniform float uTailOn;
uniform float uBlink;
uniform float uWet;
uniform vec3 uSkyRefl;
varying float vPart;
varying vec3 vPaint;
varying vec4 vState;
`;

const FRAG_COLOR = /* glsl */ `
float vp = floor(vPart + 0.5);
vec3 vAlb = vPaint;
float vRough = 0.34;
float vSky = 0.5;
if (vp == 1.0) { vAlb = vec3(0.02, 0.026, 0.032); vRough = 0.08; vSky = 0.9; }
else if (vp == 2.0) { vAlb = vec3(0.018); vRough = 0.85; vSky = 0.0; }
else if (vp == 3.0) { vAlb = vec3(0.75); vRough = 0.2; vSky = 0.2; }
else if (vp == 4.0) { vAlb = vec3(0.35, 0.02, 0.02); vRough = 0.25; vSky = 0.1; }
else if (vp == 5.0) { vAlb = vec3(0.45); vRough = 0.3; vSky = 0.2; }
else if (vp == 6.0) { vAlb = vec3(0.8, 0.7, 0.3); vSky = 0.0; }
else if (vp == 7.0) { vAlb = vec3(0.03, 0.04, 0.05); vRough = 0.1; vSky = 0.6; }
else if (vp >= 8.0) { vAlb = vec3(0.6, 0.3, 0.05); vRough = 0.25; vSky = 0.1; }
vRough = mix(vRough, vRough * 0.65, uWet);
diffuseColor.rgb = vAlb;
`;

const FRAG_EMISSIVE = /* glsl */ `
{
  float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  vec3 vEmit = vec3(0.0);
  if (vp == 3.0) vEmit = vec3(1.0, 0.94, 0.82) * uHeadOn * (1.5 + 20.0 * facing * facing * facing);
  else if (vp == 4.0) vEmit = vec3(1.0, 0.05, 0.03) * (uTailOn * 1.5 + vState.x * 7.0) * (0.45 + 0.55 * facing);
  else if (vp == 6.0) vEmit = vec3(1.0, 0.8, 0.3) * (0.5 + 2.4 * uTailOn);
  else if (vp == 7.0) vEmit = vec3(1.0, 0.9, 0.7) * uTailOn * 0.9;
  else if (vp == 8.0) vEmit = vec3(1.0, 0.42, 0.03) * vState.y * uBlink * 7.0;
  else if (vp == 9.0) vEmit = vec3(1.0, 0.42, 0.03) * vState.z * uBlink * 7.0;
  float inv = 1.0 - facing;
  float fres = 0.05 + 0.95 * inv * inv * inv * inv;
  totalEmissiveRadiance += vEmit + uSkyRefl * fres * vSky * 0.5;
}
`;

function createVehicleMaterial() {
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHeadOn = ext.uHeadOn;
    shader.uniforms.uTailOn = ext.uTailOn;
    shader.uniforms.uBlink = ext.uBlink;
    shader.uniforms.uWet = ext.uWet;
    shader.uniforms.uSkyRefl = ext.uSkyRefl;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = aPart;\nvPaint = aPaint;\nvState = aState;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRough;')
      .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE);
  };
  material.customProgramCacheKey = () => 'vehicle';
  return material;
}

/** Fixed pool of vehicle instances plus their headlight pools and contact shadows. */
export class VehicleFleet {
  constructor(count) {
    this.count = count;
    this.group = new Group();
    this.slots = [];
    this.meshes = {};
    const perType = {};
    for (let i = 0; i < count; i++) {
      const type = FLEET_PATTERN[i % FLEET_PATTERN.length];
      perType[type] = perType[type] || 0;
      this.slots.push({ type, index: perType[type]++, ...VEHICLE_TYPES[type] });
    }
    const material = createVehicleMaterial();
    for (const [type, n] of Object.entries(perType)) {
      const geometry = type === 'bus' ? busGeometry() : carGeometry(CAR_SPECS[type]);
      const paint = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
      const state = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
      state.setUsage(DynamicDrawUsage);
      geometry.setAttribute('aPaint', paint);
      geometry.setAttribute('aState', state);
      const mesh = new InstancedMesh(geometry, material, n);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.instanceMatrix.array.fill(0);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      this.meshes[type] = { mesh, paint, state };
      this.group.add(mesh);
    }
    this.beams = new DecalBatch(count, 'beam');
    this.blobs = new DecalBatch(count, 'blob');
    for (let i = 0; i < count; i++) {
      this.beams.setColor(i, 1.0, 0.93, 0.8);
      this.blobs.setColor(i, 1, 1, 1);
    }
    this.group.add(this.blobs.mesh, this.beams.mesh);
  }

  /** Picks a new paint colour for slot i (called when a vehicle respawns). */
  repaint(i, rng) {
    const slot = this.slots[i];
    const list = slot.type === 'bus' ? BUS_PAINTS : slot.type === 'van' ? VAN_PAINTS : PAINTS;
    const c = slot.type === 'taxi' ? TAXI_PAINT : rng.pick(list);
    const { paint } = this.meshes[slot.type];
    paint.array.set(c, slot.index * 3);
    paint.needsUpdate = true;
  }

  place(i, x, z, hx, hz, brake, blinkL, blinkR, beam, shadow) {
    const slot = this.slots[i];
    const { mesh, state } = this.meshes[slot.type];
    const m = mesh.instanceMatrix.array;
    const o = slot.index * 16;
    m[o] = hx; m[o + 1] = 0; m[o + 2] = hz; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = 1; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = -hz; m[o + 9] = 0; m[o + 10] = hx; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = 0; m[o + 14] = z; m[o + 15] = 1;
    const s = state.array;
    const so = slot.index * 4;
    s[so] = brake;
    s[so + 1] = blinkL;
    s[so + 2] = blinkR;
    const half = slot.length / 2;
    this.beams.set(i, x + hx * half, z + hz * half, hx, hz, slot.type === 'bus' ? 13 : 11, 6.5, beam, 0.035);
    this.blobs.set(i, x, z, hx, hz, slot.length + 0.9, slot.width + 0.7, shadow, 0.02);
  }

  hide(i) {
    const slot = this.slots[i];
    const { mesh } = this.meshes[slot.type];
    mesh.instanceMatrix.array.fill(0, slot.index * 16, slot.index * 16 + 16);
    this.beams.setIntensity(i, 0);
    this.blobs.setIntensity(i, 0);
  }

  commit() {
    for (const { mesh, state } of Object.values(this.meshes)) {
      mesh.instanceMatrix.needsUpdate = true;
      state.needsUpdate = true;
    }
    this.beams.commit();
    this.blobs.commit();
  }
}