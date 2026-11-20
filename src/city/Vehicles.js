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

// Low-poly vehicles built from tapered boxes. Every vertex carries a "part"
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

  /** Wheel with its axis along Z; `side` is +1 / -1 for the outward direction. */
  wheel(cx, cy, cz, r, halfW, side, segments = 14) {
    const zIn = cz - side * halfW;
    const zOut = cz + side * halfW;
    const ring = (i, radius, z) => {
      const a = (i / segments) * Math.PI * 2;
      return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, z];
    };
    for (let i = 0; i < segments; i++) {
      const z0 = Math.min(zIn, zOut);
      const z1 = Math.max(zIn, zOut);
      this.quad(ring(i, r, z0), ring(i + 1, r, z0), ring(i + 1, r, z1), ring(i, r, z1), PART.TRIM);
      const o0 = ring(i, r, zOut);
      const o1 = ring(i + 1, r, zOut);
      const h0 = ring(i, r * 0.6, zOut);
      const h1 = ring(i + 1, r * 0.6, zOut);
      const centre = [cx, cy, zOut + side * 0.012];
      if (side > 0) {
        this.quad(h0, o0, o1, h1, PART.TRIM);
        this.tri(centre, h0, h1, PART.HUB);
      } else {
        this.quad(h1, o1, o0, h0, PART.TRIM);
        this.tri(centre, h1, h0, PART.HUB);
      }
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

const CAR_SPECS = {
  sedan: {
    length: 4.6, width: 1.82, height: 1.44, clear: 0.2, midY: 0.52, beltY: 0.88, frontTuck: 0.2, rearTuck: 0.08,
    cabin: [-1.55, 0.72], roof: [-1.0, 0.1], roofTuck: 0.26, sideGlass: [[0.07, 0.47], [0.53, 0.93]], rearGlass: true,
    wheelR: 0.33, wheelX: 1.42,
  },
  hatch: {
    length: 4.1, width: 1.76, height: 1.5, clear: 0.2, midY: 0.52, beltY: 0.9, frontTuck: 0.2, rearTuck: 0.05,
    cabin: [-1.98, 0.68], roof: [-1.6, 0.12], roofTuck: 0.24, sideGlass: [[0.06, 0.4], [0.45, 0.9]], rearGlass: true,
    wheelR: 0.32, wheelX: 1.28,
  },
  suv: {
    length: 4.75, width: 1.92, height: 1.74, clear: 0.26, midY: 0.62, beltY: 1.04, frontTuck: 0.16, rearTuck: 0.05,
    cabin: [-2.25, 0.88], roof: [-2.05, 0.3], roofTuck: 0.2, sideGlass: [[0.05, 0.36], [0.4, 0.68], [0.72, 0.94]], rearGlass: true,
    wheelR: 0.38, wheelX: 1.46,
  },
  van: {
    length: 5.4, width: 2.0, height: 2.25, clear: 0.26, midY: 0.7, beltY: 1.2, frontTuck: 0.12, rearTuck: 0.02,
    cabin: [-2.66, 2.0], roof: [-2.64, 1.3], roofTuck: 0.1, sideGlass: [[0.05, 0.25]], rearGlass: false,
    wheelR: 0.37, wheelX: 1.75,
  },
};
CAR_SPECS.taxi = { ...CAR_SPECS.sedan, roofSign: true };

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

function carGeometry(s) {
  const b = new PartBuilder();
  const hw = s.width / 2;
  const x0 = -s.length / 2;
  const x1 = s.length / 2;
  b.frustum(s.clear, s.midY, [x0 + 0.1, x1 - 0.1, -hw + 0.07, hw - 0.07], [x0, x1, -hw, hw], PART.PAINT);
  const upper = b.frustum(
    s.midY, s.beltY, [x0, x1, -hw, hw], [x0 + s.rearTuck, x1 - s.frontTuck, -hw + 0.05, hw - 0.05], PART.PAINT, { noBottom: true },
  );
  const cabin = b.frustum(
    s.beltY, s.height, [s.cabin[0], s.cabin[1], -hw + 0.09, hw - 0.09],
    [s.roof[0], s.roof[1], -hw + s.roofTuck, hw - s.roofTuck], PART.PAINT, { noBottom: true },
  );
  b.panel(cabin.front, 0.06, 0.94, 0.1, 0.92, PART.GLASS);
  if (s.rearGlass) b.panel(cabin.back, 0.06, 0.94, 0.12, 0.9, PART.GLASS);
  for (const [sa, sb] of s.sideGlass) {
    b.panel(cabin.right, sa, sb, 0.12, 0.9, PART.GLASS);
    b.panel(cabin.left, 1 - sb, 1 - sa, 0.12, 0.9, PART.GLASS);
  }
  addLamps(b, upper.front, upper.back);
  for (const wx of [-s.wheelX, s.wheelX]) {
    b.wheel(wx, s.wheelR, hw - 0.09, s.wheelR, 0.11, 1);
    b.wheel(wx, s.wheelR, -hw + 0.09, s.wheelR, 0.11, -1);
  }
  if (s.roofSign) b.frustum(s.height, s.height + 0.14, [-0.52, -0.2, -0.24, 0.24], [-0.5, -0.22, -0.22, 0.22], PART.SIGN, { noBottom: true });
  return b.build();
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
  sedan: { length: 4.6, width: 1.82, speed: 1.0 },
  hatch: { length: 4.1, width: 1.76, speed: 1.02 },
  suv: { length: 4.75, width: 1.92, speed: 0.98 },
  van: { length: 5.4, width: 2.0, speed: 0.92 },
  taxi: { length: 4.6, width: 1.82, speed: 1.05 },
  bus: { length: BUS.length, width: BUS.width, speed: 0.8 },
};

const FLEET_PATTERN = [
  'sedan', 'suv', 'hatch', 'taxi', 'sedan', 'van', 'suv', 'sedan', 'hatch', 'bus', 'sedan', 'taxi', 'suv', 'hatch', 'van', 'sedan',
];

const PAINTS = [
  [0.82, 0.82, 0.8], [0.82, 0.82, 0.8], [0.5, 0.52, 0.55], [0.5, 0.52, 0.55], [0.2, 0.21, 0.23], [0.2, 0.21, 0.23],
  [0.03, 0.03, 0.035], [0.03, 0.03, 0.035], [0.05, 0.09, 0.22], [0.42, 0.04, 0.04], [0.07, 0.2, 0.46], [0.06, 0.18, 0.13],
  [0.55, 0.47, 0.36], [0.62, 0.22, 0.05],
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
float vSky = 0.3;
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