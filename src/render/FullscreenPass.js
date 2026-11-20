import { BufferGeometry, Float32BufferAttribute, Mesh, NoBlending, OrthographicCamera, ShaderMaterial } from 'three';

// One oversized triangle that covers the viewport; shared by every post pass.
const geometry = new BufferGeometry();
geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export function passMaterial(fragmentShader, uniforms, defines = {}) {
  return new ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    toneMapped: false,
  });
}

export class FullscreenPass {
  constructor() {
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mesh = new Mesh(geometry, null);
    this.mesh.frustumCulled = false;
  }

  render(renderer, material, target = null) {
    material.uniformsNeedUpdate = true;
    this.mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, this.camera);
  }
}