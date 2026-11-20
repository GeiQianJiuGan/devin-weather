import { MeshStandardMaterial } from 'three';
import { ext } from './sharedUniforms.js';
import { makeShopSignAtlas } from './signs.js';

// One instanced material for every building. Facades are generated in the
// fragment shader from per-instance attributes: window grid, lit windows at
// night (deterministic per window), ground-floor shop fronts with sign bands,
// roofs, wetness and snow. Distant facades fade to their average so the
// pattern never aliases.

const VERT_PARS = /* glsl */ `
attribute vec3 aSize;
attribute vec4 aStyle;
attribute vec3 aTint;
attribute vec4 aMisc;
varying vec3 vBPos;
varying vec3 vBNrm;
varying vec3 vBSize;
varying vec4 vBStyle;
varying vec3 vBTint;
varying vec4 vBMisc;
`;

const VERT_BEGIN = /* glsl */ `
vBPos = position * aSize;
vBNrm = normal;
vBSize = aSize;
vBStyle = aStyle;
vBTint = aTint;
vBMisc = aMisc;
`;

const FRAG_PARS = /* glsl */ `
uniform float uCityLights;
uniform float uWindowGain;
uniform vec3 uSkyRefl;
uniform float uWet;
uniform float uSnow;
uniform sampler2D uSignAtlas;
varying vec3 vBPos;
varying vec3 vBNrm;
varying vec3 vBSize;
varying vec4 vBStyle;
varying vec3 vBTint;
varying vec4 vBMisc;

float bHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 bHash3(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
float bNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bHash(i), bHash(i + vec2(1.0, 0.0)), f.x),
             mix(bHash(i + vec2(0.0, 1.0)), bHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float bBand(float x, float lo, float hi, float aa) {
  return smoothstep(lo - aa, lo + aa, x) - smoothstep(hi - aa, hi + aa, x);
}
vec3 bSignColor(float h) {
  if (h < 0.2) return vec3(1.0, 0.13, 0.10);
  if (h < 0.4) return vec3(1.0, 0.58, 0.10);
  if (h < 0.6) return vec3(0.10, 0.90, 0.80);
  if (h < 0.75) return vec3(1.0, 0.25, 0.60);
  if (h < 0.9) return vec3(1.0, 0.95, 0.85);
  return vec3(0.25, 1.0, 0.40);
}
`;

const FRAG_COLOR = /* glsl */ `
vec3 bAlb = vec3(0.2);
vec3 bEmit = vec3(0.0);
float bRough = 0.9;
float bGlass = 0.0;
{
  vec3 lp = vBPos;
  vec3 bsize = vBSize;
  // snapped: hashes amplify varying-interpolation error into per-pixel speckle
  float seed = floor(vBMisc.x * 64.0 + 0.5) / 64.0;
  float litBias = vBMisc.y;
  float shop = vBMisc.z;
  float kind = floor(vBMisc.w + 0.5);

  // facade coordinates in metres (branch-free so derivatives stay valid)
  float isX = step(0.5, abs(vBNrm.x));
  float faceW = mix(bsize.x, bsize.z, isX);
  float fu = mix(lp.x, lp.z, isX) + faceW * 0.5;
  float fv = lp.y;
  float faceId = isX * (1.0 + step(0.0, vBNrm.x)) + (1.0 - isX) * (3.0 + step(0.0, vBNrm.z));
  float cols = max(1.0, floor(faceW / vBStyle.x + 0.5));
  float cw = faceW / cols;
  float groundH = mix(1.0, 4.4, shop);
  float floorsN = max(1.0, floor((bsize.y - groundH - 0.9) / vBStyle.y));
  float fh = (bsize.y - groundH - 0.9) / floorsN;
  vec2 g = vec2(fu / cw, (fv - groundH) / fh);
  vec2 gfw = fwidth(g);
  float fwU = max(fwidth(fu), 1e-4);
  float fwV = max(fwidth(fv), 1e-4);

  if (vBNrm.y > 0.5) {
    bAlb = vec3(0.15, 0.15, 0.16) * (0.8 + 0.4 * bNoise(lp.xz * 0.6 + seed));
    float snTh = 1.0 - uSnow * 1.3;
    float snow = smoothstep(snTh, snTh + 0.3, bNoise(lp.xz * 0.3 + seed * 3.0)) * step(0.001, uSnow);
    bAlb = mix(bAlb, vec3(0.82, 0.86, 0.92), snow);
    bRough = 0.95;
  } else if (vBNrm.y < -0.5) {
    bAlb = vec3(0.04);
  } else {
    float wn = bNoise(vec2(fu, fv) * 0.35 + seed);
    vec2 id = floor(g);
    vec2 fc = fract(g);
    float inFloors = step(0.0, g.y) * step(g.y, floorsN);
    vec2 aa = max(gfw * 0.7, vec2(1e-4));
    vec2 dd = abs(fc - 0.5) - 0.5 * vBStyle.zw;
    float win = (1.0 - smoothstep(-aa.x, aa.x, dd.x)) * (1.0 - smoothstep(-aa.y, aa.y, dd.y)) * inFloors;
    float lod = smoothstep(0.25, 0.9, max(gfw.x, gfw.y));
    // far away the columns merge first: keep the floor bands readable for much longer than the single windows
    float lodY = smoothstep(0.3, 1.0, gfw.y);
    float rowWin = (1.0 - smoothstep(-aa.y, aa.y, dd.y)) * vBStyle.z * inFloors;
    float winL = mix(win, mix(rowWin, vBStyle.z * vBStyle.w * inFloors, lodY), lod);

    vec3 r = bHash3(id + vec2(seed * 17.0 + faceId * 31.0, seed * 7.0));
    float rowR = bHash(vec2(id.y, seed * 5.0 + faceId));
    float office = step(0.5, kind);
    float litP = clamp(uCityLights * litBias, 0.0, 1.0);
    float isLit = step(1.0 - litP, mix(r.x, rowR, office * 0.55));

    vec3 warm = vec3(1.0, 0.62, 0.30);
    vec3 neutral = vec3(1.0, 0.80, 0.56);
    vec3 cool = vec3(0.70, 0.84, 1.0);
    vec3 lc = r.y < 0.55 ? warm : (r.y < 0.88 ? neutral : (r.y < 0.95 ? cool : vec3(0.4, 0.55, 1.0)));
    lc = mix(lc, r.y < 0.7 ? cool : neutral, office);
    float inner = 0.78 + 0.22 * bNoise(fc * vec2(3.0, 5.0) + id * 1.7);
    float mull = 1.0 - (1.0 - smoothstep(0.012, 0.03, abs(fc.x - 0.5))) * step(0.45, vBStyle.z) * (1.0 - lod);
    vec3 emitWin = lc * (0.25 + 0.9 * r.z * r.z) * inner * isLit * uWindowGain * mull;
    float rowLit = mix(0.35, 1.5, step(1.0 - litP, rowR)) * mix(0.75, 1.25, bHash(vec2(id.y * 3.0 + faceId, seed)));
    vec3 emitAvg = mix(warm, cool, office * 0.7) * 0.55 * litP * uWindowGain * mix(rowLit, 1.0, lodY);
    bEmit = mix(emitWin, emitAvg, lod) * winL;

    vec3 wall = vBTint * (0.9 + 0.2 * wn) * (0.94 + 0.12 * bHash(id + seed) * (1.0 - lod));
    float slab = (1.0 - smoothstep(0.02, 0.05, fc.y)) * inFloors * (1.0 - lod);
    wall *= 1.0 - 0.18 * slab;
    wall *= 0.84 + 0.16 * smoothstep(0.0, 3.0, fv);
    // massing detail that survives distance: corner piers, structural bays, belt courses, coping
    float edgeD = min(fu, faceW - fu);
    float pier = 1.0 - smoothstep(0.55 - fwU, 0.55 + fwU, edgeD);
    float bayN = max(1.0, floor(cols / 4.0 + 0.5));
    float bayF = abs(fract(fu / faceW * bayN + 0.5) - 0.5) * faceW / bayN;
    float bayPier = (1.0 - smoothstep(0.22 - fwU, 0.22 + fwU, bayF)) * office * (1.0 - smoothstep(0.5, 2.5, fwU));
    float beltEvery = 6.0 + floor(seed * 0.07);
    float belt = step(mod(id.y, beltEvery), 0.5) * (1.0 - smoothstep(0.1, 0.16, fc.y)) * inFloors * step(0.5, id.y) * (1.0 - lodY);
    float coping = smoothstep(bsize.y - 0.45 - fwV, bsize.y - 0.45 + fwV, fv);
    vec3 trimC = mix(wall * 1.22 + 0.03, wall * 0.62, step(0.5, fract(seed * 0.37)));
    float mechBand = step(60.0, bsize.y) * bBand(fv, bsize.y - 5.2, bsize.y - 0.9, fwV);
    float louvre = 0.75 + 0.25 * step(0.5, fract(fv * 2.2)) * (1.0 - smoothstep(0.1, 0.35, fwV));

    // masonry: brick courses on punched-window buildings, fading out with distance
    float brickLod = 1.0 - smoothstep(0.012, 0.045, fwV);
    float masonry = (1.0 - step(0.5, kind)) * brickLod;
    float course = fv / 0.085;
    float brickU = fu / 0.24 + 0.5 * mod(floor(course), 2.0);
    vec2 bf2 = vec2(fract(brickU), fract(course));
    float mortar = 1.0 - smoothstep(0.02, 0.07, bf2.x) * smoothstep(0.06, 0.2, bf2.y);
    float brickTone = bHash(vec2(floor(brickU), floor(course)) + seed);
    wall = mix(wall, wall * (0.78 + 0.4 * brickTone), masonry * 0.8);
    wall = mix(wall, wall * 0.55 + vec3(0.1, 0.095, 0.09), mortar * masonry * 0.7);
    // rain streaks and grime under the window sills and along the parapet
    float streak = bNoise(vec2(fu * 3.1 + seed, fv * 0.22)) * (1.0 - lod);
    wall *= 1.0 - 0.16 * streak * smoothstep(0.55, 0.0, fc.y) * inFloors;
    wall *= 1.0 - 0.22 * smoothstep(bsize.y - 1.4, bsize.y, fv) * (0.5 + 0.5 * streak);

    // window surround: pale frame, sill below, soft shadow of the reveal at the top
    vec2 fr = vec2(0.055 / cw, 0.07 / fh);
    vec2 ddO = dd - fr;
    float surround = (1.0 - smoothstep(-aa.x, aa.x, ddO.x)) * (1.0 - smoothstep(-aa.y, aa.y, ddO.y)) * inFloors * (1.0 - lod);
    vec3 frameC = mix(vec3(0.62, 0.6, 0.56), vec3(0.09, 0.095, 0.105), step(0.5, kind));
    wall = mix(wall, frameC * (0.85 + 0.15 * wn), surround);
    float reveal = smoothstep(0.5 * vBStyle.w - 0.16, 0.5 * vBStyle.w, fc.y - 0.5) * (1.0 - lod);

    float blind = step(0.78, r.z) * (1.0 - isLit) * (1.0 - lod);
    vec3 glassC = mix(vec3(0.025, 0.035, 0.05), vec3(0.42, 0.40, 0.36), blind * 0.8);
    glassC = mix(glassC, glassC * (0.6 + 0.8 * vBTint), step(1.5, kind) * 0.5);
    // curtains drawn part-way across some lit windows
    float curtain = step(0.55, r.x) * (1.0 - office) * (1.0 - lod) * step(abs(fc.x - 0.5), 0.5 * vBStyle.z) * smoothstep(0.5 * vBStyle.z * (0.25 + 0.6 * r.z), 0.5 * vBStyle.z * (0.25 + 0.6 * r.z) + 0.02, abs(fc.x - 0.5));
    bEmit *= 1.0 - 0.45 * curtain;
    bEmit *= 1.0 - 0.35 * reveal;
    glassC = mix(glassC, vec3(0.34, 0.31, 0.27), curtain * 0.6);
    float solid = max(max(pier, bayPier), max(belt, coping));
    winL *= (1.0 - solid) * (1.0 - mechBand);
    bEmit *= (1.0 - solid) * (1.0 - mechBand);
    wall = mix(wall, trimC, max(max(pier, bayPier) * 0.8, max(belt, coping)));
    wall = mix(wall, vBTint * 0.42 * louvre, mechBand * (1.0 - pier));
    bAlb = mix(wall, glassC * mull * (1.0 - 0.5 * reveal), winL);
    bGlass = winL * (1.0 - blind) * (1.0 - 0.7 * curtain);
    bRough = mix(0.9, 0.12, bGlass);

    // ---- ground-floor shop fronts: stone pilasters and cornice, painted fascia signs from the
    // atlas, timber shopfront with stall riser, glazed door and transom, awnings, lit interiors
    float bays = max(1.0, floor(faceW / 5.2 + 0.5));
    float bw = faceW / bays;
    float bid = floor(fu / bw);
    float bx = fu - bid * bw; // metres inside the bay
    vec3 sr = bHash3(vec2(bid + seed * 9.0, faceId + seed));
    vec3 sr2 = bHash3(vec2(bid * 3.0 + faceId * 5.0, seed * 13.0));
    const float PIL = 0.24;
    // consecutive bays step through the atlas by 5 (coprime with 32): neighbours never repeat
    float signIdx = mod(bid * 5.0 + faceId * 7.0 + floor(seed) * 3.0, 32.0);
    vec2 sLocal = vec2((bx - PIL - 0.06) / (bw - 2.0 * PIL - 0.12), (fv - 3.3) / 0.76);
    vec2 sCell = vec2(mod(signIdx, 2.0), floor(signIdx / 2.0));
    vec2 sUv = vec2((sCell.x + clamp(sLocal.x, 0.004, 0.996)) / 2.0, 1.0 - (sCell.y + 1.0 - clamp(sLocal.y, 0.03, 0.97)) / 16.0);
    vec2 sDu = vec2(1.0 / ((bw - 2.0 * PIL - 0.12) * 2.0), 0.0);
    vec2 sDv = vec2(0.0, 1.0 / (0.76 * 16.0));
    vec3 signTex = textureGrad(uSignAtlas, sUv, sDu * dFdx(fu) + sDv * dFdx(fv), sDu * dFdy(fu) + sDv * dFdy(fv)).rgb;

    if (shop > 0.5 && fv < groundH) {
      float det = 1.0 - smoothstep(0.03, 0.12, fwU); // fine detail fades with distance
      float nightOn = smoothstep(0.12, 0.5, uCityLights);
      float open = step(0.1, sr.x);
      float edge = min(bx, bw - bx);
      // stone surround
      vec3 stone = mix(vec3(0.56, 0.54, 0.5), vBTint * 0.9 + 0.12, 0.45) * (0.88 + 0.2 * wn);
      stone *= 0.93 + 0.07 * bNoise(vec2(fu * 9.0, fv * 9.0) + seed);
      float pilaster = 1.0 - smoothstep(PIL - fwU, PIL + fwU, edge);
      float plinth = 1.0 - smoothstep(0.42 - fwV, 0.42 + fwV, fv);
      float capital = bBand(fv, 3.02, 3.2, fwV);
      float flute = 0.5 + 0.5 * cos(edge / PIL * 18.85);
      vec3 pilC = stone * (1.0 - 0.1 * flute * det * (1.0 - plinth) * (1.0 - capital));
      pilC = mix(pilC, stone * 0.62, plinth);
      pilC = mix(pilC, stone * 1.12, capital);
      float cornice = smoothstep(4.1 - fwV, 4.1 + fwV, fv);
      float corniceLip = bBand(fv, 4.1, 4.17, fwV);
      vec3 corniceC = stone * (1.05 - 0.35 * corniceLip) * (0.9 + 0.1 * smoothstep(4.17, 4.4, fv));
      // fascia
      float fasciaBox = bBand(fv, 3.24, 4.1, fwV) * (1.0 - pilaster);
      float inSign = bBand(sLocal.x, 0.0, 1.0, fwU / bw) * bBand(sLocal.y, 0.0, 1.0, fwV / 0.76);
      // shopfront joinery colour
      vec3 joinC = sr2.y < 0.2 ? vec3(0.045, 0.05, 0.055) : sr2.y < 0.4 ? vec3(0.06, 0.14, 0.1) : sr2.y < 0.6 ? vec3(0.2, 0.12, 0.07)
        : sr2.y < 0.8 ? vec3(0.07, 0.1, 0.19) : vec3(0.42, 0.06, 0.05);
      joinC = mix(joinC, signTex * 0.5, 0.25) * (0.9 + 0.2 * wn);
      // door position: centred or to one side
      float doorC = bw * (sr2.z < 0.4 ? 0.5 : (sr2.z < 0.7 ? 0.24 : 0.76));
      float dxr = abs(bx - doorC);
      float isDoor = 1.0 - smoothstep(0.52 - fwU, 0.52 + fwU, dxr);
      float riserH = 0.62;
      float inFront = (1.0 - pilaster) * (1.0 - smoothstep(3.24 - fwV, 3.24 + fwV, fv));
      // glazing: shop windows above the riser, door leaf glass, transom lights
      float gx = smoothstep(PIL + 0.07 - fwU, PIL + 0.07 + fwU, edge);
      float winG = gx * bBand(fv, riserH + 0.07, 2.36, fwV) * (1.0 - smoothstep(0.58 - fwU, 0.58 + fwU, dxr) * 0.0) * (1.0 - isDoor);
      winG *= smoothstep(0.58 - fwU, 0.58 + fwU, dxr) + 0.0;
      float transG = gx * bBand(fv, 2.46, 3.14, fwV);
      float doorG = (1.0 - smoothstep(0.4 - fwU, 0.4 + fwU, dxr)) * bBand(fv, 0.3, 2.24, fwV);
      doorG *= smoothstep(0.012, 0.012 + fwU, dxr) * 0.0 + 1.0;
      // glazing bars: mullions in the windows, small panes in the transom
      float mullW = 0.022;
      float mPitch = 1.15;
      float mull2 = 1.0 - smoothstep(mullW, mullW + fwU, abs(fract(bx / mPitch + 0.5) - 0.5) * mPitch);
      float tPitch = 0.46;
      float tBar = 1.0 - smoothstep(0.014, 0.014 + fwU, abs(fract(bx / tPitch + 0.5) - 0.5) * tPitch);
      float bars = max(mull2 * winG, tBar * transG * step(0.5, sr.z + 0.2)) * det;
      float glassMask = clamp(winG + transG + doorG, 0.0, 1.0) * open;
      // stall riser: recessed panels
      float riser = (1.0 - smoothstep(riserH - fwV, riserH + fwV, fv)) * (1.0 - isDoor) * inFront;
      float rp = abs(fract(bx / 0.62) - 0.5);
      float panel = smoothstep(0.08, 0.1, 0.5 - rp) * bBand(fv, 0.14, riserH - 0.1, fwV) * det;
      vec3 riserC = joinC * (1.0 - 0.35 * panel) + vec3(0.02) * panel;
      // door furniture: kick plate, push bar, threshold
      float kick = isDoor * bBand(fv, 0.06, 0.26, fwV);
      float handle = (1.0 - smoothstep(0.012, 0.012 + fwU, abs(dxr - 0.3))) * bBand(fv, 0.9, 1.35, fwV) * step(bx, doorC) * det;

      // interior seen through the glass
      float kindS = sr.y; // < 0.5 shelves of goods, else cafe / restaurant
      vec3 wallI = mix(vec3(0.62, 0.5, 0.36), vec3(0.5, 0.55, 0.58), step(0.72, sr.z));
      wallI = mix(wallI, signTex, 0.18);
      float depthShade = 0.45 + 0.55 * smoothstep(0.3, 3.1, fv);
      vec3 inter = wallI * depthShade;
      // floor
      inter = mix(inter, vec3(0.18, 0.14, 0.11), 1.0 - smoothstep(0.55, 1.0, fv));
      // shelving with goods
      float shRow = (fv - 0.75) / 0.42;
      float shelfLine = 1.0 - smoothstep(0.03, 0.08, fract(shRow));
      vec2 pc = vec2(floor(bx / 0.17), floor(shRow));
      vec3 ph = bHash3(pc + vec2(seed * 3.0, bid * 7.0));
      float pfill = step(0.28, ph.x) * step(fract(shRow), 0.25 + 0.6 * ph.y) * step(0.08, fract(shRow)) * step(0.06, fract(bx / 0.17));
      vec3 goods = mix(vec3(0.85, 0.8, 0.7), 0.25 + 0.75 * ph.zxy, 0.75);
      float shelfZone = bBand(fv, 0.75, 2.42, fwV) * step(kindS, 0.5) * det;
      inter = mix(inter, goods * (0.65 + 0.35 * ph.y), pfill * shelfZone);
      inter = mix(inter, vec3(0.12, 0.09, 0.07), shelfLine * shelfZone);
      // cafe: dark counter, bottles on a back shelf, warm pendants
      float cafeZone = step(0.5, kindS) * det;
      float counter = bBand(fv, 0.62, 1.22, fwV) * step(0.35, fract(bx / bw + sr.x));
      inter = mix(inter, vec3(0.16, 0.1, 0.07), counter * cafeZone);
      float bottle = step(0.4, bHash(vec2(floor(bx / 0.09), bid + seed))) * bBand(fv, 1.75, 2.02, fwV) * step(0.2, fract(bx / 0.09));
      inter = mix(inter, vec3(0.2, 0.5, 0.3) + 0.5 * ph.xyz, bottle * cafeZone * 0.8);
      float pendX = abs(fract(bx / 0.95 + sr.z) - 0.5) * 0.95;
      float pend = (1.0 - smoothstep(0.05, 0.12, length(vec2(pendX, (fv - 2.62) * 0.9)))) * det;
      float pendGlow = (1.0 - smoothstep(0.0, 0.75, length(vec2(pendX, fv - 2.5)))) * det;
      inter += vec3(1.0, 0.8, 0.5) * (pend * 1.6 + pendGlow * 0.22);
      // window decal: roundel logo on some windows
      float decal = bBand(length(vec2(bx - bw * 0.3, fv - 1.55)), 0.2, 0.235, fwU) * step(0.6, sr2.x) * winG * det;
      vec3 shopLight = mix(vec3(1.0, 0.8, 0.58), vec3(0.9, 0.95, 1.0), step(0.72, sr.z));
      vec3 eShop = inter * shopLight * (0.26 + 0.16 * sr.z) * (0.16 + 0.84 * nightOn);

      // roller shutter on closed shops
      float slat = 0.75 + 0.25 * step(0.5, fract(fv / 0.09));
      vec3 shutterC = vec3(0.33, 0.34, 0.35) * mix(1.0, slat, det) * (0.9 + 0.2 * wn);
      float shutter = (1.0 - open) * gx * bBand(fv, 0.06, 3.14, fwV);

      // compose
      vec3 c = joinC;
      c = mix(c, riserC, riser);
      c = mix(c, vec3(0.5, 0.42, 0.25), kick * 0.8);
      c = mix(c, vec3(0.02, 0.03, 0.035) + inter * 0.22, glassMask);
      c = mix(c, joinC * 1.15, bars);
      c = mix(c, vec3(0.92, 0.9, 0.84), decal * 0.8);
      c = mix(c, vec3(0.7, 0.6, 0.35), handle);
      c = mix(c, shutterC, shutter);
      // soffit shadow under the fascia
      c *= 1.0 - 0.3 * smoothstep(2.7, 3.24, fv) * inFront;
      bEmit = eShop * glassMask * (1.0 - bars) * (1.0 - decal * 0.6) * (1.0 - handle);
      bGlass = glassMask * (1.0 - bars) * 0.85;

      // fascia board and sign
      vec3 fasciaC = mix(joinC, signTex, inSign);
      float signLum = dot(signTex, vec3(0.3, 0.6, 0.1));
      c = mix(c, fasciaC, fasciaBox);
      // signs are lit from above by a trough light; pale lettering also glows a little
      float trough = 0.35 + 0.65 * smoothstep(0.0, 1.0, sLocal.y);
      bEmit = mix(bEmit, signTex * (0.55 * trough + 0.5 * signLum * signLum) * nightOn * inSign * (0.5 + 0.5 * step(0.1, sr.x)), fasciaBox);
      bGlass *= 1.0 - fasciaBox;

      // awning over some bays, with a scalloped valance
      float hasAwn = step(0.5, sr.z) * open;
      float valance = 2.5 + 0.05 * abs(sin(bx * 3.14159 / 0.3));
      float awn = hasAwn * bBand(bx, PIL - 0.05, bw - PIL + 0.05, fwU) * smoothstep(valance - fwV, valance + fwV, fv) * (1.0 - smoothstep(3.26 - fwV, 3.26 + fwV, fv));
      float stripe = step(0.5, fract(bx / 0.44));
      vec3 awnBase = mix(signTex, joinC * 2.0, 0.35);
      vec3 awnC = mix(awnBase * 0.8, mix(vec3(0.86, 0.83, 0.76), awnBase, step(0.75, sr2.x)), stripe);
      awnC *= 0.72 + 0.28 * smoothstep(2.5, 3.26, fv);
      awnC *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.05, fv - valance)) * det;
      c = mix(c, awnC, awn);
      bEmit *= 1.0 - awn;
      bGlass *= 1.0 - awn;
      // shadow the awning throws on the shopfront
      c *= 1.0 - 0.28 * hasAwn * bBand(fv, 1.9, 2.5, 0.3) * inFront;

      c = mix(c, pilC, pilaster * (1.0 - cornice));
      c = mix(c, corniceC, cornice);
      bEmit *= (1.0 - pilaster) * (1.0 - cornice);
      bGlass *= (1.0 - pilaster) * (1.0 - cornice);
      // pavement splash and dirt at the foot of the wall
      c *= 0.8 + 0.2 * smoothstep(0.0, 0.35, fv);
      bAlb = c;
      bRough = mix(mix(0.62, 0.85, max(pilaster, cornice)), 0.08, bGlass);
    }
    bAlb *= 1.0 - 0.22 * uWet * (1.0 - bGlass);
    bRough = mix(bRough, bRough * 0.72, uWet);
  }
}
diffuseColor.rgb = bAlb;
`;

const FRAG_EMISSIVE = /* glsl */ `
{
  float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  float fres = 0.06 + 0.94 * pow(1.0 - ndv, 3.0);
  totalEmissiveRadiance += bEmit + uSkyRefl * fres * bGlass * 0.55;
}
`;

export function createBuildingMaterial() {
  const signAtlas = makeShopSignAtlas();
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCityLights = ext.uCityLights;
    shader.uniforms.uWindowGain = ext.uWindowGain;
    shader.uniforms.uSkyRefl = ext.uSkyRefl;
    shader.uniforms.uWet = ext.uWet;
    shader.uniforms.uSnow = ext.uSnow;
    shader.uniforms.uSignAtlas = { value: signAtlas };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BEGIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = bRough;')
      .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE);
  };
  material.customProgramCacheKey = () => 'building-facade';
  return material;
}