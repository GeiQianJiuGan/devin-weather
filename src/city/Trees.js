import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { CURB_H } from '../core/layout.js';
import { Rng } from '../core/utils.js';
import { ext } from './sharedUniforms.js';

// Street trees. Each variant is grown once: a trunk that forks into limbs,
// branches and twigs (tapered tubes), and a crown of alpha-tested leaf-sprig
// cards hung on the twigs. The cards share crown-shaped shading normals, so the
// crown is lit as one soft volume instead of a pile of flat quads.

const VARIANTS = 4;

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const basis = (t) => {
  const a = norm(cross(t, Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
  return [a, cross(t, a)];
};

function barkTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  const rng = new Rng(77);
  g.fillStyle = '#6b5f52';
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 520; i++) {
    const x = rng.range(0, 128);
    const y = rng.range(-20, 256);
    const shade = rng.range(0, 1);
    g.strokeStyle = shade < 0.6 ? `rgba(28,22,17,${rng.range(0.25, 0.6)})` : `rgba(150,138,120,${rng.range(0.12, 0.3)})`;
    g.lineWidth = rng.range(0.8, 3);
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + rng.range(-5, 5), y + 14, x + rng.range(-5, 5), y + 28, x + rng.range(-4, 4), y + rng.range(30, 70));
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A twig carrying a dozen leaves, on a transparent background. */
function sprigTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S * 4;
  c.height = S * 4;
  const g = c.getContext('2d');
  g.scale(4, 4);
  const rng = new Rng(5);
  const leaf = (x, y, rot, len, wid, light) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    const grad = g.createLinearGradient(0, -wid, 0, wid);
    grad.addColorStop(0, `hsl(${88 + light * 10}, 22%, ${62 + light * 22}%)`);
    grad.addColorStop(1, `hsl(${96 + light * 8}, 26%, ${46 + light * 20}%)`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(len * 0.25, -wid, len * 0.7, -wid * 0.9, len, 0);
    g.bezierCurveTo(len * 0.7, wid * 0.9, len * 0.25, wid, 0, 0);
    g.fill();
    // darker rim so neighbouring leaves stay separate, then midrib and side veins
    g.strokeStyle = 'rgba(70,92,48,0.75)';
    g.lineWidth = 0.9;
    g.stroke();
    g.strokeStyle = 'rgba(235,245,215,0.6)';
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(len * 0.94, 0);
    g.stroke();
    g.strokeStyle = 'rgba(225,238,200,0.32)';
    g.lineWidth = 0.45;
    g.beginPath();
    for (let v = 1; v <= 5; v++) {
      const vx = (len * v) / 6.4;
      const reach = wid * 0.72 * Math.sin((v / 6.4) * Math.PI);
      g.moveTo(vx, 0);
      g.lineTo(vx + len * 0.1, -reach);
      g.moveTo(vx, 0);
      g.lineTo(vx + len * 0.1, reach);
    }
    g.stroke();
    g.restore();
  };
  for (let twig = 0; twig < 5; twig++) {
    const a0 = (twig / 5) * Math.PI * 2 + rng.range(-0.3, 0.3);
    g.strokeStyle = 'rgba(92,78,60,1)';
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(S / 2, S / 2);
    g.lineTo(S / 2 + Math.cos(a0) * 78, S / 2 + Math.sin(a0) * 78);
    g.stroke();
    for (let k = 0; k < 7; k++) {
      const d = 8 + k * 12 + rng.range(-3, 3);
      const side = k % 2 === 0 ? 1 : -1;
      leaf(
        S / 2 + Math.cos(a0) * d, S / 2 + Math.sin(a0) * d,
        a0 + side * rng.range(0.5, 1.15), rng.range(34, 48), rng.range(10, 14), rng.range(0, 1),
      );
    }
    leaf(S / 2 + Math.cos(a0) * 80, S / 2 + Math.sin(a0) * 80, a0 + rng.range(-0.2, 0.2), 42, 12, 0.8);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

function growTree(seed) {
  const rng = new Rng(seed);
  const wood = { p: [], n: [], uv: [], idx: [] };
  const anchors = [];

  const tube = (path, sides) => {
    const base = wood.p.length / 3;
    let along = 0;
    for (let i = 0; i < path.length; i++) {
      const a = path[Math.max(i - 1, 0)].pos;
      const b = path[Math.min(i + 1, path.length - 1)].pos;
      const t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      const [u, v] = basis(t);
      const { pos, r } = path[i];
      if (i > 0) along += Math.hypot(pos[0] - path[i - 1].pos[0], pos[1] - path[i - 1].pos[1], pos[2] - path[i - 1].pos[2]);
      for (let k = 0; k <= sides; k++) {
        const ang = (k / sides) * Math.PI * 2;
        const nx = u[0] * Math.cos(ang) + v[0] * Math.sin(ang);
        const ny = u[1] * Math.cos(ang) + v[1] * Math.sin(ang);
        const nz = u[2] * Math.cos(ang) + v[2] * Math.sin(ang);
        wood.p.push(pos[0] + nx * r, pos[1] + ny * r, pos[2] + nz * r);
        wood.n.push(nx, ny, nz);
        wood.uv.push((k / sides) * 2, along * 0.45);
      }
    }
    for (let i = 0; i < path.length - 1; i++) {
      for (let k = 0; k < sides; k++) {
        const a = base + i * (sides + 1) + k;
        const b = a + sides + 1;
        wood.idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  };

  const grow = (start, dir, length, r0, depth) => {
    const steps = depth === 0 ? 6 : depth === 1 ? 5 : 4;
    const r1 = depth === 3 ? 0.016 : r0 * 0.64;
    const bend = depth === 0 ? 0.06 : 0.24;
    const path = [];
    let pos = start;
    let d = dir;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      // root flare on the trunk
      const flare = depth === 0 ? 1 + 0.55 * Math.exp(-f * 9) : 1;
      path.push({ pos, r: (r0 + (r1 - r0) * f) * flare });
      if (depth >= 2 && i > 0) anchors.push(pos);
      if (i === steps) break;
      d = norm([d[0] + rng.range(-bend, bend), d[1] + rng.range(-bend, bend) * 0.5 + (depth > 0 ? 0.07 : 0), d[2] + rng.range(-bend, bend)]);
      const seg = length / steps;
      pos = [pos[0] + d[0] * seg, pos[1] + d[1] * seg, pos[2] + d[2] * seg];
      // side shoots part-way along limbs and branches
      if ((depth === 1 || depth === 2) && i >= 1 && rng.chance(0.42)) {
        const [u, v] = basis(d);
        const phi = rng.range(0, Math.PI * 2);
        const sp = rng.range(0.6, 1.0);
        const cd = norm([
          d[0] * Math.cos(sp) + (u[0] * Math.cos(phi) + v[0] * Math.sin(phi)) * Math.sin(sp),
          d[1] * Math.cos(sp) + (u[1] * Math.cos(phi) + v[1] * Math.sin(phi)) * Math.sin(sp) + 0.15,
          d[2] * Math.cos(sp) + (u[2] * Math.cos(phi) + v[2] * Math.sin(phi)) * Math.sin(sp),
        ]);
        grow(pos, cd, length * 0.5, path[i].r * 0.5, Math.min(depth + 2, 3));
      }
    }
    tube(path, depth === 0 ? 10 : depth === 1 ? 7 : depth === 2 ? 5 : 4);
    if (depth >= 3) return;
    const n = depth === 0 ? rng.int(3, 4) : rng.int(2, 3);
    const [u, v] = basis(d);
    const phi0 = rng.range(0, Math.PI * 2);
    for (let k = 0; k < n; k++) {
      const phi = phi0 + (k / n) * Math.PI * 2 + rng.range(-0.35, 0.35);
      const sp = depth === 0 ? rng.range(0.5, 0.82) : rng.range(0.42, 0.8);
      const cd = norm([
        d[0] * Math.cos(sp) + (u[0] * Math.cos(phi) + v[0] * Math.sin(phi)) * Math.sin(sp),
        d[1] * Math.cos(sp) + (u[1] * Math.cos(phi) + v[1] * Math.sin(phi)) * Math.sin(sp),
        d[2] * Math.cos(sp) + (u[2] * Math.cos(phi) + v[2] * Math.sin(phi)) * Math.sin(sp),
      ]);
      grow(pos, cd, length * (depth === 0 ? rng.range(0.62, 0.8) : rng.range(0.6, 0.78)), r1 * 0.82, depth + 1);
    }
    // the leader carries on upwards
    if (depth <= 1) grow(pos, norm([d[0] * 0.5, d[1] + 0.8, d[2] * 0.5]), length * 0.62, r1 * 0.8, depth + 1);
  };
  grow([0, 0, 0], norm([rng.range(-0.04, 0.04), 1, rng.range(-0.04, 0.04)]), rng.range(2.9, 3.4), rng.range(0.15, 0.19), 0);

  // --- crown ------------------------------------------------------------------------
  const centre = [0, 0, 0];
  for (const a of anchors) {
    centre[0] += a[0] / anchors.length;
    centre[1] += a[1] / anchors.length;
    centre[2] += a[2] / anchors.length;
  }
  let radius = 0;
  for (const a of anchors) radius = Math.max(radius, Math.hypot(a[0] - centre[0], a[1] - centre[1], a[2] - centre[2]));
  const leaf = { p: [], n: [], uv: [], c: [] };
  const DARK = [0.075, 0.14, 0.05];
  const LIGHT = [0.3, 0.44, 0.13];
  for (const a of anchors) {
    for (let k = 0; k < 9; k++) {
      const c = [a[0] + rng.range(-0.5, 0.5), a[1] + rng.range(-0.35, 0.45), a[2] + rng.range(-0.5, 0.5)];
      const out = norm([c[0] - centre[0], c[1] - centre[1] + 0.6, c[2] - centre[2]]);
      const face = norm([out[0] * 0.7 + rng.range(-0.9, 0.9), out[1] * 0.7 + rng.range(-0.5, 0.9), out[2] * 0.7 + rng.range(-0.9, 0.9)]);
      const [u, v] = basis(face);
      const s = rng.range(0.34, 0.56);
      const rot = rng.range(0, Math.PI * 2);
      const cu = Math.cos(rot) * s;
      const su = Math.sin(rot) * s;
      const ax = [u[0] * cu + v[0] * su, u[1] * cu + v[1] * su, u[2] * cu + v[2] * su];
      const ay = [v[0] * cu - u[0] * su, v[1] * cu - u[1] * su, v[2] * cu - u[2] * su];
      const corner = (sx, sy) => [c[0] + ax[0] * sx + ay[0] * sy, c[1] + ax[1] * sx + ay[1] * sy, c[2] + ax[2] * sx + ay[2] * sy];
      const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
      // outer and upper leaves catch the light, the inside of the crown stays dark
      const depthK = Math.hypot(c[0] - centre[0], c[1] - centre[1], c[2] - centre[2]) / radius;
      const k01 = Math.min(1, Math.max(0, 0.15 + 0.55 * depthK * depthK + 0.25 * out[1] + rng.range(-0.12, 0.16)));
      const tint = rng.range(-0.02, 0.03);
      const col = [DARK[0] + (LIGHT[0] - DARK[0]) * k01 + tint, DARK[1] + (LIGHT[1] - DARK[1]) * k01, DARK[2] + (LIGHT[2] - DARK[2]) * k01];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        leaf.p.push(...q[i]);
        leaf.n.push(...out);
        leaf.uv.push(...uvs[i]);
        leaf.c.push(...col);
      }
    }
  }

  const woodGeo = new BufferGeometry();
  woodGeo.setAttribute('position', new Float32BufferAttribute(wood.p, 3));
  woodGeo.setAttribute('normal', new Float32BufferAttribute(wood.n, 3));
  woodGeo.setAttribute('uv', new Float32BufferAttribute(wood.uv, 2));
  woodGeo.setIndex(wood.idx);
  const leafGeo = new BufferGeometry();
  leafGeo.setAttribute('position', new Float32BufferAttribute(leaf.p, 3));
  leafGeo.setAttribute('normal', new Float32BufferAttribute(leaf.n, 3));
  leafGeo.setAttribute('uv', new Float32BufferAttribute(leaf.uv, 2));
  leafGeo.setAttribute('color', new Float32BufferAttribute(leaf.c, 3));
  return { woodGeo, leafGeo };
}

const SWAY = /* glsl */ `
#include <begin_vertex>
#ifdef USE_INSTANCING
  float swayPhase = uTime * 1.6 + instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
#else
  float swayPhase = uTime * 1.6;
#endif
float swayAmp = uWind * smoothstep(1.5, 8.0, position.y);
transformed.x += (sin(swayPhase + position.y * 0.7) * 0.05 + sin(swayPhase * 2.7 + position.x * 2.1 + position.z * 1.3) * 0.02) * swayAmp;
transformed.z += (cos(swayPhase * 0.8 + position.y * 0.6) * 0.04 + sin(swayPhase * 3.1 + position.z * 2.3) * 0.02) * swayAmp;
`;

function leafMaterial() {
  const material = new MeshStandardMaterial({
    map: sprigTexture(), alphaTest: 0.45, side: DoubleSide, vertexColors: true, roughness: 0.72, metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = ext.uTime;
    shader.uniforms.uWind = ext.uWind;
    shader.uniforms.uSnow = ext.uSnow;
    shader.uniforms.uWet = ext.uWet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nvarying float vUpness;')
      .replace('#include <begin_vertex>', `${SWAY}\nvUpness = normal.y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnow;\nuniform float uWet;\nvarying float vUpness;')
      // the cards share crown-shaped normals: never flip them for back faces
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= 1.0 - 0.25 * uWet;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.93), uSnow * smoothstep(0.1, 0.75, vUpness) * 0.85);`,
      );
  };
  material.customProgramCacheKey = () => 'tree-leaves';
  return material;
}

function barkMaterial() {
  const material = new MeshStandardMaterial({ map: barkTexture(), roughness: 0.95, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = ext.uTime;
    shader.uniforms.uWind = ext.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', SWAY);
  };
  material.customProgramCacheKey = () => 'tree-bark';
  return material;
}

/** Builds every street tree at the given [x, z] spots. */
export function buildTrees(rng, spots) {
  const group = new Group();
  group.name = 'trees';
  const dummy = new Object3D();
  const leaves = leafMaterial();
  const bark = barkMaterial();
  const perVariant = Array.from({ length: VARIANTS }, () => []);
  spots.forEach((spot, i) => perVariant[i % VARIANTS].push(spot));

  const grates = new InstancedMesh(
    new BoxGeometry(1.5, 0.03, 1.5),
    new MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.8, metalness: 0.3 }),
    spots.length,
  );
  spots.forEach(([x, z], i) => {
    dummy.position.set(x, CURB_H + 0.012, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    grates.setMatrixAt(i, dummy.matrix);
  });
  grates.receiveShadow = true;
  grates.frustumCulled = false;
  group.add(grates);

  perVariant.forEach((list, variant) => {
    if (!list.length) return;
    const { woodGeo, leafGeo } = growTree(9100 + variant * 37);
    const wood = new InstancedMesh(woodGeo, bark, list.length);
    const crown = new InstancedMesh(leafGeo, leaves, list.length);
    list.forEach(([x, z], i) => {
      const s = rng.range(0.82, 1.12);
      dummy.position.set(x, CURB_H, z);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      dummy.scale.set(s, s * rng.range(0.94, 1.08), s);
      dummy.updateMatrix();
      wood.setMatrixAt(i, dummy.matrix);
      crown.setMatrixAt(i, dummy.matrix);
    });
    for (const mesh of [wood, crown]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
  });
  return group;
}
