import { clamp } from '../core/utils.js';
import { periodForHour } from '../core/Store.js';

// Live mode: the scene follows the current weather and local time of a real city.
// Data comes from Open-Meteo (no key needed); nothing is requested unless live mode is on.
// With automatic location the place is looked up from the visitor's IP address (no permission
// prompt; browser geolocation is unreliable in mainland China) and the clock starts from the
// browser's own time zone.

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const REFRESH_MS = 10 * 60 * 1000;
const CLOCK_MS = 20 * 1000;

export const CITIES = [
  { name: '北京', lat: 39.9042, lon: 116.4074 },
  { name: '上海', lat: 31.2304, lon: 121.4737 },
  { name: '广州', lat: 23.1291, lon: 113.2644 },
  { name: '深圳', lat: 22.5431, lon: 114.0579 },
  { name: '成都', lat: 30.5728, lon: 104.0668 },
  { name: '杭州', lat: 30.2741, lon: 120.1551 },
  { name: '武汉', lat: 30.5928, lon: 114.3055 },
  { name: '西安', lat: 34.3416, lon: 108.9398 },
  { name: '哈尔滨', lat: 45.8038, lon: 126.535 },
];

const LABELS = {
  sunny: 'Clear', cloudy: 'Partly cloudy', overcast: 'Overcast', rain_light: 'Light rain', rain_moderate: 'Rain',
  rain_heavy: 'Heavy rain', snow_light: 'Light snow', snow_heavy: 'Heavy snow', thunderstorm: 'Thunderstorm', fog: 'Fog',
};

/** Maps one Open-Meteo `current` block (WMO weather code) to the simulator's weather settings. */
export function mapConditions(c) {
  const code = c.weather_code;
  const cloud = c.cloud_cover ?? 50;
  // `precipitation` is the sum of the last 15 minutes
  const rate = Math.max(0, (c.precipitation ?? 0) * 4);
  const wet = (lo, hi, full) => Math.round(lo + (hi - lo) * clamp(rate / full, 0, 1));
  let type;
  let intensity;
  if (code === 0 || code === 1) [type, intensity] = ['sunny', 75 - cloud * 0.4];
  else if (code === 2) [type, intensity] = ['cloudy', 30 + cloud * 0.4];
  else if (code === 3) [type, intensity] = ['overcast', 30 + cloud * 0.4];
  else if (code === 45 || code === 48) [type, intensity] = ['fog', 60];
  else if (code >= 95) [type, intensity] = ['thunderstorm', wet(50, 95, 20)];
  else if (code === 75 || code === 86) [type, intensity] = ['snow_heavy', wet(55, 95, 6)];
  else if ((code >= 71 && code <= 77) || code === 85) [type, intensity] = ['snow_light', wet(35, 80, 3)];
  else if (code === 65 || code === 67 || code === 82) [type, intensity] = ['rain_heavy', wet(55, 95, 30)];
  else if (code === 63 || code === 81) [type, intensity] = ['rain_moderate', wet(40, 80, 12)];
  else if (code >= 51) [type, intensity] = ['rain_light', wet(30, 75, 4)];
  else [type, intensity] = ['cloudy', 50];
  return {
    type,
    intensity: Math.round(clamp(intensity, 5, 100)),
    // 45 km/h and above is the strongest wind the scene shows
    wind: Math.round(clamp(((c.wind_speed_10m ?? 0) / 45) * 100, 0, 100)),
    label: LABELS[type],
  };
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Looks a place name up, mainland China first. */
export async function searchCity(name) {
  const q = `${GEOCODE}?name=${encodeURIComponent(name)}&count=5&language=zh`;
  let data = await getJson(`${q}&countryCode=CN`);
  if (!data.results?.length) data = await getJson(q);
  return (data.results ?? []).map((r) => ({
    name: r.name,
    region: [r.admin1, r.country].filter((s) => s && s !== r.name).join(' · '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

// keyless IP location services, tried in order
const LOCATORS = [
  ['https://ipwho.is/?lang=zh-CN&fields=success,city,region,latitude,longitude', (d) => d.success !== false && d],
  ['https://api.ip.sb/geoip', (d) => d],
];

/** Approximate place of the visitor, from the IP address. */
export async function locateByIp() {
  for (const [url, pick] of LOCATORS) {
    try {
      const d = pick(await getJson(url));
      const lat = Number(d?.latitude);
      const lon = Number(d?.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { name: d.city || d.region || 'My location', lat, lon };
    } catch {
      /* try the next service */
    }
  }
  return null;
}

export class LiveWeather {
  constructor(store) {
    this.store = store;
    this.status = { state: 'off', text: '' };
    this.onStatus = null;
    this.offsetSeconds = null;
    this.timer = 0;
    this.clock = 0;
    this.request = 0;
    this.key = '';
    store.subscribe((path) => {
      // the automatic cycle and the real clock cannot both drive the time
      if (path === 'time.autoCycle' && store.get('time.autoCycle')) store.set('live.enabled', false);
      // a replaced configuration (import, reset) is brought up to date again
      if (path === '*') this.key = null;
      if (path === '*' || path.startsWith('live.')) this.sync();
    });
    this.sync();
  }

  /** Follows a place chosen by hand. */
  setCity({ name, lat, lon }) {
    const s = this.store;
    s.set('live.auto', false);
    s.set('live.city', name);
    s.set('live.lat', lat);
    s.set('live.lon', lon);
    s.set('live.enabled', true);
  }

  sync() {
    const live = this.store.get('live');
    const key = live.enabled ? (live.auto ? 'auto' : `${live.lat},${live.lon}`) : '';
    if (key === this.key) return;
    this.key = key;
    clearInterval(this.timer);
    clearInterval(this.clock);
    this.request++;
    this.offsetSeconds = null;
    if (!key) {
      this.setStatus('off', '');
      return;
    }
    this.store.set('time.autoCycle', false);
    if (live.auto) {
      // the visitor's own time zone is known without any request
      this.offsetSeconds = -new Date().getTimezoneOffset() * 60;
      this.applyClock();
      this.locate();
    } else {
      this.refresh();
    }
    this.timer = setInterval(() => this.refresh(), REFRESH_MS);
    this.clock = setInterval(() => this.applyClock(), CLOCK_MS);
  }

  async locate() {
    const id = ++this.request;
    this.setStatus('loading', 'Finding your location...');
    const place = await locateByIp();
    if (id !== this.request) return;
    if (place) {
      const s = this.store;
      s.set('live.city', place.name);
      s.set('live.lat', place.lat);
      s.set('live.lon', place.lon);
    }
    // without a result the last known place is used
    this.refresh();
  }

  async refresh() {
    const { lat, lon, city } = this.store.get('live');
    const id = ++this.request;
    if (this.status.state !== 'ok') this.setStatus('loading', `Loading ${city}...`);
    try {
      const data = await getJson(
        `${FORECAST}?latitude=${lat}&longitude=${lon}&timezone=auto` +
        '&current=weather_code,temperature_2m,precipitation,cloud_cover,wind_speed_10m',
      );
      if (id !== this.request) return;
      const m = mapConditions(data.current);
      const s = this.store;
      s.set('weather.type', m.type);
      s.set('weather.intensity', m.intensity);
      s.set('weather.windStrength', m.wind);
      // an automatic location keeps the browser's time zone: an IP lookup can be far off
      if (!this.store.get('live.auto')) this.offsetSeconds = data.utc_offset_seconds;
      this.applyClock();
      const t = data.current;
      this.setStatus('ok', `${city}  ${Math.round(t.temperature_2m)}°C  ${m.label}  wind ${Math.round(t.wind_speed_10m)} km/h`);
    } catch (error) {
      if (id !== this.request) return;
      this.setStatus('error', `Could not load weather for ${city} (${error.message})`);
    }
  }

  /** Sets the scene clock to the city's local time. */
  applyClock() {
    if (this.offsetSeconds === null) return;
    const seconds = (Date.now() / 1000 + this.offsetSeconds) % 86400;
    const hour = seconds / 3600;
    this.store.set('time.hour', hour);
    this.store.set('time.preset', periodForHour(hour));
  }

  setStatus(state, text) {
    this.status = { state, text };
    this.onStatus?.(this.status);
  }
}
