import {
  AdditiveBlending,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { ext } from './sharedUniforms.js';

// Flat quads laid on the ground and drawn in one instanced call per batch:
//  - beam: headlight pools in front of vehicles (additive)
//  - pool: soft round light spill from streetlights / shop fronts (additive)
//  - blob: contact shadow under vehicles (darkening)

const VERT = /* glsl */ `
attribute vec4 aPosDir;   // x, z, dirX, dirZ
attribute vec4 aParams;   // length, width, intensity, height
attribute vec3 aColor;
uniform float uFogDensity;
varying vec2 vQ;
varying vec3 vCol;
varying float vFog;
void main() {
  vec2 q = position.xy;
  vec2 dir = aPosDir.zw;
  vec2 right = vec2(-dir.y, dir.x);
  #ifdef DECAL_BEAM
    float fx = q.x + 0.5;
    float along = 1.4 + fx * aParams.x;
    float lat = q.y * mix(aParams.y * 0.42, aParams.y, fx);
  #else
    float along = q.x * aParams.x;
    float lat = q.y * aParams.y;
  #endif
  vec2 xz = aPosDir.xy + dir * along + right * lat;
  vec4 mv = viewMatrix * vec4(xz.x, aParams.w, xz.y, 1.0);
  gl_Position = projectionMatrix * mv;
  vQ = q;
  vCol = aColor * aParams.z;
  float d = -mv.z;
  vFog = exp(-uFogDensity * uFogDensity * d * d);
}`;

const FRAG = /* glsl */ `
varying vec2 vQ;
varying vec3 vCol;
varying float vFog;
void main() {
  #if defined(DECAL_BEAM)
    float fx = clamp(vQ.x + 0.5, 0.0, 1.0);
    float ly = abs(vQ.y) * 2.0;
    float off = (ly - 0.26 * (1.0 - fx)) * 2.4;
    float lobes = exp(-off * off);
    float fade = 1.0 - fx;
    float a = lobes * fade * sqrt(fade) * smoothstep(0.0, 0.07, fx);
    gl_FragColor = vec4(vCol * a * vFog, 1.0);
  #elif defined(DECAL_POOL)
    float r = max(1.0 - length(vQ) * 2.0, 0.0);
    float a = r * r;
    gl_FragColor = vec4(vCol * a * vFog, 1.0);
  #else
    vec2 q2 = abs(vQ) * 2.0;
    float a = (1.0 - smoothstep(0.5, 1.0, q2.x)) * (1.0 - smoothstep(0.45, 1.0, q2.y));
    gl_FragColor = vec4(vec3(0.0), a * vCol.r * vFog);
  #endif
}`;

const quad = new PlaneGeometry(1, 1);

export class DecalBatch {
  constructor(count, mode, dynamic = true) {
    this.count = count;
    const geometry = new InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    this.posDir = new InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.params = new InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.color = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
    if (dynamic) {
      this.posDir.setUsage(DynamicDrawUsage);
      this.params.setUsage(DynamicDrawUsage);
    }
    geometry.setAttribute('aPosDir', this.posDir);
    geometry.setAttribute('aParams', this.params);
    geometry.setAttribute('aColor', this.color);
    geometry.instanceCount = count;
    const additive = mode !== 'blob';
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uFogDensity: ext.uFogDensity },
      defines: { [`DECAL_${mode.toUpperCase()}`]: 1 },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: additive ? AdditiveBlending : NormalBlending,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
  }

  set(i, x, z, dirX, dirZ, length, width, intensity, height = 0.03) {
    const a = this.posDir.array;
    const p = this.params.array;
    a[i * 4] = x;
    a[i * 4 + 1] = z;
    a[i * 4 + 2] = dirX;
    a[i * 4 + 3] = dirZ;
    p[i * 4] = length;
    p[i * 4 + 1] = width;
    p[i * 4 + 2] = intensity;
    p[i * 4 + 3] = height;
  }

  setColor(i, r, g, b) {
    const c = this.color.array;
    c[i * 3] = r;
    c[i * 3 + 1] = g;
    c[i * 3 + 2] = b;
    this.color.needsUpdate = true;
  }

  setIntensity(i, intensity) {
    this.params.array[i * 4 + 2] = intensity;
  }

  commit() {
    this.posDir.needsUpdate = true;
    this.params.needsUpdate = true;
  }
}