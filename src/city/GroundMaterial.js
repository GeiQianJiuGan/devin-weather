import { MeshStandardMaterial } from 'three';
import { CROSSWALK_FAR, CROSSWALK_NEAR, LANE_W, ROAD_HALF, STOP_FAR, STOP_NEAR } from '../core/layout.js';
import { ext } from './sharedUniforms.js';

// Procedural ground: asphalt with lane markings, stop lines and zebra
// crossings (road), or pavers and kerb stones (sidewalk). Both variants share
// the wetness model: darker albedo, glossy film, puddles in low spots that
// mirror the planar reflection texture, rain ripples and snow cover.

const f = (n) => n.toFixed(3);

const PARS = /* glsl */ `
uniform float uWet;
uniform float uSnow;
uniform float uRain;
uniform float uTime;
uniform float uReflOn;
uniform sampler2D uReflTex;
varying vec3 vGPos;
varying vec4 vReflCoord;

#define RW ${f(ROAD_HALF)}
#define LANE ${f(LANE_W)}
#define CW_NEAR ${f(CROSSWALK_NEAR)}
#define CW_FAR ${f(CROSSWALK_FAR)}
#define STOP_A ${f(STOP_NEAR)}
#define STOP_B ${f(STOP_FAR)}

float gHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float gNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x),
             mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float gFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * gNoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s / 0.9375;
}
float gBand(float x, float lo, float hi, float aa) {
  return smoothstep(lo - aa, lo + aa, x) - smoothstep(hi - aa, hi + aa, x);
}
float gLine(float d, float halfW, float aa) {
  return 1.0 - smoothstep(halfW - aa, halfW + aa, abs(d));
}
vec2 gRipple(vec2 p, float t) {
  vec2 q = p * 1.8;
  vec2 id = floor(q);
  vec2 fq = fract(q) - 0.5;
  float h = gHash(id);
  float ph = fract(t * (0.7 + 0.6 * h) + h * 9.0);
  vec2 c = (vec2(gHash(id + 3.1), gHash(id + 7.7)) - 0.5) * 0.5;
  vec2 dv = fq - c;
  float d = length(dv);
  float r = ph * 0.42;
  float ring = sin((d - r) * 55.0) * smoothstep(0.07, 0.0, abs(d - r)) * (1.0 - ph);
  return dv / max(d, 1e-3) * ring;
}

#ifdef GROUND_ROAD
// Markings of one road arm. along: distance from the intersection centre,
// lat: signed lateral offset (positive = lanes travelling towards the junction).
vec2 armMarks(float along, float lat, float aaA, float aaL) {
  float al = abs(lat);
  float beyond = smoothstep(STOP_B - aaA, STOP_B + aaA, along);
  float yellow = gLine(al - 0.17, 0.06, aaL) * beyond;
  float dashT = abs(fract(along / 9.0) - 0.5);
  float dash = 1.0 - smoothstep(0.17 - aaA / 9.0, 0.17 + aaA / 9.0, dashT);
  float solid = 1.0 - smoothstep(STOP_B + 14.0, STOP_B + 15.0, along);
  float white = gLine(al - LANE, 0.06, aaL) * max(dash, solid) * beyond;
  white += gLine(al - (RW - 0.3), 0.05, aaL) * beyond;
  white += gBand(along, STOP_A, STOP_B, aaA) * gBand(lat, 0.3, RW - 0.25, aaL);
  float zt = abs(fract(lat / 1.1) - 0.5);
  float stripes = 1.0 - smoothstep(0.25 - aaL / 1.1, 0.25 + aaL / 1.1, zt);
  white += gBand(along, CW_NEAR, CW_FAR, aaA) * stripes * (1.0 - smoothstep(RW - 0.35 - aaL, RW - 0.35 + aaL, al));
  return vec2(min(white, 1.0), yellow);
}
#endif
`;

const COLOR = /* glsl */ `
vec2 gp = vGPos.xz;
vec2 gFw = max(fwidth(gp), vec2(1e-4));
float gAaX = gFw.x * 0.8;
float gAaZ = gFw.y * 0.8;
float gCoarse = max(gFw.x, gFw.y);
float gLarge = gFbm(gp * 0.07 + 5.0);
float gFine = gNoise(gp * 9.0);
float gGrain = 1.0 - smoothstep(0.03, 0.2, gCoarse);
float gPaint = 0.0;
float gTrack = 0.0;
float gRut = 0.0;

#ifdef GROUND_ROAD
  vec3 gAlb = vec3(0.092, 0.094, 0.098) * (0.75 + 0.5 * gLarge) * (1.0 + (gFine - 0.5) * 0.35 * gGrain);
  float gax = abs(gp.x);
  float gaz = abs(gp.y);
  vec2 mk = vec2(0.0);
  float laneLat = -1.0;
  if (gaz < RW + 0.5 && gax > RW) {
    mk = armMarks(gax, -gp.y * sign(gp.x), gAaX, gAaZ);
    laneLat = gaz;
  } else if (gax < RW + 0.5 && gaz > RW) {
    mk = armMarks(gaz, gp.x * sign(gp.y), gAaZ, gAaX);
    laneLat = gax;
  }
  float wear = 0.72 + 0.28 * gNoise(gp * 2.3 + 9.0);
  gAlb = mix(gAlb, vec3(0.62, 0.62, 0.60) * wear, mk.x);
  gAlb = mix(gAlb, vec3(0.62, 0.44, 0.07) * wear, mk.y);
  gPaint = max(mk.x, mk.y);
  if (laneLat >= 0.0) {
    float inLane = mod(laneLat, LANE) - LANE * 0.5;
    gTrack = gLine(abs(inLane) - 0.85, 0.3, 0.14);
    // In snow the wheel paths are not ruled lines: every car takes a slightly different
    // line, so the ruts wander, change width, overlap and are half filled in again.
    float gAlong = gaz < RW + 0.5 && gax > RW ? gp.x : gp.y;
    float laneId = floor(laneLat / LANE) + 2.0 * step(0.0, gp.x + gp.y);
    float wob = (gNoise(vec2(gAlong * 0.11, laneId * 7.3)) - 0.5) * 1.1 + (gNoise(vec2(gAlong * 0.37, laneId * 3.1 + 5.0)) - 0.5) * 0.4;
    // ragged edges
    wob += (gNoise(gp * 1.9 + 41.0) - 0.5) * 0.3;
    float wide = 0.2 + 0.2 * gNoise(vec2(gAlong * 0.21 + 13.0, laneId * 5.7));
    float rutA = gLine(abs(inLane - wob) - 0.82, wide, 0.22);
    float rutB = gLine(abs(inLane + wob * 0.6 - 0.1) - 0.74, wide * 0.7, 0.2) * 0.6;
    float churn = gFbm(gp * vec2(1.7, 1.7) + 17.0);
    float fine = gNoise(gp * 6.5 + 3.0);
    // long stretches where fresh snow has covered the tracks again
    float worn = smoothstep(0.3, 0.75, gNoise(vec2(gAlong * 0.045 + 9.0, laneId * 11.0)) + 0.35 * (gLarge - 0.5));
    gRut = max(rutA, rutB) * smoothstep(0.18, 0.62, churn + 0.25 * fine) * (0.25 + 0.75 * worn) * (1.0 - 0.45 * uSnow);
    gRut = max(gRut, 0.22 * smoothstep(0.55, 0.8, churn) * gLine(inLane, 1.3, 0.4));
  } else {
    gTrack = 0.6;
    // the junction is churned by turning traffic
    gRut = 0.2 + 0.6 * smoothstep(0.3, 0.7, gFbm(gp * 1.3 + 17.0));
  }
  gAlb *= 1.0 - 0.1 * gTrack;
#else
  vec2 tile = gp / 0.6;
  vec2 tid = floor(tile);
  vec2 tf = fract(tile);
  float jd = min(min(tf.x, 1.0 - tf.x), min(tf.y, 1.0 - tf.y)) * 0.6;
  float joint = (1.0 - smoothstep(0.006, 0.014 + gCoarse, jd)) * (1.0 - smoothstep(0.02, 0.12, gCoarse));
  vec3 gAlb = vec3(0.30, 0.295, 0.285) * (0.86 + 0.22 * gHash(tid)) * (0.8 + 0.4 * gLarge);
  gAlb *= 1.0 - 0.4 * joint;
  float kerb = 1.0 - smoothstep(0.26, 0.32, min(abs(gp.x), abs(gp.y)) - RW);
  kerb = max(kerb, 1.0 - step(${f(0.15)}, vGPos.y));
  gAlb = mix(gAlb, vec3(0.40, 0.40, 0.41) * (0.85 + 0.3 * gLarge), kerb);
#endif

// wetness: thin film everywhere, standing water in the low spots
float pudN = gFbm(gp * 0.16 + 3.7);
float pth = mix(0.08, 0.5, uWet);
float puddle = (1.0 - smoothstep(pth - 0.04, pth + 0.07, pudN)) * smoothstep(0.12, 0.45, uWet);
#ifndef GROUND_ROAD
  puddle *= 0.5 * (1.0 - kerb);
#endif
float film = uWet;
gAlb *= mix(1.0, 0.52, film);
gAlb *= mix(1.0, 0.7, puddle);
float gRough = mix(0.94, 0.5, film);
gRough = mix(gRough, 0.07, puddle);
gRough *= 1.0 - 0.2 * gPaint;

// snow cover (tyres keep dark tracks on the road)
float snTh = 1.0 - uSnow * 1.25;
float snow = smoothstep(snTh, snTh + 0.35, gFbm(gp * 0.4 + 31.0)) * step(0.001, uSnow);
// ruts hold grey-brown slush rather than clean asphalt; packed snow stays between the tyres
float slush = gRut * snow;
snow *= 1.0 - 0.8 * gRut;
gAlb = mix(gAlb, vec3(0.80, 0.84, 0.90), snow);
gAlb = mix(gAlb, vec3(0.33, 0.32, 0.31) * (0.8 + 0.4 * gNoise(gp * 4.0)), slush * 0.55);
gRough = mix(gRough, 0.82, snow);
diffuseColor.rgb = gAlb;
`;

const EMISSIVE = /* glsl */ `
{
  float reflK = uReflOn * film * (0.07 + 0.6 * puddle) * (1.0 - snow);
  if (reflK > 0.002) {
    vec3 gV = normalize(cameraPosition - vGPos);
    float fres = 0.04 + 0.96 * pow(1.0 - clamp(gV.y, 0.0, 1.0), 4.0);
    vec2 ruv = vReflCoord.xy / vReflCoord.w;
    vec2 bump = vec2(gNoise(gp * 2.7 + 11.0), gNoise(gp * 2.7 + 47.0)) - 0.5;
    vec2 rip = gRipple(gp, uTime) * uRain * puddle;
    float soft = 1.0 - puddle;
    ruv += bump * mix(0.004, 0.03, soft) + rip * 0.012;
    float stretch = mix(0.015, 0.11, soft);
    float jit = gHash(gl_FragCoord.xy);
    vec3 refl = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 6; i++) {
      float fi = (float(i) + jit) / 6.0;
      float w = 1.0 - 0.75 * fi;
      refl += textureLod(uReflTex, ruv + vec2(0.0, (fi - 0.12) * stretch), 0.0).rgb * w;
      wsum += w;
    }
    totalEmissiveRadiance += (refl / wsum) * reflK * clamp(0.3 + 2.2 * fres, 0.0, 1.0);
  }
}
`;

export function createGroundMaterial(kind) {
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  material.defines = { ...material.defines, [kind === 'road' ? 'GROUND_ROAD' : 'GROUND_SIDEWALK']: 1 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = ext.uWet;
    shader.uniforms.uSnow = ext.uSnow;
    shader.uniforms.uRain = ext.uRain;
    shader.uniforms.uTime = ext.uTime;
    shader.uniforms.uReflOn = ext.uReflOn;
    shader.uniforms.uReflTex = ext.uReflTex;
    shader.uniforms.uReflMatrix = ext.uReflMatrix;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uReflMatrix;\nvarying vec3 vGPos;\nvarying vec4 vReflCoord;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvec4 gWorld = modelMatrix * vec4(transformed, 1.0);\nvGPos = gWorld.xyz;\nvReflCoord = uReflMatrix * gWorld;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <color_fragment>', COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <emissivemap_fragment>', EMISSIVE);
  };
  material.customProgramCacheKey = () => `ground-${kind}`;
  return material;
}