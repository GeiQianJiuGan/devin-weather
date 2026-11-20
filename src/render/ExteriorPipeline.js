import { LinearFilter, Matrix4, PerspectiveCamera, Vector3, WebGLRenderTarget } from 'three';
import { BlurPyramid, HalfCopy } from './BlurPyramid.js';

// Everything outside the window is rendered into its own HDR target so it can
// be blurred / diffused independently of the bedroom. The glass shader then
// composites the sharp image, the soft-focus copy and the light halos.

const _pos = new Vector3();
const _look = new Vector3();
const _up = new Vector3();
const _rot = new Matrix4();

export class ExteriorPipeline {
  constructor(pass) {
    this.pass = pass;
    this.rtScene = null;
    this.rtRefl = null;
    this.half = new HalfCopy();
    this.mist = new BlurPyramid();
    this.halo = new BlurPyramid({ additive: true, prefilter: true });
    this.reflCamera = new PerspectiveCamera();
    this.reflMatrix = new Matrix4();
    this.width = 1;
    this.height = 1;
  }

  setSize(width, height, q, textureType) {
    this.width = width;
    this.height = height;
    this.rtScene?.dispose();
    this.rtRefl?.dispose();
    this.rtScene = new WebGLRenderTarget(width, height, {
      type: textureType,
      samples: q.msaa,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.rtScene.texture.generateMipmaps = false;
    this.rtRefl = null;
    if (q.reflection) {
      const rw = Math.max(2, Math.round(width * q.reflectionScale));
      const rh = Math.max(2, Math.round(height * q.reflectionScale));
      this.rtRefl = new WebGLRenderTarget(rw, rh, {
        type: textureType,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
      });
      this.rtRefl.texture.generateMipmaps = false;
    }
    this.half.setSize(width, height, textureType);
    this.mist.setSize(this.half.target.width, this.half.target.height, q.blurLevels, textureType);
    this.halo.setSize(this.half.target.width, this.half.target.height, q.haloLevels, textureType);
  }

  /** Mirrors `camera` about the ground plane (y = 0) for the wet-road reflection pass. */
  updateReflectionCamera(camera) {
    const rc = this.reflCamera;
    _pos.setFromMatrixPosition(camera.matrixWorld);
    _rot.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_pos);
    _up.set(0, 1, 0).applyMatrix4(_rot);
    rc.position.set(_pos.x, -_pos.y, _pos.z);
    rc.up.set(_up.x, -_up.y, _up.z);
    rc.lookAt(_look.x, -_look.y, _look.z);
    rc.projectionMatrix.copy(camera.projectionMatrix);
    rc.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    rc.updateMatrixWorld(true);
    this.reflMatrix
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(rc.projectionMatrix)
      .multiply(rc.matrixWorldInverse);
  }

  renderReflection(renderer, scene, camera, hidden) {
    if (!this.rtRefl) return;
    this.updateReflectionCamera(camera);
    const previous = hidden.map((o) => o.visible);
    for (const o of hidden) o.visible = false;
    renderer.setRenderTarget(this.rtRefl);
    renderer.render(scene, this.reflCamera);
    hidden.forEach((o, i) => (o.visible = previous[i]));
  }

  renderScene(renderer, scene, camera) {
    renderer.setRenderTarget(this.rtScene);
    renderer.render(scene, camera);
  }

  /**
   * Soft-focus copy (only when the glass is misted) and light halos (only when
   * the weather diffuses light). Returns which of the two were produced.
   */
  renderBlur(renderer, { mist, halo, scatter, haloThreshold, haloKnee }) {
    if (!mist && !halo) return;
    const half = this.half.render(renderer, this.pass, this.rtScene.texture);
    if (mist) this.mist.render(renderer, this.pass, half, { mix: scatter });
    if (halo) this.halo.render(renderer, this.pass, half, { mix: 0.85, threshold: haloThreshold, knee: haloKnee });
  }

  get sceneTexture() {
    return this.rtScene.texture;
  }
  get mistTexture() {
    return this.mist.texture;
  }
  get haloTexture() {
    return this.halo.texture;
  }
  get reflectionTexture() {
    return this.rtRefl ? this.rtRefl.texture : null;
  }

  dispose() {
    this.rtScene?.dispose();
    this.rtRefl?.dispose();
    this.half.dispose();
    this.mist.dispose();
    this.halo.dispose();
  }
}