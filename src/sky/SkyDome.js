import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector2, Vector3 } from 'three';

// Procedural sky: gradient, sun / moon, stars, drifting FBM clouds, horizon
// haze and lightning-lit clouds. Colours are supplied by the lighting system.

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // pin to the far plane
}`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunDisc;
uniform vec3 uSunGlow;
uniform vec3 uMoonDir;
uniform float uMoon;
uniform float uStars;
uniform float uCover;
uniform float uCloudDark;
uniform vec2 uCloudOffset;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uFogColor;
uniform float uFogAmount;
uniform float uFlash;
uniform vec3 uFlashDir;
uniform vec3 uCityGlow;
uniform float uTime;
varying vec3 vDir;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  float n = 0.0;
  for (int i = 0; i < CLOUD_OCTAVES; i++) {
    s += a * vnoise(p);
    n += a;
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1;
    a *= 0.5;
  }
  return s / n;
}
float stars(vec3 d) {
  vec3 p = d * 150.0;
  vec3 ip = floor(p);
  vec3 fp = fract(p) - 0.5;
  float h = hash13(ip);
  vec3 off = vec3(hash13(ip + 11.1), hash13(ip + 23.7), hash13(ip + 37.3)) - 0.5;
  float size = 0.07 + 0.11 * fract(h * 71.3);
  float tw = 0.7 + 0.3 * sin(uTime * (1.5 + 4.0 * fract(h * 13.7)) + h * 90.0);
  return step(0.94, h) * smoothstep(size, 0.0, length(fp - off * 0.6)) * tw * (0.4 + 1.8 * fract(h * 37.1));
}

void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 sky = mix(uZenith, uHorizon, pow(1.0 - up, 3.5));

  vec2 sunAz = normalize(uSunDir.xz + vec2(1e-4));
  vec2 dAz = normalize(d.xz + vec2(1e-4));
  float az = max(dot(dAz, sunAz), 0.0);
  sky += uSunGlow * (0.25 + 0.75 * pow(az, 4.0)) * exp(-up * 5.0);
  sky += uCityGlow * exp(-up * 7.0);

  float sd = max(dot(d, uSunDir), 0.0);
  vec3 sun = uSunColor * uSunDisc * (smoothstep(0.99972, 0.99990, sd) * 40.0 + pow(sd, 900.0) * 6.0 + pow(sd, 60.0) * 0.5 + pow(sd, 8.0) * 0.12);
  float md = max(dot(d, uMoonDir), 0.0);
  vec3 moon = vec3(0.85, 0.9, 1.0) * uMoon * (smoothstep(0.99980, 0.99990, md) * 3.2 + pow(md, 1500.0) * 0.5 + pow(md, 80.0) * 0.05);
  float st = stars(d) * uStars * smoothstep(0.02, 0.25, d.y);

  // cloud layer projected onto a plane above the city
  vec2 cuv = d.xz / (max(d.y, 0.0) + 0.07) * 0.5 + uCloudOffset;
  float detail = fbm(cuv * 3.1 + 5.2);
  float n = fbm(cuv) * 0.78 + detail * 0.22;
  float th = 0.88 - uCover * 1.05;
  float dens = smoothstep(th, th + 0.26, n);
  float nl = fbm(cuv + sunAz * 0.22) * 0.78 + detail * 0.22;
  float lit = clamp(0.5 + (n - nl) * 2.6, 0.0, 1.0);
  float thick = smoothstep(th + 0.1, th + 0.6, n);
  vec3 ccol = mix(uCloudShade, uCloudLit, lit * (1.0 - 0.6 * thick));
  ccol *= 1.0 - uCloudDark * (0.35 + 0.45 * thick);
  ccol += uSunColor * uSunDisc * pow(sd, 10.0) * 0.35 * (1.0 - thick);
  float fl = pow(max(dot(d, uFlashDir), 0.0), 3.0);
  ccol += vec3(0.75, 0.82, 1.0) * uFlash * (0.5 + 3.0 * fl) * (0.35 + 0.65 * n);

  float cfade = smoothstep(0.0, 0.12, d.y);
  vec3 col = sky + (sun + moon + vec3(st)) * (1.0 - dens * 0.97);
  col = mix(col, ccol, dens * cfade);
  vec3 overcastBand = mix(uCloudShade, uCloudLit, 0.45) * (1.0 - uCloudDark * 0.5);
  col = mix(col, overcastBand, (1.0 - cfade) * smoothstep(0.6, 1.0, uCover));

  float hz = clamp(uFogAmount * (0.35 + 0.65 * exp(-up * 3.0)) + exp(-up * 22.0) * 0.6, 0.0, 1.0);
  col = mix(col, uFogColor, hz);
  col += vec3(0.6, 0.7, 1.0) * uFlash * 0.2;
  if (d.y < 0.0) col = mix(col, uGround, smoothstep(0.0, -0.25, d.y));
  gl_FragColor = vec4(col, 1.0);
}`;

export class SkyDome {
  constructor() {
    this.uniforms = {
      uZenith: { value: new Color(0.1, 0.3, 0.8) },
      uHorizon: { value: new Color(0.6, 0.75, 1.0) },
      uGround: { value: new Color(0.05, 0.05, 0.06) },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uSunColor: { value: new Color(1, 1, 1) },
      uSunDisc: { value: 1 },
      uSunGlow: { value: new Color(0, 0, 0) },
      uMoonDir: { value: new Vector3(0, 1, 0) },
      uMoon: { value: 0 },
      uStars: { value: 0 },
      uCover: { value: 0.2 },
      uCloudDark: { value: 0 },
      uCloudOffset: { value: new Vector2() },
      uCloudLit: { value: new Color(1, 1, 1) },
      uCloudShade: { value: new Color(0.5, 0.55, 0.62) },
      uFogColor: { value: new Color(0.6, 0.65, 0.7) },
      uFogAmount: { value: 0 },
      uFlash: { value: 0 },
      uFlashDir: { value: new Vector3(0.5, 0.4, -0.7).normalize() },
      uCityGlow: { value: new Color(0, 0, 0) },
      uTime: { value: 0 },
    };
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      defines: { CLOUD_OCTAVES: 5 },
      side: BackSide,
      depthTest: true,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 48, 24), this.material);
    this.mesh.scale.setScalar(3000);
    this.mesh.renderOrder = 900; // after every opaque object: only visible sky pixels are shaded
    this.mesh.frustumCulled = false;
  }

  setQuality(q) {
    const octaves = q.cloudOctaves;
    if (this.material.defines.CLOUD_OCTAVES !== octaves) {
      this.material.defines.CLOUD_OCTAVES = octaves;
      this.material.needsUpdate = true;
    }
  }

  /** Clouds drift with the wind; called with the simulation delta. */
  advance(dt, windX, windZ) {
    const o = this.uniforms.uCloudOffset.value;
    o.x = (o.x - windX * dt * 0.004) % 512;
    o.y = (o.y - windZ * dt * 0.004) % 512;
  }
}