import {
  BoxGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Shape,
  Vector2,
} from 'three';
import { BUILD_LINE, CAMERA, CURB_H, CURB_RADIUS, GROUND_SIZE, ROAD_HALF, ROOM_ORIGIN } from '../core/layout.js';
import { createBuildingMaterial } from './BuildingMaterial.js';
import { DecalBatch } from './Decals.js';
import { createGroundMaterial } from './GroundMaterial.js';
import { makeBillboardTexture, makeSignTexture } from './signs.js';

// Procedural city around the intersection: ground, sidewalks, instanced
// buildings (deterministic layout), rooftop clutter and a few luminous signs.

const BLOCKS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

const TINTS = {
  residential: [[0.36, 0.2, 0.15], [0.62, 0.55, 0.45], [0.7, 0.69, 0.66], [0.52, 0.32, 0.24], [0.4, 0.42, 0.37], [0.5, 0.46, 0.42]],
  office: [[0.46, 0.46, 0.45], [0.17, 0.18, 0.2], [0.28, 0.33, 0.4], [0.58, 0.57, 0.55]],
  glass: [[0.2, 0.32, 0.42], [0.16, 0.22, 0.3], [0.3, 0.4, 0.42], [0.24, 0.24, 0.3]],
};

// kind 0: punched windows (residential), 1: ribbon windows (office), 2: curtain wall
function styleFor(kind, rng) {
  if (kind === 0) {
    return { style: [rng.range(2.6, 3.4), rng.range(3.0, 3.3), rng.range(0.38, 0.55), rng.range(0.45, 0.6)], tint: rng.pick(TINTS.residential), lit: rng.range(0.35, 0.7) };
  }
  if (kind === 1) {
    return { style: [rng.range(2.2, 3.2), rng.range(3.5, 3.9), rng.range(0.7, 0.9), rng.range(0.5, 0.62)], tint: rng.pick(TINTS.office), lit: rng.range(0.3, 0.75) };
  }
  return { style: [rng.range(1.6, 2.2), rng.range(3.6, 4.0), 0.9, 0.86], tint: rng.pick(TINTS.glass), lit: rng.range(0.25, 0.6) };
}

const CORNERS = {
  '-1,-1': { w: 20, d: 20, h: 24.5, kind: 0 }, // residential over shops, across the avenue
  '1,-1': { w: 22, d: 18.6, h: 8.9, kind: 0 }, // low commercial corner facing the window
  '1,1': { w: 22, d: 19, h: 33, kind: 1 }, // office block across the street
  '-1,1': { w: 20, d: 17, h: 27, kind: 0 }, // the apartment building itself
};

function generateBuildings(rng) {
  const list = [];
  const cam = {
    x: ROOM_ORIGIN.x + CAMERA.position.x,
    y: ROOM_ORIGIN.y + CAMERA.position.y,
    z: ROOM_ORIGIN.z + CAMERA.position.z,
  };
  // Keeps a varied but open skyline in the direction the window faces.
  const skylineCap = (x, z, h, reach) => {
    const dx = x - cam.x;
    const dz = z - cam.z;
    const dist = Math.hypot(dx, dz);
    const az = (Math.atan2(dx, -dz) * 180) / Math.PI;
    if (az > 22 && az < 74 && dist < reach) {
      return Math.min(h, cam.y + dist * Math.tan((rng.range(8.5, 20) * Math.PI) / 180));
    }
    return h;
  };
  const add = (b) => {
    const entry = { rot: 0, shop: 0, fronts: [], ...b, seed: rng.range(1, 90) };
    list.push(entry);
    return entry;
  };

  for (const [sx, sz] of BLOCKS) {
    const c = CORNERS[`${sx},${sz}`];
    const corner = add({
      x: sx * (BUILD_LINE + c.w / 2), z: sz * (BUILD_LINE + c.d / 2), w: c.w, d: c.d, h: c.h, kind: c.kind, shop: 1,
      ...styleFor(c.kind, rng), fronts: [[0, -sz], [-sx, 0]],
    });
    if (sx === 1 && sz === -1) Object.assign(corner, { style: [3.6, 3.5, 0.72, 0.62], tint: [0.56, 0.48, 0.4], lit: 1.4 });

    // frontage along the avenue (row grows along X) and along the cross street (row grows along Z)
    for (const alongX of [true, false]) {
      let off = BUILD_LINE + (alongX ? c.w : c.d) + 0.4;
      let first = true;
      while (off < 330) {
        const w = rng.range(14, 26);
        const d = rng.range(15, 22);
        const near = off < 75;
        const kind = near ? (rng.chance(0.6) ? 0 : 1) : rng.int(0, 2);
        let h = near ? rng.range(13, 32) : rng.range(20, 58);
        const x = alongX ? sx * (off + w / 2) : sx * (BUILD_LINE + d / 2);
        const z = alongX ? sz * (BUILD_LINE + d / 2) : sz * (off + w / 2);
        h = skylineCap(x, z, h, 210);
        if (first && sx === 1 && sz === -1) h = Math.min(h, rng.range(12.5, 15.5));
        h = Math.max(h, 8.5);
        add({
          x, z, w: alongX ? w : d, d: alongX ? d : w, h, kind, shop: rng.chance(0.8) ? 1 : 0,
          ...styleFor(kind, rng), fronts: [alongX ? [0, -sz] : [-sx, 0]],
        });
        off += w + (rng.chance(0.15) ? rng.range(3, 5) : 0.4);
        first = false;
      }
    }

    // towers inside the block
    for (let gx = BUILD_LINE + 34; gx < 340; gx += 40) {
      for (let gz = BUILD_LINE + 34; gz < 340; gz += 40) {
        if (!rng.chance(0.8)) continue;
        const x = sx * (gx + rng.range(-6, 6));
        const z = sz * (gz + rng.range(-6, 6));
        const fp = rng.range(20, 32);
        let h = rng.chance(0.12) ? rng.range(130, 185) : rng.range(34, 110);
        h = skylineCap(x, z, h, 330);
        const kind = rng.chance(0.55) ? 2 : 1;
        const tower = add({ x, z, w: fp, d: fp * rng.range(0.8, 1.2), h, kind, ...styleFor(kind, rng) });
        if (h > 90 && rng.chance(0.7)) {
          add({ ...tower, w: tower.w * 0.6, d: tower.d * 0.6, h: h + rng.range(8, 20) });
        }
      }
    }
  }

  // distant skyline ring; the road axes stay open so the avenues fade into haze
  for (let i = 0; i < 90; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(380, 660);
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    if (Math.abs(x) < 34 || Math.abs(z) < 34) continue;
    const fp = rng.range(26, 46);
    const kind = rng.chance(0.5) ? 2 : 1;
    add({ x, z, w: fp, d: fp, h: rng.range(40, 150), rot: rng.range(0, Math.PI), kind, ...styleFor(kind, rng) });
  }
  // Break up the plain boxes of the taller towers: stepped setbacks, a plant-room
  // block and a mast. Derived from each tower's own seed so the layout RNG is untouched.
  const frac = (v) => v - Math.floor(v);
  for (const b of list.slice()) {
    if (b.h < 44 || b.shop) continue;
    const k1 = frac(b.seed * 7.31);
    const k2 = frac(b.seed * 3.77);
    const k3 = frac(b.seed * 11.13);
    let top = b.h;
    let w = b.w;
    let d = b.d;
    if (k1 < 0.6) {
      const tiers = k2 < 0.4 ? 2 : 1;
      for (let t = 0; t < tiers; t++) {
        w *= 0.74;
        d *= 0.74;
        top += (5 + 9 * frac(k2 * 13 + t * 0.37)) * (b.h > 90 ? 1.6 : 1);
        list.push({ ...b, w, d, h: top, seed: b.seed + 0.5 + t });
      }
    }
    const plain = { ...b, style: [99, 999, 0, 0], kind: 1, lit: 0, tint: [b.tint[0] * 0.6 + 0.08, b.tint[1] * 0.6 + 0.08, b.tint[2] * 0.6 + 0.09] };
    const ox = (k3 - 0.5) * w * 0.3;
    const oz = (k2 - 0.5) * d * 0.3;
    const c = Math.cos(b.rot);
    const sn = Math.sin(b.rot);
    const px = b.x + ox * c + oz * sn;
    const pz = b.z - ox * sn + oz * c;
    list.push({ ...plain, x: px, z: pz, w: w * 0.5, d: d * 0.42, h: top + 3.2 + 2 * k3 });
    if (k3 > 0.45) list.push({ ...plain, x: px, z: pz, w: 0.7, d: 0.7, h: top + 12 + 26 * k1 * (b.h > 90 ? 1.5 : 1) });
  }
  // instances are drawn in buffer order: front to back from the fixed camera lets the depth test reject hidden facades
  const toCamera = (b) => Math.hypot(b.x - cam.x, b.z - cam.z) - Math.hypot(b.w, b.d) / 2;
  return list.sort((a, b) => toCamera(a) - toCamera(b));
}

function sidewalkGeometry(sx, sz) {
  const far = GROUND_SIZE / 2;
  const pts = [];
  const cx = sx * (ROAD_HALF + CURB_RADIUS);
  const cz = sz * (ROAD_HALF + CURB_RADIUS);
  pts.push([sx * far, sz * ROAD_HALF], [sx * far, sz * far], [sx * ROAD_HALF, sz * far]);
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    pts.push([cx - sx * CURB_RADIUS * Math.cos(a), cz - sz * CURB_RADIUS * Math.sin(a)]);
  }
  const shape = new Shape(pts.map(([x, z]) => new Vector2(x, -z)));
  const geometry = new ExtrudeGeometry(shape, { depth: CURB_H, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function signMesh(texture, width, height, { x, y, z, rotY = 0, doubleSided = false }) {
  const material = new MeshBasicMaterial({ map: texture, toneMapped: false });
  if (doubleSided) material.side = DoubleSide;
  const mesh = new Mesh(new PlaneGeometry(width, height), material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  return mesh;
}

export function buildCity(rng) {
  const group = new Group();
  group.name = 'city';

  // --- ground ---------------------------------------------------------------
  const road = new Mesh(new PlaneGeometry(GROUND_SIZE, GROUND_SIZE), createGroundMaterial('road'));
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  road.renderOrder = 20;
  group.add(road);

  const sidewalkMaterial = createGroundMaterial('sidewalk');
  for (const [sx, sz] of BLOCKS) {
    const slab = new Mesh(sidewalkGeometry(sx, sz), sidewalkMaterial);
    slab.receiveShadow = true;
    slab.renderOrder = 10;
    group.add(slab);
  }

  // --- buildings --------------------------------------------------------------
  const list = generateBuildings(rng);
  const box = new BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const n = list.length;
  const aSize = new Float32Array(n * 3);
  const aStyle = new Float32Array(n * 4);
  const aTint = new Float32Array(n * 3);
  const aMisc = new Float32Array(n * 4);
  const buildings = new InstancedMesh(box, createBuildingMaterial(), n);
  const dummy = new Object3D();
  list.forEach((b, i) => {
    dummy.position.set(b.x, 0, b.z);
    dummy.rotation.set(0, b.rot, 0);
    dummy.scale.set(b.w, b.h, b.d);
    dummy.updateMatrix();
    buildings.setMatrixAt(i, dummy.matrix);
    aSize.set([b.w, b.h, b.d], i * 3);
    aStyle.set(b.style, i * 4);
    aTint.set(b.tint, i * 3);
    aMisc.set([b.seed, b.lit, b.shop, b.kind], i * 4);
  });
  box.setAttribute('aSize', new InstancedBufferAttribute(aSize, 3));
  box.setAttribute('aStyle', new InstancedBufferAttribute(aStyle, 4));
  box.setAttribute('aTint', new InstancedBufferAttribute(aTint, 3));
  box.setAttribute('aMisc', new InstancedBufferAttribute(aMisc, 4));
  buildings.instanceMatrix.needsUpdate = true;
  buildings.castShadow = true;
  buildings.receiveShadow = true;
  buildings.frustumCulled = false;
  group.add(buildings);

  // --- rooftop clutter ----------------------------------------------------------
  const clutter = [];
  for (const b of list) {
    const dist = Math.hypot(b.x, b.z);
    if (dist > 170 || b.h > 70 || b.rot !== 0) continue;
    const count = rng.int(1, 3);
    for (let k = 0; k < count; k++) {
      const w = rng.range(1.4, 4);
      const d = rng.range(1.4, 3);
      clutter.push({
        x: b.x + rng.range(-0.5, 0.5) * Math.max(0, b.w - w - 3),
        z: b.z + rng.range(-0.5, 0.5) * Math.max(0, b.d - d - 3),
        y: b.h,
        w, d, h: rng.range(0.9, 2.4),
      });
    }
  }
  const clutterGeo = new BoxGeometry(1, 1, 1);
  clutterGeo.translate(0, 0.5, 0);
  const roofClutter = new InstancedMesh(clutterGeo, new MeshStandardMaterial({ color: 0x5a5d61, roughness: 0.85 }), clutter.length);
  clutter.forEach((c, i) => {
    dummy.position.set(c.x, c.y, c.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(c.w, c.h, c.d);
    dummy.updateMatrix();
    roofClutter.setMatrixAt(i, dummy.matrix);
  });
  roofClutter.castShadow = true;
  roofClutter.frustumCulled = false;
  group.add(roofClutter);

  // --- signs ------------------------------------------------------------------------
  const signs = [];
  const addSign = (mesh, night = 3.0) => {
    group.add(mesh);
    signs.push({ mesh, night });
    return mesh;
  };
  const hero = CORNERS['1,-1'];
  const dark = new MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 });

  const billboard = addSign(signMesh(makeBillboardTexture(), 10, 3.75, { x: 14.6, y: hero.h + 2.75, z: -14.6, rotY: -Math.PI / 4 }), 2.4);
  const frame = new Mesh(new BoxGeometry(10.3, 4.05, 0.25), dark);
  frame.position.copy(billboard.position).add({ x: 0.13, y: 0, z: -0.13 });
  frame.rotation.y = -Math.PI / 4;
  frame.castShadow = true;
  group.add(frame);
  for (const t of [-3.6, 0, 3.6]) {
    const leg = new Mesh(new BoxGeometry(0.16, 1.1, 0.16), dark);
    leg.position.set(14.75 + t * Math.SQRT1_2, hero.h + 0.5, -14.75 + t * Math.SQRT1_2);
    group.add(leg);
  }

  addSign(signMesh(makeSignTexture({ text: 'CAFE LUMEN', width: 768, height: 112, bg: '#140c06', fg: '#ffd9a0' }), 5.4, 0.78, { x: 17.2, y: 3.66, z: -BUILD_LINE + 0.07 }), 3.4);
  addSign(signMesh(makeSignTexture({ text: 'NOODLE BAR', width: 768, height: 112, bg: '#16060a', fg: '#ff5a70' }), 5.2, 0.78, { x: BUILD_LINE - 0.07, y: 3.66, z: -19.5, rotY: -Math.PI / 2 }), 3.6);
  addSign(signMesh(makeSignTexture({ text: 'HOTEL', width: 160, height: 800, bg: '#12060c', fg: '#ff3d6a', vertical: true, border: '#ff3d6a' }), 1.5, 7.5, { x: -BUILD_LINE + 0.95, y: 12.2, z: -12.6, doubleSided: true }), 3.2);
  addSign(signMesh(makeSignTexture({ text: 'BAR', width: 160, height: 520, bg: '#041212', fg: '#3df0e0', vertical: true, border: '#3df0e0' }), 1.3, 4.4, { x: 38, y: 8.2, z: -BUILD_LINE + 0.85, rotY: -Math.PI / 2, doubleSided: true }), 3.2);
  addSign(signMesh(makeSignTexture({ text: 'CINEMA', width: 160, height: 900, bg: '#120c02', fg: '#ffb53d', vertical: true, border: '#ffb53d' }), 1.4, 8, { x: BUILD_LINE - 0.9, y: 11, z: -39, doubleSided: true }), 3.0);

  // --- warm light spilling from shop fronts onto the pavement -------------------------------
  const spill = [];
  for (const b of list) {
    if (!b.shop || Math.hypot(b.x, b.z) > 110) continue;
    for (const [nx, nz] of b.fronts) {
      const length = nx === 0 ? b.w : b.d;
      const count = Math.max(1, Math.round(length / 5.5));
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) / count - 0.5;
        const fx = b.x + (nx === 0 ? t * b.w : (nx * b.w) / 2);
        const fz = b.z + (nz === 0 ? t * b.d : (nz * b.d) / 2);
        spill.push({ x: fx + nx * 2.4, z: fz + nz * 2.4, warm: rng.next(), power: rng.range(0.5, 1) });
      }
    }
  }
  const shopSpill = new DecalBatch(spill.length, 'pool', false);
  spill.forEach((s, i) => {
    shopSpill.set(i, s.x, s.z, 1, 0, 9, 9, 0, CURB_H + 0.025);
    shopSpill.setColor(i, 1.0, 0.72 + 0.2 * s.warm, 0.45 + 0.4 * s.warm);
    s.index = i;
  });
  shopSpill.commit();
  group.add(shopSpill.mesh);

  return { group, road, buildings, signs, shopSpill, spill, buildingCount: n };
}