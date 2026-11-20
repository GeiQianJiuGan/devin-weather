import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { Rng } from '../core/utils.js';

// Procedural canvas textures for the bedroom (no image files).

if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  // very old browsers: fall back to square corners
  CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h) {
    this.rect(x, y, w, h);
  };
}

function canvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return [c, c.getContext('2d')];
}

function toTexture(c, repeat = false) {
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

/** Oak planks; one tile covers 1.6 m x 1.6 m (8 planks). */
export function woodFloorTexture() {
  const [c, g] = canvas(1024, 1024);
  const rng = new Rng(11);
  const rows = 8;
  const ph = 1024 / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rng.range(0, 400);
    while (x < 1024) {
      const w = rng.range(380, 720);
      const light = rng.range(-10, 10);
      g.fillStyle = `rgb(${150 + light}, ${112 + light * 0.8}, ${78 + light * 0.6})`;
      g.fillRect(x, r * ph, w, ph);
      for (let k = 0; k < 26; k++) {
        const y = r * ph + rng.range(2, ph - 2);
        g.strokeStyle = `rgba(${rng.chance(0.5) ? '70, 45, 25' : '205, 170, 130'}, ${rng.range(0.04, 0.13)})`;
        g.lineWidth = rng.range(0.6, 1.8);
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(x + w * 0.3, y + rng.range(-3, 3), x + w * 0.7, y + rng.range(-3, 3), x + w, y + rng.range(-2, 2));
        g.stroke();
      }
      g.fillStyle = 'rgba(40, 24, 12, 0.5)';
      g.fillRect(x + w - 1.5, r * ph, 2.5, ph);
      x += w;
    }
    g.fillStyle = 'rgba(40, 24, 12, 0.55)';
    g.fillRect(0, r * ph, 1024, 2);
  }
  return toTexture(c, true);
}

export function rugTexture() {
  const [c, g] = canvas(512, 352);
  const rng = new Rng(5);
  g.fillStyle = '#b9ad9c';
  g.fillRect(0, 0, 512, 352);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${rng.chance(0.5) ? '255, 250, 240' : '80, 70, 60'}, ${rng.range(0.03, 0.1)})`;
    g.fillRect(rng.range(0, 512), rng.range(0, 352), rng.range(1, 4), 1);
  }
  g.strokeStyle = 'rgba(84, 92, 104, 0.85)';
  g.lineWidth = 6;
  g.strokeRect(22, 22, 468, 308);
  g.lineWidth = 2;
  g.strokeRect(36, 36, 440, 280);
  g.strokeStyle = 'rgba(160, 96, 66, 0.7)';
  for (let x = 70; x < 460; x += 44) {
    g.beginPath();
    g.moveTo(x, 150);
    g.lineTo(x + 22, 176);
    g.lineTo(x + 44, 150);
    g.lineTo(x + 22, 202);
    g.closePath();
    g.stroke();
  }
  return toTexture(c);
}

/** Portrait key layout: rows run along the canvas height. */
export function keyboardTexture() {
  const [c, g] = canvas(160, 512);
  g.fillStyle = '#1b1d21';
  g.fillRect(0, 0, 160, 512);
  const rows = 5;
  const cols = 15;
  const kw = 136 / rows;
  const kh = 496 / cols;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const wide = r === 0 && k > 4 && k < 10; // space bar
      if (wide && k !== 5) continue;
      g.fillStyle = (r + k) % 7 === 0 ? '#3a3f47' : '#2b2f36';
      const h = wide ? kh * 5 - 3 : kh - 3;
      g.beginPath();
      g.roundRect(12 + r * kw + 1.5, 8 + k * kh + 1.5, kw - 3, h, 3);
      g.fill();
    }
  }
  return toTexture(c);
}

export function paperTexture(seed) {
  const [c, g] = canvas(256, 362);
  const rng = new Rng(seed);
  g.fillStyle = rng.chance(0.3) ? '#f4f0e6' : '#f7f7f5';
  g.fillRect(0, 0, 256, 362);
  g.fillStyle = 'rgba(40, 44, 52, 0.85)';
  g.fillRect(26, 28, rng.range(90, 150), 9);
  g.fillStyle = 'rgba(70, 76, 88, 0.5)';
  let y = 56;
  while (y < 330) {
    if (rng.chance(0.12)) {
      y += 12;
      continue;
    }
    if (rng.chance(0.08) && y < 250) {
      g.strokeStyle = 'rgba(60, 100, 170, 0.6)';
      g.lineWidth = 1.5;
      g.strokeRect(30, y, 196, 54);
      g.beginPath();
      g.moveTo(34, y + 44);
      for (let x = 34; x < 224; x += 16) g.lineTo(x, y + 44 - rng.range(4, 38));
      g.stroke();
      y += 66;
      continue;
    }
    g.fillRect(26, y, rng.range(120, 204), 3.2);
    y += 9;
  }
  return toTexture(c);
}

/** Soft rounded-rectangle alpha falloff used for fake contact shadows. */
export function contactShadowTexture() {
  const [c, g] = canvas(128, 128);
  const img = g.createImageData(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const u = Math.abs(x / 63.5 - 1);
      const v = Math.abs(y / 63.5 - 1);
      const d = Math.pow(Math.pow(u, 4) + Math.pow(v, 4), 0.25);
      const t = Math.min(1, Math.max(0, (1 - d) / 0.45));
      const a = t * t * (3 - 2 * t);
      const i = (y * 128 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const texture = new CanvasTexture(c);
  return texture;
}

/** Animated desktop shown on the monitor: code editor, a small chart and a clock. */
export class ScreenContent {
  constructor() {
    [this.canvas, this.g] = canvas(640, 360);
    this.texture = toTexture(this.canvas);
    this.key = '';
    this.rng = new Rng(3);
    this.lines = Array.from({ length: 60 }, () => ({
      indent: this.rng.int(0, 3),
      parts: Array.from({ length: this.rng.int(1, 4) }, () => ({ w: this.rng.range(18, 90), c: this.rng.int(0, 4) })),
    }));
    this.update('22:00', 0);
  }

  update(clock, time) {
    const tick = Math.floor(time * 2);
    const key = `${clock}|${tick}`;
    if (key === this.key) return;
    this.key = key;
    this.draw(clock, tick);
    this.texture.needsUpdate = true;
  }

  draw(clock, tick) {
    const g = this.g;
    const bg = g.createLinearGradient(0, 0, 640, 360);
    bg.addColorStop(0, '#0d2a55');
    bg.addColorStop(0.55, '#1b4f8f');
    bg.addColorStop(1, '#3f8fc4');
    g.fillStyle = bg;
    g.fillRect(0, 0, 640, 360);

    // editor window
    g.fillStyle = '#12161f';
    g.beginPath();
    g.roundRect(22, 18, 388, 296, 8);
    g.fill();
    g.fillStyle = '#1c2230';
    g.beginPath();
    g.roundRect(22, 18, 388, 24, [8, 8, 0, 0]);
    g.fill();
    ['#ff6058', '#ffbd2e', '#28c940'].forEach((col, i) => {
      g.fillStyle = col;
      g.beginPath();
      g.arc(38 + i * 16, 30, 4.5, 0, Math.PI * 2);
      g.fill();
    });
    g.fillStyle = '#171c27';
    g.fillRect(22, 42, 70, 272);
    const palette = ['#7fb6ff', '#c7d3e6', '#7fe3c4', '#f0c674', '#d59cff'];
    const scroll = Math.floor(tick / 6) % 30;
    for (let i = 0; i < 20; i++) {
      const line = this.lines[(i + scroll) % this.lines.length];
      const y = 54 + i * 12.6;
      g.fillStyle = '#3a445a';
      g.fillRect(100, y, 10, 4);
      let x = 122 + line.indent * 16;
      for (const part of line.parts) {
        g.fillStyle = palette[part.c];
        g.fillRect(x, y, part.w, 4.5);
        x += part.w + 8;
      }
      if (i < 9) {
        g.fillStyle = i === 3 ? '#7fb6ff' : '#34405a';
        g.fillRect(32, y, 30 + ((i * 17) % 22), 4);
      }
    }
    if (tick % 2 === 0) {
      g.fillStyle = '#ffffff';
      g.fillRect(126 + ((tick * 7) % 150), 54 + 12.6 * 11 - 3, 2, 11);
    }

    // chart widget
    g.fillStyle = 'rgba(240, 247, 255, 0.92)';
    g.beginPath();
    g.roundRect(428, 18, 190, 138, 8);
    g.fill();
    g.fillStyle = '#28446e';
    g.fillRect(442, 30, 72, 6);
    for (let i = 0; i < 9; i++) {
      const h = 22 + 58 * Math.abs(Math.sin(i * 1.7 + tick * 0.15));
      g.fillStyle = i % 3 === 0 ? '#2f7fe0' : '#7db6f2';
      g.fillRect(444 + i * 19, 142 - h, 12, h);
    }
    // notes widget
    g.fillStyle = 'rgba(16, 24, 40, 0.82)';
    g.beginPath();
    g.roundRect(428, 170, 190, 144, 8);
    g.fill();
    g.fillStyle = '#9fd0ff';
    g.fillRect(442, 184, 90, 6);
    g.fillStyle = '#56688a';
    for (let i = 0; i < 7; i++) g.fillRect(442, 204 + i * 14, 80 + ((i * 37) % 80), 4);

    // taskbar
    g.fillStyle = 'rgba(8, 14, 26, 0.86)';
    g.fillRect(0, 328, 640, 32);
    for (let i = 0; i < 7; i++) {
      g.fillStyle = ['#4aa3ff', '#ffffff', '#58d6a9', '#ffc857', '#ff7b72', '#c792ea', '#9fb3c8'][i];
      g.beginPath();
      g.roundRect(18 + i * 30, 336, 16, 16, 4);
      g.fill();
    }
    g.fillStyle = '#eaf2ff';
    g.font = '600 15px "Segoe UI", Arial, sans-serif';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText(clock, 624, 345);
  }
}