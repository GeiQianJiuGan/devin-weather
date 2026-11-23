import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, RepeatWrapping } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/utils.js';
import { ROOM } from '../core/layout.js';
import { broadLeafPlant, flowerArrangement, leafyPlant } from './Plants.js';
import { artPrintTexture, linenTexture, reededGlassTexture, sheerCurtainTexture } from './textures.js';

// The half of the cafe away from the windows, which the free camera can turn to:
// panelled walls, the stair-hall entrance, a banquette with tables for two, a shared
// table, a reading corner by the bookcase and a curtained window. The stair-hall door is the only way in.
// `K` is the builder's kit of mesh helpers and shared materials.

export function buildBack(K) {
  const { group, M, mat, box, rbox, slab, cyl, lathe, stick, v, chair, table, cup, blob, pendantDome, TABLE_TOP } = K;
  const { w: W, d: D, h: H, glassNorth: GN, glassEast: GE } = ROOM;
  const rng = new Rng(77);

  // a frame standing against a wall: local X runs along the wall, local Z points into the room
  const against = (x, z, rotY) => {
    const g = new Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    group.add(g);
    return g;
  };
  const SOUTH = Math.PI;
  const WEST = Math.PI / 2;
  const EAST = -Math.PI / 2;

  // --- wall panelling -------------------------------------------------------------------
  const PANEL_H = 1.02;
  const panelling = (g, length) => {
    box(length, PANEL_H, 0.024, M.cabinet, 0, PANEL_H / 2, 0.012, g);
    box(length, 0.13, 0.04, M.cabinet, 0, 0.065, 0.02, g);
    slab(length, 0.04, 0.055, M.oak, 0, PANEL_H + 0.02, 0.0275, g);
    const n = Math.max(1, Math.round(length / 0.56));
    for (let k = 0; k <= n; k++) {
      const x = Math.min(Math.max(-length / 2 + (k * length) / n, -length / 2 + 0.035), length / 2 - 0.035);
      box(0.07, PANEL_H - 0.13, 0.036, M.cabinet, x, 0.13 + (PANEL_H - 0.13) / 2, 0.018, g);
    }
    box(length, 0.07, 0.036, M.cabinet, 0, PANEL_H - 0.035, 0.018, g);
  };
  const doorX = -6.75; // entrance, centre
  const doorHalf = 0.84;
  panelling(against(-W, D / 2, WEST), D);
  panelling(against(-(W + GN) / 2, 0, 0), W - GN);
  panelling(against(0, (D + GE) / 2, EAST), D - GE);
  for (const [a, b] of [[-W, doorX - doorHalf], [doorX + doorHalf, 0]]) {
    panelling(against((a + b) / 2, D, SOUTH), b - a);
  }
  // plaster cornice where the walls meet the ceiling
  for (const [x, z, rot, len] of [[-W, D / 2, WEST, D], [-W / 2, D, SOUTH, W], [-(W + GN) / 2, 0, 0, W - GN], [0, (D + GE) / 2, EAST, D - GE]]) {
    const g = against(x, z, rot);
    box(len, 0.09, 0.05, M.ceiling, 0, H - 0.045, 0.025, g).castShadow = false;
    box(len, 0.04, 0.09, M.ceiling, 0, H - 0.02, 0.045, g).castShadow = false;
  }

  // --- entrance from the stair hall ---------------------------------------------------------
  const reeded = reededGlassTexture();
  reeded.repeat.set(2, 1);
  const privacyGlass = new MeshStandardMaterial({
    map: reeded, color: 0xaab5b0, roughness: 0.16, emissive: 0x6b5a44, emissiveMap: reeded, emissiveIntensity: 0.1,
  });
  const entrance = against(doorX, D, SOUTH);
  const DH = 2.24;
  for (const s of [-1, 1]) box(0.08, DH + 0.08, 0.15, M.frame, s * (doorHalf - 0.04), (DH + 0.08) / 2, 0.02, entrance);
  box(doorHalf * 2, 0.08, 0.15, M.frame, 0, DH + 0.04, 0.02, entrance);
  box(doorHalf * 2 - 0.16, DH, 0.02, M.black, 0, DH / 2, -0.03, entrance);
  const leafW = doorHalf - 0.085;
  for (const s of [-1, 1]) {
    const x = s * (leafW / 2 + 0.003);
    box(leafW, DH - 0.01, 0.044, M.frame, x, DH / 2, 0.03, entrance);
    box(leafW - 0.16, 1.52, 0.05, privacyGlass, x, 1.36, 0.03, entrance);
    box(leafW - 0.16, 0.03, 0.054, M.frame, x, 1.36, 0.03, entrance);
    box(leafW - 0.04, 0.3, 0.048, M.brass, x, 0.19, 0.03, entrance); // kick plate
    // pull handle on two standoffs
    const hx = s * 0.075;
    stick(v(hx, 0.92, 0.1), v(hx, 1.42, 0.1), 0.011, M.brass, entrance);
    for (const y of [1.0, 1.34]) stick(v(hx, y, 0.05), v(hx, y, 0.1), 0.007, M.brass, entrance);
    rbox(0.24, 0.05, 0.055, 0.008, M.steelBrushed, s * (leafW - 0.2), DH - 0.09, 0.08, entrance); // closer
    stick(v(s * (leafW - 0.3), DH - 0.09, 0.09), v(s * (leafW - 0.02), DH + 0.02, 0.1), 0.006, M.steelBrushed, entrance);
  }
  box(1.5, 0.014, 0.9, mat(0x3b3027, 1), 0, 0.007, 0.56, entrance); // coir mat
  box(1.56, 0.008, 0.96, M.black, 0, 0.004, 0.56, entrance);
  // umbrella stand between the door and the banquette
  const ux = doorX + doorHalf + 0.2;
  lathe([[0, 0], [0.11, 0], [0.115, 0.01], [0.115, 0.5], [0.12, 0.51], [0.105, 0.51], [0.105, 0.02], [0, 0.02]], M.brass, ux, 0, D - 0.2);
  for (const [dx, dz, lean, tint] of [[0.03, 0.02, 0.05, M.black], [-0.04, -0.01, -0.06, M.cabinet]]) {
    stick(v(ux + dx, 0.03, D - 0.2 + dz), v(ux + dx + lean, 0.86, D - 0.2 + dz - 0.03), 0.02, tint, undefined, 0.013);
    const crook = new Group();
    crook.position.set(ux + dx + lean, 0.86, D - 0.2 + dz - 0.03);
    group.add(crook);
    stick(v(0, 0, 0), v(lean * 0.2, 0.1, -0.004), 0.008, M.oak, crook);
    stick(v(lean * 0.2, 0.1, -0.004), v(lean * 0.2 + 0.05, 0.12, -0.004), 0.008, M.oak, crook);
  }

  // --- banquette with tables for two --------------------------------------------------------
  const leather = mat(0x8a4a28, 0.52);
  const BL = 3.3;
  const bcx = -3.9;
  const banquette = against(bcx, D, SOUTH);
  box(BL - 0.06, 0.07, 0.48, M.black, 0, 0.035, 0.27, banquette);
  box(BL, 0.3, 0.56, M.walnut, 0, 0.22, 0.28, banquette);
  rbox(BL, 0.13, 0.57, 0.035, leather, 0, 0.43, 0.3, banquette);
  const ribs = Math.round(BL / 0.2);
  for (let k = 0; k < ribs; k++) {
    rbox(BL / ribs - 0.006, 0.6, 0.12, 0.04, leather, -BL / 2 + (k + 0.5) * (BL / ribs), 0.8, 0.07, banquette).rotation.x = -0.06;
  }
  slab(BL + 0.06, 0.035, 0.17, M.oak, 0, 1.125, 0.085, banquette);
  for (const s of [-1, 1]) box(0.035, 1.11, 0.6, M.walnut, s * (BL / 2 + 0.0175), 0.555, 0.3, banquette);
  const tz = D - 0.98;
  [-1.1, 0, 1.1].forEach((dx, i) => {
    const x = bcx + dx;
    table(x, tz);
    chair(x + (i - 1) * 0.04, tz - 0.6, (i - 1) * 0.22);
    blob(1.3, 1.5, x, tz - 0.2, 0.4);
    if (i !== 1) {
      const bunch = flowerArrangement(31 + i * 4, 0.11, 5);
      bunch.position.set(x + 0.08, TABLE_TOP, tz + 0.1);
      group.add(bunch);
    }
  });
  cup(bcx + 0.1, TABLE_TOP, tz - 0.08, group, { rot: 2.2 });
  // prints over the banquette
  const print = (g, x, y, w, h, seed, frame) => {
    box(w + 0.05, h + 0.05, 0.028, frame, x, y, 0.016, g);
    const face = new Mesh(new PlaneGeometry(w, h), new MeshStandardMaterial({ map: artPrintTexture(seed), roughness: 0.9 }));
    face.position.set(x, y, 0.0305);
    face.receiveShadow = true;
    g.add(face);
  };
  [-1.1, 0, 1.1].forEach((dx, i) => print(banquette, dx, 1.95 + (i === 1 ? 0.06 : 0), i === 1 ? 0.72 : 0.54, i === 1 ? 0.96 : 0.72, 5 + i * 3, i === 1 ? M.oak : M.black));

  // --- shared table --------------------------------------------------------------------
  const sx = -4.4;
  const sz = 4.1;
  slab(2.3, 0.045, 0.88, M.oak, sx, 0.7275, sz);
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) box(0.07, 0.705, 0.07, M.oak, sx + a * 1.02, 0.3525, sz + b * 0.34);
    box(0.045, 0.07, 0.61, M.oak, sx + a * 1.02, 0.62, sz);
  }
  box(1.97, 0.07, 0.045, M.oak, sx, 0.3, sz);
  for (const a of [-1, 1]) box(0.045, 0.07, 0.61, M.oak, sx + a * 1.02, 0.3, sz);
  [-0.72, 0, 0.72].forEach((dx, i) => {
    chair(sx + dx + 0.03 * (i - 1), sz - 0.66, 0.1 * (1 - i));
    chair(sx + dx - 0.02 * i, sz + 0.66, Math.PI + 0.12 * (i - 1));
  });
  blob(2.9, 2.3, sx, sz, 0.5);
  const centrepiece = flowerArrangement(4, 0.2, 11);
  centrepiece.position.set(sx + 0.1, 0.75, sz);
  group.add(centrepiece);
  cup(sx - 0.62, 0.75, sz - 0.2, group, { rot: 1.1 });
  for (let k = 0; k < 3; k++) rbox(0.21, 0.006, 0.28, 0.002, k === 1 ? M.kraft : M.paper, sx + 0.72, 0.753 + k * 0.006, sz + 0.12).rotation.y = 0.2 + k * 0.17;
  [-0.62, 0, 0.62].forEach((dx) => pendantDome(sx + dx, 2.02, sz));

  // --- bookcase and reading corner on the west wall -----------------------------------------
  const BW = 3.0;
  const BHt = 2.3;
  const BD = 0.32;
  const bookcase = against(-W, 3.0, WEST);
  box(BW, BHt, 0.012, M.cabinet, 0, BHt / 2, 0.03, bookcase);
  const uprights = [-BW / 2 + 0.015, -BW / 6, BW / 6, BW / 2 - 0.015];
  for (const x of uprights) box(0.03, BHt, BD, M.oak, x, BHt / 2, BD / 2 + 0.03, bookcase);
  const levels = [0.06, 0.5, 0.92, 1.34, 1.76, 2.18];
  for (const y of levels) slab(BW - 0.03, 0.028, BD - 0.01, M.oak, 0, y, BD / 2 + 0.03, bookcase);
  slab(BW + 0.04, 0.035, BD + 0.03, M.oak, 0, BHt + 0.0175, BD / 2 + 0.035, bookcase);
  const spines = [0x7a2e24, 0x2c4636, 0x1f3048, 0xcdbf9f, 0xb98a3a, 0x4a3a33, 0xe8e2d4, 0x8c5a4a, 0x55606b].map((c) => mat(c, 0.8));
  const batches = spines.map(() => []);
  const book = (w, h, d, x, y, z, tilt = 0, flatways = false) => {
    const g = new BoxGeometry(w, h, d);
    if (flatways) g.rotateZ(Math.PI / 2);
    else if (tilt) g.rotateZ(tilt);
    g.translate(x, y, z);
    batches[rng.int(0, spines.length - 1)].push(g);
  };
  const stoneware = [M.porcelain, M.stoneware, mat(0xb86f4c, 0.7), mat(0x2f3d4a, 0.45)];
  for (let bay = 0; bay < 3; bay++) {
    const x0 = uprights[bay] + 0.03;
    const x1 = uprights[bay + 1] - 0.03;
    for (let l = 0; l < levels.length - 1; l++) {
      const y = levels[l] + 0.014;
      const zc = BD / 2 + 0.04;
      const kind = (bay * 3 + l * 5 + rng.int(0, 2)) % 6;
      let x = x0 + rng.range(0.01, 0.05);
      const row = (until) => {
        while (x < until) {
          const w = rng.range(0.022, 0.05);
          const h = rng.range(0.19, 0.3);
          book(w, h, rng.range(0.15, 0.21), x + w / 2, y + h / 2, zc - 0.02);
          x += w + 0.002;
        }
        // the last one leans on the row
        const h = rng.range(0.2, 0.26);
        book(0.03, h, 0.17, x + 0.045, y + h / 2 - 0.004, zc - 0.02, 0.2);
        x += 0.13;
      };
      if (kind <= 2) row(x0 + (x1 - x0) * rng.range(0.45, 0.8));
      if (kind === 1 || kind === 3) {
        // a pile lying flat with something on top
        const px = Math.min(x + 0.16, x1 - 0.15);
        let top = y;
        for (let k = 0; k < rng.int(3, 5); k++) {
          const t = rng.range(0.022, 0.04);
          book(t, rng.range(0.2, 0.27), 0.17, px + rng.range(-0.01, 0.01), top + t / 2, zc - 0.01, 0, true);
          top += t;
        }
        lathe([[0, 0], [0.03, 0], [0.045, 0.03], [0.04, 0.08], [0.02, 0.1], [0.024, 0.11], [0, 0.105]], rng.pick(stoneware), px, top, zc, bookcase);
      }
      if (kind === 3 || kind === 4) {
        // bags of beans, front to back
        for (let k = 0; k < 3; k++) {
          const bx = x0 + 0.12 + k * 0.17;
          rbox(0.13, 0.2, 0.07, 0.012, k === 1 ? M.black : M.kraft, bx, y + 0.1, zc, bookcase);
          box(0.08, 0.07, 0.002, M.paper, bx, y + 0.1, zc + 0.036, bookcase).castShadow = false;
          box(0.13, 0.02, 0.02, k === 1 ? M.black : M.kraft, bx, y + 0.21, zc, bookcase);
        }
      }
      if (kind === 4 || kind === 5) {
        const px = x1 - rng.range(0.14, 0.3);
        if (l >= 2 && rng.next() > 0.4) {
          const plant = broadLeafPlant(40 + bay * 7 + l, 0.045, 0.07);
          plant.position.set(px, y, zc);
          bookcase.add(plant);
        } else {
          lathe([[0, 0], [0.04, 0], [0.065, 0.05], [0.07, 0.13], [0.045, 0.2], [0.03, 0.24], [0.036, 0.26], [0, 0.25]], rng.pick(stoneware), px, y, zc, bookcase, 28);
        }
      }
      if (kind === 5) {
        for (let k = 0; k < 3; k++) cup(x0 + 0.1 + k * 0.13, y, zc, bookcase, { rot: k * 1.3 + 2 });
      }
    }
  }
  batches.forEach((geos, i) => {
    if (!geos.length) return;
    const m = new Mesh(mergeGeometries(geos), spines[i]);
    m.castShadow = true;
    m.receiveShadow = true;
    bookcase.add(m);
  });

  const wool = linenTexture([118, 130, 112]);
  wool.repeat.set(3, 3);
  const upholstery = new MeshStandardMaterial({ map: wool, roughness: 0.95 });
  const armchair = (x, z, rotY) => {
    const g = new Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    group.add(g);
    for (const a of [-1, 1]) for (const b of [-1, 1]) stick(v(a * 0.3, 0, b * 0.3), v(a * 0.26, 0.24, b * 0.25), 0.014, M.oak, g, 0.02);
    rbox(0.7, 0.1, 0.68, 0.03, upholstery, 0, 0.28, 0, g);
    rbox(0.52, 0.13, 0.56, 0.05, upholstery, 0, 0.385, 0.04, g);
    rbox(0.7, 0.52, 0.15, 0.06, upholstery, 0, 0.58, -0.28, g).rotation.x = -0.2;
    for (const a of [-1, 1]) rbox(0.11, 0.3, 0.64, 0.045, upholstery, a * 0.3, 0.45, 0.01, g);
    rbox(0.36, 0.3, 0.1, 0.045, mat(0xc9a36a, 0.9), 0.02, 0.58, -0.16, g).rotation.set(-0.3, 0, 0.08);
    return g;
  };
  const nx = -7.15;
  const rugTex = linenTexture([172, 150, 126]);
  rugTex.wrapS = rugTex.wrapT = RepeatWrapping;
  rugTex.repeat.set(4, 6);
  const rug = box(1.9, 0.012, 2.7, new MeshStandardMaterial({ map: rugTex, roughness: 1 }), nx, 0.006, 3.0);
  rug.castShadow = false;
  box(1.7, 0.013, 2.5, new MeshStandardMaterial({ map: rugTex, color: 0x9aa59a, roughness: 1 }), nx, 0.0065, 3.0).castShadow = false;
  armchair(nx + 0.05, 2.05, 0.12);
  armchair(nx - 0.02, 3.95, Math.PI - 0.15);
  blob(1.1, 1.1, nx, 2.05, 0.5);
  blob(1.1, 1.1, nx, 3.95, 0.5);
  lathe([[0, 0], [0.3, 0], [0.31, 0.012], [0.3, 0.026], [0, 0.026]], M.walnut, nx + 0.12, 0.4, 3.0, group, 48);
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094 + 0.4;
    stick(v(nx + 0.12 + Math.cos(a) * 0.22, 0, 3.0 + Math.sin(a) * 0.22), v(nx + 0.12 + Math.cos(a) * 0.14, 0.4, 3.0 + Math.sin(a) * 0.14), 0.011, M.iron);
  }
  for (let k = 0; k < 2; k++) rbox(0.15, 0.022, 0.21, 0.004, k ? M.cabinet : M.paper, nx + 0.06, 0.437 + k * 0.022, 3.06).rotation.y = 0.4 + k * 0.3;
  cup(nx + 0.24, 0.426, 2.9, group, { rot: 0.4 });

  // --- shelves behind the counter ---------------------------------------------------------
  const shelves = against(0, (D + GE) / 2, EAST);
  const SL = D - GE - 0.5;
  for (const y of [1.36, 1.78]) {
    slab(SL, 0.03, 0.24, M.oak, 0, y, 0.12, shelves);
    for (const s of [-1, 1]) {
      box(0.02, 0.16, 0.02, M.brass, s * (SL / 2 - 0.2), y - 0.095, 0.012, shelves);
      stick(v(s * (SL / 2 - 0.2), y - 0.17, 0.02), v(s * (SL / 2 - 0.2), y - 0.016, 0.2), 0.006, M.brass, shelves);
    }
    for (let k = 0; k < 7; k++) {
      const x = -SL / 2 + 0.16 + k * ((SL - 0.32) / 6);
      if (y < 1.5) {
        for (let j = 0; j < 1 + (k % 3); j++) cup(x, y + 0.015 + j * 0.034, 0.12, shelves, { saucer: false, rot: k + j, material: k % 2 ? M.stoneware : M.porcelain });
      } else if (k % 3 === 2) {
        lathe([[0, 0], [0.04, 0], [0.06, 0.04], [0.06, 0.12], [0.035, 0.17], [0.04, 0.185], [0, 0.18]], M.stoneware, x, y + 0.015, 0.12, shelves, 24);
      } else {
        rbox(0.12, 0.19, 0.07, 0.012, k % 2 ? M.kraft : M.black, x, y + 0.11, 0.12, shelves);
      }
    }
  }

  // --- window on the west wall ---------------------------------------------------------------
  // It gives onto the light well, so a sheer curtain stays drawn across it; the daylight comes through.
  const win = against(-W, 5.7, WEST);
  const WW = 1.5;
  const wy0 = PANEL_H + 0.1;
  const wy1 = 2.62;
  const wyc = (wy0 + wy1) / 2;
  for (const s of [-1, 1]) box(0.09, wy1 - wy0 + 0.18, 0.05, M.wall, s * (WW / 2 + 0.045), wyc, 0.025, win);
  box(WW + 0.26, 0.09, 0.06, M.wall, 0, wy1 + 0.045, 0.03, win);
  slab(WW + 0.3, 0.04, 0.16, M.oak, 0, wy0 - 0.02, 0.08, win);
  box(WW, wy1 - wy0, 0.01, M.frame, 0, wyc, 0.006, win);
  const CW = WW + 0.5;
  const CH = wy1 + 0.16 - wy0;
  const curtainGeo = new PlaneGeometry(CW, CH, 96, 1);
  const cp = curtainGeo.getAttribute('position');
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i);
    // pleats gathered at the rod, falling looser towards the hem
    const loose = cp.getY(i) < 0 ? 1.25 : 0.8;
    cp.setZ(i, (Math.sin(x * 46) * 0.018 + Math.sin(x * 19 + 1.3) * 0.008) * loose);
  }
  curtainGeo.computeVertexNormals();
  const curtainMaterial = new MeshStandardMaterial({
    color: 0xe9e4d8, roughness: 0.95, emissive: 0x000000, emissiveMap: sheerCurtainTexture(),
  });
  const curtain = new Mesh(curtainGeo, curtainMaterial);
  curtain.position.set(0, wy0 + CH / 2 + 0.01, 0.1);
  curtain.receiveShadow = true;
  win.add(curtain);
  stick(v(-CW / 2 - 0.06, wy1 + 0.19, 0.1), v(CW / 2 + 0.06, wy1 + 0.19, 0.1), 0.011, M.brass, win);
  for (const s of [-1, 1]) {
    stick(v(s * (CW / 2 - 0.05), wy1 + 0.19, 0), v(s * (CW / 2 - 0.05), wy1 + 0.19, 0.1), 0.007, M.brass, win);
    lathe([[0, 0], [0.02, 0.004], [0.024, 0.02], [0.016, 0.036], [0, 0.04]], M.brass, 0, 0, 0, win, 16).position.set(s * (CW / 2 + 0.06), wy1 + 0.19, 0.1);
    win.children[win.children.length - 1].rotation.z = -s * Math.PI / 2;
  }

  // --- greenery -------------------------------------------------------------------------
  for (const [seed, scale, x, z] of [[11, 3.1, -7.7, 0.72], [19, 2.6, -8.0, 6.55]]) {
    const plant = leafyPlant(seed, 0.058, 0.1);
    plant.scale.setScalar(scale);
    plant.position.set(x, 0, z);
    group.add(plant);
    blob(0.6, 0.6, x, z, 0.5);
  }
  return { curtainMaterial };
}
