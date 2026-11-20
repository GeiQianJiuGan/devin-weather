import { Color, Vector3 } from 'three';
import { periodForHour } from '../core/Store.js';
import { sampleKeys, smoothstep } from '../core/utils.js';

// Time of day -> sun / moon position and the clear-sky lighting environment.
// Weather is applied on top of this by the LightingSystem, so both stay
// independent (sunny night, rainy afternoon, foggy morning ...).

const SUNRISE = 6.0;
const SUNSET = 18.6;
const DEG = Math.PI / 180;
// The sun rises behind the building and sets in the direction the window faces.
const SUN_EAST = new Vector3(-0.616, 0, 0.788);
const SUN_SOUTH = new Vector3(0.788, 0, 0.616);
const SUN_TILT = 38 * DEG;
const MOONRISE = 19.0;
const MOON_UP_HOURS = 11.8;
const MOON_EAST = new Vector3(0.9945, 0, -0.1045);
const MOON_SOUTH = new Vector3(-0.1045, 0, -0.9945);
const MOON_TILT = 71 * DEG;

// Keyframes over the sine of the sun elevation (night ... zenith).
const KEYS = [-0.35, -0.14, -0.04, 0.03, 0.12, 0.3, 0.78];
const ZENITH = [[0.004, 0.007, 0.018], [0.01, 0.018, 0.05], [0.04, 0.07, 0.18], [0.09, 0.16, 0.38], [0.12, 0.26, 0.6], [0.11, 0.3, 0.76], [0.085, 0.26, 0.78]];
const HORIZON = [[0.014, 0.018, 0.034], [0.035, 0.042, 0.08], [0.42, 0.23, 0.19], [0.95, 0.48, 0.22], [0.9, 0.66, 0.44], [0.64, 0.79, 0.98], [0.54, 0.73, 0.98]];
const SUN_COLOR = [[1, 0.3, 0.08], [1, 0.3, 0.08], [1, 0.3, 0.08], [1, 0.42, 0.14], [1, 0.66, 0.38], [1, 0.9, 0.76], [1, 0.96, 0.9]];
const SUN_INTENSITY = [0, 0, 0, 0.9, 2.6, 4.0, 4.6];
const HEMI_SKY = [[0.3, 0.34, 0.5], [0.3, 0.34, 0.52], [0.4, 0.38, 0.55], [0.66, 0.56, 0.58], [0.72, 0.74, 0.86], [0.62, 0.76, 1.0], [0.6, 0.76, 1.0]];
const HEMI_GROUND = [[0.1, 0.09, 0.09], [0.1, 0.09, 0.09], [0.16, 0.13, 0.12], [0.26, 0.2, 0.16], [0.3, 0.26, 0.22], [0.32, 0.3, 0.27], [0.32, 0.3, 0.27]];
const HEMI_INTENSITY = [0.3, 0.32, 0.5, 0.8, 1.15, 1.5, 1.7];
const SUN_GLOW = [[0, 0, 0], [0.05, 0.02, 0.015], [0.55, 0.22, 0.08], [0.9, 0.38, 0.12], [0.4, 0.24, 0.12], [0, 0, 0], [0, 0, 0]];
const EXPOSURE = [1.75, 1.7, 1.4, 1.18, 1.05, 1.0, 1.0];

const _rgb = [0, 0, 0];
const setColor = (color, table, x) => {
  sampleKeys(KEYS, table, x, _rgb);
  color.setRGB(_rgb[0], _rgb[1], _rgb[2]);
};

function orbit(out, theta, east, south, tilt) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return out
    .copy(east)
    .multiplyScalar(c)
    .addScaledVector(south, s * Math.sin(tilt))
    .setY(s * Math.cos(tilt))
    .normalize();
}

export class TimeSystem {
  constructor(store) {
    this.store = store;
    this.hour = store.state.time.hour % 24;
    this.env = {
      hour: this.hour,
      sunDir: new Vector3(0, 1, 0),
      moonDir: new Vector3(0, 1, 0),
      elevation: 0,
      day: 1,
      night: 0,
      zenith: new Color(),
      horizon: new Color(),
      sunColor: new Color(),
      sunIntensity: 0,
      moonVisibility: 0,
      hemiSky: new Color(),
      hemiGround: new Color(),
      hemiIntensity: 1,
      sunGlow: new Color(),
      stars: 0,
      exposure: 1,
    };
    this.compute();
  }

  update(realDt, simDt) {
    const t = this.store.state.time;
    if (t.autoCycle && simDt > 0) {
      const next = (t.hour + (simDt * t.cycleSpeed) / 60) % 24;
      this.store.set('time.hour', next);
      const period = periodForHour(next);
      if (period !== t.preset) this.store.set('time.preset', period);
      this.hour = next;
    } else {
      // ease towards the selected hour along the shorter way around the clock
      const target = t.hour % 24;
      const diff = ((target - this.hour + 36) % 24) - 12;
      if (Math.abs(diff) < 0.002) this.hour = target;
      else this.hour = (this.hour + diff * (1 - Math.exp(-realDt * 2.4)) + 24) % 24;
    }
    this.compute();
  }

  compute() {
    const env = this.env;
    const h = this.hour;
    env.hour = h;

    const dayLength = SUNSET - SUNRISE;
    let theta;
    if (h >= SUNRISE && h <= SUNSET) theta = (Math.PI * (h - SUNRISE)) / dayLength;
    else theta = Math.PI + (Math.PI * (h > SUNSET ? h - SUNSET : h + 24 - SUNSET)) / (24 - dayLength);
    orbit(env.sunDir, theta, SUN_EAST, SUN_SOUTH, SUN_TILT);

    const sinceMoonrise = (h - MOONRISE + 24) % 24;
    const moonTheta = sinceMoonrise <= MOON_UP_HOURS
      ? (Math.PI * sinceMoonrise) / MOON_UP_HOURS
      : Math.PI + (Math.PI * (sinceMoonrise - MOON_UP_HOURS)) / (24 - MOON_UP_HOURS);
    orbit(env.moonDir, moonTheta, MOON_EAST, MOON_SOUTH, MOON_TILT);

    const e = env.sunDir.y;
    env.elevation = e;
    env.day = smoothstep(-0.1, 0.2, e);
    env.night = 1 - smoothstep(-0.16, 0.02, e);
    setColor(env.zenith, ZENITH, e);
    setColor(env.horizon, HORIZON, e);
    setColor(env.sunColor, SUN_COLOR, e);
    setColor(env.hemiSky, HEMI_SKY, e);
    setColor(env.hemiGround, HEMI_GROUND, e);
    setColor(env.sunGlow, SUN_GLOW, e);
    env.sunIntensity = sampleKeys(KEYS, SUN_INTENSITY, e);
    env.hemiIntensity = sampleKeys(KEYS, HEMI_INTENSITY, e);
    env.exposure = sampleKeys(KEYS, EXPOSURE, e);
    env.stars = env.night * 0.85;
    env.moonVisibility = env.night * smoothstep(-0.02, 0.1, env.moonDir.y);

    // dawn is a little cooler and pinker than dusk
    if (h < 12) {
      const twilight = Math.exp(-((e / 0.14) ** 2));
      env.horizon.lerp(_dawn, 0.35 * twilight);
      env.sunGlow.multiplyScalar(1 - 0.3 * twilight);
    }
  }
}

const _dawn = new Color(0.8, 0.5, 0.56);