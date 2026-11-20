import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { lerp } from '../core/utils.js';

// Lightning. Event logic (when a strike happens, how its flashes are shaped)
// is kept separate from rendering: other systems only read `flash`, `direction`
// and the bolt mesh.

const SEGMENTS = 26;
const BRANCH_SEGMENTS = 10;
const STRIPS = [SEGMENTS, BRANCH_SEGMENTS, BRANCH_SEGMENTS];

export class LightningSystem {
  constructor(rng, cameraPosition) {
    this.rng = rng;
    this.camera = cameraPosition.clone();
    this.flash = 0;
    this.direction = new Vector3(0.6, 0.35, -0.7).normalize();
    this.pulses = [];
    this.age = 10;
    this.timeToNext = 4;
    this.strikes = 0;
    this.boltVisible = false;

    // preallocated ribbon geometry for the main channel and two branches
    const vertexCount = STRIPS.reduce((n, s) => n + (s + 1) * 2, 0);
    this.positions = new Float32Array(vertexCount * 3);
    const index = [];
    let base = 0;
    for (const segs of STRIPS) {
      for (let i = 0; i < segs; i++) {
        const a = base + i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      base += (segs + 1) * 2;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setIndex(index);
    this.material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
      toneMapped: false,
    });
    this.material.color.setRGB(7, 8, 11);
    this.bolt = new Mesh(geometry, this.material);
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
  }

  /** dt: simulation time step, activity: 0 (none) .. 1 (violent storm). */
  update(dt, activity) {
    if (dt > 0) {
      this.age += dt;
      if (activity > 0.01) {
        this.timeToNext -= dt;
        if (this.timeToNext <= 0) {
          this.strike(activity);
          // exponential waiting times: irregular, more frequent in stronger storms
          this.timeToNext = 0.7 - Math.log(1 - this.rng.next()) * lerp(13, 3.2, activity);
        }
      } else {
        this.timeToNext = Math.min(this.timeToNext, 2.5);
      }
    }
    let f = 0;
    for (const p of this.pulses) {
      const t = this.age - p.t0;
      if (t >= 0) f += p.amp * Math.exp(-t / p.tau);
    }
    this.flash = f < 0.003 ? 0 : f;
    const show = this.boltVisible && this.age < 0.32 && f > 0.05;
    this.bolt.visible = show;
    if (show) this.material.opacity = Math.min(1, f * 1.4);
  }

  strike(activity) {
    const rng = this.rng;
    this.age = 0;
    this.strikes++;
    this.pulses.length = 0;
    const count = 2 + Math.floor(rng.next() * 3 + activity * 1.5);
    let t = 0;
    for (let i = 0; i < count; i++) {
      this.pulses.push({ t0: t, amp: rng.range(0.45, 1.25) * (0.6 + 0.6 * activity), tau: rng.range(0.05, 0.14) });
      t += rng.range(0.05, 0.2);
    }
    // most strikes happen in the part of the sky the window looks at
    const az = (rng.chance(0.75) ? rng.range(12, 84) : rng.range(0, 360)) * (Math.PI / 180);
    const dist = rng.range(320, 700);
    const x = this.camera.x + Math.sin(az) * dist;
    const z = this.camera.z - Math.cos(az) * dist;
    this.direction.set(x - this.camera.x, rng.range(140, 260), z - this.camera.z).normalize();
    this.boltVisible = rng.chance(0.6);
    if (this.boltVisible) this.buildBolt(x, z, az);
  }

  buildBolt(x, z, az) {
    const rng = this.rng;
    // ribbon faces the camera: widen along the horizontal tangent
    const tx = Math.cos(az);
    const tz = Math.sin(az);
    const top = rng.range(330, 430);
    const bottom = rng.range(25, 110);
    const pos = this.positions;
    let cursor = 0;
    const writeStrip = (segs, x0, y0, y1, drift, width) => {
      let off = 0;
      let branchAt = null;
      for (let i = 0; i <= segs; i++) {
        const k = i / segs;
        off += rng.range(-1, 1) * 9 + drift;
        const y = lerp(y0, y1, k);
        const w = width * (1 - 0.55 * k);
        const px = x + (x0 + off) * tx;
        const pz = z + (x0 + off) * tz;
        pos.set([px - tx * w, y, pz - tz * w, px + tx * w, y, pz + tz * w], cursor);
        cursor += 6;
        if (branchAt === null && k > 0.3 && rng.chance(0.1)) branchAt = { x0: x0 + off, y };
      }
      return branchAt || { x0: x0 + off * 0.5, y: lerp(y0, y1, 0.5) };
    };
    const fork = writeStrip(SEGMENTS, 0, top, bottom, rng.range(-1.5, 1.5), 1.5);
    writeStrip(BRANCH_SEGMENTS, fork.x0, fork.y, fork.y - rng.range(60, 130), rng.range(3, 8), 0.8);
    writeStrip(BRANCH_SEGMENTS, fork.x0, fork.y - 20, fork.y - rng.range(70, 150), -rng.range(3, 8), 0.7);
    this.bolt.geometry.attributes.position.needsUpdate = true;
  }
}