import {
  BackSide,
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  RectAreaLight,
  SphereGeometry,
  SpotLight,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { ROOM, ROOM_ORIGIN } from '../core/layout.js';
import { Rng } from '../core/utils.js';
import { ScreenContent, contactShadowTexture, keyboardTexture, paperTexture, rugTexture, woodFloorTexture } from './textures.js';

// The bedroom: shell with a corner window, bed, white desk with computer,
// chair, lamp and a few small objects, plus all interior light sources.
// Local frame: origin at the glass corner on the floor, room extends to -X / +Z.

const UP = new Vector3(0, 1, 0);

function duvetGeometry(w, l, drop) {
  const g = new PlaneGeometry(w + 2 * drop, l + drop, 44, 36);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, (l + drop) / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let z = p.getZ(i);
    let y = 0.014 * Math.sin(x * 7 + z * 3.1) + 0.01 * Math.sin(z * 11 - x * 4.3) + 0.006 * Math.sin(x * 19 + 1.3) * Math.sin(z * 15);
    y += 0.03 * Math.exp(-z * 6);
    const ox = Math.abs(x) - w / 2;
    if (ox > 0) {
      y -= ((ox * ox) / (ox + 0.04)) * 0.92;
      x = Math.sign(x) * (w / 2 + ox * 0.22);
    }
    const oz = z - l;
    if (oz > 0) {
      y -= ((oz * oz) / (oz + 0.04)) * 0.92;
      z = l + oz * 0.22;
    }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

function pillowGeometry(w, h, d) {
  const g = new SphereGeometry(0.5, 32, 20);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const n = Math.pow(Math.abs(x) ** 4 + Math.abs(y) ** 4 + Math.abs(z) ** 4, 0.25) || 1;
    x = (x / n) * 0.5;
    y = (y / n) * 0.5;
    z = (z / n) * 0.5;
    const puff = 0.5 + 0.5 * (1 - Math.abs(2 * x) ** 2.5) * (1 - Math.abs(2 * z) ** 2.5);
    p.setXYZ(i, x * w, y * h * puff, z * d);
  }
  g.computeVertexNormals();
  return g;
}

export function buildRoom() {
  RectAreaLightUniformsLib.init();
  const group = new Group();
  group.name = 'room';
  group.position.copy(ROOM_ORIGIN);
  const rng = new Rng(21);
  const { w: W, d: D, h: H, glassNorth: GN, glassEast: GE, glassY0: Y0, glassY1: Y1 } = ROOM;

  const mat = (color, roughness = 0.8, extra = {}) => new MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
  const M = {
    wall: mat(0xd6d1c8, 0.93),
    ceiling: mat(0xe8e5df, 0.95),
    frame: mat(0x1b1d21, 0.45, { metalness: 0.3 }),
    white: mat(0xf1f0ed, 0.36),
    whiteMatte: mat(0xe9e8e4, 0.7),
    wood: mat(0x6e4c34, 0.6),
    fabricGray: mat(0x8a8782, 0.96),
    fabricDark: mat(0x34373c, 0.95),
    sheet: mat(0xf0eee9, 0.92),
    duvet: mat(0x8c9da6, 0.96, { side: DoubleSide }),
    mustard: mat(0xc7942c, 0.92),
    terracotta: mat(0xb2543a, 0.93),
    dark: mat(0x1a1b1e, 0.55),
    plastic: mat(0x25272b, 0.42),
    metal: mat(0x9b9ea3, 0.35, { metalness: 0.6 }),
    green: mat(0x3f6e37, 0.85, { flatShading: true }),
    pot: mat(0xb56c4a, 0.85),
    ceramic: mat(0x2c6a6e, 0.3),
    teal: mat(0x23484d, 0.6),
  };

  const add = (mesh, cast = true, receive = true, parent = group) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    parent.add(mesh);
    return mesh;
  };
  const box = (w, h, d, material, x, y, z, parent) => {
    const m = new Mesh(new BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    return add(m, true, true, parent);
  };
  const rbox = (w, h, d, radius, material, x, y, z, parent) => {
    const m = new Mesh(new RoundedBoxGeometry(w, h, d, 3, radius), material);
    m.position.set(x, y, z);
    return add(m, true, true, parent);
  };
  const cyl = (rTop, rBottom, h, material, x, y, z, parent, segments = 24) => {
    const m = new Mesh(new CylinderGeometry(rTop, rBottom, h, segments), material);
    m.position.set(x, y, z);
    return add(m, true, true, parent);
  };
  const stick = (a, b, radius, material) => {
    const dir = new Vector3().subVectors(b, a);
    const m = new Mesh(new CylinderGeometry(radius, radius, dir.length(), 10), material);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    return add(m);
  };
  const flat = (w, d, material, x, y, z, rotY = 0) => {
    const g = new PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    const m = new Mesh(g, material);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    return add(m, false, true);
  };

  // --- shell ---------------------------------------------------------------------
  const wood = woodFloorTexture();
  wood.repeat.set(W / 1.6, D / 1.6);
  flat(W, D, new MeshStandardMaterial({ map: wood, roughness: 0.42 }), -W / 2, 0, D / 2);
  box(W + 0.6, 0.2, D + 0.6, M.ceiling, -W / 2, H + 0.1, D / 2);
  box(0.2, H, D + 0.4, M.wall, -W - 0.1, H / 2, D / 2);
  box(W + 0.4, H, 0.2, M.wall, -W / 2, H / 2, D + 0.1);
  box(W - GN, H, 0.2, M.wall, -(W + GN) / 2, H / 2, -0.1);
  box(0.2, H, D - GE, M.wall, 0.1, H / 2, (D + GE) / 2);
  box(GN + 0.2, H - Y1, 0.2, M.wall, -GN / 2 + 0.1, (H + Y1) / 2, -0.1);
  box(0.2, H - Y1, GE, M.wall, 0.1, (H + Y1) / 2, GE / 2);
  box(GN + 0.2, Y0, 0.2, M.frame, -GN / 2 + 0.1, Y0 / 2, -0.1);
  box(0.2, Y0, GE, M.frame, 0.1, Y0 / 2, GE / 2);

  // window frames: slim dark mullions around the glass
  const gh = Y1 - Y0;
  const gy = (Y0 + Y1) / 2;
  for (let k = 1; k <= 3; k++) box(0.05, gh, 0.1, M.frame, (-GN * k) / 4, gy, -0.02);
  box(0.07, gh, 0.12, M.frame, -GN + 0.035, gy, -0.02);
  for (let k = 1; k <= 2; k++) box(0.1, gh, 0.05, M.frame, 0.02, gy, (GE * k) / 3);
  box(0.12, gh, 0.07, M.frame, 0.02, gy, GE - 0.035);
  box(0.1, gh, 0.1, M.frame, 0, gy, 0);
  box(GN, 0.05, 0.1, M.frame, -GN / 2, Y1 - 0.025, -0.02);
  box(GN, 0.05, 0.1, M.frame, -GN / 2, Y0 + 0.025, -0.02);
  box(0.1, 0.05, GE, M.frame, 0.02, Y1 - 0.025, GE / 2);
  box(0.1, 0.05, GE, M.frame, 0.02, Y0 + 0.025, GE / 2);

  // --- bed (head towards the north window) ------------------------------------
  const bx = -3.75;
  const bz = 0.34;
  box(1.5, 0.1, 2.0, M.dark, bx, 0.05, bz + 1.05);
  rbox(1.66, 0.2, 2.14, 0.02, M.wood, bx, 0.2, bz + 1.07);
  rbox(1.72, 0.9, 0.1, 0.04, M.fabricGray, bx, 0.7, bz + 0.05);
  rbox(1.56, 0.22, 2.0, 0.06, M.sheet, bx, 0.41, bz + 1.1);
  const duvet = add(new Mesh(duvetGeometry(1.6, 1.4, 0.24), M.duvet));
  duvet.position.set(bx, 0.535, bz + 0.72);
  rbox(1.64, 0.06, 0.3, 0.028, M.sheet, bx, 0.562, bz + 0.76);
  const pillowGeo = pillowGeometry(0.7, 0.2, 0.44);
  for (const side of [-1, 1]) {
    const pillow = add(new Mesh(pillowGeo, M.sheet));
    pillow.position.set(bx + side * 0.4, 0.66, bz + 0.36);
    pillow.rotation.set(0.45, side * 0.06, 0);
  }
  const cushion = add(new Mesh(pillowGeometry(0.42, 0.14, 0.42), M.mustard));
  cushion.position.set(bx + 0.18, 0.67, bz + 0.6);
  cushion.rotation.set(0.75, 0.25, 0.05);
  rbox(1.7, 0.03, 0.55, 0.012, M.terracotta, bx, 0.585, bz + 1.75);
  for (const side of [-1, 1]) box(0.025, 0.22, 0.55, M.terracotta, bx + side * 0.865, 0.47, bz + 1.75);

  // bedside table with a book and a small plant
  const nx = -2.58;
  const nz = 0.62;
  cyl(0.2, 0.2, 0.025, M.wood, nx, 0.5, nz);
  cyl(0.018, 0.018, 0.48, M.dark, nx, 0.25, nz);
  cyl(0.14, 0.14, 0.015, M.dark, nx, 0.008, nz);
  box(0.15, 0.026, 0.21, M.terracotta, nx + 0.05, 0.526, nz + 0.03).rotation.y = 0.35;
  cyl(0.05, 0.04, 0.08, M.pot, nx - 0.08, 0.553, nz - 0.05);
  for (let k = 0; k < 5; k++) {
    const leaf = add(new Mesh(new IcosahedronGeometry(rng.range(0.035, 0.06), 0), M.green));
    leaf.position.set(nx - 0.08 + rng.range(-0.05, 0.05), 0.62 + rng.range(0, 0.09), nz - 0.05 + rng.range(-0.05, 0.05));
  }

  // --- desk along the east window ------------------------------------------------
  const dx = -0.42;
  const dz = 1.67;
  const top = 0.755;
  rbox(0.7, 0.035, 1.64, 0.012, M.white, dx, top - 0.0175, dz);
  rbox(0.6, 0.62, 0.42, 0.01, M.whiteMatte, dx, 0.41, 2.25);
  box(0.56, 0.1, 0.38, M.dark, dx, 0.05, 2.25);
  for (let k = 0; k < 3; k++) {
    rbox(0.014, 0.185, 0.385, 0.004, M.white, dx - 0.307, 0.615 - k * 0.2, 2.25);
    box(0.012, 0.012, 0.13, M.metal, dx - 0.32, 0.665 - k * 0.2, 2.25);
  }
  for (const side of [-1, 1]) box(0.04, top - 0.035, 0.04, M.whiteMatte, dx + side * 0.3, (top - 0.035) / 2, 0.9);
  box(0.6, 0.03, 0.03, M.whiteMatte, dx, 0.16, 0.9);
  box(0.018, 0.32, 1.14, M.whiteMatte, dx + 0.31, 0.54, 1.47);
  cyl(0.03, 0.03, 0.004, M.dark, dx + 0.26, top + 0.002, 1.95);

  // monitor
  const monitor = new Group();
  monitor.position.set(-0.2, top, 1.55);
  monitor.rotation.y = 0.26;
  group.add(monitor);
  rbox(0.2, 0.012, 0.26, 0.005, M.plastic, 0.02, 0.006, 0, monitor);
  box(0.03, 0.2, 0.05, M.plastic, 0.035, 0.11, 0, monitor);
  rbox(0.022, 0.375, 0.635, 0.008, M.plastic, 0, 0.33, 0, monitor);
  const screenContent = new ScreenContent();
  const screenMaterial = new MeshBasicMaterial({ map: screenContent.texture, toneMapped: false });
  const screen = new Mesh(new PlaneGeometry(0.6, 0.3375), screenMaterial);
  screen.position.set(-0.0122, 0.33, 0);
  screen.rotation.y = -Math.PI / 2;
  monitor.add(screen);

  // keyboard, mouse and desk clutter
  rbox(0.15, 0.014, 0.44, 0.005, M.plastic, -0.52, top + 0.007, 1.55);
  flat(0.134, 0.424, new MeshStandardMaterial({ map: keyboardTexture(), roughness: 0.6 }), -0.52, top + 0.0146, 1.55);
  box(0.2, 0.003, 0.24, M.dark, -0.52, top + 0.0015, 2.0);
  const mouse = add(new Mesh(new SphereGeometry(0.5, 20, 14), M.plastic));
  mouse.scale.set(0.105, 0.036, 0.062);
  mouse.position.set(-0.52, top + 0.018, 1.98);

  const paperMats = [3, 8, 14].map((seed) => new MeshStandardMaterial({ map: paperTexture(seed), roughness: 0.85 }));
  const sheets = [
    [-0.52, 1.02, 0.25], [-0.4, 1.12, -0.35], [-0.3, 0.99, 0.9], [-0.6, 1.2, 1.45],
    [-0.27, 1.25, -0.12], [-0.5, 1.29, 0.1], [-0.3, 1.9, 0.6],
  ];
  sheets.forEach(([x, z, rot], i) => {
    const sheet = flat(0.21, 0.297, paperMats[i % 3], x, top + 0.001 + i * 0.0012, z, rot + rng.range(-0.08, 0.08));
    sheet.castShadow = false;
  });
  flat(0.076, 0.076, mat(0xf2d85c, 0.8), -0.66, top + 0.011, 1.42, 0.2);
  flat(0.076, 0.076, mat(0xf08aa8, 0.8), -0.62, top + 0.002, 2.24, -0.3);
  rbox(0.16, 0.014, 0.22, 0.004, M.teal, -0.27, top + 0.016, 1.07).rotation.y = 0.2;
  stick(new Vector3(-0.31, top + 0.028, 1.02), new Vector3(-0.23, top + 0.028, 1.13), 0.004, M.metal);

  cyl(0.04, 0.037, 0.09, M.ceramic, -0.3, top + 0.045, 2.12);
  cyl(0.034, 0.034, 0.002, mat(0x24140c, 0.3), -0.3, top + 0.088, 2.12);
  const handle = add(new Mesh(new TorusGeometry(0.026, 0.007, 8, 16), M.ceramic));
  handle.position.set(-0.3, top + 0.047, 2.165);
  handle.rotation.y = Math.PI / 2;

  cyl(0.034, 0.03, 0.095, M.dark, -0.14, top + 0.0475, 1.2);
  for (const [ox, oz, color] of [[0.02, 0.012, 0xd04a3a], [-0.018, 0.01, 0x2f6fd0], [0.0, -0.02, 0xe8e8e8]]) {
    stick(new Vector3(-0.14, top + 0.02, 1.2), new Vector3(-0.14 + ox * 2.2, top + 0.17, 1.2 + oz * 2.2), 0.004, mat(color, 0.5));
  }
  cyl(0.055, 0.042, 0.09, M.pot, -0.18, top + 0.045, 0.98);
  for (let k = 0; k < 7; k++) {
    const leaf = add(new Mesh(new IcosahedronGeometry(rng.range(0.04, 0.07), 0), M.green));
    leaf.position.set(-0.18 + rng.range(-0.06, 0.06), top + 0.12 + rng.range(0, 0.12), 0.98 + rng.range(-0.06, 0.06));
  }

  // desk lamp
  const lampBase = new Vector3(-0.2, top + 0.018, 2.36);
  const lampJoint = new Vector3(-0.26, top + 0.36, 2.3);
  const lampHead = new Vector3(-0.44, top + 0.46, 2.08);
  const lampDir = new Vector3(-0.25, -1, -0.5).normalize();
  cyl(0.075, 0.08, 0.018, M.dark, lampBase.x, top + 0.009, lampBase.z);
  stick(lampBase, lampJoint, 0.008, M.metal);
  stick(lampJoint, lampHead, 0.008, M.metal);
  const joint = add(new Mesh(new SphereGeometry(0.014, 12, 8), M.dark));
  joint.position.copy(lampJoint);
  const shadeGeo = new CylinderGeometry(0.03, 0.085, 0.12, 24, 1, true);
  const shade = add(new Mesh(shadeGeo, M.dark));
  shade.position.copy(lampHead).addScaledVector(lampDir, 0.03);
  shade.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), lampDir);
  const lampGlowMaterial = new MeshBasicMaterial({ color: 0x000000, side: BackSide, toneMapped: false });
  const shadeInner = new Mesh(shadeGeo, lampGlowMaterial);
  shadeInner.position.copy(shade.position);
  shadeInner.quaternion.copy(shade.quaternion);
  shadeInner.scale.setScalar(0.96);
  group.add(shadeInner);
  const bulbMaterial = new MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const bulb = new Mesh(new SphereGeometry(0.024, 14, 10), bulbMaterial);
  bulb.position.copy(lampHead).addScaledVector(lampDir, 0.05);
  group.add(bulb);

  // chair
  const chair = new Group();
  chair.position.set(-1.3, 0, 1.62);
  chair.rotation.y = -0.4;
  group.add(chair);
  rbox(0.48, 0.08, 0.48, 0.03, M.fabricDark, 0, 0.48, 0, chair);
  rbox(0.07, 0.56, 0.44, 0.03, M.fabricDark, -0.235, 0.86, 0, chair).rotation.z = 0.12;
  box(0.03, 0.3, 0.06, M.dark, -0.25, 0.56, 0, chair);
  cyl(0.028, 0.028, 0.32, M.metal, 0, 0.28, 0, chair);
  cyl(0.045, 0.045, 0.05, M.dark, 0, 0.11, 0, chair);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    box(0.3, 0.025, 0.045, M.dark, Math.cos(a) * 0.15, 0.085, Math.sin(a) * 0.15, chair).rotation.y = -a;
    const caster = add(new Mesh(new SphereGeometry(0.028, 10, 8), M.dark), true, true, chair);
    caster.position.set(Math.cos(a) * 0.3, 0.03, Math.sin(a) * 0.3);
  }

  // rug and fake contact shadows (area lights cast no shadows of their own)
  flat(2.3, 1.58, new MeshStandardMaterial({ map: rugTexture(), roughness: 0.98 }), -1.85, 0.004, 1.3, 0.06);
  const shadowTex = contactShadowTexture();
  const blob = (w, d, x, z, opacity) => {
    const m = flat(w, d, new MeshBasicMaterial({ map: shadowTex, transparent: true, opacity, depthWrite: false }), x, 0.008, z);
    m.receiveShadow = false;
    m.renderOrder = 1;
  };
  blob(2.2, 2.7, bx, bz + 1.07, 0.8);
  blob(1.15, 2.1, dx, dz, 0.55);
  blob(0.85, 0.85, -1.3, 1.62, 0.5);
  blob(0.55, 0.55, nx, nz, 0.5);

  // ceiling fixture (the "interior light")
  const fixtureMaterial = new MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const fixture = new Mesh(new CylinderGeometry(0.22, 0.22, 0.04, 28), fixtureMaterial);
  fixture.position.set(-2.8, H - 0.02, 2.1);
  group.add(fixture);

  // --- lights ----------------------------------------------------------------------
  const sun = new DirectionalLight(0xffffff, 0);
  sun.castShadow = true;
  sun.shadow.camera.left = -5.5;
  sun.shadow.camera.right = 5.5;
  sun.shadow.camera.top = 5.5;
  sun.shadow.camera.bottom = -5.5;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.025;
  const sunTarget = new Object3D();
  sunTarget.position.set(-W / 2, 0.6, D / 2);
  group.add(sun, sunTarget);
  sun.target = sunTarget;

  // the two glass walls act as large soft light sources (sky / city glow)
  const windowNorth = new RectAreaLight(0xffffff, 0, GN, gh);
  const windowEast = new RectAreaLight(0xffffff, 0, GE, gh);
  group.add(windowNorth, windowEast);
  windowNorth.position.set(-GN / 2, gy, 0.03);
  windowNorth.lookAt(ROOM_ORIGIN.x - GN / 2, ROOM_ORIGIN.y + gy, ROOM_ORIGIN.z + 2);
  windowEast.position.set(-0.03, gy, GE / 2);
  windowEast.lookAt(ROOM_ORIGIN.x - 2, ROOM_ORIGIN.y + gy, ROOM_ORIGIN.z + GE / 2);

  const fill = new HemisphereLight(0xffffff, 0x8a7d6e, 0);
  group.add(fill);

  const ceiling = new PointLight(0xffd9ae, 0, 0, 2);
  ceiling.position.set(-2.8, H - 0.35, 2.1);
  group.add(ceiling);

  const lamp = new SpotLight(0xffc98f, 0, 5, 1.0, 0.75, 2);
  lamp.position.copy(lampHead).addScaledVector(lampDir, 0.045);
  const lampTarget = new Object3D();
  lampTarget.position.copy(lampHead).addScaledVector(lampDir, 1);
  group.add(lamp, lampTarget);
  lamp.target = lampTarget;
  lamp.castShadow = true;
  lamp.shadow.camera.near = 0.05;
  lamp.shadow.camera.far = 4;
  lamp.shadow.bias = -0.002;

  group.updateMatrixWorld(true);
  const screenCenter = screen.getWorldPosition(new Vector3());
  const screenNormal = new Vector3(0, 0, 1).transformDirection(screen.matrixWorld);
  const monitorLight = new RectAreaLight(0xbfd8ff, 0, 0.6, 0.34);
  group.add(monitorLight);
  monitorLight.position.copy(group.worldToLocal(screenCenter.clone().addScaledVector(screenNormal, 0.02)));
  monitorLight.lookAt(screenCenter.clone().addScaledVector(screenNormal, 1));

  // Cheaper stand-ins for the three area lights, used below the "high" preset.
  // They sit behind the glass / in front of the screen so their falloff resembles the area lights.
  const windowNorthPoint = new PointLight(0xffffff, 0, 0, 2);
  windowNorthPoint.position.set(-GN / 2, gy, -2.5);
  const windowEastPoint = new PointLight(0xffffff, 0, 0, 2);
  windowEastPoint.position.set(2.5, gy, GE / 2);
  const monitorPoint = new PointLight(0xbfd8ff, 0, 4, 2);
  monitorPoint.position.copy(group.worldToLocal(screenCenter.clone().addScaledVector(screenNormal, 0.12)));
  group.add(windowNorthPoint, windowEastPoint, monitorPoint);

  group.updateMatrixWorld(true);
  return {
    group,
    lights: {
      sun, sunTarget, windowNorth, windowEast, fill, ceiling, lamp, monitorLight,
      windowNorthPoint, windowEastPoint, monitorPoint,
      windowAreaNorth: GN * gh,
      windowAreaEast: GE * gh,
    },
    screenContent,
    screenMaterial,
    lampGlowMaterial,
    bulbMaterial,
    fixtureMaterial,
    anchors: {
      screen: screenCenter,
      lamp: bulb.getWorldPosition(new Vector3()),
      centre: new Vector3(-W / 2, 1.2, D / 2).add(ROOM_ORIGIN),
    },
  };
}