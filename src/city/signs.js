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
// Shop fascia atlas: SIGN_COLS x SIGN_ROWS painted signboards, sampled per shop bay by the facade shader.
export const SIGN_COLS = 2;
export const SIGN_ROWS = 16;
const SERIF = 'Georgia, "Times New Roman", serif';
const SHOPS = [
  ['MERIDIAN BOOKS', 'new & second-hand', '#1d3b2f', '#ecd9a8', 'serif'],
  ['Bakehouse No.9', 'bread · pastry · coffee', '#efe6d3', '#3a2a1c', 'script'],
  ['GREEN GROCER', 'fresh daily', '#27522e', '#f4f1e4', 'sans'],
  ['HARBOR PHARMACY', 'open late', '#f3f5f4', '#0c7a55', 'sans'],
  ['Florist', 'Wild Stem · flowers & plants', '#2b2b2e', '#f1c9d0', 'script'],
  ['NOODLE HOUSE', 'hand-pulled since 1988', '#8f1d18', '#ffe9b8', 'serif'],
  ['Atelier Mode', 'tailoring & alterations', '#111418', '#d9b676', 'serif'],
  ['CORNER DELI', 'sandwiches · salads', '#f0c23a', '#22201c', 'sans'],
  ['Vinyl & Tape', 'records bought and sold', '#243a5e', '#f5e9cf', 'script'],
  ['OPTICIAN', 'Lens & Frame', '#e9ecef', '#1b2a44', 'sans'],
  ['Tea Room', 'loose leaf · matcha', '#3d4a35', '#ece2c6', 'serif'],
  ['BARBER', "gentlemen's cuts", '#15181d', '#f2f2f2', 'sans'],
  ['Luna Gelato', 'made here every morning', '#f6dfe0', '#7a2f4a', 'script'],
  ['HARDWARE', 'tools · paint · keys cut', '#b5471b', '#fff3da', 'sans'],
  ['Wine Cellar', 'fine wines & spirits', '#3a1220', '#e6c98a', 'serif'],
  ['BIKE WORKS', 'sales · repair', '#1f6f78', '#f2f2ea', 'sans'],
  ['Paper & Ink', 'stationery · print', '#f4efe6', '#27313f', 'serif'],
  ['MINI MARKET', '24 hours', '#16643a', '#ffe14d', 'sans'],
  ['Dumpling Bar', 'steamed · fried', '#1a1a1a', '#ff8a5c', 'script'],
  ['GALLERY 12', 'prints · frames', '#f2f2f0', '#222222', 'serif'],
  ['Shoe Repair', 'heels · soles · leather', '#5a3a22', '#f0dfc0', 'serif'],
  ['LAUNDRETTE', 'wash · dry · fold', '#2f6fb3', '#ffffff', 'sans'],
  ['Cheese & Co.', 'delicatessen', '#e8d9a0', '#3b3418', 'script'],
  ['PHOTO LAB', 'film developed here', '#202225', '#ffd23f', 'sans'],
  ['Juniper', 'kitchen & bar', '#1e2b28', '#d7c8a2', 'serif'],
  ['TOY BOX', 'games · puzzles', '#d8452e', '#fff6d6', 'sans'],
  ['Ramen Ichi', 'open till late', '#101010', '#f4f0e6', 'script'],
  ['WATCHMAKER', 'repairs · batteries', '#263238', '#cfd8dc', 'serif'],
  ['Petal & Pot', 'house plants', '#e7efe2', '#2f5d3a', 'script'],
  ['BURGER STOP', 'grill · shakes', '#c62b1f', '#ffe9c2', 'sans'],
  ['Antiques', 'curios · furniture', '#4a3f2c', '#e9dcb9', 'serif'],
  ['SUNRISE CAFE', 'breakfast all day', '#f3a53a', '#3b2410', 'sans'],
];

export function makeShopSignAtlas() {
  const CW = 1024;
  const CH = 128;
  const canvas = document.createElement('canvas');
  canvas.width = CW * SIGN_COLS;
  canvas.height = CH * SIGN_ROWS;
  const g = canvas.getContext('2d');
  SHOPS.forEach(([name, sub, bg, fg, face], i) => {
    const x0 = (i % SIGN_COLS) * CW;
    const y0 = Math.floor(i / SIGN_COLS) * CH;
    g.save();
    g.beginPath();
    g.rect(x0, y0, CW, CH);
    g.clip();
    g.translate(x0, y0);
    // painted board: slight vertical sheen and a few brush / weather streaks
    const sheen = g.createLinearGradient(0, 0, 0, CH);
    sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.16)');
    g.fillStyle = bg;
    g.fillRect(0, 0, CW, CH);
    g.fillStyle = sheen;
    g.fillRect(0, 0, CW, CH);
    let seed = 17 + i * 131;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let k = 0; k < 26; k++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + rnd() * 0.04})`;
      g.fillRect(rnd() * CW, 0, 1 + rnd() * 3, CH * (0.3 + rnd() * 0.7));
    }
    // inset pinstripe border
    g.strokeStyle = fg;
    g.globalAlpha = 0.55;
    g.lineWidth = 2.5;
    g.strokeRect(14, 12, CW - 28, CH - 24);
    g.globalAlpha = 1;
    g.fillStyle = fg;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    const main = face === 'script' ? `italic 700 70px ${SERIF}` : face === 'serif' ? `700 62px ${SERIF}` : `800 60px ${FONT}`;
    g.font = main;
    if (face !== 'script') g.letterSpacing = '6px';
    const variant = i % 3;
    if (variant === 0) {
      g.fillText(name, CW / 2, CH * 0.42);
      g.letterSpacing = '4px';
      g.font = `600 21px ${FONT}`;
      g.globalAlpha = 0.85;
      g.fillText(sub.toUpperCase(), CW / 2, CH * 0.78);
    } else if (variant === 1) {
      // roundel on the left, name centred, small line right
      g.beginPath();
      g.arc(86, CH / 2, 34, 0, Math.PI * 2);
      g.lineWidth = 4;
      g.stroke();
      g.font = `700 36px ${SERIF}`;
      g.letterSpacing = '0px';
      g.fillText(name[0], 86, CH / 2 + 2);
      g.font = main;
      if (face !== 'script') g.letterSpacing = '6px';
      g.fillText(name, CW / 2 + 20, CH * 0.44);
      g.letterSpacing = '3px';
      g.font = `600 20px ${FONT}`;
      g.globalAlpha = 0.85;
      g.fillText(sub.toUpperCase(), CW / 2 + 20, CH * 0.79);
    } else {
      g.textAlign = 'left';
      g.fillText(name, 54, CH * 0.5);
      const w = g.measureText(name).width;
      g.globalAlpha = 0.6;
      g.fillRect(54 + w + 26, CH * 0.3, 2, CH * 0.4);
      g.globalAlpha = 0.85;
      g.letterSpacing = '3px';
      g.font = `600 22px ${FONT}`;
      g.fillText(sub.toUpperCase(), 54 + w + 48, CH * 0.5);
    }
    g.restore();
  });
  const texture = finish(canvas);
  texture.anisotropy = 16;
  return texture;
}
