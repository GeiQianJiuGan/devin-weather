import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from 'three';
import { ROOM } from '../core/layout.js';

// Window glass ("WindowEffectSystem"). The panes do not render the city
// themselves: they composite the exterior render target in screen space and
// add everything that happens on the glass - beads, sliding drops with trails,
// condensation that is wiped by those trails, refraction through the drops,
// light halos and faint reflections of the room.

const VERT = /* glsl */ `
varying vec2 vGuv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vGuv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const GLINTS = 7;

const FRAG = /* glsl */ `
#define GLINTS ${GLINTS}
uniform sampler2D tScene;
uniform sampler2D tMist;
uniform sampler2D tHalo;
uniform vec2 uResolution;
uniform float uTime;
uniform float uDrops;
uniform float uMist;
uniform float uBlur;
uniform float uHalo;
uniform float uMistOn;
uniform float uTilt;
uniform vec3 uVeil;
uniform vec3 uInterior;
uniform vec3 uGlintPos[GLINTS];
uniform vec3 uGlintColor[GLINTS];
uniform float uGlintSize[GLINTS];
varying vec2 vGuv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

// hashes after Dave Hoskins, "Hash without Sine" (MIT)
vec3 h31(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
vec3 h32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Small beads that sit on the glass, slowly grow and vanish again. The lattice is hidden by
// warping the lookup (w), scattering each bead across its whole cell and giving the radii a
// long-tailed distribution: mostly specks, now and then a fat drop that is not quite round.
float beads(vec2 uv, vec2 w, float cell, float t, float amount) {
  vec2 g = (uv + w * cell * 1.6) / cell;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  vec3 r = h32(id);
  vec3 q = h32(id + 71.7);
  float on = step(1.0 - amount, r.z);
  float life = fract(t * 0.035 * (0.6 + r.x) + r.y * 9.0);
  float grow = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.85, 1.0, life));
  float rad = (0.07 + 0.19 * q.x * q.x) * grow + 1e-4;
  vec2 d = f - (r.xy - 0.5) * (0.98 - 2.0 * rad);
  float ca = cos(q.y * 6.2832);
  float sa = sin(q.y * 6.2832);
  d = vec2(ca * d.x - sa * d.y, sa * d.x + ca * d.y);
  d.x *= 1.0 + 0.45 * q.z;
  return on * (1.0 - smoothstep(rad * 0.35, rad, length(d)));
}

// Drops that run down the pane in stick-slip motion, leaving a wet trail.
// Returns (height, trail). The grid scrolls downwards; inside its cell a drop
// climbs at the same rate (so it rests on the glass) and then lets go.
vec2 slide(vec2 uv, float t, vec2 cell, float seed, float amount) {
  float col = floor(uv.x / cell.x);
  vec3 cr = h31(col * 7.31 + seed);
  float speed = 0.12 + 0.28 * cr.x;
  float y = uv.y / cell.y + t * speed + cr.y * 20.0;
  float row = floor(y);
  vec3 r = h32(vec2(col, row) + seed * 3.17);
  float alive = step(1.0 - amount, r.z);
  float fx = fract(uv.x / cell.x) - 0.5;
  float fy = fract(y);
  float ph = fract(t * speed / 0.706 + r.y);
  float py = ph < 0.85 ? mix(0.2, 0.8, ph / 0.85) : mix(0.8, 0.2, smoothstep(0.0, 1.0, (ph - 0.85) / 0.15));
  float px = (r.x - 0.5) * 0.62;
  px += (sin(uv.y * 31.0 + r.y * 6.28) * 0.07 + sin(uv.y * 77.0 + cr.z * 6.28) * 0.03) * (0.5 - abs(px));
  vec2 d = vec2((fx - px) * cell.x, (fy - py) * cell.y);
  float R = cell.x * (0.1 + 0.16 * r.z * r.z);
  vec2 dd = d;
  dd.y *= d.y > 0.0 ? 0.72 : 1.0;
  float h = 1.0 - smoothstep(R * 0.35, R, length(dd));
  float above = step(py, fy);
  float tLen = clamp((fy - py) / max(1.0 - py, 1e-3), 0.0, 1.0);
  float tw = R * (0.8 - 0.4 * tLen);
  float trail = (1.0 - smoothstep(tw * 0.5, tw, abs(d.x))) * above * (1.0 - tLen * tLen);
  float by = fract(uv.y / (R * 2.4) + r.x) - 0.5;
  float bd = length(vec2(d.x * 1.3, by * R * 2.4));
  float residue = (1.0 - smoothstep(R * 0.15, R * 0.5, bd)) * above * (1.0 - tLen) * step(R * 1.2, d.y);
  return vec2(max(h, residue * 0.7), trail) * alive;
}

// Sizes are in metres on the pane: beads of 2-10 mm across, running drops of about a centimetre.
vec2 dropField(vec2 uv) {
  vec2 w = vec2(vnoise(uv * 19.0), vnoise(uv * 19.0 + 31.7)) - 0.5;
  // beads are kept shallow: they only bend the view a little instead of turning into noise
  float b = beads(uv, w, 0.015, uTime, clamp(uDrops * 1.1, 0.0, 0.5)) * 0.24;
  b = max(b, beads(uv + vec2(0.413, 0.257), w.yx, 0.026, uTime * 0.8, clamp(uDrops * 1.0, 0.0, 0.5)) * 0.32);
  // runs wander instead of falling down ruled columns
  vec2 su = uv;
  su.x += (vnoise(vec2(uv.x * 2.3, uv.y * 1.7)) - 0.5) * 0.07 + w.x * 0.004;
  vec2 a = slide(su, uTime, vec2(0.052, 0.5), 1.0, clamp(uDrops * 0.9 - 0.08, 0.0, 0.6));
  #ifdef SECOND_LAYER
    b = max(b, beads(uv + vec2(0.171, 0.633), -w, 0.04, uTime * 0.6, clamp(uDrops * 0.7 - 0.1, 0.0, 0.35)) * 0.38);
    vec2 c = slide(su + vec2(0.37, 0.11) + w * 0.006, uTime * 1.15, vec2(0.031, 0.37), 7.0, clamp(uDrops * 0.9 - 0.3, 0.0, 0.45));
    a = max(a, c);
  #endif
  return vec2(max(a.x, b * (1.0 - a.y)), a.y);
}

void main() {
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 N = normalize(vWorldNormal);
  float ndv = clamp(dot(N, V), 0.0, 1.0);

  vec2 grad = vec2(0.0);
  float drop = 0.0;
  float wipe = 0.0;
  if (uDrops > 0.003) {
    vec2 guv = vGuv;
    guv.x += guv.y * uTilt;
    vec2 c0 = dropField(guv);
    #ifdef CHEAP_NORMALS
      // screen-space derivatives: one evaluation of the drop field instead of three
      grad = vec2(dFdx(c0.x), dFdy(c0.x)) * 0.5;
    #else
      const float e = 0.0008;
      grad = vec2(dropField(guv + vec2(e, 0.0)).x - c0.x, dropField(guv + vec2(0.0, e)).x - c0.x);
    #endif
    drop = c0.x;
    wipe = c0.y;
  }

  float mistAmt = uMist * (0.62 + 0.38 * vnoise(vGuv * 2.3)) * (1.0 - 0.85 * clamp(wipe, 0.0, 1.0));
  float inDrop = smoothstep(0.05, 0.22, drop);
  float blurAmt = clamp(uBlur + mistAmt, 0.0, 0.9) * (1.0 - inDrop);

  vec2 offs = grad * 0.3;
  offs.x *= uResolution.y / uResolution.x;
  vec2 uvS = clamp(suv + offs, vec2(0.001), vec2(0.999));
  vec3 sharp = texture2D(tScene, uvS).rgb;
  vec3 col = sharp;
  if (uMistOn > 0.5) {
    vec3 soft = texture2D(tMist, uvS).rgb;
    col = mix(sharp, soft, blurAmt);
    // a drop is a tiny wide-angle lens: it gathers light from a large part of the view
    col = mix(col, max(sharp, soft * 1.35), inDrop * 0.75);
  }
  col += texture2D(tHalo, suv).rgb * uHalo;
  col = mix(col, uVeil, mistAmt * 0.16 * (1.0 - inDrop));

  // drop shading: darker rim, small highlight
  float rim = smoothstep(0.0, 0.25, drop) * (1.0 - smoothstep(0.25, 0.8, drop));
  col *= 1.0 - 0.07 * rim;
  vec3 dn = normalize(vec3(-grad * 3.0, 1.0));
  float spec = pow(max(dot(dn, normalize(vec3(-0.4, 0.7, 0.6))), 0.0), 40.0) * inDrop;
  col += (uVeil * 2.0 + uInterior * 2.0) * spec;

  // the glass itself: slight tint, Fresnel reflection of the room, glints of the lamp and the monitor
  col *= vec3(0.955, 0.985, 0.975);
  float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  col = mix(col, uInterior, min(fres, 0.6));
  vec3 R = reflect(-V, N);
  // Mirror images of the room's lamps. Each is a small, fairly crisp spot the size of the
  // bulb with a faint skirt, plus a weaker second image from the back face of the pane -
  // not a big soft blob.
  vec3 R2 = normalize(R + N * 0.012);
  for (int i = 0; i < GLINTS; i++) {
    vec3 toL = uGlintPos[i] - vWorldPos;
    float s2 = uGlintSize[i] * uGlintSize[i];
    vec3 miss = toL - R * max(dot(toL, R), 0.0);
    float q = dot(miss, miss) / s2;
    float img = exp(-q * q) + 0.06 * exp(-q * 0.06);
    vec3 miss2 = toL - R2 * max(dot(toL, R2), 0.0);
    float q2 = dot(miss2, miss2) / s2;
    img += 0.35 * exp(-q2 * q2);
    col += uGlintColor[i] * img * min(fres, 0.5);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class WindowGlass {
  constructor() {
    this.uniforms = {
      tScene: { value: null },
      tMist: { value: null },
      tHalo: { value: null },
      uResolution: { value: new Vector2(1, 1) },
      uTime: { value: 0 },
      uDrops: { value: 0 },
      uMist: { value: 0 },
      uBlur: { value: 0 },
      uHalo: { value: 0.05 },
      uMistOn: { value: 0 },
      uTilt: { value: 0 },
      uVeil: { value: new Color(0.5, 0.55, 0.6) },
      uInterior: { value: new Color(0.02, 0.02, 0.02) },
      uGlintPos: { value: Array.from({ length: GLINTS }, () => new Vector3()) },
      uGlintColor: { value: Array.from({ length: GLINTS }, () => new Color(0, 0, 0)) },
      // menu display, table lamp, then the pendant shades
      uGlintSize: { value: [0.2, 0.04, 0.04, 0.04, 0.045, 0.045, 0.045] },
    };
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      defines: { SECOND_LAYER: 1 },
      toneMapped: false,
    });
    const { glassNorth: GN, glassEast: GE, glassY0: Y0, glassY1: Y1 } = ROOM;
    const h = Y1 - Y0;
    const y = (Y0 + Y1) / 2;
    this.north = this.pane(GN, h, 0);
    this.north.position.set(-GN / 2, y, -0.02);
    this.east = this.pane(GE, h, GN + 1.7);
    this.east.position.set(0.02, y, GE / 2);
    this.east.rotation.y = -Math.PI / 2;
    this.meshes = [this.north, this.east];
    this.time = 0;
  }

  /** One glass wall; its UVs are remapped to metres so drops have a physical size. */
  pane(width, height, uOffset) {
    const geometry = new PlaneGeometry(width, height);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width + uOffset, uv.getY(i) * height);
    const mesh = new Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5; // after the furniture, so covered glass pixels are never shaded
    return mesh;
  }

  setQuality(q) {
    const defines = {};
    if (q.dropLayers > 1) defines.SECOND_LAYER = 1;

    if (q.cheapNormals) defines.CHEAP_NORMALS = 1;
    this.material.defines = defines;
    this.material.needsUpdate = true;
  }

  setInputs(sceneTexture, mistTexture, haloTexture, width, height) {
    this.uniforms.tScene.value = sceneTexture;
    this.uniforms.tMist.value = mistTexture;
    this.uniforms.tHalo.value = haloTexture;
    this.uniforms.uResolution.value.set(width, height);
  }

  update(dt) {
    this.time = (this.time + dt) % 14400;
    this.uniforms.uTime.value = this.time;
  }
}