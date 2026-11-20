import {
  HalfFloatType,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  UnsignedByteType,
  Vector3,
  WebGLRenderer,
} from 'three';
import { buildCity } from '../city/CityBuilder.js';
import { ext } from '../city/sharedUniforms.js';
import { buildStreetFurniture } from '../city/StreetFurniture.js';
import { TrafficSystem } from '../city/TrafficSystem.js';
import { VehicleFleet } from '../city/Vehicles.js';
import { ExteriorPipeline } from '../render/ExteriorPipeline.js';
import { FullscreenPass } from '../render/FullscreenPass.js';
import { PostFX } from '../render/PostFX.js';
import { buildRoom } from '../room/RoomBuilder.js';
import { WindowGlass } from '../room/WindowGlass.js';
import { SkyDome } from '../sky/SkyDome.js';
import { LightingSystem } from '../systems/LightingSystem.js';
import { TimeSystem } from '../systems/TimeSystem.js';
import { WeatherSystem } from '../systems/WeatherSystem.js';
import { LightningSystem } from '../weather/LightningSystem.js';
import { RainSystem, SnowSystem } from '../weather/Precipitation.js';
import { CAMERA, ROOM_ORIGIN } from './layout.js';
import { QUALITY } from './PerformanceManager.js';
import { Rng, clamp, damp, formatHour } from './utils.js';

const CITY_SEED = 20240611;
const VEHICLE_POOL = 64;
const BASE_ASPECT = 16 / 9;

/**
 * Scene manager: owns the renderer, both scenes (city outside / bedroom
 * inside), every simulation system and the frame loop.
 *
 * Frame: update systems -> render the city into its own HDR target ->
 * blur / halo passes -> render the bedroom (its glass composites the city) ->
 * bloom + tone mapping to the screen.
 */
export class App {
  constructor({ canvas, stage, store, perf, onGpu }) {
    this.canvas = canvas;
    this.stage = stage;
    this.store = store;
    this.perf = perf;

    const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    renderer.toneMapping = NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.info.autoReset = false;
    this.renderer = renderer;
    const floatTargets = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    this.textureType = floatTargets ? HalfFloatType : UnsignedByteType;
    const gl = renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : '';
    onGpu?.(this.gpuName);

    // --- cameras: one viewpoint, two depth ranges ------------------------------------
    this.cameraHome = new Vector3().copy(ROOM_ORIGIN).add(CAMERA.position);
    this.camera = new PerspectiveCamera(CAMERA.fov, BASE_ASPECT, 0.05, 60);
    this.exteriorCamera = new PerspectiveCamera(CAMERA.fov, BASE_ASPECT, 0.5, 6000);
    this.pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    this.placeCameras();

    // --- city (exterior scene) -----------------------------------------------------------
    const rng = new Rng(CITY_SEED);
    this.exteriorScene = new Scene();
    this.sky = new SkyDome();
    this.city = buildCity(rng);
    this.furniture = buildStreetFurniture(rng, QUALITY.high.streetLights);
    this.fleet = new VehicleFleet(VEHICLE_POOL);
    this.traffic = new TrafficSystem(this.fleet, this.furniture, new Rng(CITY_SEED + 7));
    this.rain = new RainSystem(new Rng(101));
    this.snow = new SnowSystem(new Rng(202));
    this.lightning = new LightningSystem(new Rng(303), this.cameraHome);
    this.exteriorScene.add(
      this.sky.mesh, this.city.group, this.furniture.group, this.fleet.group, this.lightning.bolt,
      ...this.rain.meshes, ...this.snow.meshes,
    );
    // not part of the mirrored image used for wet-road reflections
    this.reflectionHidden = [
      this.city.road, this.city.shopSpill.mesh, this.furniture.pools.mesh, this.fleet.beams.mesh, this.fleet.blobs.mesh,
      ...this.rain.meshes, ...this.snow.meshes,
    ];

    // --- bedroom (interior scene) -------------------------------------------------------
    this.interiorScene = new Scene();
    this.room = buildRoom();
    this.glass = new WindowGlass();
    this.room.group.add(...this.glass.meshes);
    this.interiorScene.add(this.room.group);

    // --- systems ------------------------------------------------------------------------------
    this.time = new TimeSystem(store);
    this.weather = new WeatherSystem(store);
    this.lighting = new LightingSystem({
      exteriorScene: this.exteriorScene, sky: this.sky, city: this.city, furniture: this.furniture, room: this.room,
      glass: this.glass, traffic: this.traffic, rain: this.rain, snow: this.snow, cameraPosition: this.cameraHome,
    });

    // --- render pipeline -------------------------------------------------------------------
    this.pass = new FullscreenPass();
    this.exterior = new ExteriorPipeline(this.pass);
    this.post = new PostFX(this.pass);

    this.simTime = 0;
    this.last = performance.now();
    this.raf = 0;
    this.running = false;
    this.frameCount = 0;
    this.onFirstFrame = null;
    this.quality = null;
    this.applyQuality();

    this.frame = this.frame.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
    this.onPointer = this.onPointer.bind(this);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pointermove', this.onPointer);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(stage);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.stop();
    });
    canvas.addEventListener('webglcontextrestored', () => window.location.reload());
    store.subscribe((path) => {
      if (path === 'quality' || path === '*') this.applyQuality();
    });
    perf.onScale = () => this.resize();
  }

  placeCameras() {
    const p = this.pointer;
    // a few centimetres of parallax following the pointer makes the depth readable
    const eye = this.camera.position.copy(this.cameraHome);
    eye.x += p.sx * 0.05 * 0.68 ;
    eye.z += p.sx * 0.05 * 0.73;
    eye.y += p.sy * 0.03;
    this.camera.lookAt(CAMERA.target);
    this.exteriorCamera.position.copy(eye);
    this.exteriorCamera.quaternion.copy(this.camera.quaternion);
    this.camera.updateMatrixWorld();
    this.exteriorCamera.updateMatrixWorld();
  }

  onPointer(e) {
    const rect = this.stage.getBoundingClientRect();
    this.pointer.x = clamp(((e.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1, -1, 1);
    this.pointer.y = clamp(1 - ((e.clientY - rect.top) / Math.max(rect.height, 1)) * 2, -1, 1);
  }

  applyQuality() {
    const q = this.perf.settings;
    if (q === this.quality) return;
    this.quality = q;
    this.sky.setQuality(q);
    this.glass.setQuality(q);
    this.rain.setQuality(q.particles);
    this.snow.setQuality(q.particles);
    this.lighting.setQuality(q);
    this.resize();
  }

  resize() {
    const width = Math.max(1, this.stage.clientWidth);
    const height = Math.max(1, this.stage.clientHeight);
    const q = this.quality;
    const ratio = Math.min(window.devicePixelRatio || 1, q.maxPixelRatio) * q.renderScale * this.perf.scale;
    const bw = Math.max(2, Math.floor(width * ratio));
    const bh = Math.max(2, Math.floor(height * ratio));
    if (bw === this.bufferWidth && bh === this.bufferHeight && q === this.sizedFor) return;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.bufferWidth = bw;
    this.bufferHeight = bh;
    this.sizedFor = q;

    // 16:9 is the reference framing; narrower viewports widen the vertical field of view instead of cropping
    const aspect = width / height;
    const half = (CAMERA.fov * Math.PI) / 360;
    let fov = CAMERA.fov;
    if (aspect < BASE_ASPECT) fov = Math.min(86, (Math.atan((Math.tan(half) * BASE_ASPECT) / aspect) * 360) / Math.PI);
    for (const cam of [this.camera, this.exteriorCamera]) {
      cam.fov = fov;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
    this.exterior.setSize(bw, bh, q, this.textureType);
    this.post.setSize(bw, bh, q, this.textureType);
    this.glass.setInputs(this.exterior.sceneTexture, this.exterior.mistTexture, this.exterior.haloTexture, bw, bh);
    const pixel = (2 * Math.tan((fov * Math.PI) / 360)) / bh;
    this.rain.setPixelAngle(pixel);
    this.snow.setPixelAngle(pixel);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  onVisibility() {
    // no simulation while the tab is hidden; resume without a time jump
    if (document.hidden) this.stop();
    else this.start();
  }

  frame(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const rawDt = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    const dt = Math.min(rawDt, 0.1);
    this.step(dt);
    this.render();
    this.perf.tick(rawDt, {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      width: this.bufferWidth,
      height: this.bufferHeight,
      vehicles: this.traffic.activeCount,
    });
    if (this.frameCount++ === 1) this.onFirstFrame?.();
  }

  /** Advances every system. dt is real time; simulation time stands still while paused. */
  step(dt) {
    const state = this.store.state;
    const simDt = state.playback.paused ? 0 : dt;
    this.simTime += simDt;

    this.time.update(dt, simDt);
    this.weather.update(dt, simDt);
    const wx = this.weather.params;
    const wind = this.weather.wind;
    this.lightning.update(simDt, wx.lightning);

    this.traffic.setEnabled(state.scene.trafficEnabled);
    this.traffic.setDensity(state.scene.trafficDensity / 100);
    this.lighting.update(dt, simDt, this.time.env, this.weather, this.lightning, state);
    this.traffic.update(simDt);

    this.rain.update(simDt, wx.rain, wind.x, wind.z);
    this.snow.update(simDt, wx.snow, wind.x, wind.z);
    this.sky.advance(simDt, wind.x, wind.z);
    this.sky.uniforms.uTime.value = this.simTime % 1000;
    this.glass.update(simDt);
    this.room.screenContent.update(formatHour(this.time.hour), this.simTime);

    const p = this.pointer;
    p.sx = damp(p.sx, p.x, 3, dt);
    p.sy = damp(p.sy, p.y, 3, dt);
    this.placeCameras();
  }

  render() {
    const r = this.renderer;
    const lighting = this.lighting;
    r.info.reset();
    this.sky.mesh.position.copy(this.exteriorCamera.position);

    // 1. the city, mirrored about the ground, for wet-road reflections
    r.shadowMap.needsUpdate = this.frameCount % this.quality.shadowInterval === 0;
    ext.uReflOn.value = 0;
    ext.uReflTex.value = null;
    if (lighting.reflectionActive && this.exterior.reflectionTexture) {
      this.exterior.renderReflection(r, this.exteriorScene, this.exteriorCamera, this.reflectionHidden);
      ext.uReflTex.value = this.exterior.reflectionTexture;
      ext.uReflMatrix.value.copy(this.exterior.reflMatrix);
      ext.uReflOn.value = 1;
    }
    // 2. the city as seen through the window, plus its soft-focus and halo copies
    this.exterior.renderScene(r, this.exteriorScene, this.exteriorCamera);
    this.exterior.renderBlur(r, {
      mist: lighting.mistActive, halo: lighting.haloActive, scatter: lighting.scatter,
      haloThreshold: lighting.haloThreshold, haloKnee: 0.5,
    });
    // 3. the bedroom; the glass panes composite the exterior textures
    r.shadowMap.needsUpdate = lighting.interiorShadowsDirty;
    lighting.interiorShadowsDirty = false;
    r.setRenderTarget(this.post.target);
    r.render(this.interiorScene, this.camera);
    // 4. bloom, exposure, tone mapping
    this.post.render(r, { exposure: lighting.exposure, bloom: 0.05, time: this.simTime });
  }

  /** Skips all running transitions (time easing, weather build-up). Used for testing and captures. */
  settle() {
    this.time.hour = this.store.state.time.hour % 24;
    Object.assign(this.weather.params, this.weather.resolve());
    this.lighting.first = true;
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pointermove', this.onPointer);
    this.resizeObserver.disconnect();
    this.exterior.dispose();
    this.post.dispose();
    this.renderer.dispose();
  }
}