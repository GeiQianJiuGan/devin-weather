import { clamp, damp, lerp } from '../core/utils.js';

// Weather presets -> a set of continuous parameters. Every preset maps the
// 0..100 intensity slider differently; the parameters are then smoothed so
// switching presets or dragging sliders never pops.

const BASE = {
  cover: 0, // cloud cover
  dark: 0, // cloud thickness / darkness
  rain: 0, // rain particle amount
  snow: 0, // snow particle amount
  fog: 0, // extra fog density (1 / m)
  sunMul: 1, // direct sunlight that makes it through
  skyMul: 1, // ambient sky light
  lightning: 0, // lightning activity
  wet: 0, // ground wetness target
  snowCover: 0, // snow on the ground target
  drops: 0, // droplets / streaks on the glass
  mist: 0, // condensation on the glass
  blur: 0, // rain-induced softening of the view
  halo: 0, // light diffusion around lamps
  wind: 2, // base wind speed (m / s)
  speed: 1, // how fast drivers dare to go
};

const P = (o) => ({ ...BASE, ...o });

export const WEATHER_MODELS = {
  sunny: (t) => P({ cover: lerp(0.3, 0.03, t), sunMul: lerp(0.82, 1.12, t), fog: lerp(0.0012, 0.0002, t), wind: lerp(1, 3, t) }),
  cloudy: (t) => P({ cover: lerp(0.38, 0.78, t), dark: lerp(0.05, 0.3, t), sunMul: lerp(0.8, 0.4, t), skyMul: lerp(1, 0.85, t), fog: 0.0005, wind: lerp(2, 6, t) }),
  overcast: (t) => P({ cover: lerp(0.9, 1, t), dark: lerp(0.3, 0.75, t), sunMul: lerp(0.14, 0.02, t), skyMul: lerp(0.8, 0.48, t), fog: lerp(0.0008, 0.002, t), halo: lerp(0, 0.1, t), wind: lerp(2, 6, t) }),
  rain_light: (t) => P({
    cover: lerp(0.92, 1, t), dark: lerp(0.4, 0.55, t), sunMul: 0.05, skyMul: lerp(0.72, 0.6, t), rain: lerp(0.06, 0.3, t),
    wet: lerp(0.45, 0.72, t), drops: lerp(0.14, 0.4, t), mist: lerp(0.08, 0.3, t), blur: lerp(0.03, 0.12, t), halo: lerp(0.1, 0.25, t),
    fog: lerp(0.001, 0.003, t), wind: lerp(2, 5, t), speed: 0.94,
  }),
  rain_moderate: (t) => P({
    cover: 1, dark: lerp(0.55, 0.72, t), sunMul: 0.03, skyMul: lerp(0.6, 0.48, t), rain: lerp(0.3, 0.62, t),
    wet: lerp(0.78, 0.92, t), drops: lerp(0.4, 0.7, t), mist: lerp(0.3, 0.55, t), blur: lerp(0.1, 0.22, t), halo: lerp(0.25, 0.45, t),
    fog: lerp(0.0025, 0.005, t), wind: lerp(3, 7, t), speed: 0.88,
  }),
  rain_heavy: (t) => P({
    cover: 1, dark: lerp(0.7, 0.9, t), sunMul: 0.02, skyMul: lerp(0.5, 0.36, t), rain: lerp(0.6, 1, t),
    wet: 1, drops: lerp(0.68, 1, t), mist: lerp(0.5, 0.8, t), blur: lerp(0.2, 0.38, t), halo: lerp(0.4, 0.7, t),
    fog: lerp(0.0045, 0.0105, t), wind: lerp(4, 10, t), speed: 0.78,
  }),
  snow_light: (t) => P({
    cover: lerp(0.88, 0.97, t), dark: lerp(0.2, 0.35, t), sunMul: 0.1, skyMul: lerp(0.85, 0.75, t), snow: lerp(0.08, 0.42, t),
    snowCover: lerp(0.3, 0.62, t), mist: lerp(0.1, 0.25, t), blur: lerp(0.02, 0.08, t), halo: lerp(0.1, 0.25, t),
    fog: lerp(0.0015, 0.004, t), wind: lerp(0.8, 3, t), wet: 0.2, speed: 0.85,
  }),
  snow_heavy: (t) => P({
    cover: 1, dark: lerp(0.35, 0.55, t), sunMul: 0.04, skyMul: lerp(0.75, 0.6, t), snow: lerp(0.45, 1, t),
    snowCover: lerp(0.7, 1, t), mist: lerp(0.2, 0.45, t), blur: lerp(0.06, 0.18, t), halo: lerp(0.25, 0.5, t),
    fog: lerp(0.005, 0.013, t), wind: lerp(2, 7, t), wet: 0.25, speed: 0.68,
  }),
  thunderstorm: (t) => P({
    cover: 1, dark: lerp(0.85, 1, t), sunMul: 0.01, skyMul: lerp(0.4, 0.28, t), rain: lerp(0.55, 1, t),
    wet: 1, drops: lerp(0.6, 1, t), mist: lerp(0.4, 0.7, t), blur: lerp(0.16, 0.34, t), halo: lerp(0.35, 0.65, t),
    fog: lerp(0.004, 0.009, t), wind: lerp(7, 16, t), lightning: lerp(0.25, 1, t), speed: 0.75,
  }),
  fog: (t) => P({
    cover: lerp(0.7, 0.9, t), dark: 0.15, sunMul: lerp(0.45, 0.08, t), skyMul: lerp(0.9, 0.75, t), fog: lerp(0.006, 0.034, t),
    mist: lerp(0.04, 0.2, t), blur: lerp(0, 0.1, t), halo: lerp(0.35, 1, t), wet: 0.3, wind: 0.6, speed: lerp(0.9, 0.7, t),
  }),
};

// Approach rates (1 / s) when a value rises / falls.
const RATES = {
  wet: [0.35, 0.12],
  snowCover: [0.12, 0.16],
  drops: [0.3, 0.22],
  mist: [0.3, 0.25],
  fog: [0.5, 0.5],
  cover: [0.6, 0.6],
  dark: [0.6, 0.6],
  lightning: [1.2, 1.2],
};
const DEFAULT_RATE = [0.8, 0.8];
const BASE_HAZE = 0.0011;

export class WeatherSystem {
  constructor(store) {
    this.store = store;
    this.target = this.resolve();
    this.params = { ...this.target };
    this.wind = { x: 0, z: 0, speed: 0 };
    this.fogDensity = BASE_HAZE;
    this.glass = { drops: 0, mist: 0, blur: 0, halo: 0 };
    this.time = 0;
    this.derive(0);
  }

  resolve() {
    const { weather, scene } = this.store.state;
    const model = WEATHER_MODELS[weather.type] || WEATHER_MODELS.sunny;
    const target = model(clamp(weather.intensity / 100, 0, 1));
    if (!scene.windowCondensation) {
      target.drops = 0;
      target.mist = 0;
      target.blur *= 0.35;
    }
    return target;
  }

  update(realDt, simDt) {
    this.target = this.resolve();
    const forcedDry = !this.store.state.scene.windowCondensation;
    for (const key of Object.keys(this.target)) {
      const goal = this.target[key];
      const rates = RATES[key] || DEFAULT_RATE;
      let rate = goal > this.params[key] ? rates[0] : rates[1];
      if (forcedDry && (key === 'drops' || key === 'mist')) rate = 2.5;
      this.params[key] = damp(this.params[key], goal, rate, realDt);
    }
    this.derive(simDt);
  }

  derive(simDt) {
    const p = this.params;
    const { weather, scene } = this.store.state;
    this.time += simDt;
    const t = this.time;

    // wind: user strength scales the preset's base speed; slow gusts and veering
    const w = weather.windStrength / 100;
    const gust = 1 + 0.25 * Math.sin(t * 0.5) + 0.15 * Math.sin(t * 1.3 + 1);
    const speed = (p.wind * (0.25 + 1.5 * w) + 6 * w * w) * gust;
    const angle = 0.644 + 0.2 * Math.sin(t * 0.07) + 0.1 * Math.sin(t * 0.19 + 2);
    this.wind.speed = speed;
    this.wind.x = Math.cos(angle) * speed;
    this.wind.z = Math.sin(angle) * speed;

    this.fogDensity = BASE_HAZE + p.fog;

    // the "exterior blur" slider scales how strongly weather softens the view
    const k = scene.exteriorBlur / 100;
    const gain = 0.25 + 1.5 * k;
    this.glass.drops = p.drops;
    this.glass.mist = clamp(p.mist * (0.4 + 1.2 * k), 0, 1);
    this.glass.blur = clamp(p.blur * gain + 0.3 * Math.max(2 * k - 1, 0), 0, 1);
    this.glass.halo = p.halo * (0.5 + k);
  }
}