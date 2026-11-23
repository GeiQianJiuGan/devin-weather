import { QUALITY_LEVELS, TIME_PRESETS, WEATHER_TYPES, periodForHour } from '../core/Store.js';
import { CITIES, searchCity } from '../systems/LiveWeather.js';
import { formatHour } from '../core/utils.js';

// Control panel. Every control is bound to one path of the central store:
// user input writes to the store, and any store change (including the
// automatic day/night cycle) refreshes the controls.

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

export class UIController {
  constructor({ live, panel, root, stage, store, perf, toggleButton, toast }) {
    this.live = live;
    this.panel = panel;
    this.root = root;
    this.stage = stage;
    this.store = store;
    this.perf = perf;
    this.toastEl = toast;
    this.updaters = [];
    this.scheduled = false;
    this.toastTimer = 0;

    this.build();
    this.sync();
    store.subscribe(() => this.schedule());
    toggleButton.addEventListener('click', () => this.togglePanel());
    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('fullscreenchange', () => this.schedule());
    perf.onReport = (r) => {
      this.perfEl.textContent = `${Math.round(r.fps)} fps`;
      this.perfEl.dataset.level = r.fps >= 50 ? 'good' : r.fps >= 28 ? 'ok' : 'bad';
      this.perfDetail.textContent = `${r.frameMs.toFixed(1)} ms  |  ${r.calls} draws  |  ${r.width}x${r.height}  |  ${r.vehicles} vehicles`;
    };
    perf.onAdapt = (level) => this.toast(`Low frame rate: quality set to ${level}`);
  }

  // --- building blocks ---------------------------------------------------------------

  section(title, ...children) {
    return el('section', { class: 'group' }, el('h2', { text: title }), ...children);
  }

  slider({ label, path, min = 0, max = 100, step = 1, format = (v) => `${Math.round(v)}%`, onInput }) {
    const value = el('output', { class: 'value' });
    const input = el('input', { type: 'range', min, max, step, 'aria-label': label });
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (onInput) onInput(v);
      else this.store.set(path, v);
    });
    this.updaters.push(() => {
      const v = this.store.get(path);
      if (document.activeElement !== input || Math.abs(Number(input.value) - v) > step) input.value = v;
      input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
      value.textContent = format(v);
    });
    return el('label', { class: 'row slider' }, el('span', { class: 'label', text: label }), value, input);
  }

  toggle({ label, path }) {
    const input = el('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
    input.addEventListener('change', () => this.store.set(path, input.checked));
    this.updaters.push(() => {
      input.checked = this.store.get(path);
    });
    return el('label', { class: 'row toggle' }, el('span', { class: 'label', text: label }), input, el('span', { class: 'switch' }));
  }

  choices({ options, path, className, onPick }) {
    const buttons = options.map((option) => {
      const button = el('button', { type: 'button', class: 'chip', text: option.label, 'data-id': option.id });
      button.addEventListener('click', () => (onPick ? onPick(option) : this.store.set(path, option.id)));
      return button;
    });
    this.updaters.push(() => {
      const current = this.store.get(path);
      for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.id === current));
    });
    return el('div', { class: `chips ${className}`, role: 'group' }, ...buttons);
  }

  button(label, onClick, className = '') {
    return el('button', { type: 'button', class: `btn ${className}`, text: label, onclick: onClick });
  }

  // --- layout -------------------------------------------------------------------------------

  build() {
    const store = this.store;
    this.perfEl = el('span', { class: 'perf', text: '-- fps', title: 'Current frame rate' });
    this.perfDetail = el('p', { class: 'perf-detail', text: ' ' });
    const head = el('header', { class: 'panel-head' },
      el('div', {}, el('h1', { text: 'Window Weather' }), el('p', { text: 'Real-time city weather simulator' })),
      this.perfEl,
    );

    const liveStatus = el('p', { class: 'live-status', role: 'status' });
    const showStatus = (st) => {
      liveStatus.textContent = st.text;
      liveStatus.dataset.state = st.state;
    };
    this.live.onStatus = showStatus;
    showStatus(this.live.status);
    const cityChips = (list) => list.map((c) => el('button', {
      type: 'button', class: 'chip', text: c.name, title: c.region || c.name, 'data-pos': `${c.lat},${c.lon}`, onclick: () => this.live.setCity(c),
    }));
    const results = el('div', { class: 'chips cities' }, ...cityChips(CITIES));
    this.updaters.push(() => {
      const l = store.get('live');
      for (const chip of results.children) chip.setAttribute('aria-pressed', String(l.enabled && !l.auto && chip.dataset.pos === `${l.lat},${l.lon}`));
    });
    const cityInput = el('input', { type: 'text', class: 'text', placeholder: 'City, e.g. 成都', 'aria-label': 'City name', maxlength: '40' });
    const search = async () => {
      const name = cityInput.value.trim();
      if (!name) return;
      try {
        const found = await searchCity(name);
        if (!found.length) return this.toast(`No place found for "${name}"`);
        results.replaceChildren(...cityChips(found));
        this.live.setCity(found[0]);
      } catch {
        this.toast('City search is not reachable');
      }
    };
    cityInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') search();
    });
    const locate = () => {
      if (!navigator.geolocation) return this.toast('Location is not available in this browser');
      navigator.geolocation.getCurrentPosition(
        (pos) => this.live.setCity({ name: 'My location', lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => this.toast('Location permission was not granted'),
        { timeout: 10000 },
      );
    };
    const live = this.section('Live weather',
      this.toggle({ label: 'Follow real weather and local time', path: 'live.enabled' }),
      this.toggle({ label: 'Detect my location', path: 'live.auto' }),
      el('div', { class: 'buttons search' }, cityInput, this.button('Search', search), this.button('Locate me', locate)),
      results,
      liveStatus,
    );

    const weather = this.section('Weather',
      this.choices({
        options: WEATHER_TYPES, path: 'weather.type', className: 'weather',
        onPick: (option) => {
          store.set('live.enabled', false);
          store.set('weather.type', option.id);
          store.set('weather.intensity', option.intensity);
        },
      }),
      this.slider({ label: 'Intensity', path: 'weather.intensity' }),
      this.slider({ label: 'Wind', path: 'weather.windStrength' }),
      this.slider({ label: 'Exterior blur', path: 'scene.exteriorBlur' }),
    );

    const time = this.section('Time of day',
      this.choices({
        options: TIME_PRESETS, path: 'time.preset', className: 'time',
        onPick: (option) => {
          store.set('live.enabled', false);
          store.set('time.hour', option.hour);
          store.set('time.preset', option.id);
        },
      }),
      this.slider({
        label: 'Time', path: 'time.hour', min: 0, max: 24, step: 0.05, format: formatHour,
        onInput: (v) => {
          store.set('live.enabled', false);
          store.set('time.hour', v);
          store.set('time.preset', periodForHour(v));
        },
      }),
      this.toggle({ label: 'Automatic day / night cycle', path: 'time.autoCycle' }),
      this.slider({ label: 'Cycle speed', path: 'time.cycleSpeed', min: 1, max: 100, format: (v) => `${Math.round(v)} min/s` }),
    );

    const scene = this.section('Scene',
      this.toggle({ label: 'Rain on glass', path: 'scene.windowCondensation' }),
      this.toggle({ label: 'Vehicle traffic', path: 'scene.trafficEnabled' }),
      this.slider({ label: 'Traffic density', path: 'scene.trafficDensity' }),
      this.toggle({ label: 'Ceiling lights', path: 'scene.interiorLightEnabled' }),
      this.slider({ label: 'Menu display', path: 'scene.computerScreenBrightness' }),
    );

    this.pauseButton = this.button('Pause', () => store.set('playback.paused', !store.get('playback.paused')), 'primary');
    this.fullscreenButton = this.button('Fullscreen', () => this.toggleFullscreen());
    const playback = this.section('Playback and quality',
      el('div', { class: 'buttons' },
        this.pauseButton,
        this.button('Reset', () => {
          store.reset();
          this.toast('Scene reset to defaults');
        }),
        this.fullscreenButton,
      ),
      this.choices({
        options: QUALITY_LEVELS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) })), path: 'quality', className: 'quality',
        onPick: (option) => {
          this.perf.userSelected();
          store.set('quality', option.id);
        },
      }),
      this.perfDetail,
    );

    this.configText = el('textarea', { spellcheck: 'false', rows: 9, 'aria-label': 'Scene configuration as JSON' });
    const config = el('details', { class: 'group config' },
      el('summary', { text: 'Scene configuration (JSON)' }),
      this.configText,
      el('div', { class: 'buttons' },
        this.button('Copy', async () => {
          try {
            await navigator.clipboard.writeText(store.serialize());
            this.toast('Configuration copied');
          } catch {
            this.configText.select();
            this.toast('Select and copy the text manually');
          }
        }),
        this.button('Apply', () => {
          try {
            store.replace(JSON.parse(this.configText.value));
            this.toast('Configuration applied');
          } catch {
            this.toast('That is not valid JSON');
          }
        }),
      ),
    );
    config.addEventListener('toggle', () => this.schedule());
    this.configDetails = config;

    const hint = el('p', { class: 'hint', text: 'Drag: look around   WASD / arrows: walk   Q/E: down/up   Wheel: zoom   R or double-click: reset view   Space: pause   H: hide panel   F: fullscreen' });
    this.panel.append(head, live, weather, time, scene, playback, config, hint);
  }

  // --- behaviour ------------------------------------------------------------------------------

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.sync();
    });
  }

  sync() {
    for (const update of this.updaters) update();
    this.pauseButton.textContent = this.store.get('playback.paused') ? 'Resume' : 'Pause';
    this.fullscreenButton.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
    if (this.configDetails.open && document.activeElement !== this.configText) this.configText.value = this.store.serialize();
  }

  togglePanel() {
    this.root.classList.toggle('panel-hidden');
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else this.root.requestFullscreen?.().catch(() => this.toast('Fullscreen is not available'));
  }

  onKey(e) {
    const tag = e.target.tagName;
    if (tag === 'TEXTAREA' || (tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.store.set('playback.paused', !this.store.get('playback.paused'));
    } else if (e.key === 'h' || e.key === 'H') {
      this.togglePanel();
    } else if (e.key === 'f' || e.key === 'F') {
      this.toggleFullscreen();
    }
  }

  toast(message) {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 2600);
  }
}