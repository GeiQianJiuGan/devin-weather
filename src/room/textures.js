import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { Rng } from '../core/utils.js';

// Procedural canvas textures for the cafe interior (no image files).

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
  texture.anisotropy = 16;
  if (repeat) texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

/** Oiled oak planks; one tile covers 2 m x 2 m (14 rows of 143 mm boards). */
export function woodFloorTexture() {
  const S = 2048;
  const [c, g] = canvas(S, S);
  const rng = new Rng(11);
  const rows = 14;
  const ph = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rng.range(0, 900);
    while (x < S) {
      const w = rng.range(900, 1500);
      const light = rng.range(-14, 12);
      const warm = rng.range(-4, 4);
      g.fillStyle = `rgb(${172 + light + warm}, ${136 + light * 0.85}, ${98 + light * 0.65 - warm})`;
      g.fillRect(x, r * ph, w, ph);
      // long grain
      for (let k = 0; k < 90; k++) {
        const y = r * ph + rng.range(1, ph - 1);
        g.strokeStyle = `rgba(${rng.chance(0.55) ? '84, 54, 28' : '226, 196, 156'}, ${rng.range(0.03, 0.12)})`;
        g.lineWidth = rng.range(0.5, 2.2);
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(x + w * 0.3, y + rng.range(-5, 5), x + w * 0.7, y + rng.range(-5, 5), x + w, y + rng.range(-3, 3));
        g.stroke();
      }
      // cathedral figure and the odd knot
      if (rng.chance(0.55)) {
        const cx = x + rng.range(0.2, 0.8) * w;
        const cy = r * ph + rng.range(0.3, 0.7) * ph;
        for (let k = 1; k < 7; k++) {
          g.strokeStyle = `rgba(92, 58, 30, ${0.1 - k * 0.01})`;
          g.lineWidth = 1.4;
          g.beginPath();
          g.ellipse(cx, cy, k * 46, k * 5.5, 0, 0, Math.PI * 2);
          g.stroke();
        }
        if (rng.chance(0.3)) {
          g.fillStyle = 'rgba(70, 42, 22, 0.5)';
          g.beginPath();
          g.ellipse(cx, cy, 9, 6, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
      // fine pores
      for (let k = 0; k < 500; k++) {
        g.fillStyle = `rgba(60, 38, 20, ${rng.range(0.05, 0.16)})`;
        g.fillRect(x + rng.range(0, w), r * ph + rng.range(0, ph), rng.range(4, 16), 1);
      }
      g.fillStyle = 'rgba(38, 22, 10, 0.6)';
      g.fillRect(x + w - 1.5, r * ph, 3, ph);
      x += w;
    }
    g.fillStyle = 'rgba(38, 22, 10, 0.6)';
    g.fillRect(0, r * ph, S, 2.5);
    g.fillStyle = 'rgba(255, 236, 205, 0.1)';
    g.fillRect(0, r * ph + 2.5, S, 1.5);
  }
  return toTexture(c, true);
}

/** Straight-grained timber (walnut, oak ...) with the grain running along V. */
export function woodGrainTexture(rgb, seed = 1) {
  const S = 1024;
  const [c, g] = canvas(S, S);
  const rng = new Rng(seed);
  g.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  g.fillRect(0, 0, S, S);
  for (let k = 0; k < 420; k++) {
    const x = rng.range(0, S);
    const dark = rng.chance(0.6);
    g.strokeStyle = dark
      ? `rgba(${rgb[0] * 0.45}, ${rgb[1] * 0.42}, ${rgb[2] * 0.4}, ${rng.range(0.05, 0.22)})`
      : `rgba(${Math.min(255, rgb[0] * 1.35)}, ${Math.min(255, rgb[1] * 1.3)}, ${Math.min(255, rgb[2] * 1.25)}, ${rng.range(0.04, 0.14)})`;
    g.lineWidth = rng.range(0.6, 3.2);
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + rng.range(-14, 14), S * 0.33, x + rng.range(-14, 14), S * 0.66, x + rng.range(-6, 6), S);
    g.stroke();
  }
  for (let k = 0; k < 2600; k++) {
    g.fillStyle = `rgba(${rgb[0] * 0.35}, ${rgb[1] * 0.33}, ${rgb[2] * 0.3}, ${rng.range(0.06, 0.2)})`;
    g.fillRect(rng.range(0, S), rng.range(0, S), 1, rng.range(5, 22));
  }
  return toTexture(c, true);
}

/** Honed white marble with soft grey and faint gold veining; tiles seamlessly enough at 1.2 m. */
export function marbleTexture(seed = 5) {
  const S = 1024;
  const [c, g] = canvas(S, S);
  const rng = new Rng(seed);
  g.fillStyle = '#eeebe6';
  g.fillRect(0, 0, S, S);
  // cloudy body
  for (let k = 0; k < 70; k++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const r = rng.range(60, 220);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const tone = rng.chance(0.5) ? '150, 152, 158' : '255, 255, 255';
    grad.addColorStop(0, `rgba(${tone}, ${rng.range(0.05, 0.14)})`);
    grad.addColorStop(1, `rgba(${tone}, 0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  // veins: wandering strokes that fork
  const vein = (x, y, angle, width, alpha, steps) => {
    for (let i = 0; i < steps; i++) {
      const nx = x + Math.cos(angle) * 16;
      const ny = y + Math.sin(angle) * 16;
      g.strokeStyle = `rgba(96, 98, 106, ${alpha})`;
      g.lineWidth = width * rng.range(0.6, 1.3);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(nx, ny);
      g.stroke();
      x = nx;
      y = ny;
      angle += rng.range(-0.38, 0.38);
      if (width > 1 && rng.chance(0.06)) vein(x, y, angle + rng.range(-0.9, 0.9), width * 0.5, alpha * 0.8, steps >> 1);
    }
  };
  g.lineCap = 'round';
  g.shadowColor = 'rgba(90, 92, 100, 0.5)';
  for (let k = 0; k < 9; k++) {
    g.shadowBlur = rng.range(3, 12);
    vein(rng.range(-50, S), rng.range(-50, S), rng.range(0.3, 1.1), rng.range(1, 4.5), rng.range(0.12, 0.34), 90);
  }
  g.shadowBlur = 0;
  for (let k = 0; k < 14; k++) {
    g.strokeStyle = `rgba(176, 140, 84, ${rng.range(0.05, 0.14)})`;
    g.lineWidth = rng.range(0.6, 1.4);
    let x = rng.range(0, S);
    let y = rng.range(0, S);
    let a = rng.range(0.3, 1.1);
    g.beginPath();
    g.moveTo(x, y);
    for (let i = 0; i < 30; i++) {
      x += Math.cos(a) * 14;
      y += Math.sin(a) * 14;
      a += rng.range(-0.4, 0.4);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return toTexture(c, true);
}

/** Top view of a flat white: crema with a poured rosetta. */
export function latteTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const crema = g.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S / 2);
  crema.addColorStop(0, '#b9834f');
  crema.addColorStop(0.8, '#a06a3a');
  crema.addColorStop(1, '#6e431f');
  g.fillStyle = crema;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#f3e6d2';
  g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const y = 70 + i * 22;
    const w = 58 - Math.abs(i - 2.2) * 9;
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(S / 2 - w, y - 12);
    g.quadraticCurveTo(S / 2, y + 22, S / 2 + w, y - 12);
    g.stroke();
  }
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(S / 2, 50);
  g.lineTo(S / 2, 206);
  g.stroke();
  return toTexture(c);
}

/** Embroidered linen for seat pads and the like: a fine two-tone weave. */
export function linenTexture(rgb) {
  const S = 512;
  const [c, g] = canvas(S, S);
  const rng = new Rng(17);
  g.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 4) {
    for (let x = 0; x < S; x += 4) {
      const v = rng.range(-16, 16);
      g.fillStyle = v > 0 ? `rgba(255, 255, 255, ${v / 160})` : `rgba(0, 0, 0, ${-v / 130})`;
      g.fillRect(x, y, ((x + y) >> 2) % 2 ? 4 : 2, ((x + y) >> 2) % 2 ? 2 : 4);
    }
  }
  return toTexture(c, true);
}

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

/** The menu display on the counter: today's coffee list and a clock. */
export class ScreenContent {
  constructor() {
    [this.canvas, this.g] = canvas(960, 540);
    this.texture = toTexture(this.canvas);
    this.key = '';
    this.update('22:00', 0);
  }

  update(clock, time) {
    const tick = Math.floor(time / 4) % 3;
    const key = `${clock}|${tick}`;
    if (key === this.key) return;
    this.key = key;
    this.draw(clock, tick);
    this.texture.needsUpdate = true;
  }

  draw(clock, tick) {
    const g = this.g;
    g.fillStyle = '#15120f';
    g.fillRect(0, 0, 960, 540);
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillStyle = '#f2e7d5';
    g.font = '600 46px Georgia, "Times New Roman", serif';
    g.fillText('Corner House Coffee', 48, 78);
    g.fillStyle = '#c9a26a';
    g.font = '500 20px "Segoe UI", Arial, sans-serif';
    g.fillText('SECOND FLOOR  ·  OPEN DAILY', 50, 112);
    g.textAlign = 'right';
    g.fillStyle = '#f2e7d5';
    g.font = '300 44px "Segoe UI", Arial, sans-serif';
    g.fillText(clock, 912, 80);
    g.fillStyle = '#c9a26a';
    g.fillRect(48, 132, 864, 2);

    const columns = [
      ['COFFEE', [['Espresso', '3.0'], ['Americano', '3.5'], ['Flat White', '4.2'], ['Cappuccino', '4.2'], ['Latte', '4.5'], ['Mocha', '4.8']]],
      ['SLOW BAR', [['Hand Drip', '5.5'], ['Cold Brew', '4.8'], ['Matcha Latte', '5.0'], ['Earl Grey', '3.8'], ['Croissant', '3.2'], ['Lemon Cake', '4.0']]],
    ];
    columns.forEach(([title, rows], ci) => {
      const x0 = 48 + ci * 450;
      g.textAlign = 'left';
      g.fillStyle = '#c9a26a';
      g.font = '600 22px "Segoe UI", Arial, sans-serif';
      g.fillText(title, x0, 180);
      rows.forEach(([name, price], i) => {
        const y = 226 + i * 46;
        const featured = ci * 6 + i === [2, 6, 4][tick];
        g.textAlign = 'left';
        g.fillStyle = featured ? '#ffd9a0' : '#e9dfcf';
        g.font = '400 30px Georgia, "Times New Roman", serif';
        g.fillText(name, x0, y);
        const nameW = g.measureText(name).width;
        g.textAlign = 'right';
        g.font = '400 28px "Segoe UI", Arial, sans-serif';
        g.fillText(price, x0 + 400, y);
        g.fillStyle = 'rgba(201, 162, 106, 0.4)';
        for (let x = x0 + nameW + 14; x < x0 + 400 - 56; x += 9) g.fillRect(x, y - 4, 2, 2);
      });
    });
    g.textAlign = 'left';
    g.fillStyle = '#8f8676';
    g.font = '400 18px "Segoe UI", Arial, sans-serif';
    g.fillText('Oat and soy milk available  ·  Please order at the counter', 48, 512);
  }
}
