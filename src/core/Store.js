import { clamp } from './utils.js';

// Central, serialisable scene configuration. Every system reads from this
// store; the UI is the only writer (plus the auto day/night cycle
// and live weather).

export const WEATHER_TYPES = [
  { id: 'sunny', label: 'Sunny', intensity: 60 },
  { id: 'cloudy', label: 'Cloudy', intensity: 50 },
  { id: 'overcast', label: 'Overcast', intensity: 60 },
  { id: 'rain_light', label: 'Light Rain', intensity: 50 },
  { id: 'rain_moderate', label: 'Moderate Rain', intensity: 55 },
  { id: 'rain_heavy', label: 'Heavy Rain', intensity: 70 },
  { id: 'snow_light', label: 'Light Snow', intensity: 50 },
  { id: 'snow_heavy', label: 'Heavy Snow', intensity: 70 },
  { id: 'thunderstorm', label: 'Thunderstorm', intensity: 70 },
  { id: 'fog', label: 'Fog', intensity: 60 },
];

export const TIME_PRESETS = [
  { id: 'dawn', label: 'Dawn', hour: 6.2 },
  { id: 'morning', label: 'Morning', hour: 9.0 },
  { id: 'noon', label: 'Noon', hour: 12.5 },
  { id: 'afternoon', label: 'Afternoon', hour: 15.5 },
  { id: 'sunset', label: 'Sunset', hour: 18.3 },
  { id: 'night', label: 'Night', hour: 22.0 },
];

export const QUALITY_LEVELS = ['low', 'medium', 'high'];

const WEATHER_ALIASES = { rain: 'rain_moderate', snow: 'snow_light', storm: 'thunderstorm', clear: 'sunny' };

/** Named part of the day for an arbitrary hour (used to highlight presets). */
export function periodForHour(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 4.9 && h < 7.4) return 'dawn';
  if (h >= 7.4 && h < 11) return 'morning';
  if (h >= 11 && h < 14) return 'noon';
  if (h >= 14 && h < 16.9) return 'afternoon';
  if (h >= 16.9 && h < 19.4) return 'sunset';
  return 'night';
}

export function createDefaultState() {
  return {
    weather: { type: 'rain_moderate', intensity: 55, windStrength: 35 },
    time: { preset: 'night', hour: 20, autoCycle: false, cycleSpeed: 20 },
    scene: {
      trafficEnabled: true,
      trafficDensity: 65,
      windowCondensation: true,
      exteriorBlur: 50,
      interiorLightEnabled: true,
      deskLampEnabled: true,
      computerScreenBrightness: 80,
    },
    // live mode: follow the current weather and local time of a real place
    live: { enabled: true, auto: true, city: '北京', lat: 39.9042, lon: 116.4074 },
    playback: { paused: false },
    quality: 'high',
  };
}

const num = (min, max) => ({ kind: 'number', min, max });
const bool = { kind: 'boolean' };
const SCHEMA = {
  'weather.type': { kind: 'enum', values: WEATHER_TYPES.map((w) => w.id), aliases: WEATHER_ALIASES },
  'weather.intensity': num(0, 100),
  'weather.windStrength': num(0, 100),
  'time.preset': { kind: 'enum', values: [...TIME_PRESETS.map((t) => t.id), 'custom'] },
  'time.hour': num(0, 24),
  'time.autoCycle': bool,
  'time.cycleSpeed': num(1, 100),
  'scene.trafficEnabled': bool,
  'scene.trafficDensity': num(0, 100),
  'scene.windowCondensation': bool,
  'scene.exteriorBlur': num(0, 100),
  'scene.interiorLightEnabled': bool,
  'scene.deskLampEnabled': bool,
  'scene.computerScreenBrightness': num(0, 100),
  'live.enabled': bool,
  'live.auto': bool,
  'live.city': { kind: 'string', max: 40 },
  'live.lat': num(-90, 90),
  'live.lon': num(-180, 180),
  'playback.paused': bool,
  quality: { kind: 'enum', values: QUALITY_LEVELS },
};

const readPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const writePath = (obj, path, value) => {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
};

function coerce(rule, value) {
  if (rule.kind === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? clamp(n, rule.min, rule.max) : undefined;
  }
  if (rule.kind === 'string') return typeof value === 'string' && value.trim() ? value.trim().slice(0, rule.max) : undefined;
  if (rule.kind === 'boolean') return typeof value === 'boolean' ? value : undefined;
  const v = rule.aliases && rule.aliases[value] ? rule.aliases[value] : value;
  return rule.values.includes(v) ? v : undefined;
}

/** Builds a valid state from untrusted input; unknown or invalid fields fall back to defaults. */
export function sanitizeState(input) {
  const state = createDefaultState();
  if (!input || typeof input !== 'object') return state;
  for (const [path, rule] of Object.entries(SCHEMA)) {
    const raw = readPath(input, path);
    if (raw === undefined) continue;
    const value = coerce(rule, raw);
    if (value !== undefined) writePath(state, path, value);
  }
  // saved before automatic location existed: the place in it was chosen by hand
  if (input.live && typeof input.live === 'object' && input.live.auto === undefined) state.live.auto = false;
  return state;
}

export class Store {
  constructor(storageKey = 'cinematic-weather:v1') {
    this.storageKey = storageKey;
    this.listeners = new Set();
    this.saveTimer = 0;
    const saved = this.loadSaved();
    this.hasSavedState = saved !== null;
    this.state = sanitizeState(saved);
    this.state.playback.paused = false;
  }

  loadSaved() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  get(path) {
    return readPath(this.state, path);
  }

  /** Sets one field (validated). Returns true when the value changed. */
  set(path, value) {
    const rule = SCHEMA[path];
    if (!rule) throw new Error(`Unknown state path: ${path}`);
    const next = coerce(rule, value);
    if (next === undefined || next === readPath(this.state, path)) return false;
    writePath(this.state, path, next);
    this.emit(path);
    return true;
  }

  /** Replaces the whole configuration (import / reset). */
  replace(input) {
    this.state = sanitizeState(input);
    this.emit('*');
  }

  reset() {
    const quality = this.state.quality;
    this.state = createDefaultState();
    this.state.quality = quality;
    this.emit('*');
  }

  serialize() {
    return JSON.stringify(this.state, null, 2);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(path) {
    for (const listener of this.listeners) listener(path, this.state);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.state));
      } catch {
        /* storage may be unavailable (private mode); the app works without it */
      }
    }, 400);
  }
}