import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LatheGeometry,
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
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { ROOM, ROOM_ORIGIN } from '../core/layout.js';
import { broadLeafPlant, snakePlant } from './Plants.js';
import {
  ScreenContent, contactShadowTexture, latteTexture, linenTexture, marbleTexture, woodFloorTexture, woodGrainTexture,
} from './textures.js';

// The second-floor cafe: shell with a glazed corner, a marble-topped service
// counter with a fluted timber front, the back bar under the east window
// (espresso machine, grinders, pour-over gear), window tables with timber
// chairs, pendant lights and all interior light sources. Nobody is in.
// Local frame: origin at the glass corner on the floor, room extends to -X / +Z.

const UP = new Vector3(0, 1, 0);

/** Scales the 0..1 face UVs of a BoxGeometry to metres so tiling textures keep their proportions. */
function boxUV(geometry, w, h, d, perMetre) {
  const uv = geometry.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] * perMetre, uv.getY(i) * dims[f][1] * perMetre);
    }
  }
  return geometry;
}

/** A fluted (scalloped) panel: length along +X, height along +Y, flutes bulging towards +Z. */
function flutedGeometry(length, height, pitch = 0.042, depth = 0.014) {
  const flutes = Math.round(length / pitch);
  const p = length / flutes;
  const seg = 7;
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  for (let f = 0; f < flutes; f++) {
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI;
      const x = f * p + (p / 2) * (1 - Math.cos(a));
      const z = Math.sin(a) * depth;
      const nx = -Math.cos(a) * depth * 2;
      const nz = Math.sin(a) * p;
      const nl = Math.hypot(nx, nz) || 1;
      for (const y of [0, height]) {
        pos.push(x, y, z);
        nor.push(nx / nl, 0, nz / nl);
        uv.push(x * 1.4, y * 1.4);
      }
    }
    const base = f * (seg + 1) * 2;
    for (let k = 0; k < seg; k++) {
      const a = base + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function buildRoom() {
  RectAreaLightUniformsLib.init();
  const group = new Group();
  group.name = 'room';
  group.position.copy(ROOM_ORIGIN);
  const { w: W, d: D, h: H, glassNorth: GN, glassEast: GE, glassY0: Y0, glassY1: Y1 } = ROOM;

  const mat = (color, roughness = 0.8, extra = {}) => new MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
  const marble = marbleTexture();
  const walnutTex = woodGrainTexture([112, 74, 48], 3);
  const oakTex = woodGrainTexture([196, 158, 112], 8);
  const M = {
    wall: mat(0xe6e1d8, 0.94),
    ceiling: mat(0xf0ede8, 0.96),
    frame: mat(0x17181b, 0.42, { metalness: 0.5 }),
    marble: new MeshStandardMaterial({ map: marble, color: 0xd9d6d0, roughness: 0.24 }),
    walnut: new MeshStandardMaterial({ map: walnutTex, roughness: 0.5 }),
    oak: new MeshStandardMaterial({ map: oakTex, roughness: 0.55 }),
    cabinet: mat(0x2c3a33, 0.5),
    iron: mat(0x151617, 0.5, { metalness: 0.7 }),
    black: mat(0x111214, 0.45),
    rubber: mat(0x0c0c0d, 0.85),
    steel: mat(0xd6d8da, 0.2, { metalness: 1 }),
    steelBrushed: mat(0xb9bcc0, 0.38, { metalness: 1 }),
    brass: mat(0xa87f3c, 0.3, { metalness: 1 }),
    porcelain: mat(0xf4f1ea, 0.22),
    stoneware: mat(0x9aa39b, 0.55),
    linen: new MeshStandardMaterial({ map: linenTexture([196, 184, 164]), roughness: 0.95 }),
    glass: mat(0xffffff, 0.04, { transparent: true, opacity: 0.16, depthWrite: false }),
    glassAmber: mat(0x8a5a2c, 0.08, { transparent: true, opacity: 0.4, depthWrite: false }),
    coffee: mat(0x1e0f07, 0.25),
    beans: mat(0x2e1a0e, 0.6),
    pastry: mat(0xc8873c, 0.7),
    pastryDark: mat(0x8a4f22, 0.7),
    paper: mat(0xf2ede2, 0.8),
    kraft: mat(0xb08a5c, 0.85),
    twig: mat(0x6b5136, 0.8),
    sage: mat(0x8ea183, 0.8, { side: DoubleSide }),
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
  const slab = (w, h, d, material, x, y, z, parent) => {
    const m = new Mesh(boxUV(new BoxGeometry(w, h, d), w, h, d, 0.8), material);
    m.position.set(x, y, z);
    return add(m, true, true, parent);
  };
  const cyl = (rTop, rBottom, h, material, x, y, z, parent, segments = 32) => {
    const m = new Mesh(new CylinderGeometry(rTop, rBottom, h, segments), material);
    m.position.set(x, y, z);
    return add(m, true, true, parent);
  };
  /** Solid of revolution from [radius, height] pairs. */
  const lathe = (profile, material, x, y, z, parent, segments = 40) => {
    const m = new Mesh(new LatheGeometry(profile.map(([r, h]) => new Vector2(r, h)), segments), material);
    m.position.set(x, y, z);
    return add(m, true, true, parent);
  };
  const stick = (a, b, radius, material, parent, radiusB = radius) => {
    const dir = new Vector3().subVectors(b, a);
    const m = new Mesh(new CylinderGeometry(radiusB, radius, dir.length(), 12), material);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    return add(m, true, true, parent);
  };
  const tube = (points, radius, material, parent) => {
    const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)));
    return add(new Mesh(new TubeGeometry(curve, points.length * 8, radius, 10), material), true, true, parent);
  };
  const flat = (w, d, material, x, y, z, rotY = 0) => {
    const g = new PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    const m = new Mesh(g, material);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    return add(m, false, true);
  };
  const v = (x, y, z) => new Vector3(x, y, z);

  // --- shell ---------------------------------------------------------------------
  const floorTex = woodFloorTexture();
  floorTex.repeat.set(W / 2, D / 2);
  flat(W, D, new MeshStandardMaterial({ map: floorTex, color: 0xc9c2b8, roughness: 0.45 }), -W / 2, 0, D / 2);
  box(W + 0.6, 0.2, D + 0.6, M.ceiling, -W / 2, H + 0.1, D / 2);
  box(0.2, H, D + 0.4, M.wall, -W - 0.1, H / 2, D / 2);
  box(W + 0.4, H, 0.2, M.wall, -W / 2, H / 2, D + 0.1);
  box(W - GN, H, 0.2, M.wall, -(W + GN) / 2, H / 2, -0.1);
  box(0.2, H, D - GE, M.wall, 0.1, H / 2, (D + GE) / 2);
  box(GN + 0.2, H - Y1, 0.2, M.wall, -GN / 2 + 0.1, (H + Y1) / 2, -0.1);
  box(0.2, H - Y1, GE, M.wall, 0.1, (H + Y1) / 2, GE / 2);
  box(GN + 0.2, Y0, 0.2, M.frame, -GN / 2 + 0.1, Y0 / 2, -0.1);
  box(0.2, Y0, GE, M.frame, 0.1, Y0 / 2, GE / 2);

  // window frames: slim dark steel mullions and a transom
  const gh = Y1 - Y0;
  const gy = (Y0 + Y1) / 2;
  for (let k = 1; k <= 3; k++) box(0.045, gh, 0.09, M.frame, (-GN * k) / 4, gy, -0.02);
  box(0.07, gh, 0.12, M.frame, -GN + 0.035, gy, -0.02);
  for (let k = 1; k <= 2; k++) box(0.09, gh, 0.045, M.frame, 0.02, gy, (GE * k) / 3);
  box(0.12, gh, 0.07, M.frame, 0.02, gy, GE - 0.035);
  box(0.1, gh, 0.1, M.frame, 0, gy, 0);
  for (const y of [Y1 - 0.025, Y0 + 0.025, 2.36]) {
    const t = y === 2.36 ? 0.035 : 0.05;
    box(GN, t, 0.09, M.frame, -GN / 2, y, -0.02);
    box(0.09, t, GE, M.frame, 0.02, y, GE / 2);
  }
  // timber window board along both glass walls
  slab(GN - 0.1, 0.03, 0.16, M.oak, -GN / 2 - 0.05, Y0 + 0.065, 0.1);

  // --- crockery ---------------------------------------------------------------------
  const cupProfile = [[0.0, 0.004], [0.022, 0.004], [0.026, 0.008], [0.034, 0.03], [0.04, 0.058], [0.041, 0.062], [0.038, 0.06], [0.031, 0.028], [0.02, 0.012], [0, 0.012]];
  const saucerProfile = [[0, 0.004], [0.03, 0.004], [0.07, 0.014], [0.072, 0.016], [0.07, 0.018], [0.03, 0.009], [0, 0.009]];
  const latteMat = new MeshStandardMaterial({ map: latteTexture(), roughness: 0.35 });
  const cup = (x, y, z, parent, { filled = false, rot = 0, saucer = true, material = M.porcelain } = {}) => {
    const g = new Group();
    g.position.set(x, y, z);
    g.rotation.y = rot;
    (parent || group).add(g);
    if (saucer) lathe(saucerProfile, material, 0, 0, 0, g);
    const base = saucer ? 0.008 : 0;
    lathe(cupProfile, material, 0, base, 0, g);
    const handle = add(new Mesh(new TorusGeometry(0.017, 0.0045, 10, 20, Math.PI * 1.3), material), true, true, g);
    handle.position.set(0.04, base + 0.034, 0);
    handle.rotation.z = -Math.PI * 0.65;
    if (filled) cyl(0.0365, 0.0365, 0.002, latteMat, 0, base + 0.053, 0, g).castShadow = false;
    return g;
  };

  // --- furniture ---------------------------------------------------------------------
  const tableTopProfile = [[0, 0], [0.31, 0], [0.33, 0.006], [0.335, 0.014], [0.33, 0.024], [0.325, 0.028], [0, 0.028]];
  const tableBaseProfile = [
    [0, 0], [0.2, 0], [0.21, 0.008], [0.2, 0.018], [0.09, 0.03], [0.04, 0.06], [0.026, 0.12], [0.024, 0.62],
    [0.03, 0.66], [0.07, 0.69], [0.14, 0.7], [0.14, 0.712], [0, 0.712],
  ];
  const table = (x, z) => {
    const g = new Group();
    g.position.set(x, 0, z);
    group.add(g);
    lathe(tableBaseProfile, M.iron, 0, 0, 0, g);
    lathe(tableTopProfile, M.marble, 0, 0.712, 0, g, 56);
    return g;
  };
  const TABLE_TOP = 0.74;

  // Timber cafe chair: turned legs, a round saddle seat and a steam-bent back rail on spindles.
  const seatProfile = [[0, 0], [0.19, 0], [0.205, 0.008], [0.21, 0.02], [0.2, 0.032], [0.12, 0.03], [0, 0.026]];
  const chair = (x, z, rotY) => {
    const g = new Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    group.add(g);
    const seatY = 0.44;
    lathe(seatProfile, M.oak, 0, seatY, 0, g);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        stick(v(sx * 0.2, 0, sz * 0.2), v(sx * 0.14, seatY + 0.004, sz * 0.14), 0.013, M.oak, g, 0.019);
      }
      stick(v(sx * 0.177, 0.2, -0.177), v(sx * 0.177, 0.2, 0.177), 0.008, M.oak, g);
    }
    stick(v(-0.177, 0.24, 0), v(0.177, 0.24, 0), 0.008, M.oak, g);
    // back rail: a horizontal arc behind the sitter (the chair faces +Z)
    const railR = 0.215;
    const railY = seatY + 0.34;
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const a = Math.PI * (1.08 + (0.84 * k) / 12);
      const drop = 0.06 * Math.pow(Math.abs(k - 6) / 6, 2.4);
      pts.push([Math.cos(a) * railR, railY - drop, Math.sin(a) * railR - 0.03]);
    }
    tube(pts, 0.014, M.oak, g);
    for (let k = 1; k <= 11; k += 2) {
      const a = Math.PI * (1.08 + (0.84 * k) / 12);
      stick(
        v(Math.cos(a) * 0.185, seatY + 0.02, Math.sin(a) * 0.185),
        v(pts[k][0], pts[k][1], pts[k][2]), 0.0075, M.oak, g,
      );
    }
    return g;
  };

  const stool = (x, z) => {
    const g = new Group();
    g.position.set(x, 0, z);
    group.add(g);
    lathe([[0, 0], [0.16, 0], [0.175, 0.01], [0.175, 0.03], [0.16, 0.042], [0, 0.045]], M.walnut, 0, 0.69, 0, g);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      stick(v(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2), v(Math.cos(a) * 0.11, 0.69, Math.sin(a) * 0.11), 0.011, M.iron, g);
    }
    const ring = add(new Mesh(new TorusGeometry(0.173, 0.008, 10, 40), M.brass), true, true, g);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.26;
    return g;
  };

  // small bud vase with a few dried stems
  const vase = (x, y, z, material, seed) => {
    const g = new Group();
    g.position.set(x, y, z);
    group.add(g);
    lathe([[0, 0], [0.022, 0], [0.034, 0.02], [0.036, 0.045], [0.02, 0.085], [0.012, 0.11], [0.015, 0.118], [0.011, 0.118], [0.009, 0.1], [0, 0.1]], material, 0, 0, 0, g);
    for (let k = 0; k < 4; k++) {
      const a = seed + k * 1.9;
      const lean = 0.035 + 0.02 * ((k * 7 + seed) % 3);
      const tip = v(Math.cos(a) * lean, 0.3 + 0.03 * (k % 3), Math.sin(a) * lean);
      stick(v(0, 0.08, 0), tip, 0.0016, M.twig, g);
      for (let j = 0; j < 5; j++) {
        const t = 0.45 + j * 0.13;
        const leaf = add(new Mesh(new SphereGeometry(0.011, 8, 6), M.sage), true, true, g);
        leaf.scale.set(1, 0.25, 0.7);
        leaf.position.set(tip.x * t + Math.cos(a + j * 2.4) * 0.012, 0.08 + (tip.y - 0.08) * t, tip.z * t + Math.sin(a + j * 2.4) * 0.012);
        leaf.rotation.set(j * 1.1, a + j * 2.4, 0.6);
      }
    }
    return g;
  };

  // window tables along the north glass
  const windowTables = [-1.6, -3.4, -5.2];
  windowTables.forEach((x, i) => {
    table(x, 0.82);
    chair(x + 0.56, 0.84, -Math.PI / 2 + (i === 0 ? 0.25 : -0.12));
    chair(x - 0.56, 0.8, Math.PI / 2 + (i === 1 ? 0.3 : 0.08));
    vase(x + 0.05, TABLE_TOP, 0.66, i === 1 ? M.stoneware : M.porcelain, i * 2.3 + 1);
  });
  // the table closest to the viewer: somebody's seat, but nobody is here
  const tx = -3.72;
  const tz = 2.95;
  table(tx, tz);
  chair(tx - 0.1, tz - 0.6, 0.18);
  chair(tx + 0.62, tz + 0.2, -Math.PI / 2 - 0.5);
  cup(tx + 0.08, TABLE_TOP, tz + 0.1, group, { filled: true, rot: 0.7 });
  const spoon = stick(v(tx + 0.17, TABLE_TOP + 0.012, tz + 0.13), v(tx + 0.2, TABLE_TOP + 0.013, tz + 0.03), 0.0022, M.steel);
  spoon.castShadow = false;
  rbox(0.13, 0.016, 0.19, 0.004, M.cabinet, tx - 0.02, TABLE_TOP + 0.008, tz - 0.14).rotation.y = 0.5;
  rbox(0.124, 0.012, 0.184, 0.002, M.paper, tx - 0.02, TABLE_TOP + 0.009, tz - 0.14).rotation.y = 0.5;

  // cordless table lamp (the "table lamp" switch)
  const lx = tx - 0.17;
  const lz = tz + 0.06;
  lathe([[0, 0], [0.05, 0], [0.052, 0.006], [0.05, 0.012], [0.012, 0.02], [0.008, 0.03], [0.008, 0.2], [0, 0.2]], M.brass, lx, TABLE_TOP, lz);
  const shadeProfile = [[0.012, 0.075], [0.04, 0.07], [0.075, 0.05], [0.092, 0.02], [0.095, 0]];
  const shadeGeo = new LatheGeometry(shadeProfile.map(([r, h]) => new Vector2(r, h)), 40);
  const shade = add(new Mesh(shadeGeo, mat(0x26342d, 0.4, { side: DoubleSide })));
  shade.position.set(lx, TABLE_TOP + 0.19, lz);
  const lampGlowMaterial = new MeshBasicMaterial({ color: 0x000000, side: BackSide, toneMapped: false });
  const shadeInner = new Mesh(shadeGeo, lampGlowMaterial);
  shadeInner.position.copy(shade.position);
  shadeInner.scale.setScalar(0.97);
  group.add(shadeInner);
  const bulbMaterial = new MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const bulb = new Mesh(new SphereGeometry(0.018, 16, 12), bulbMaterial);
  bulb.position.set(lx, TABLE_TOP + 0.215, lz);
  group.add(bulb);

  // --- service counter -------------------------------------------------------------------
  const cx0 = -2.02; // customer face
  const cx1 = -1.4;
  const cz0 = 2.6;
  const cz1 = 5.7;
  const CH = 0.98;
  box(cx1 - cx0 - 0.03, CH - 0.1, cz1 - cz0 - 0.03, M.walnut, (cx0 + cx1) / 2, 0.1 + (CH - 0.1) / 2, (cz0 + cz1) / 2);
  box(cx1 - cx0 - 0.12, 0.1, cz1 - cz0 - 0.12, M.black, (cx0 + cx1) / 2, 0.05, (cz0 + cz1) / 2);
  const fluteFront = add(new Mesh(flutedGeometry(cz1 - cz0, CH - 0.14), M.walnut));
  fluteFront.position.set(cx0 + 0.016, 0.1, cz0);
  fluteFront.rotation.y = -Math.PI / 2;
  const fluteEnd = add(new Mesh(flutedGeometry(cx1 - cx0, CH - 0.14), M.walnut));
  fluteEnd.position.set(cx1, 0.1, cz0 + 0.016);
  fluteEnd.rotation.y = Math.PI;
  box(0.012, 0.03, cz1 - cz0 + 0.01, M.brass, cx0 - 0.002, 0.115, (cz0 + cz1) / 2);
  box(cx1 - cx0 + 0.01, 0.03, 0.012, M.brass, (cx0 + cx1) / 2, 0.115, cz0 - 0.002);
  slab(cx1 - cx0 + 0.1, 0.04, cz1 - cz0 + 0.08, M.marble, (cx0 + cx1) / 2 - 0.02, CH + 0.02, (cz0 + cz1) / 2 - 0.02);
  const CT = CH + 0.04;
  // brass foot rail
  stick(v(cx0 - 0.13, 0.17, cz0 + 0.1), v(cx0 - 0.13, 0.17, cz1 - 0.1), 0.014, M.brass);
  for (const z of [cz0 + 0.25, (cz0 + cz1) / 2, cz1 - 0.25]) {
    stick(v(cx0 - 0.13, 0.17, z), v(cx0 + 0.01, 0.17, z), 0.008, M.brass);
    stick(v(cx0 - 0.13, 0, z), v(cx0 - 0.13, 0.17, z), 0.008, M.brass);
  }
  stool(cx0 - 0.42, 3.05);
  stool(cx0 - 0.4, 3.75);

  // pastry case
  const pz = 3.86;
  const px = (cx0 + cx1) / 2 - 0.02;
  box(0.46, 0.03, 0.64, M.walnut, px, CT + 0.015, pz);
  const caseGlass = box(0.44, 0.3, 0.62, M.glass, px, CT + 0.18, pz);
  caseGlass.castShadow = false;
  caseGlass.renderOrder = 8;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) box(0.012, 0.3, 0.012, M.brass, px + sx * 0.22, CT + 0.18, pz + sz * 0.31);
    box(0.012, 0.012, 0.62, M.brass, px + sx * 0.22, CT + 0.33, pz);
    box(0.44, 0.012, 0.012, M.brass, px, CT + 0.33, pz + sx * 0.31);
  }
  box(0.4, 0.008, 0.58, M.glass, px, CT + 0.17, pz).castShadow = false;
  const croissant = (x, y, z, rot) => {
    const m = add(new Mesh(new TorusGeometry(0.036, 0.02, 10, 18, Math.PI * 1.15), M.pastry));
    m.position.set(x, y + 0.016, z);
    m.rotation.set(-Math.PI / 2, 0, rot);
    m.scale.set(1, 1, 0.85);
    for (let k = 0; k < 4; k++) {
      const a = rot + 0.25 + k * 0.95;
      const ridge = add(new Mesh(new TorusGeometry(0.0205, 0.004, 6, 14), M.pastryDark));
      ridge.position.set(x + Math.cos(a) * 0.036, y + 0.016, z - Math.sin(a) * 0.036);
      ridge.rotation.y = a + Math.PI / 2;
      ridge.scale.set(1, 0.85, 1);
    }
  };
  for (let k = 0; k < 4; k++) {
    lathe([[0, 0], [0.085, 0], [0.1, 0.006], [0.1, 0.009], [0, 0.009]], M.porcelain, px + (k % 2 ? 0.08 : -0.08), CT + 0.03 + (k > 1 ? 0.148 : 0), pz - 0.16 + (k % 2) * 0.3 + (k > 1 ? 0.03 : 0));
  }
  croissant(px - 0.1, CT + 0.039, pz - 0.14, 0.4);
  croissant(px - 0.04, CT + 0.039, pz - 0.2, 2.2);
  croissant(px - 0.09, CT + 0.062, pz - 0.17, 4.0);
  for (const [ox, oz] of [[0.05, 0.1], [0.11, 0.15], [0.07, 0.18]]) {
    cyl(0.026, 0.02, 0.03, M.kraft, px + ox, CT + 0.054, pz + oz, group, 16);
    const dome = add(new Mesh(new SphereGeometry(0.03, 14, 10), M.pastryDark));
    dome.scale.y = 0.62;
    dome.position.set(px + ox, CT + 0.07, pz + oz);
  }
  for (const [ox, oz] of [[-0.1, 0.0], [-0.05, -0.05]]) {
    const cake = rbox(0.05, 0.045, 0.09, 0.006, mat(0xe9d27a, 0.6), px + ox, CT + 0.21, pz - 0.14 + oz * 2);
    cake.rotation.y = 0.3;
  }
  for (const [ox, oz] of [[0.06, 0.17], [0.1, 0.13], [0.1, 0.21]]) {
    cyl(0.03, 0.03, 0.018, mat(0x5a3220, 0.55), px + ox, CT + 0.196, pz + oz, group, 20);
  }

  // menu display on a slim stand
  const screenContent = new ScreenContent();
  const screenMaterial = new MeshBasicMaterial({ map: screenContent.texture, toneMapped: false });
  const display = new Group();
  display.position.set(px + 0.04, CT, 3.3);
  display.rotation.y = 0.12;
  group.add(display);
  lathe([[0, 0], [0.08, 0], [0.085, 0.006], [0.08, 0.012], [0.012, 0.018], [0.01, 0.16], [0, 0.16]], M.black, 0, 0, 0, display);
  rbox(0.018, 0.29, 0.5, 0.006, M.black, 0, 0.25, 0, display);
  const screen = new Mesh(new PlaneGeometry(0.47, 0.264), screenMaterial);
  screen.position.set(-0.0096, 0.25, 0);
  screen.rotation.y = -Math.PI / 2;
  display.add(screen);

  // odds and ends on the counter
  lathe([[0, 0], [0.036, 0], [0.04, 0.01], [0.04, 0.1], [0.036, 0.108], [0.036, 0.1], [0.033, 0.006], [0, 0.006]], M.glass, px - 0.13, CT, 4.36).castShadow = false;
  for (let k = 0; k < 9; k++) {
    stick(v(px - 0.13, CT + 0.006, 4.36), v(px - 0.13 + Math.cos(k * 2.4) * 0.03, CT + 0.19, 4.36 + Math.sin(k * 2.4) * 0.03), 0.0025, k % 3 ? M.paper : M.kraft);
  }
  for (let k = 0; k < 4; k++) rbox(0.11, 0.004, 0.11, 0.001, M.paper, px + 0.08, CT + 0.003 + k * 0.004, 2.8).rotation.y = k * 0.13;
  const counterPlant = broadLeafPlant(23, 0.06, 0.1);
  counterPlant.position.set(px + 0.04, CT, 4.75);
  group.add(counterPlant);

  // --- back bar under the east window ------------------------------------------------------
  const bx0 = -0.66;
  const bx1 = -0.1;
  const bz0 = 1.02;
  const bz1 = 4.95;
  const BH = 0.88;
  box(bx1 - bx0, BH - 0.1, bz1 - bz0, M.cabinet, (bx0 + bx1) / 2, 0.1 + (BH - 0.1) / 2, (bz0 + bz1) / 2);
  box(bx1 - bx0 - 0.08, 0.1, bz1 - bz0 - 0.04, M.black, (bx0 + bx1) / 2 + 0.04, 0.05, (bz0 + bz1) / 2);
  const doors = 6;
  const dw = (bz1 - bz0) / doors;
  for (let k = 0; k < doors; k++) {
    const z = bz0 + (k + 0.5) * dw;
    rbox(0.018, BH - 0.16, dw - 0.012, 0.004, M.cabinet, bx0 - 0.008, 0.1 + (BH - 0.1) / 2, z);
    rbox(0.01, BH - 0.3, dw - 0.14, 0.003, M.cabinet, bx0 - 0.014, 0.1 + (BH - 0.1) / 2, z);
    const hz = z + (k % 2 ? -1 : 1) * (dw / 2 - 0.05);
    stick(v(bx0 - 0.034, 0.6, hz), v(bx0 - 0.034, 0.72, hz), 0.005, M.brass);
    for (const y of [0.61, 0.71]) stick(v(bx0 - 0.034, y, hz), v(bx0 - 0.014, y, hz), 0.004, M.brass);
  }
  slab(bx1 - bx0 + 0.04, 0.03, bz1 - bz0 + 0.04, M.marble, (bx0 + bx1) / 2 - 0.02, BH + 0.015, (bz0 + bz1) / 2);
  const BT = BH + 0.03;

  // espresso machine, two groups; the barista side faces the room (-X)
  const em = new Group();
  em.position.set(-0.36, BT, 1.98);
  group.add(em);
  const EW = 0.74; // along Z
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.022, 0.018, 0.035, M.black, sx * 0.19, 0.0175, sz * (EW / 2 - 0.06), em, 16);
  rbox(0.5, 0.11, EW, 0.012, M.steel, -0.01, 0.09, 0, em); // base with drip tray
  rbox(0.22, 0.3, EW, 0.012, M.steel, 0.13, 0.25, 0, em); // boiler housing
  rbox(0.5, 0.12, EW, 0.014, M.steel, -0.01, 0.38, 0, em); // head
  for (const sz of [-1, 1]) rbox(0.42, 0.35, 0.014, 0.005, M.black, 0.02, 0.265, sz * (EW / 2 + 0.002), em); // side panels
  box(0.2, 0.006, EW - 0.08, M.steelBrushed, -0.14, 0.147, 0, em); // drip grate
  for (let k = 0; k < 16; k++) box(0.19, 0.003, 0.008, M.black, -0.14, 0.1505, -EW / 2 + 0.07 + k * ((EW - 0.14) / 15), em).castShadow = false;
  box(0.012, 0.16, EW - 0.04, M.black, 0.018, 0.23, 0, em); // back splash
  for (const gz of [-0.17, 0.17]) {
    cyl(0.034, 0.038, 0.05, M.steelBrushed, -0.13, 0.3, gz, em, 28);
    cyl(0.04, 0.036, 0.03, M.steel, -0.13, 0.262, gz, em, 28);
    stick(v(-0.16, 0.262, gz), v(-0.31, 0.24, gz + 0.02), 0.011, M.black, em, 0.014);
    for (const s of [-1, 1]) stick(v(-0.13, 0.25, gz + s * 0.012), v(-0.13, 0.225, gz + s * 0.018), 0.004, M.steel, em);
    // paddle and gauge above each group
    rbox(0.012, 0.03, 0.05, 0.004, M.black, -0.262, 0.385, gz, em);
    const gauge = cyl(0.022, 0.022, 0.008, M.porcelain, -0.262, 0.39, gz + 0.09 * Math.sign(-gz), em, 24);
    gauge.rotation.z = Math.PI / 2;
    const bezel = add(new Mesh(new TorusGeometry(0.022, 0.003, 8, 28), M.steel), true, true, em);
    bezel.position.copy(gauge.position);
    bezel.rotation.y = Math.PI / 2;
  }
  for (const sz of [-1, 1]) {
    // steam wands with rubber grips
    tube([[-0.2, 0.33, sz * 0.3], [-0.25, 0.3, sz * 0.31], [-0.265, 0.2, sz * 0.315], [-0.27, 0.165, sz * 0.32]], 0.005, M.steel, em);
    stick(v(-0.262, 0.25, sz * 0.314), v(-0.267, 0.2, sz * 0.316), 0.008, M.rubber, em);
    const knob = cyl(0.02, 0.02, 0.025, M.black, -0.268, 0.385, sz * 0.3, em, 20);
    knob.rotation.z = Math.PI / 2;
  }
  cyl(0.008, 0.008, 0.11, M.steel, -0.19, 0.275, 0, em, 12); // hot water spout
  // cup rail and warming cups on top
  for (const sx of [-1, 1]) stick(v(sx * 0.22 - 0.01, 0.475, -EW / 2 + 0.03), v(sx * 0.22 - 0.01, 0.475, EW / 2 - 0.03), 0.005, M.steel, em);
  for (const sz of [-1, 1]) {
    stick(v(-0.23, 0.475, sz * (EW / 2 - 0.03)), v(0.21, 0.475, sz * (EW / 2 - 0.03)), 0.005, M.steel, em);
    for (const sx of [-1, 1]) stick(v(sx * 0.22 - 0.01, 0.44, sz * (EW / 2 - 0.03)), v(sx * 0.22 - 0.01, 0.475, sz * (EW / 2 - 0.03)), 0.004, M.steel, em);
  }
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 3; j++) {
      if ((i * 3 + j) % 7 === 5) continue;
      const c = cup(-0.14 + j * 0.115, 0.502, -0.27 + i * 0.135, em, { saucer: false, rot: i * 1.3 + j });
      c.rotation.x = Math.PI;
      if (j === 1 && i % 2 === 0) {
        const c2 = cup(-0.14 + j * 0.115, 0.56, -0.27 + i * 0.135, em, { saucer: false, rot: i * 2.1 });
        c2.rotation.x = Math.PI;
      }
    }
  }

  // grinders
  const grinder = (z, tint) => {
    const g = new Group();
    g.position.set(-0.36, BT, z);
    group.add(g);
    rbox(0.2, 0.03, 0.17, 0.008, tint, -0.02, 0.015, 0, g);
    rbox(0.14, 0.3, 0.15, 0.02, tint, 0.02, 0.17, 0, g);
    rbox(0.1, 0.07, 0.12, 0.015, tint, -0.07, 0.27, 0, g);
    cyl(0.012, 0.016, 0.05, M.steel, -0.1, 0.215, 0, g, 12);
    for (const s of [-1, 1]) stick(v(-0.04, 0.14, s * 0.035), v(-0.13, 0.14, s * 0.035), 0.004, M.steel, g);
    cyl(0.05, 0.05, 0.012, M.black, 0.02, 0.326, 0, g, 24);
    const hopper = lathe([[0.03, 0], [0.085, 0.14], [0.088, 0.2]], M.glassAmber, 0.02, 0.33, 0, g, 28);
    hopper.material.side = DoubleSide;
    hopper.castShadow = false;
    hopper.renderOrder = 8;
    lathe([[0, 0], [0.028, 0], [0.07, 0.1], [0, 0.11]], M.beans, 0.02, 0.332, 0, g, 20);
    lathe([[0, 0.012], [0.03, 0.012], [0.09, 0.004], [0.092, 0], [0.09, 0]], M.black, 0.02, 0.53, 0, g, 28);
    const dial = cyl(0.018, 0.018, 0.01, M.steel, -0.052, 0.12, 0.05, g, 16);
    dial.rotation.z = Math.PI / 2;
  };
  grinder(1.2, M.black);
  grinder(1.42, mat(0xe9e6df, 0.35));

  // knock box and tamper mat
  rbox(0.16, 0.07, 0.13, 0.01, M.steelBrushed, -0.42, BT + 0.035, 2.5);
  rbox(0.2, 0.006, 0.14, 0.002, M.rubber, -0.44, BT + 0.003, 2.68);
  lathe([[0, 0], [0.028, 0], [0.028, 0.012], [0.012, 0.02], [0.016, 0.05], [0.02, 0.075], [0, 0.085]], M.steel, -0.44, BT + 0.006, 2.66, group, 24);

  // pour-over station: timber stand, ceramic drippers, glass servers
  const stand = new Group();
  stand.position.set(-0.36, BT, 3.15);
  group.add(stand);
  rbox(0.2, 0.02, 0.5, 0.005, M.oak, 0, 0.01, 0, stand);
  rbox(0.16, 0.016, 0.5, 0.005, M.oak, 0.02, 0.27, 0, stand);
  for (const s of [-1, 1]) stick(v(0.085, 0.02, s * 0.235), v(0.085, 0.262, s * 0.235), 0.008, M.brass, stand);
  for (const s of [-1, 1]) {
    const z = s * 0.115;
    const server = lathe([[0, 0.003], [0.045, 0.003], [0.052, 0.02], [0.05, 0.07], [0.03, 0.1], [0.034, 0.125], [0.037, 0.13]], M.glass, -0.02, 0.02, z, stand, 28);
    server.material.side = DoubleSide;
    server.castShadow = false;
    server.renderOrder = 8;
    lathe([[0, 0], [0.043, 0], [0.049, 0.016], [0.048, 0.04 + (s > 0 ? 0.02 : 0)], [0, 0.04 + (s > 0 ? 0.02 : 0)]], M.coffee, -0.02, 0.025, z, stand, 24);
    lathe([[0.014, 0], [0.05, 0.012], [0.052, 0.016], [0.016, 0.02], [0.02, 0.03], [0.055, 0.085], [0.058, 0.087], [0.052, 0.082], [0.016, 0.026]], M.porcelain, -0.02, 0.262, z, stand, 28);
    const ear = add(new Mesh(new TorusGeometry(0.016, 0.004, 8, 16, Math.PI), M.porcelain), true, true, stand);
    ear.position.set(-0.02, 0.32, z + s * 0.045);
    ear.rotation.set(0, Math.PI / 2, s * -Math.PI / 2);
  }

  // gooseneck kettle
  const kettle = new Group();
  kettle.position.set(-0.36, BT, 3.6);
  kettle.rotation.y = 0.5;
  group.add(kettle);
  lathe([[0, 0], [0.068, 0], [0.072, 0.008], [0.066, 0.07], [0.052, 0.125], [0.05, 0.132], [0, 0.132]], M.steelBrushed, 0, 0, 0, kettle, 36);
  lathe([[0, 0], [0.046, 0], [0.04, 0.012], [0.008, 0.016], [0.012, 0.03], [0, 0.034]], M.steelBrushed, 0, 0.132, 0, kettle, 28);
  tube([[-0.062, 0.03, 0], [-0.1, 0.045, 0], [-0.115, 0.09, 0], [-0.125, 0.13, 0], [-0.155, 0.14, 0]], 0.0045, M.steelBrushed, kettle);
  tube([[0.05, 0.12, 0], [0.1, 0.125, 0], [0.115, 0.09, 0], [0.105, 0.04, 0], [0.068, 0.03, 0]], 0.007, M.black, kettle);

  // stacks of takeaway cups, a milk pitcher, jars
  for (const [z, n] of [[4.05, 9], [4.15, 6]]) {
    for (let k = 0; k < n; k++) lathe([[0.027, 0], [0.041, 0.105], [0.043, 0.108], [0.041, 0.108], [0.0265, 0.003]], M.paper, -0.3, BT + k * 0.014, z, group, 20);
  }
  lathe([[0, 0], [0.04, 0], [0.043, 0.01], [0.037, 0.085], [0.042, 0.1], [0.04, 0.1], [0.035, 0.085], [0.04, 0.012], [0, 0.008]], M.steel, -0.47, BT, 2.86, group, 28);
  for (const [z, fill] of [[4.62, M.beans], [4.76, mat(0xd9c9a8, 0.7)]]) {
    const jar = lathe([[0, 0.002], [0.05, 0.002], [0.054, 0.012], [0.054, 0.14], [0.046, 0.152]], M.glass, -0.34, BT, z, group, 28);
    jar.castShadow = false;
    jar.renderOrder = 8;
    lathe([[0, 0], [0.05, 0], [0.05, 0.1], [0, 0.105]], fill, -0.34, BT + 0.006, z, group, 20);
    lathe([[0, 0], [0.05, 0], [0.052, 0.012], [0.02, 0.018], [0, 0.018]], M.oak, -0.34, BT + 0.152, z, group, 24);
  }

  // --- plants -----------------------------------------------------------------------------
  const floorPlant = snakePlant(11, 0.058, 0.1);
  floorPlant.scale.setScalar(3.1);
  floorPlant.position.set(-1.78, 0, 2.02);
  group.add(floorPlant);

  // --- pendants -----------------------------------------------------------------------------
  // The "interior lighting" switch: brass domes over the counter, opal globes over the window tables.
  const fixtureMaterial = new MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const globeMaterial = new MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const domeProfile = [[0.018, 0.2], [0.03, 0.19], [0.06, 0.15], [0.12, 0.07], [0.16, 0.015], [0.165, 0]];
  const domeGeo = new LatheGeometry(domeProfile.map(([r, h]) => new Vector2(r, h)), 48);
  const domeInner = new MeshBasicMaterial({ color: 0x000000, side: BackSide, toneMapped: false });
  const pendantDome = (x, y, z) => {
    stick(v(x, y + 0.2, z), v(x, H, z), 0.004, M.black).castShadow = false;
    cyl(0.05, 0.05, 0.02, M.brass, x, H - 0.01, z, group, 24);
    cyl(0.02, 0.018, 0.05, M.brass, x, y + 0.215, z, group, 16);
    const dome = add(new Mesh(domeGeo, M.black), false);
    dome.position.set(x, y, z);
    const inner = new Mesh(domeGeo, domeInner);
    inner.position.set(x, y, z);
    inner.scale.setScalar(0.985);
    group.add(inner);
    const b = new Mesh(new SphereGeometry(0.032, 16, 12), fixtureMaterial);
    b.position.set(x, y + 0.075, z);
    group.add(b);
  };
  for (const z of [3.0, 3.75, 4.5]) pendantDome((cx0 + cx1) / 2, 2.12, z);
  const pendantGlobe = (x, y, z) => {
    stick(v(x, y + 0.1, z), v(x, H, z), 0.0035, M.black).castShadow = false;
    cyl(0.04, 0.04, 0.018, M.brass, x, H - 0.009, z, group, 24);
    cyl(0.022, 0.03, 0.05, M.brass, x, y + 0.115, z, group, 16);
    const globe = new Mesh(new SphereGeometry(0.105, 32, 24), globeMaterial);
    globe.position.set(x, y, z);
    group.add(globe);
  };
  windowTables.forEach((x, i) => pendantGlobe(x, 2.52 - (i % 2) * 0.1, 0.82));

  // fake contact shadows (area and point lights cast no shadows of their own)
  const shadowTex = contactShadowTexture();
  const blob = (w, d, x, z, opacity) => {
    const m = flat(w, d, new MeshBasicMaterial({ map: shadowTex, transparent: true, opacity, depthWrite: false }), x, 0.006, z);
    m.receiveShadow = false;
    m.renderOrder = 1;
  };
  for (const x of windowTables) blob(1.9, 1.0, x, 0.82, 0.42);
  blob(1.5, 1.5, tx + 0.1, tz - 0.1, 0.45);
  blob(1.3, cz1 - cz0 + 0.7, (cx0 + cx1) / 2 - 0.1, (cz0 + cz1) / 2, 0.7);
  blob(1.0, bz1 - bz0 + 0.5, (bx0 + bx1) / 2 - 0.1, (bz0 + bz1) / 2, 0.6);
  blob(0.6, 0.6, -1.78, 2.02, 0.5);

  // --- lights ----------------------------------------------------------------------
  const sun = new DirectionalLight(0xffffff, 0);
  sun.castShadow = true;
  sun.shadow.camera.left = -7;
  sun.shadow.camera.right = 7;
  sun.shadow.camera.top = 7;
  sun.shadow.camera.bottom = -7;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 44;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  const sunTarget = new Object3D();
  sunTarget.position.set(-W / 2 + 1, 0.6, D / 2 - 0.8);
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

  const fill = new HemisphereLight(0xffffff, 0x9a8468, 0);
  group.add(fill);

  const ceiling = new PointLight(0xffd3a0, 0, 0, 2);
  ceiling.position.set((cx0 + cx1) / 2 - 0.05, 2.02, 3.6);
  const pendants = new PointLight(0xffdcb4, 0, 0, 2);
  pendants.position.set(-3.2, 2.25, 1.0);
  group.add(ceiling, pendants);

  const lamp = new SpotLight(0xffc98f, 0, 4, 1.25, 0.6, 2);
  lamp.position.copy(bulb.position);
  const lampTarget = new Object3D();
  lampTarget.position.set(lx, 0, lz);
  group.add(lamp, lampTarget);
  lamp.target = lampTarget;
  lamp.castShadow = true;
  lamp.shadow.camera.near = 0.03;
  lamp.shadow.camera.far = 3;
  lamp.shadow.bias = -0.002;

  group.updateMatrixWorld(true);
  const screenCenter = screen.getWorldPosition(new Vector3());
  const screenNormal = new Vector3(0, 0, 1).transformDirection(screen.matrixWorld);
  const monitorLight = new RectAreaLight(0xffe6c4, 0, 0.47, 0.27);
  group.add(monitorLight);
  monitorLight.position.copy(group.worldToLocal(screenCenter.clone().addScaledVector(screenNormal, 0.02)));
  monitorLight.lookAt(screenCenter.clone().addScaledVector(screenNormal, 1));

  // Cheaper stand-ins for the three area lights, used below the "high" preset.
  // They sit behind the glass / in front of the screen so their falloff resembles the area lights.
  const windowNorthPoint = new PointLight(0xffffff, 0, 0, 2);
  windowNorthPoint.position.set(-GN / 2, gy, -2.5);
  const windowEastPoint = new PointLight(0xffffff, 0, 0, 2);
  windowEastPoint.position.set(2.5, gy, GE / 2);
  const monitorPoint = new PointLight(0xffe6c4, 0, 4, 2);
  monitorPoint.position.copy(group.worldToLocal(screenCenter.clone().addScaledVector(screenNormal, 0.12)));
  group.add(windowNorthPoint, windowEastPoint, monitorPoint);

  group.updateMatrixWorld(true);
  return {
    group,
    lights: {
      sun, sunTarget, windowNorth, windowEast, fill, ceiling, pendants, lamp, monitorLight,
      windowNorthPoint, windowEastPoint, monitorPoint,
      windowAreaNorth: GN * gh,
      windowAreaEast: GE * gh,
    },
    screenContent,
    screenMaterial,
    lampGlowMaterial,
    bulbMaterial,
    fixtureMaterial,
    globeMaterial,
    domeInnerMaterial: domeInner,
    anchors: {
      screen: screenCenter,
      lamp: bulb.getWorldPosition(new Vector3()),
      centre: new Vector3(-W / 2, 1.2, D / 2).add(ROOM_ORIGIN),
    },
  };
}
