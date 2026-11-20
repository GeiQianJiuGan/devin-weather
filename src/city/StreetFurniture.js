import {
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
} from 'three';
import { CURB_H, ROAD_HALF } from '../core/layout.js';
import { DecalBatch } from './Decals.js';
import { makeRoadSignTexture, makeSignTexture } from './signs.js';

// Streetlights, traffic signals, road signs and street trees.

export const STREETLIGHT_COLOR = new Color(1.0, 0.74, 0.46);
const LAMP_HEIGHT = 8.3;

function streetlightLayout() {
  const out = [];
  for (const s of [-1, 1]) {
    for (let k = 0; k < 10; k++) {
      // avenue (along X), alternating sides
      const sideA = (k % 2 === 0 ? 1 : -1) * s;
      out.push({ x: s * (16 + k * 30), z: sideA * (ROAD_HALF + 1.0), ax: 0, az: -sideA });
      // cross street (along Z)
      const sideB = (k % 2 === 0 ? -1 : 1) * s;
      out.push({ x: sideB * (ROAD_HALF + 1.0), z: s * (16 + k * 30), ax: -sideB, az: 0 });
    }
  }
  for (const l of out) {
    l.hx = l.x + l.ax * 2.4;
    l.hz = l.z + l.az * 2.4;
    l.dist = Math.hypot(l.hx, l.hz);
  }
  return out.sort((a, b) => a.dist - b.dist);
}

// Mast arms: one per approach, two heads each (far-side, except the southbound one).
// approach 0: eastbound, 1: northbound, 2: westbound, 3: southbound
const MASTS = [
  { approach: 0, pole: [9.0, 9.4], arm: [0, -1], armLen: 8.7, heads: [[9.0, 5.25], [9.0, 1.75]], face: [-1, 0] },
  { approach: 1, pole: [9.4, -9.0], arm: [-1, 0], armLen: 8.7, heads: [[5.25, -9.0], [1.75, -9.0]], face: [0, 1] },
  { approach: 2, pole: [-9.2, -9.2], arm: [0, 1], armLen: 8.5, heads: [[-9.2, -5.25], [-9.2, -1.75]], face: [1, 0] },
  { approach: 3, pole: [-9.2, -9.2], arm: [1, 0], armLen: 8.5, heads: [[-5.25, -9.2], [-1.75, -9.2]], face: [0, -1] },
];
const MAST_H = 7.3;
const HEAD_Y = 6.55;

const SIGNAL_COLORS = {
  red: new Color(1.0, 0.07, 0.04),
  yellow: new Color(1.0, 0.62, 0.05),
  green: new Color(0.08, 1.0, 0.45),
};

export function buildStreetFurniture(rng, realLightCount) {
  const group = new Group();
  group.name = 'street-furniture';
  const dummy = new Object3D();
  const metal = new MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.55, metalness: 0.4 });
  const place = (mesh, i, x, y, z, rotY = 0, sx = 1, sy = 1, sz = 1) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };

  // --- streetlights -----------------------------------------------------------------
  const lamps = streetlightLayout();
  const n = lamps.length;
  const poleGeo = new CylinderGeometry(0.07, 0.11, LAMP_HEIGHT, 8);
  poleGeo.translate(0, LAMP_HEIGHT / 2, 0);
  const poles = new InstancedMesh(poleGeo, metal, n);
  const armGeo = new BoxGeometry(1, 0.09, 0.11);
  armGeo.translate(0.5, 0, 0);
  const arms = new InstancedMesh(armGeo, metal, n);
  const heads = new InstancedMesh(new BoxGeometry(0.78, 0.13, 0.3), metal, n);
  const bulbMaterial = new MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const bulbs = new InstancedMesh(new BoxGeometry(0.56, 0.04, 0.22), bulbMaterial, n);
  lamps.forEach((l, i) => {
    const rot = Math.atan2(-l.az, l.ax);
    place(poles, i, l.x, CURB_H, l.z);
    place(arms, i, l.x, CURB_H + LAMP_HEIGHT - 0.05, l.z, rot, 2.5, 1, 1);
    place(heads, i, l.hx, CURB_H + LAMP_HEIGHT - 0.03, l.hz, rot);
    place(bulbs, i, l.hx, CURB_H + LAMP_HEIGHT - 0.115, l.hz, rot);
  });
  for (const mesh of [poles, arms, heads, bulbs]) {
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  poles.castShadow = true;

  const lights = [];
  for (let i = 0; i < Math.min(realLightCount, n); i++) {
    const light = new PointLight(STREETLIGHT_COLOR, 0, 46, 2);
    light.position.set(lamps[i].hx, CURB_H + LAMP_HEIGHT - 0.3, lamps[i].hz);
    lights.push(light);
    group.add(light);
  }
  // Lamps without an active real light get a painted pool of light on the road and one on the pavement.
  const pools = new DecalBatch(lamps.length * 2, 'pool', false);
  lamps.forEach((l, i) => {
    pools.set(i * 2, l.hx, l.hz, 1, 0, 26, 26, 0, 0.03);
    pools.set(i * 2 + 1, l.x, l.z, l.az === 0 ? 0 : 1, l.az === 0 ? 1 : 0, 20, 7, 0, CURB_H + 0.03);
    pools.setColor(i * 2, STREETLIGHT_COLOR.r, STREETLIGHT_COLOR.g, STREETLIGHT_COLOR.b);
    pools.setColor(i * 2 + 1, STREETLIGHT_COLOR.r, STREETLIGHT_COLOR.g, STREETLIGHT_COLOR.b);
  });
  pools.commit();
  group.add(pools.mesh);

  // --- traffic signals -----------------------------------------------------------------
  const mastPoleGeo = new CylinderGeometry(0.1, 0.15, MAST_H + 0.2, 10);
  mastPoleGeo.translate(0, (MAST_H + 0.2) / 2, 0);
  const mastPoles = new InstancedMesh(mastPoleGeo, metal, MASTS.length);
  const mastArmGeo = new BoxGeometry(1, 0.14, 0.14);
  mastArmGeo.translate(0.5, 0, 0);
  const mastArms = new InstancedMesh(mastArmGeo, metal, MASTS.length);
  const housingMat = new MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.6 });
  const housings = new InstancedMesh(new BoxGeometry(0.4, 1.2, 0.28), housingMat, MASTS.length * 2);
  const hangers = new InstancedMesh(new BoxGeometry(0.06, 0.3, 0.06), metal, MASTS.length * 2);
  const plates = new InstancedMesh(new BoxGeometry(0.58, 1.38, 0.03), housingMat, MASTS.length * 2);
  const lampGeo = new CircleGeometry(0.135, 20);
  const lampMeshes = [0, 1].map(() => ({}));
  const lampMaterials = [0, 1].map(() => ({}));
  for (const axis of [0, 1]) {
    for (const key of ['red', 'yellow', 'green']) {
      const material = new MeshBasicMaterial({ color: 0x000000, toneMapped: false });
      const mesh = new InstancedMesh(lampGeo, material, 4);
      mesh.frustumCulled = false;
      lampMaterials[axis][key] = material;
      lampMeshes[axis][key] = mesh;
      group.add(mesh);
    }
  }
  const lampCursor = [0, 0];
  MASTS.forEach((m, i) => {
    place(mastPoles, i, m.pole[0], CURB_H, m.pole[1]);
    place(mastArms, i, m.pole[0], CURB_H + MAST_H, m.pole[1], Math.atan2(-m.arm[1], m.arm[0]), m.armLen, 1, 1);
    const axis = m.approach % 2;
    const rot = Math.atan2(m.face[0], m.face[1]); // rotates +Z onto the facing direction
    m.heads.forEach(([hx, hz], k) => {
      const j = i * 2 + k;
      place(housings, j, hx, HEAD_Y, hz, rot);
      place(hangers, j, hx, HEAD_Y + 0.72, hz, rot);
      place(plates, j, hx - m.face[0] * 0.12, HEAD_Y, hz - m.face[1] * 0.12, rot);
      const li = lampCursor[axis]++;
      const lx = hx + m.face[0] * 0.146;
      const lz = hz + m.face[1] * 0.146;
      place(lampMeshes[axis].red, li, lx, HEAD_Y + 0.4, lz, rot);
      place(lampMeshes[axis].yellow, li, lx, HEAD_Y, lz, rot);
      place(lampMeshes[axis].green, li, lx, HEAD_Y - 0.4, lz, rot);
    });
  });
  for (const mesh of [mastPoles, mastArms, housings, hangers, plates]) {
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  mastPoles.castShadow = true;

  // --- signs ------------------------------------------------------------------------------
  const blade = (text, x, y, z, rotY) => {
    const tex = makeSignTexture({ text, width: 512, height: 96, bg: '#0d5a35', fg: '#f2f6f2', glow: 'rgba(0,0,0,0)', weight: 700 });
    const mesh = new Mesh(new PlaneGeometry(2.4, 0.45), new MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    group.add(mesh);
  };
  blade('MERIDIAN AVE', 3.5, CURB_H + MAST_H - 0.42, -8.9, 0);
  blade('HARBOR ST', 8.9, CURB_H + MAST_H - 0.42, 3.5, -Math.PI / 2);

  const postGeo = new CylinderGeometry(0.035, 0.035, 2.6, 6);
  postGeo.translate(0, 1.3, 0);
  const signSpecs = [
    { kind: 'speed', x: 9.0, z: -26, rotY: 0 },
    { kind: 'parking', x: -20, z: -9.0, rotY: 0 },
    { kind: 'bus', x: 30, z: -9.2, rotY: -Math.PI / 2 },
  ];
  for (const s of signSpecs) {
    const post = new Mesh(postGeo, metal);
    post.position.set(s.x, CURB_H, s.z);
    const plate = new Mesh(
      new PlaneGeometry(0.62, 0.62),
      new MeshStandardMaterial({ map: makeRoadSignTexture(s.kind), roughness: 0.5 }),
    );
    plate.position.set(s.x, CURB_H + 2.35, s.z);
    plate.rotation.y = s.rotY;
    plate.translateZ(0.045);
    group.add(post, plate);
  }

  // --- trees ---------------------------------------------------------------------------------
  const treeSpots = [
    [28, -9.2], [44, -9.3], [61, -9.1], [-27, -9.2], [-44, -9.3], [9.2, -31], [9.3, -47], [9.1, -63],
    [-9.2, -33], [-9.3, -52], [27, 9.2], [45, 9.3], [9.2, 30], [9.3, 47], [-9.2, 34], [-30, 9.3], [-48, 9.2],
  ];
  const trunkGeo = new CylinderGeometry(0.1, 0.16, 3.2, 6);
  trunkGeo.translate(0, 1.6, 0);
  const trunks = new InstancedMesh(trunkGeo, new MeshStandardMaterial({ color: 0x2c2118, roughness: 0.9 }), treeSpots.length);
  const crowns = new InstancedMesh(
    new IcosahedronGeometry(1, 1),
    new MeshStandardMaterial({ color: 0x2f4a26, roughness: 0.95, flatShading: true }),
    treeSpots.length * 3,
  );
  treeSpots.forEach(([x, z], i) => {
    const s = rng.range(0.85, 1.25);
    place(trunks, i, x, CURB_H, z, rng.range(0, 3), s, s, s);
    for (let k = 0; k < 3; k++) {
      const r = rng.range(1.1, 1.7) * s;
      place(
        crowns, i * 3 + k,
        x + rng.range(-0.8, 0.8) * s, CURB_H + (3.4 + k * 0.9 + rng.range(-0.2, 0.2)) * s, z + rng.range(-0.8, 0.8) * s,
        rng.range(0, 3), r, r * rng.range(0.75, 0.95), r,
      );
    }
  });
  trunks.castShadow = true;
  crowns.castShadow = true;
  trunks.frustumCulled = false;
  crowns.frustumCulled = false;
  group.add(trunks, crowns);

  return {
    group,
    lamps,
    lights,
    pools,
    bulbMaterial,
    lampMaterials,
    signalColors: SIGNAL_COLORS,
    lampHeight: CURB_H + LAMP_HEIGHT - 0.3,
  };
}