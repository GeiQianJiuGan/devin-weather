import { HalfFloatType, LinearFilter, Vector2, WebGLRenderTarget } from 'three';
import { passMaterial } from './FullscreenPass.js';

// Progressive down/up-sampling blur (13-tap downsample, 3x3 tent upsample).
// Used in two flavours:
//  - "scatter": every level is blended into the next one, producing a
//    controllable soft-focus copy of the image (misted glass).
//  - "additive" + prefilter: classic HDR bloom (light halos).
// The chains are fed with a half-resolution copy of the image (HalfCopy), so
// the most expensive first step is a single bilinear tap per pixel.

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;

vec3 fetch(vec2 o) {
  vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb;
  // clamp() also swallows NaN / Inf so one bad pixel can never smear across the frame
  return clamp(c, vec3(0.0), vec3(64.0));
}

void main() {
  vec3 a = fetch(vec2(-2.0, 2.0));
  vec3 b = fetch(vec2(0.0, 2.0));
  vec3 c = fetch(vec2(2.0, 2.0));
  vec3 d = fetch(vec2(-2.0, 0.0));
  vec3 e = fetch(vec2(0.0, 0.0));
  vec3 f = fetch(vec2(2.0, 0.0));
  vec3 g = fetch(vec2(-2.0, -2.0));
  vec3 h = fetch(vec2(0.0, -2.0));
  vec3 i = fetch(vec2(2.0, -2.0));
  vec3 j = fetch(vec2(-1.0, 1.0));
  vec3 k = fetch(vec2(1.0, 1.0));
  vec3 l = fetch(vec2(-1.0, -1.0));
  vec3 m = fetch(vec2(1.0, -1.0));
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  #ifdef PREFILTER
    float br = max(col.r, max(col.g, col.b));
    float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    col *= max(soft, br - uThreshold) / max(br, 1e-4);
  #endif
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tLow;
uniform sampler2D tHigh;
uniform vec2 uTexelLow;
uniform float uMix;
varying vec2 vUv;

void main() {
  vec2 o = uTexelLow;
  vec3 s = texture2D(tLow, vUv).rgb * 4.0;
  s += (texture2D(tLow, vUv + vec2(o.x, 0.0)).rgb + texture2D(tLow, vUv - vec2(o.x, 0.0)).rgb
      + texture2D(tLow, vUv + vec2(0.0, o.y)).rgb + texture2D(tLow, vUv - vec2(0.0, o.y)).rgb) * 2.0;
  s += texture2D(tLow, vUv + o).rgb + texture2D(tLow, vUv - o).rgb
     + texture2D(tLow, vUv + vec2(o.x, -o.y)).rgb + texture2D(tLow, vUv + vec2(-o.x, o.y)).rgb;
  s *= 0.0625;
  vec3 hi = texture2D(tHigh, vUv).rgb;
  #ifdef ADDITIVE
    gl_FragColor = vec4(hi + s * uMix, 1.0);
  #else
    gl_FragColor = vec4(mix(hi, s, uMix), 1.0);
  #endif
}`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(clamp(texture2D(tSrc, vUv).rgb, vec3(0.0), vec3(64.0)), 1.0);
}`;

export function makeTarget(w, h, type) {
  const rt = new WebGLRenderTarget(w, h, {
    type,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  rt.texture.generateMipmaps = false;
  return rt;
}

/** Half-resolution copy of a texture: one bilinear tap averages each 2x2 block. */
export class HalfCopy {
  constructor() {
    this.target = null;
    this.material = passMaterial(COPY_FRAG, { tSrc: { value: null } });
  }
  setSize(width, height, type = HalfFloatType) {
    this.target?.dispose();
    this.target = makeTarget(Math.max(2, Math.floor(width / 2)), Math.max(2, Math.floor(height / 2)), type);
  }
  render(renderer, pass, source) {
    this.material.uniforms.tSrc.value = source;
    pass.render(renderer, this.material, this.target);
    return this.target;
  }
  dispose() {
    this.target?.dispose();
    this.material.dispose();
  }
}

export class BlurPyramid {
  constructor({ additive = false, prefilter = false } = {}) {
    this.down = [];
    this.up = [];
    const downUniforms = () => ({
      tSrc: { value: null },
      uTexel: { value: new Vector2() },
      uThreshold: { value: 1 },
      uKnee: { value: 0.5 },
    });
    this.firstMat = passMaterial(DOWN_FRAG, downUniforms(), prefilter ? { PREFILTER: 1 } : {});
    this.downMat = prefilter ? passMaterial(DOWN_FRAG, downUniforms()) : this.firstMat;
    this.upMat = passMaterial(
      UP_FRAG,
      { tLow: { value: null }, tHigh: { value: null }, uTexelLow: { value: new Vector2() }, uMix: { value: 0.5 } },
      additive ? { ADDITIVE: 1 } : {},
    );
  }

  /** width / height: size of the source that will be fed to render(). */
  setSize(width, height, levels, type = HalfFloatType) {
    this.disposeTargets();
    let w = width;
    let h = height;
    for (let i = 0; i < levels; i++) {
      w = Math.max(2, Math.floor(w / 2));
      h = Math.max(2, Math.floor(h / 2));
      this.down.push(makeTarget(w, h, type));
      if (i < levels - 1) this.up.push(makeTarget(w, h, type));
    }
  }

  /** Runs the chain on a render target and returns the blurred texture (half the source resolution). */
  render(renderer, pass, source, { mix = 0.5, threshold = 1, knee = 0.5 } = {}) {
    const levels = this.down.length;
    let src = source;
    for (let i = 0; i < levels; i++) {
      const mat = i === 0 ? this.firstMat : this.downMat;
      mat.uniforms.tSrc.value = src.texture;
      mat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      mat.uniforms.uThreshold.value = threshold;
      mat.uniforms.uKnee.value = knee;
      pass.render(renderer, mat, this.down[i]);
      src = this.down[i];
    }
    let low = this.down[levels - 1];
    const u = this.upMat.uniforms;
    for (let i = levels - 2; i >= 0; i--) {
      u.tLow.value = low.texture;
      u.tHigh.value = this.down[i].texture;
      u.uTexelLow.value.set(1 / low.width, 1 / low.height);
      u.uMix.value = mix;
      pass.render(renderer, this.upMat, this.up[i]);
      low = this.up[i];
    }
    return low.texture;
  }

  get texture() {
    return (this.up[0] || this.down[0]).texture;
  }

  disposeTargets() {
    for (const rt of this.down) rt.dispose();
    for (const rt of this.up) rt.dispose();
    this.down.length = 0;
    this.up.length = 0;
  }

  dispose() {
    this.disposeTargets();
    this.firstMat.dispose();
    this.downMat.dispose();
    this.upMat.dispose();
  }
}