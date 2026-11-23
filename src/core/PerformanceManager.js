// Quality presets, frame-rate monitoring and automatic adaptation.

export const QUALITY = {
  low: {
    maxPixelRatio: 1, renderScale: 0.6, msaa: 0, shadows: false, shadowSize: 1024, shadowInterval: 1,
    reflection: false, reflectionScale: 0.3, blurLevels: 3, haloLevels: 3, finalBloom: false,
    particles: 0.3, dropLayers: 1, cheapNormals: true, cloudOctaves: 3, streetLights: 0, areaLights: false,
  },
  medium: {
    maxPixelRatio: 1, renderScale: 0.8, msaa: 2, shadows: true, shadowSize: 1024, shadowInterval: 2,
    reflection: true, reflectionScale: 0.35, blurLevels: 4, haloLevels: 4, finalBloom: true,
    particles: 0.6, dropLayers: 2, cheapNormals: false, cloudOctaves: 4, streetLights: 4, areaLights: false,
  },
  high: {
    maxPixelRatio: 1.5, renderScale: 1, msaa: 4, shadows: true, shadowSize: 2048, shadowInterval: 1,
    reflection: true, reflectionScale: 0.5, blurLevels: 5, haloLevels: 4, finalBloom: true,
    particles: 1, dropLayers: 2, cheapNormals: false, cloudOctaves: 5, streetLights: 8, areaLights: true,
  },
};

const ORDER = ['low', 'medium', 'high'];
const SCALE_STEPS = [1, 0.85, 0.72, 0.6];

/** Integrated / software GPUs start on the medium preset. */
export function suggestQuality(gpuName) {
  return /intel|uhd|iris|radeon\(tm\) graphics|swiftshader|llvmpipe|software|basic render|mali|adreno|powervr/i.test(gpuName || '')
    ? 'medium'
    : 'high';
}

export class PerformanceManager {
  constructor(store, { autoAdapt = true } = {}) {
    this.store = store;
    this.autoAdapt = autoAdapt;
    this.fps = 60;
    this.frameMs = 16.7;
    this.frames = 0;
    this.elapsed = 0;
    this.warmup = 5;
    this.slowFor = 0;
    this.scaleStep = 0;
    this.onReport = null;
    this.onAdapt = null;
    this.onScale = null;
  }

  get settings() {
    return QUALITY[this.store.state.quality] || QUALITY.high;
  }

  /** Extra resolution factor chosen by the automatic adaptation (1 = preset resolution). */
  get scale() {
    return SCALE_STEPS[this.scaleStep];
  }

  /** The user picked a preset explicitly: stop second-guessing them. */
  userSelected() {
    this.autoAdapt = false;
    if (this.scaleStep !== 0) {
      this.scaleStep = 0;
      this.onScale?.();
    }
  }

  tick(dt, info) {
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed < 0.5) return;
    this.fps = this.frames / this.elapsed;
    this.frameMs = (this.elapsed / this.frames) * 1000;
    const window = this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    this.onReport?.({ fps: this.fps, frameMs: this.frameMs, ...info });

    // Sustained low frame rate: first lower the internal resolution in a few
    // steps, then drop to the next preset. Never steps back up on its own, so
    // it cannot oscillate; picking a preset by hand restores full resolution.
    if (this.warmup > 0) {
      this.warmup -= window;
      return;
    }
    if (!this.autoAdapt || this.store.state.playback.paused) return;
    this.slowFor = this.fps < 24 ? this.slowFor + window : 0;
    if (this.slowFor < 3) return;
    this.slowFor = 0;
    this.warmup = 3;
    const level = ORDER.indexOf(this.store.state.quality);
    if (this.scaleStep < SCALE_STEPS.length - 1 && !(level > 0 && this.scaleStep >= 1)) {
      this.scaleStep++;
      this.onScale?.();
    } else if (level > 0) {
      this.scaleStep = 0;
      this.store.set('quality', ORDER[level - 1]);
      this.onAdapt?.(ORDER[level - 1]);
    } else if (this.scaleStep < SCALE_STEPS.length - 1) {
      this.scaleStep++;
      this.onScale?.();
    }
  }
}