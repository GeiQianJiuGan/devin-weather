import { Color, DirectionalLight, FogExp2, HemisphereLight, Vector3 } from 'three';
import { ext } from '../city/sharedUniforms.js';
import { STREETLIGHT_COLOR } from '../city/StreetFurniture.js';
import { clamp, damp, lerp, smoothstep } from '../core/utils.js';

// Coordinates every light in both scenes. Inputs: the clear-sky environment
// (TimeSystem), the smoothed weather parameters (WeatherSystem), lightning and
// the user's scene toggles. Outputs: sky, fog, sun / moon, ambient light,
// streetlights, building windows, vehicle lamps, signs, the interior lights,
// the glass composite parameters and the final exposure.

const MOON_COLOR = new Color(0.55, 0.68, 1.0);
const FLASH_COLOR = new Color(0.72, 0.8, 1.0);
const CITY_GLOW = new Color(0.022, 0.016, 0.012);
const WARM = new Color(1.0, 0.78, 0.56);
const LAMP_WARM = new Color(1.0, 0.72, 0.42);
const SCREEN_COOL = new Color(1.0, 0.9, 0.76);

const _a = new Color();
const _b = new Color();
const _c = new Color();
const _d = new Color();
const luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
/** target += color * scale */
const mad = (target, color, scale) => {
  target.r += color.r * scale;
  target.g += color.g * scale;
  target.b += color.b * scale;
  return target;
};
const desaturate = (c, amount) => {
  const l = luminance(c);
  c.r = lerp(c.r, l, amount);
  c.g = lerp(c.g, l, amount);
  c.b = lerp(c.b, l, amount);
  return c;
};

export class LightingSystem {
  constructor({ exteriorScene, sky, city, furniture, room, glass, traffic, rain, snow, cameraPosition }) {
    this.sky = sky;
    this.city = city;
    this.furniture = furniture;
    this.room = room;
    this.glass = glass;
    this.traffic = traffic;
    this.rain = rain;
    this.snow = snow;

    exteriorScene.fog = new FogExp2(0x8899aa, 0.0012);
    this.fog = exteriorScene.fog;

    this.sun = new DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    const cam = this.sun.shadow.camera;
    cam.left = -85;
    cam.right = 85;
    cam.top = 85;
    cam.bottom = -85;
    cam.near = 20;
    cam.far = 620;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.35;
    this.sun.target.position.set(8, 0, -8);
    this.hemi = new HemisphereLight(0xffffff, 0x444444, 1);
    exteriorScene.add(this.sun, this.sun.target, this.hemi);

    // particle systems are lit by the streetlights closest to the window
    this.particleLights = [...furniture.lamps]
      .map((l) => ({ x: l.hx, y: furniture.lampHeight, z: l.hz, d: Math.hypot(l.hx - cameraPosition.x, l.hz - cameraPosition.z) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, 8);

    this.levels = { interior: 0, lamp: 0, screen: 0.8 };
    this.exposure = 1;
    this.scatter = 0.5;
    this.haloThreshold = 1;
    this.reflectionActive = false;
    this.mistActive = false;
    this.haloActive = false;
    this.interiorShadowsDirty = true;
    this.shadowWarmup = 4;
    this.lastInteriorDir = new Vector3();
    this.cityLights = 0;
    this.blinkTime = 0;
    this.first = true;
  }

  update(realDt, simDt, env, weather, lightning, state) {
    const wx = weather.params;
    const flash = lightning.flash;
    const cover = wx.cover;
    const overcast = smoothstep(0.55, 1, cover);

    // --- how bright is it outside? -> which artificial lights are on -----------
    const lum = clamp((env.hemiIntensity * wx.skyMul) / 1.6, 0, 1.2);
    const cityLights = 1 - smoothstep(0.2, 0.8, lum);
    this.cityLights = cityLights;
    const lampsOn = smoothstep(0.2, 0.6, cityLights);
    const precip = smoothstep(0.08, 0.4, wx.rain + wx.snow + wx.fog * 40);
    const headOn = Math.max(0.1, cityLights, 0.75 * precip);
    const tailOn = Math.max(cityLights, 0.6 * precip);

    // --- sky ----------------------------------------------------------------------------
    const su = this.sky.uniforms;
    su.uZenith.value.copy(env.zenith).multiplyScalar(wx.skyMul);
    su.uHorizon.value.copy(env.horizon).multiplyScalar(wx.skyMul);
    su.uSunDir.value.copy(env.sunDir);
    su.uMoonDir.value.copy(env.moonDir);
    su.uSunColor.value.copy(env.sunColor);
    su.uSunDisc.value = clamp(env.sunIntensity / 2, 0, 1) * (1 - overcast);
    su.uSunGlow.value.copy(env.sunGlow).multiplyScalar(1 - 0.75 * overcast);
    su.uMoon.value = env.moonVisibility * (1 - 0.9 * cover);
    su.uStars.value = env.stars * (1 - cover) * (1 - clamp(wx.fog * 60, 0, 1));
    su.uCover.value = cover;
    su.uCloudDark.value = wx.dark;
    su.uFlash.value = flash;
    su.uFlashDir.value.copy(lightning.direction);

    const cityGlow = _c.copy(CITY_GLOW).multiplyScalar(env.night * (0.6 + 0.8 * cover));
    su.uCityGlow.value.copy(cityGlow);

    // ambient sky colour (what clouds, fog, glass and wet surfaces pick up)
    const ambient = _a.copy(env.hemiSky).multiplyScalar(env.hemiIntensity * wx.skyMul);
    desaturate(ambient, 0.55 * cover);
    su.uCloudShade.value.copy(ambient).multiplyScalar(0.3).add(cityGlow);
    su.uCloudLit.value.copy(env.sunColor).multiplyScalar(env.sunIntensity * 0.22 * (1 - 0.8 * overcast));
    mad(su.uCloudLit.value, ambient, 0.42).add(cityGlow);

    const fogAmount = clamp(wx.fog * 38 + wx.rain * 0.2 + wx.snow * 0.25, 0, 0.97);
    const fogColor = _b.copy(env.horizon).multiplyScalar(wx.skyMul);
    fogColor.lerp(_d.copy(su.uCloudShade.value).multiplyScalar(1.5), clamp(cover * 0.7 + fogAmount, 0, 1));
    mad(mad(fogColor, cityGlow, 0.6), FLASH_COLOR, flash * 0.25);
    su.uFogColor.value.copy(fogColor);
    su.uFogAmount.value = fogAmount;
    su.uGround.value.copy(fogColor).multiplyScalar(0.5);
    this.fog.color.copy(fogColor);
    this.fog.density = weather.fogDensity;
    ext.uFogDensity.value = weather.fogDensity;

    // --- sun / moon and ambient light outside ---------------------------------------
    const sunPower = env.sunIntensity * wx.sunMul;
    const moonPower = 0.16 * env.moonVisibility * (1 - 0.85 * cover);
    const useMoon = moonPower > sunPower;
    // during a flash the scene is lit from the direction of the strike
    const lightDir = flash > 0.02 ? lightning.direction : useMoon ? env.moonDir : env.sunDir;
    const lightColor = useMoon ? MOON_COLOR : env.sunColor;
    const directPower = Math.max(sunPower, moonPower);
    this.sun.color.copy(lightColor).lerp(FLASH_COLOR, clamp(flash, 0, 1));
    this.sun.intensity = directPower + flash * 1.5;
    this.sun.position.copy(this.sun.target.position).addScaledVector(lightDir, 300);
    this.hemi.color.copy(ambient).multiplyScalar(1 / Math.max(env.hemiIntensity * wx.skyMul, 1e-3));
    this.hemi.groundColor.copy(env.hemiGround);
    this.hemi.intensity = env.hemiIntensity * wx.skyMul + 0.12 * env.night + flash * 0.9;

    // --- city ---------------------------------------------------------------------------
    ext.uCityLights.value = 0.07 + 0.93 * cityLights;
    ext.uWindowGain.value = lerp(0.5, 1.25, cityLights);
    mad(ext.uSkyRefl.value.copy(env.horizon).multiplyScalar(0.6), env.zenith, 0.4).multiplyScalar(wx.skyMul);
    ext.uSkyRefl.value.lerp(su.uCloudLit.value, 0.7 * cover);
    ext.uHeadOn.value = headOn;
    ext.uTailOn.value = tailOn;
    this.blinkTime += simDt;
    ext.uBlink.value = (this.blinkTime * 1.4) % 1 < 0.5 ? 1 : 0;
    ext.uTime.value = this.blinkTime % 3600;
    ext.uWet.value = wx.wet;
    ext.uSnow.value = wx.snowCover;
    ext.uRain.value = wx.rain;
    ext.uWind.value = clamp(0.12 + weather.wind.speed / 9, 0.12, 2.4);
    this.reflectionActive = wx.wet > 0.03;

    const f = this.furniture;
    f.bulbMaterial.color.copy(STREETLIGHT_COLOR).multiplyScalar(0.02 + 26 * lampsOn);
    for (const light of f.lights) light.intensity = 120 * lampsOn;
    if (this.first || Math.abs(lampsOn - this.lastLamps) > 0.002 || Math.abs(wx.wet - this.lastWet) > 0.01) {
      const road = lampsOn * 0.5 * (1 - 0.35 * wx.wet);
      for (let i = 0; i < f.lamps.length; i++) {
        const real = i < f.lights.length && f.lights[i].visible;
        f.pools.setIntensity(i * 2, real ? 0 : road);
        f.pools.setIntensity(i * 2 + 1, real ? 0 : lampsOn * 0.8);
      }
      f.pools.commit();
      const spillOn = smoothstep(0.1, 0.5, cityLights) * 0.5;
      for (const s of this.city.spill) this.city.shopSpill.setIntensity(s.index, s.power * spillOn);
      this.city.shopSpill.commit();
      this.lastLamps = lampsOn;
      this.lastWet = wx.wet;
    }
    const signNight = smoothstep(0.08, 0.5, cityLights);
    for (const sign of this.city.signs) sign.mesh.material.color.setScalar(Math.max(lum * 0.85, sign.night * signNight));

    this.traffic.lampGain = lerp(3.2, 6.5, cityLights);
    this.traffic.beamLevel = smoothstep(0.3, 0.9, headOn) * 0.2 * (1 - 0.5 * wx.wet);
    this.traffic.shadowLevel = lerp(0.3, 0.55, clamp(lum, 0, 1)) * (1 - 0.5 * wx.snowCover);
    this.traffic.speedFactor = wx.speed;

    // --- precipitation shading ---------------------------------------------------------
    const particleAmbient = mad(_b.copy(ambient).multiplyScalar(0.34), FLASH_COLOR, flash * 1.5);
    this.rain.setAmbient(particleAmbient);
    this.rain.setLights(this.particleLights, 2.6 * lampsOn, STREETLIGHT_COLOR);
    this.snow.setAmbient(particleAmbient.multiplyScalar(1.5));
    this.snow.setLights(this.particleLights, 1.8 * lampsOn, STREETLIGHT_COLOR);

    // --- interior -------------------------------------------------------------------------
    const scene = state.scene;
    const lv = this.levels;
    const k = this.first ? 1000 : 6;
    lv.interior = damp(lv.interior, scene.interiorLightEnabled ? 1 : 0, k, realDt);
    lv.lamp = damp(lv.lamp, scene.deskLampEnabled ? 1 : 0, k, realDt);
    lv.screen = damp(lv.screen, scene.computerScreenBrightness / 100, k, realDt);
    const L = this.room.lights;

    L.sun.color.copy(this.sun.color);
    L.sun.intensity = directPower * 0.9 + flash * 1.1;
    L.sun.position.copy(L.sunTarget.position).addScaledVector(lightDir, 18);
    // the room never changes shape: its shadow maps only need a refresh when the light moves
    if (this.shadowWarmup > 0 || this.lastInteriorDir.distanceToSquared(lightDir) > 1e-7) {
      this.interiorShadowsDirty = true;
      this.lastInteriorDir.copy(lightDir);
      if (this.shadowWarmup > 0) this.shadowWarmup--;
    }

    // the glass walls glow with the sky (day) or the street (night)
    const windowGlow = _b.copy(ambient).multiplyScalar(0.5);
    mad(mad(mad(windowGlow, STREETLIGHT_COLOR, 0.035 * lampsOn), cityGlow, 0.5), FLASH_COLOR, flash * 0.9);
    L.windowNorth.color.copy(windowGlow);
    L.windowEast.color.copy(windowGlow);
    L.windowNorth.intensity = 1;
    L.windowEast.intensity = 1;
    L.windowNorthPoint.color.copy(windowGlow);
    L.windowEastPoint.color.copy(windowGlow);
    L.windowNorthPoint.intensity = L.windowAreaNorth * 2.2;
    L.windowEastPoint.intensity = L.windowAreaEast * 2.2;

    L.fill.color.copy(WARM).lerp(_d.copy(ambient).multiplyScalar(1 / Math.max(luminance(ambient), 1e-3)), 0.5 * clamp(lum, 0, 1));
    L.fill.intensity = 0.03 + 0.22 * clamp(lum, 0, 1) + 0.1 * lv.interior + 0.03 * lv.lamp + flash * 0.12;
    L.ceiling.intensity = 2.4 * lv.interior;
    L.pendants.intensity = 2.0 * lv.interior;
    this.room.fixtureMaterial.color.copy(WARM).multiplyScalar(0.04 + 9 * lv.interior);
    this.room.globeMaterial.color.copy(WARM).multiplyScalar(0.12 + 0.2 * clamp(lum, 0, 1) + 2.2 * lv.interior);
    this.room.domeInnerMaterial.color.copy(WARM).multiplyScalar(0.03 + 1.6 * lv.interior);
    L.lamp.intensity = 1.5 * lv.lamp;
    this.room.bulbMaterial.color.copy(LAMP_WARM).multiplyScalar(0.03 + 30 * lv.lamp);
    this.room.lampGlowMaterial.color.copy(LAMP_WARM).multiplyScalar(0.02 + 3.5 * lv.lamp);

    // monitor: dims itself a little in a dark room, but is always a cool light source
    const screenPower = lv.screen * lerp(0.72, 1, clamp(lum, 0, 1));
    this.room.screenMaterial.color.setScalar(0.03 + 1.5 * screenPower);
    L.monitorLight.color.copy(SCREEN_COOL);
    L.monitorLight.intensity = 1.6 * screenPower;
    L.monitorPoint.color.copy(SCREEN_COOL);
    L.monitorPoint.intensity = 0.4 * screenPower;

    // --- glass composite ----------------------------------------------------------------
    const gu = this.glass.uniforms;
    const g = weather.glass;
    gu.uDrops.value = g.drops;
    gu.uMist.value = g.mist;
    gu.uBlur.value = g.blur;
    // the blur chains only run when the weather actually needs them
    this.mistActive = g.mist + g.blur > 0.004 || g.drops > 0.004;
    this.haloActive = g.halo > 0.01;
    gu.uMistOn.value = this.mistActive ? 1 : 0;
    gu.uHalo.value = this.haloActive ? 0.03 + 0.04 * cityLights + 0.2 * g.halo : 0;
    gu.uTilt.value = clamp(weather.wind.speed * 0.014, 0, 0.3);
    mad(mad(gu.uVeil.value.copy(ambient).multiplyScalar(0.3), cityGlow, 0.6), FLASH_COLOR, flash);
    gu.uInterior.value.copy(WARM).multiplyScalar(0.1 * lv.interior + 0.025 * lv.lamp);
    mad(mad(gu.uInterior.value, SCREEN_COOL, 0.012 * screenPower), ambient, 0.02);
    gu.uGlintPos.value[0].copy(this.room.anchors.screen);
    gu.uGlintPos.value[1].copy(this.room.anchors.lamp);
    gu.uGlintColor.value[0].copy(SCREEN_COOL).multiplyScalar(2.2 * screenPower);
    gu.uGlintColor.value[1].copy(LAMP_WARM).multiplyScalar(16 * lv.lamp);

    this.scatter = lerp(0.4, 0.68, clamp(g.mist + g.blur, 0, 1));
    this.haloThreshold = lerp(1.0, 2.4, clamp(lum, 0, 1));
    this.exposure = env.exposure * (1 + 0.2 * overcast * env.day);
    this.first = false;
  }

  /** Applies a quality preset: shadow maps and the number of real streetlights. */
  setQuality(q) {
    const apply = (light, size) => {
      light.castShadow = q.shadows;
      if (light.shadow.mapSize.x !== size) {
        light.shadow.mapSize.set(size, size);
        light.shadow.map?.dispose();
        light.shadow.map = null;
      }
    };
    apply(this.sun, q.shadowSize);
    apply(this.room.lights.sun, q.shadowSize);
    apply(this.room.lights.lamp, q.lampShadowSize);
    this.furniture.lights.forEach((light, i) => (light.visible = i < q.streetLights));
    const L = this.room.lights;
    for (const light of [L.windowNorth, L.windowEast, L.monitorLight]) light.visible = q.areaLights;
    for (const light of [L.windowNorthPoint, L.windowEastPoint, L.monitorPoint]) light.visible = !q.areaLights;
    this.shadowWarmup = 4;
    this.first = true;
  }
}