import './style.css';
import { App } from './core/App.js';
import { PerformanceManager, suggestQuality } from './core/PerformanceManager.js';
import { Store, QUALITY_LEVELS } from './core/Store.js';
import { UIController } from './ui/UIController.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(window.location.search);

const store = new Store();
// optional overrides, handy for sharing a look or for testing: ?quality=low&autoquality=0
const forcedQuality = QUALITY_LEVELS.includes(params.get('quality')) ? params.get('quality') : null;
if (forcedQuality) store.set('quality', forcedQuality);
const perf = new PerformanceManager(store, { autoAdapt: params.get('autoquality') !== '0' });

const loading = $('loading');
try {
  const app = new App({
    canvas: $('scene'), stage: $('stage'), store, perf,
    // first visit: choose a starting preset that suits the graphics hardware
    onGpu: (gpuName) => {
      if (!forcedQuality && !store.hasSavedState) store.set('quality', suggestQuality(gpuName));
    },
  });
  const ui = new UIController({
    panel: $('panel'), root: $('app'), stage: $('stage'), store, perf, toggleButton: $('panel-toggle'), toast: $('toast'),
  });
  app.onFirstFrame = () => loading.classList.add('done');
  app.start();
  window.weatherSim = { app, store, ui, perf };
} catch (error) {
  console.error(error);
  loading.classList.add('error');
  loading.textContent = 'WebGL 2 could not be started on this device. Please try a current desktop browser with hardware acceleration enabled.';
}