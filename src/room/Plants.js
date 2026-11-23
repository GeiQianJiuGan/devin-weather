import {
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  QuadraticBezierCurve3,
  SRGBColorSpace,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/utils.js';

// Potted house plants: a lathe-turned pot with a rim and soil, and leaves that
// are real curved blades (folded along the midrib, drooping towards the tip)
// on thin petioles, textured with procedural veins.

function broadLeafTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1024;
  const g = c.getContext('2d');
  g.scale(4, 4);
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, '#2c5a27');
  grad.addColorStop(0.5, '#3f7a35');
  grad.addColorStop(1, '#2a5625');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 256);
  const rng = new Rng(31);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${rng.int(20, 90)},${rng.int(90, 150)},${rng.int(20, 60)},0.07)`;
    g.fillRect(rng.range(0, 128), rng.range(0, 256), rng.range(4, 16), rng.range(4, 16));
  }
  g.strokeStyle = 'rgba(170,205,130,0.5)';
  g.lineWidth = 1.4;
  for (let y = 14; y < 250; y += 17) {
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(64, y);
      g.quadraticCurveTo(64 + s * 30, y + 10, 64 + s * 62, y + 34);
      g.stroke();
    }
  }
  g.strokeStyle = 'rgba(190,220,150,0.85)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(64, 0);
  g.lineTo(64, 256);
  g.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

/**
 * A leaf blade growing along +Z from the origin, upper side +Y.
 * `outline(u)` gives the half-width fraction at u in [0, 1].
 */
function leafGeometry({ length, width, fold, droop, twist = 0, outline, nu = 9, nv = 4 }) {
  const pos = [];
  const uv = [];
  const idx = [];
  let y = 0;
  let z = 0;
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    if (i > 0) {
      const ang = droop * (u - 0.5 / nu);
      y -= Math.sin(ang) * (length / nu);
      z += Math.cos(ang) * (length / nu);
    }
    const w = width * outline(u);
    const tw = twist * u;
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv) * 2 - 1;
      const lx = v * w;
      const ly = Math.abs(v) * w * fold + Math.sin(u * 9 + v * 2) * w * 0.05;
      pos.push(lx * Math.cos(tw) - ly * Math.sin(tw), y + lx * Math.sin(tw) + ly * Math.cos(tw), z);
      uv.push(j / nv, u);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j;
      const b = a + nv + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const OVATE = (u) => Math.sin(Math.PI * u ** 0.62) ** 0.85 * (1 - 0.25 * u) + 0.02;

function potMeshes(r, h, material, soilMat, saucerMat) {
  const rb = r * 0.74;
  const pts = [
    [0, 0], [rb, 0], [r * 0.97, h * 0.76], [r * 1.09, h * 0.76], [r * 1.1, h * 0.98],
    [r * 1.06, h], [r * 0.95, h], [r * 0.92, h * 0.8],
  ].map(([x, y]) => new Vector2(x, y));
  const meshes = [new Mesh(new LatheGeometry(pts, 40), material)];
  const soil = new Mesh(new CircleGeometry(r * 0.94, 32), soilMat);
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = h * 0.86;
  meshes.push(soil);
  if (saucerMat) {
    const sp = [[0, 0], [r * 0.95, 0], [r * 1.12, h * 0.1], [r * 1.07, h * 0.1], [r * 0.9, h * 0.035], [0, h * 0.035]].map(
      ([x, y]) => new Vector2(x, y),
    );
    meshes.push(new Mesh(new LatheGeometry(sp, 40), saucerMat));
    meshes[0].position.y = h * 0.035;
    soil.position.y += h * 0.035;
  }
  return meshes;
}

let shared;
function materials() {
  shared ??= {
    broad: new MeshStandardMaterial({ map: broadLeafTexture(), roughness: 0.56, metalness: 0, side: DoubleSide }),
    stem: new MeshStandardMaterial({ color: 0x55702f, roughness: 0.7 }),
    soil: new MeshStandardMaterial({ color: 0x2a1f17, roughness: 1 }),
    terracotta: new MeshStandardMaterial({ color: 0xa9603f, roughness: 0.88 }),
    ceramic: new MeshStandardMaterial({ color: 0xe6e2da, roughness: 0.28 }),
  };
  return shared;
}

function finish(group) {
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/** A bushy broad-leaved plant (rubber-plant like) in a terracotta pot with saucer. */
export function broadLeafPlant(seed, potR = 0.055, potH = 0.09) {
  const M = materials();
  const rng = new Rng(seed);
  const group = new Group();
  group.add(...potMeshes(potR, potH, M.terracotta, M.soil, M.terracotta));
  const soilY = potH * 0.9;
  const leaves = [];
  const stems = [];
  const dummy = new Object3D();
  dummy.rotation.order = 'YXZ';
  const N = 19;
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1); // 0 = outer/low ring, 1 = young upright centre leaves
    const phi = i * 2.39996 + rng.range(-0.25, 0.25);
    const reach = potR * (1.5 - 0.95 * f) * rng.range(0.85, 1.15);
    const rise = potR * (1.2 + 2.6 * f) * rng.range(0.9, 1.1);
    const base = new Vector3(Math.cos(phi) * potR * 0.25, soilY, Math.sin(phi) * potR * 0.25);
    const tip = new Vector3(Math.cos(phi) * reach, soilY + rise, Math.sin(phi) * reach);
    const ctrl = new Vector3(base.x * 1.2, soilY + rise * 0.85, base.z * 1.2);
    stems.push(new TubeGeometry(new QuadraticBezierCurve3(base, ctrl, tip), 8, potR * 0.028, 5));
    const length = potR * rng.range(1.5, 2.1) * (1 - 0.25 * f);
    const leaf = leafGeometry({
      length, width: length * rng.range(0.27, 0.33), fold: rng.range(0.18, 0.34), droop: rng.range(0.7, 1.5) * (1 - 0.5 * f), outline: OVATE,
    });
    dummy.position.copy(tip);
    dummy.rotation.set(-(0.25 + 0.75 * f) * rng.range(0.8, 1.15), Math.PI / 2 - phi, rng.range(-0.3, 0.3));
    dummy.updateMatrix();
    leaf.applyMatrix4(dummy.matrix);
    leaves.push(leaf);
  }
  group.add(new Mesh(mergeGeometries(leaves), M.broad), new Mesh(mergeGeometries(stems), M.stem));
  return finish(group);
}

/**
 * A full, leafy floor plant (ficus like): several canes rising from the pot, each carrying
 * leaves all the way up, over a skirt of low leaves that hides the soil.
 */
export function leafyPlant(seed, potR = 0.05, potH = 0.08) {
  const M = materials();
  const rng = new Rng(seed);
  const group = new Group();
  group.add(...potMeshes(potR, potH, M.ceramic, M.soil, null));
  const soilY = potH * 0.84;
  const leaves = [];
  const stems = [];
  const dummy = new Object3D();
  dummy.rotation.order = 'YXZ';
  const addLeaf = (at, phi, pitch, length, droop) => {
    const leaf = leafGeometry({
      length, width: length * rng.range(0.3, 0.38), fold: rng.range(0.14, 0.3), droop, outline: OVATE,
    });
    dummy.position.copy(at);
    dummy.rotation.set(pitch, Math.PI / 2 - phi, rng.range(-0.35, 0.35));
    dummy.updateMatrix();
    leaf.applyMatrix4(dummy.matrix);
    leaves.push(leaf);
  };
  const CANES = 11;
  for (let c = 0; c < CANES; c++) {
    const phi = c * 2.39996 + rng.range(-0.3, 0.3);
    // the first cane is the leader, the others lean outwards around it
    const lean = c === 0 ? 0.15 : rng.range(0.55, 1.25);
    const height = potR * (c === 0 ? 7.6 : rng.range(4.2, 6.6));
    const base = new Vector3(Math.cos(phi) * potR * 0.3, soilY, Math.sin(phi) * potR * 0.3);
    const tip = new Vector3(Math.cos(phi) * potR * lean * 2.2, soilY + height, Math.sin(phi) * potR * lean * 2.2);
    const ctrl = new Vector3(base.x * 1.3, soilY + height * 0.6, base.z * 1.3);
    const cane = new QuadraticBezierCurve3(base, ctrl, tip);
    stems.push(new TubeGeometry(cane, 10, potR * 0.05, 6));
    const n = Math.round(height / potR / 0.4);
    for (let i = 0; i < n; i++) {
      const t = 0.22 + 0.78 * (i / (n - 1));
      const at = cane.getPoint(t);
      // leaves spiral around the cane; the top ones stand up, the lower ones hang out
      const lphi = phi + i * 2.39996 + rng.range(-0.4, 0.4);
      const length = potR * rng.range(1.1, 1.65) * (1 - 0.3 * t);
      const out = new Vector3(Math.cos(lphi), 0.35 + 0.5 * t, Math.sin(lphi)).multiplyScalar(potR * 0.3);
      const from = at.clone().add(out);
      stems.push(new TubeGeometry(new QuadraticBezierCurve3(at, at.clone().addScaledVector(out, 0.5), from), 3, potR * 0.018, 4));
      addLeaf(from, lphi, -(0.15 + 0.7 * t) * rng.range(0.8, 1.2), length, rng.range(0.7, 1.4) * (1 - 0.4 * t));
    }
  }
  // skirt
  for (let i = 0; i < 20; i++) {
    const phi = i * 2.39996 + rng.range(-0.25, 0.25);
    const at = new Vector3(Math.cos(phi) * potR * 0.75, soilY + potR * rng.range(0.5, 1.1), Math.sin(phi) * potR * 0.75);
    stems.push(new TubeGeometry(new QuadraticBezierCurve3(new Vector3(at.x * 0.3, soilY, at.z * 0.3), new Vector3(at.x * 0.5, at.y, at.z * 0.5), at), 4, potR * 0.02, 4));
    addLeaf(at, phi, -rng.range(0.05, 0.35), potR * rng.range(1.5, 2.1), rng.range(1.0, 1.7));
  }
  group.add(new Mesh(mergeGeometries(leaves), M.broad), new Mesh(mergeGeometries(stems), M.stem));
  return finish(group);
}
