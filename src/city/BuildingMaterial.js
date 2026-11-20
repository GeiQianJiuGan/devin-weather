import { MeshStandardMaterial } from 'three';
import { ext } from './sharedUniforms.js';

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
    float winL = mix(win, vBStyle.z * vBStyle.w * inFloors, lod);

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
    vec3 emitAvg = mix(warm, cool, office * 0.7) * 0.55 * litP * uWindowGain;
    bEmit = mix(emitWin, emitAvg, lod) * winL;

    vec3 wall = vBTint * (0.9 + 0.2 * wn) * (0.94 + 0.12 * bHash(id + seed) * (1.0 - lod));
    float slab = (1.0 - smoothstep(0.02, 0.05, fc.y)) * inFloors * (1.0 - lod);
    wall *= 1.0 - 0.18 * slab;
    wall *= 0.84 + 0.16 * smoothstep(0.0, 3.0, fv);

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
    bAlb = mix(wall, glassC * mull * (1.0 - 0.5 * reveal), winL);
    bGlass = winL * (1.0 - blind) * (1.0 - 0.7 * curtain);
    bRough = mix(0.9, 0.12, bGlass);

    if (shop > 0.5 && fv < groundH) {
      float bays = max(1.0, floor(faceW / 5.2 + 0.5));
      float bw = faceW / bays;
      float bu = fu / bw;
      float bid = floor(bu);
      float bf = fract(bu);
      float aaB = fwU / bw;
      vec3 sr = bHash3(vec2(bid + seed * 9.0, faceId + seed));
      float glassMask = bBand(bf, 0.07, 0.93, aaB) * bBand(fv, 0.45, 3.0, fwV);
      float signMask = bBand(bf, 0.05, 0.95, aaB) * bBand(fv, 3.25, 4.05, fwV);
      float open = step(0.12, sr.x);
      float nightOn = smoothstep(0.12, 0.5, uCityLights);
      vec3 shopLight = mix(vec3(1.0, 0.82, 0.6), vec3(0.85, 0.93, 1.0), step(0.6, sr.y));
      float shelf = 0.65 + 0.35 * step(0.5, fract(fv * 1.6 + sr.z)) * (0.7 + 0.3 * step(0.4, fract(bu * 6.0 + sr.x)));
      vec3 eShop = shopLight * (0.2 + 0.28 * sr.z) * shelf * open * (0.18 + 0.82 * nightOn);
      vec3 signCol = bSignColor(sr.y);
      float letters = step(0.35, bHash(vec2(floor(bu * 14.0), bid + seed))) * bBand(fv, 3.42, 3.88, fwV) * bBand(bf, 0.16, 0.84, aaB);
      vec3 eSign = signCol * (0.25 + 1.6 * letters) * nightOn;
      vec3 base = vBTint * 0.5 * (0.9 + 0.2 * wn);
      // glazing bars, a door leaf and a stall riser under the shop window
      float bar = max(1.0 - smoothstep(0.006, 0.018, abs(fract(bf * 4.0 + 0.5) - 0.5) / 4.0 * 1.0), 1.0 - smoothstep(0.03, 0.06, abs(fv - 2.45)));
      bar *= 1.0 - smoothstep(0.4, 1.2, fwU * 12.0);
      float riser = 1.0 - smoothstep(0.75, 0.82, fv);
      float isDoor = step(0.38, bf) * step(bf, 0.62);
      riser *= 1.0 - isDoor;
      eShop *= (1.0 - 0.85 * bar) * (1.0 - 0.9 * riser);
      // awning over some bays
      float awn = step(0.55, sr.z) * bBand(bf, 0.04, 0.96, aaB) * bBand(fv, 2.75, 3.25, fwV);
      vec3 awnC = mix(signCol * 0.35, vec3(0.75, 0.72, 0.66), step(0.5, fract(bf * 9.0)) * 0.6);
      bAlb = mix(base, vec3(0.03, 0.04, 0.05), glassMask);
      bAlb = mix(bAlb, vec3(0.05, 0.05, 0.055), bar * glassMask);
      bAlb = mix(bAlb, base * 0.7, riser * glassMask);
      bAlb = mix(bAlb, mix(signCol * 0.22, vec3(0.8), letters * 0.8), signMask);
      bEmit = eShop * glassMask * (1.0 - awn) + eSign * signMask;
      bAlb = mix(bAlb, awnC, awn);
      bGlass = glassMask * (1.0 - riser) * (1.0 - awn);
      bRough = mix(0.85, 0.1, glassMask);
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
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCityLights = ext.uCityLights;
    shader.uniforms.uWindowGain = ext.uWindowGain;
    shader.uniforms.uSkyRefl = ext.uSkyRefl;
    shader.uniforms.uWet = ext.uWet;
    shader.uniforms.uSnow = ext.uSnow;
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