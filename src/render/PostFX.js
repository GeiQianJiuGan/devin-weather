import { LinearFilter, Vector2, WebGLRenderTarget } from 'three';
import { BlurPyramid, HalfCopy } from './BlurPyramid.js';
import { passMaterial } from './FullscreenPass.js';

// Final grade: the bedroom (with the composited window view) is rendered into
// an HDR target, then bloomed, exposed, tone mapped and dithered to the screen.

const FINAL_FRAG = /* glsl */ `
uniform sampler2D tMain;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
varying vec2 vUv;

vec3 rrtOdtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

vec3 acesFilmic(vec3 color) {
  const mat3 inputMat = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777));
  const mat3 outputMat = mat3(
    vec3(1.60475, -0.10208, -0.00327),
    vec3(-0.53108, 1.10813, -0.07276),
    vec3(-0.07367, -0.00605, 1.07602));
  color = inputMat * (color / 0.6);
  color = rrtOdtFit(color);
  return clamp(outputMat * color, 0.0, 1.0);
}

vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 col = texture2D(tMain, vUv).rgb;
  col += texture2D(tBloom, vUv).rgb * uBloom;
  vec2 q = vUv - 0.5;
  float vig = smoothstep(0.92, 0.28, length(q * vec2(1.0, 0.86)));
  col *= mix(1.0 - uVignette, 1.0, vig);
  col = acesFilmic(col * uExposure);
  col = toSrgb(col);
  col += (hash(gl_FragCoord.xy + fract(uTime) * 157.0) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
}`;

export class PostFX {
  constructor(pass) {
    this.pass = pass;
    this.rtMain = null;
    this.half = new HalfCopy();
    this.bloom = new BlurPyramid({ additive: true, prefilter: true });
    this.bloomEnabled = true;
    this.size = new Vector2(1, 1);
    this.material = passMaterial(FINAL_FRAG, {
      tMain: { value: null },
      tBloom: { value: null },
      uBloom: { value: 0.05 },
      uExposure: { value: 1 },
      uVignette: { value: 0.3 },
      uGrain: { value: 0.022 },
      uTime: { value: 0 },
    });
  }

  setSize(width, height, q, textureType) {
    this.size.set(width, height);
    this.rtMain?.dispose();
    this.rtMain = new WebGLRenderTarget(width, height, {
      type: textureType,
      samples: q.msaa,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.rtMain.texture.generateMipmaps = false;
    this.bloomEnabled = q.finalBloom;
    this.half.setSize(width, height, textureType);
    this.bloom.setSize(this.half.target.width, this.half.target.height, q.finalBloom ? 4 : 1, textureType);
  }

  get target() {
    return this.rtMain;
  }

  render(renderer, { exposure, bloom, time }) {
    const u = this.material.uniforms;
    u.tMain.value = this.rtMain.texture;
    if (this.bloomEnabled) {
      const half = this.half.render(renderer, this.pass, this.rtMain.texture);
      u.tBloom.value = this.bloom.render(renderer, this.pass, half, { mix: 0.8, threshold: 1.1, knee: 0.6 });
      u.uBloom.value = bloom;
    } else {
      u.tBloom.value = this.rtMain.texture;
      u.uBloom.value = 0;
    }
    u.uExposure.value = exposure;
    u.uTime.value = time;
    this.pass.render(renderer, this.material, null);
  }

  dispose() {
    this.rtMain?.dispose();
    this.half.dispose();
    this.bloom.dispose();
    this.material.dispose();
  }
}