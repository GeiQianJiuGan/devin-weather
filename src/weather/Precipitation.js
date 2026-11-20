import {
  Color,
  CustomBlending,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  Vector4,
} from 'three';
import { BUILD_LINE } from '../core/layout.js';
import { ext } from '../city/sharedUniforms.js';

// GPU particles for rain and snow. Every particle is an instanced quad whose
// position is derived in the vertex shader from a random seed plus a wrapped
// drift offset, so nothing is allocated or uploaded per frame except a few
// uniforms. Each layer covers a different depth range in front of the window.

const SPEED_CLASSES = [0.82, 0.94, 1.06, 1.18];
export const MAX_LIGHTS = 8;
const quad = new PlaneGeometry(1, 1);

const COMMON = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uOffsets[4];
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec4 uLights[${MAX_LIGHTS}];
uniform float uFogDensity;
uniform float uPixel;
varying vec2 vQ;
varying float vFade;
varying float vLight;

vec3 particleCentre() {
  int cls = int(min(aSeed.w * 4.0, 3.0));
  return mod(aSeed.xyz * uBoxSize + uOffsets[cls], uBoxSize) + uBoxMin;
}
float lightAt(vec3 p) {
  float l = 0.0;
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec3 d = uLights[i].xyz - p;
    float d2 = dot(d, d);
    l += uLights[i].w * (1.0 - smoothstep(60.0, 620.0, d2)) / (1.0 + d2 * 0.05);
  }
  return l;
}
bool insideHome(vec3 p) {
  return p.x < ${(-BUILD_LINE + 0.15).toFixed(2)} && p.z > ${(BUILD_LINE - 0.15).toFixed(2)};
}
`;

const RAIN_VERT = /* glsl */ `
${COMMON}
uniform vec3 uDir;
uniform float uLength;
uniform float uWidth;
varying float vThin;
void main() {
  vec3 p = particleCentre();
  vec3 dir = normalize(uDir + vec3(fract(aSeed.x * 91.7) - 0.5, 0.0, fract(aSeed.z * 57.3) - 0.5) * 0.07);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(dir, toCam));
  float dist = length(cameraPosition - p);
  float w = max(uWidth, dist * uPixel * 1.2);
  vThin = uWidth / w;
  float len = uLength * (0.8 + 0.4 * fract(aSeed.w * 37.0));
  vec3 wp = p + dir * position.y * len + side * position.x * w;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  if (insideHome(p)) gl_Position = vec4(0.0, 0.0, -10.0, 1.0);
  vQ = position.xy;
  vFade = exp(-uFogDensity * uFogDensity * dist * dist) * smoothstep(0.4, 1.6, dist);
  vLight = lightAt(p);
}`;

const RAIN_FRAG = /* glsl */ `
uniform vec3 uAmbient;
uniform vec3 uLightColor;
uniform float uAlpha;
varying vec2 vQ;
varying float vFade;
varying float vLight;
varying float vThin;
void main() {
  float across = 1.0 - abs(vQ.x) * 2.0;
  float along = smoothstep(-0.5, -0.2, vQ.y) * (1.0 - smoothstep(0.1, 0.5, vQ.y));
  float a = across * along * uAlpha * vFade * vThin;
  vec3 c = uAmbient + uLightColor * vLight;
  gl_FragColor = vec4(c * a, a * 0.35);
}`;

const SNOW_VERT = /* glsl */ `
${COMMON}
uniform float uSize;
uniform float uSway;
uniform float uTime;
varying float vThin;
void main() {
  vec3 p = particleCentre();
  float ph = aSeed.w * 44.0;
  // frequencies are multiples of 1/8 so the motion loops seamlessly when uTime wraps
  p.x += sin(uTime * (0.5 + floor(aSeed.x * 8.0) * 0.125) + ph) * uSway;
  p.z += cos(uTime * (0.375 + floor(aSeed.z * 8.0) * 0.125) + ph * 1.3) * uSway;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  float size = uSize * (0.55 + 0.9 * fract(aSeed.w * 13.0));
  float s = max(size, dist * uPixel * 1.4);
  vThin = (size * size) / (s * s);
  mv.xy += position.xy * s;
  gl_Position = projectionMatrix * mv;
  if (insideHome(p)) gl_Position = vec4(0.0, 0.0, -10.0, 1.0);
  vQ = position.xy;
  vFade = exp(-uFogDensity * uFogDensity * dist * dist) * smoothstep(0.3, 1.2, dist);
  vLight = lightAt(p);
}`;

const SNOW_FRAG = /* glsl */ `
uniform vec3 uAmbient;
uniform vec3 uLightColor;
uniform float uAlpha;
varying vec2 vQ;
varying float vFade;
varying float vLight;
varying float vThin;
void main() {
  float r = length(vQ) * 2.0;
  float a = (1.0 - smoothstep(0.35, 1.0, r)) * uAlpha * vFade * vThin;
  vec3 c = uAmbient + uLightColor * vLight;
  gl_FragColor = vec4(c * a, a);
}`;

class ParticleLayer {
  constructor(spec, vertexShader, fragmentShader, extraUniforms, rng) {
    this.spec = spec;
    const geometry = new InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    const seeds = new Float32Array(spec.count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rng.next();
    geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
    geometry.instanceCount = 0;
    this.geometry = geometry;
    this.size = new Vector3(...spec.size);
    this.offsets = SPEED_CLASSES.map(() => new Vector3());
    this.uniforms = {
      uOffsets: { value: this.offsets },
      uBoxMin: { value: new Vector3(...spec.min) },
      uBoxSize: { value: this.size },
      uLights: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector4(0, -100, 0, 0)) },
      uFogDensity: ext.uFogDensity,
      uPixel: { value: 0.001 },
      uAmbient: { value: new Color(0.5, 0.5, 0.5) },
      uLightColor: { value: new Color(1, 0.74, 0.46) },
      uAlpha: { value: spec.alpha },
      ...extraUniforms,
    };
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
  }

  /** Advances the wrapped drift offsets (one per speed class). */
  drift(dt, vx, vy, vz) {
    const s = this.size;
    this.offsets.forEach((o, j) => {
      const k = SPEED_CLASSES[j];
      o.x = (((o.x + vx * k * dt) % s.x) + s.x) % s.x;
      o.y = (((o.y + vy * k * dt) % s.y) + s.y) % s.y;
      o.z = (((o.z + vz * k * dt) % s.z) + s.z) % s.z;
    });
  }

  setCount(fraction) {
    const n = Math.floor(this.spec.count * Math.min(1, Math.max(0, fraction)));
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
  }
}

class ParticleSystem {
  constructor() {
    this.layers = [];
    this.budget = 1;
  }
  get meshes() {
    return this.layers.map((l) => l.mesh);
  }
  setQuality(budget) {
    this.budget = budget;
  }
  setPixelAngle(pixel) {
    for (const l of this.layers) l.uniforms.uPixel.value = pixel;
  }
  /** lights: array of {x, y, z}; power scales their contribution. */
  setLights(lights, power, color) {
    for (const l of this.layers) {
      l.uniforms.uLightColor.value.copy(color);
      l.uniforms.uLights.value.forEach((v, i) => {
        const src = lights[i];
        if (src) v.set(src.x, src.y, src.z, power);
        else v.set(0, -100, 0, 0);
      });
    }
  }
  setAmbient(color) {
    for (const l of this.layers) l.uniforms.uAmbient.value.copy(color);
  }
}

const RAIN_LAYERS = [
  { min: [-17.5, 0, -9], size: [26, 16, 27], count: 2400, length: 0.55, width: 0.012, alpha: 0.5 },
  { min: [-20, 0, -45], size: [70, 30, 66], count: 7000, length: 0.75, width: 0.02, alpha: 0.38 },
  { min: [-30, 0, -130], size: [170, 50, 160], count: 9000, length: 1.05, width: 0.045, alpha: 0.26 },
];

export class RainSystem extends ParticleSystem {
  constructor(rng) {
    super();
    this.layers = RAIN_LAYERS.map(
      (spec) => new ParticleLayer(spec, RAIN_VERT, RAIN_FRAG, {
        uDir: { value: new Vector3(0, -1, 0) },
        uLength: { value: spec.length },
        uWidth: { value: spec.width },
      }, rng),
    );
  }

  /** amount: 0..1 rain intensity; wind in m/s. */
  update(dt, amount, windX, windZ) {
    const fall = 9 + 5.5 * amount;
    for (const layer of this.layers) {
      layer.setCount(amount > 0.004 ? Math.pow(amount, 0.8) * this.budget : 0);
      if (!layer.mesh.visible) continue;
      layer.drift(dt, windX, -fall, windZ);
      layer.uniforms.uDir.value.set(windX, -fall, windZ).normalize();
      layer.uniforms.uLength.value = layer.spec.length * (0.75 + 0.5 * amount);
      layer.uniforms.uAlpha.value = layer.spec.alpha * (0.65 + 0.35 * amount);
    }
  }
}

const SNOW_LAYERS = [
  { min: [-17.5, 0, -9], size: [26, 14, 27], count: 2000, flake: 0.05, alpha: 0.95 },
  { min: [-20, 0, -45], size: [70, 28, 66], count: 5600, flake: 0.085, alpha: 0.85 },
  { min: [-30, 0, -130], size: [170, 45, 160], count: 7000, flake: 0.16, alpha: 0.6 },
];

export class SnowSystem extends ParticleSystem {
  constructor(rng) {
    super();
    this.time = 0;
    this.layers = SNOW_LAYERS.map(
      (spec) => new ParticleLayer(spec, SNOW_VERT, SNOW_FRAG, {
        uSize: { value: spec.flake },
        uSway: { value: 0.25 },
        uTime: { value: 0 },
      }, rng),
    );
  }

  update(dt, amount, windX, windZ) {
    this.time = (this.time + dt) % (Math.PI * 16 * 64);
    const fall = 1.0 + 1.5 * amount;
    for (const layer of this.layers) {
      layer.setCount(amount > 0.004 ? Math.pow(amount, 0.85) * this.budget : 0);
      if (!layer.mesh.visible) continue;
      layer.drift(dt, windX * 0.8, -fall, windZ * 0.8);
      layer.uniforms.uTime.value = this.time;
      layer.uniforms.uSway.value = 0.18 + 0.2 * amount;
    }
  }
}