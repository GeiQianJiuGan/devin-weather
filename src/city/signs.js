import { CanvasTexture, SRGBColorSpace } from 'three';

// Procedural sign artwork drawn on 2D canvases (no external images).

const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

function finish(canvas) {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function makeSignTexture({ text, width = 512, height = 128, bg = '#0b0b10', fg = '#ffffff', glow = null, vertical = false, border = null, weight = 800 }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, width, height);
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = Math.max(4, Math.min(width, height) * 0.05);
    g.strokeRect(g.lineWidth, g.lineWidth, width - 2 * g.lineWidth, height - 2 * g.lineWidth);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = fg;
  g.shadowColor = glow || fg;
  g.shadowBlur = Math.min(width, height) * 0.16;
  if (vertical) {
    const chars = [...text];
    const step = height / (chars.length + 0.5);
    g.font = `${weight} ${Math.floor(Math.min(step * 0.86, width * 0.8))}px ${FONT}`;
    chars.forEach((ch, i) => g.fillText(ch, width / 2, step * (i + 0.75)));
  } else {
    let size = height * 0.62;
    g.font = `${weight} ${size}px ${FONT}`;
    while (g.measureText(text).width > width * 0.86 && size > 10) {
      size -= 2;
      g.font = `${weight} ${size}px ${FONT}`;
    }
    g.fillText(text, width / 2, height / 2 + size * 0.04);
    g.fillText(text, width / 2, height / 2 + size * 0.04);
  }
  return finish(canvas);
}

/** Large rooftop advertisement: abstract skyline at dusk with a word mark. */
export function makeBillboardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 384;
  const g = canvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1024, 384);
  grad.addColorStop(0, '#1b1150');
  grad.addColorStop(0.45, '#a3246e');
  grad.addColorStop(1, '#ff8a2a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 384);
  g.fillStyle = 'rgba(255, 214, 150, 0.95)';
  g.beginPath();
  g.arc(800, 250, 120, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(16, 8, 40, 0.92)';
  let x = 560;
  let seed = 7;
  while (x < 1024) {
    seed = (seed * 9301 + 49297) % 233280;
    const w = 26 + (seed % 46);
    const h = 60 + ((seed >> 3) % 150);
    g.fillRect(x, 384 - h, w, h);
    x += w + 4;
  }
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.shadowColor = 'rgba(255, 255, 255, 0.8)';
  g.shadowBlur = 26;
  g.font = `800 150px ${FONT}`;
  g.fillText('AURORA', 56, 150);
  g.shadowBlur = 8;
  g.font = `600 44px ${FONT}`;
  g.fillText('CITY NIGHTS  /  OPEN LATE', 62, 268);
  return finish(canvas);
}

export function makeRoadSignTexture(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (kind === 'speed') {
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#c21a1a';
    g.lineWidth = 26;
    g.beginPath();
    g.arc(128, 128, 100, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#111111';
    g.font = `800 120px ${FONT}`;
    g.fillText('40', 128, 136);
  } else if (kind === 'bus') {
    g.fillStyle = '#1456b8';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#ffffff';
    g.font = `800 96px ${FONT}`;
    g.fillText('BUS', 128, 104);
    g.font = `700 54px ${FONT}`;
    g.fillText('STOP', 128, 184);
  } else {
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#c21a1a';
    g.lineWidth = 22;
    g.beginPath();
    g.arc(128, 128, 100, 0, Math.PI * 2);
    g.moveTo(58, 58);
    g.lineTo(198, 198);
    g.stroke();
    g.fillStyle = '#1456b8';
    g.font = `800 130px ${FONT}`;
    g.fillText('P', 128, 138);
  }
  return finish(canvas);
}