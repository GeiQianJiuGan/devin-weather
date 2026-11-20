import { ROAD_HALF, ROAD_LENGTH, STOP_FAR } from '../core/layout.js';
import { clamp, damp, lerp } from '../core/utils.js';

// Lightweight route-based traffic simulation for the four-way intersection.
//  - 16 fixed routes (4 approaches x 2 lanes x straight / turn)
//  - Intelligent Driver Model for following, stopping and curve speeds
//  - two-phase signals with permissive left turns (gap acceptance)
//  - a fixed pool of vehicles that is recycled, never re-allocated

const DIRS = [[1, 0], [0, -1], [-1, 0], [0, 1]]; // approach headings: east, north, west, south
const LANE_LAT = [1.75, 5.25];
const L = ROAD_LENGTH;
const STRAIGHT = 0;
const RIGHT = 1;
const LEFT = 2;
const R_RIGHT = 4.5;
const R_LEFT = 10; // wide enough that opposing left turns pass each other with room to spare
const BOX = ROAD_HALF + 4.0; // junction box including the crossings
const STOP_FRONT = STOP_FAR + 0.5; // where the front bumper waits
const BRAKE_COMFORT = 3.0;
const BASE_SPEED = 12.5;

function makeRoute(a, lane, move) {
  const [dx, dz] = DIRS[a];
  const rx = -dz;
  const rz = dx;
  const lat = LANE_LAT[lane];
  const r = { a, lane, move, dx, dz, rx, rz, x0: -dx * L + rx * lat, z0: -dz * L + rz * lat, arcLen: 0, R: 0 };
  if (move === STRAIGHT) {
    r.len1 = 2 * L;
    r.total = 2 * L;
    r.out = a * 2 + lane;
    r.sBoxOut = L + BOX;
    return r;
  }
  if (move === RIGHT) {
    r.R = R_RIGHT;
    const k = lat + r.R;
    r.len1 = L - k;
    r.cx = -dx * k + rx * k;
    r.cz = -dz * k + rz * k;
    r.bx = -dx * lat + rx * k;
    r.bz = -dz * lat + rz * k;
    r.ex = rx;
    r.ez = rz;
    r.len3 = L - k;
    r.out = ((a + 3) % 4) * 2 + 1;
    r.arcLen = (Math.PI / 2) * r.R;
    r.sBoxOut = r.len1 + r.arcLen + (BOX - k);
  } else {
    r.R = R_LEFT;
    const k = r.R - lat;
    r.len1 = L - k;
    r.cx = -dx * k - rx * k;
    r.cz = -dz * k - rz * k;
    r.bx = dx * lat - rx * k;
    r.bz = dz * lat - rz * k;
    r.ex = -rx;
    r.ez = -rz;
    r.len3 = L - k;
    r.out = ((a + 1) % 4) * 2;
    r.arcLen = (Math.PI / 2) * r.R;
    r.sBoxOut = r.len1 + r.arcLen + (BOX - k);
  }
  r.total = r.len1 + r.arcLen + r.len3;
  return r;
}

function routePose(r, s, out) {
  if (r.move === STRAIGHT || s <= r.len1) {
    out.x = r.x0 + r.dx * s;
    out.z = r.z0 + r.dz * s;
    out.hx = r.dx;
    out.hz = r.dz;
  } else if (s < r.len1 + r.arcLen) {
    const phi = (s - r.len1) / r.R;
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    const k = r.move === RIGHT ? -1 : 1;
    out.x = r.cx + r.R * (k * r.rx * c + r.dx * sn);
    out.z = r.cz + r.R * (k * r.rz * c + r.dz * sn);
    out.hx = r.dx * c - k * r.rx * sn;
    out.hz = r.dz * c - k * r.rz * sn;
  } else {
    const t = s - r.len1 - r.arcLen;
    out.x = r.bx + r.ex * t;
    out.z = r.bz + r.ez * t;
    out.hx = r.ex;
    out.hz = r.ez;
  }
  return out;
}

const PHASES = [
  { axis: 0, state: 'G', duration: 16 },
  { axis: 0, state: 'Y', duration: 3 },
  { axis: -1, state: 'R', duration: 2.2 },
  { axis: 1, state: 'G', duration: 14 },
  { axis: 1, state: 'Y', duration: 3 },
  { axis: -1, state: 'R', duration: 2.2 },
];

export class SignalController {
  constructor() {
    this.index = 0;
    this.elapsed = 5;
  }
  update(dt) {
    this.elapsed += dt;
    while (this.elapsed >= PHASES[this.index].duration) {
      this.elapsed -= PHASES[this.index].duration;
      this.index = (this.index + 1) % PHASES.length;
    }
  }
  /** 'G' | 'Y' | 'R' for the given road axis (0: avenue / X, 1: cross street / Z). */
  stateFor(axis) {
    const phase = PHASES[this.index];
    return phase.axis === axis ? phase.state : 'R';
  }
}

// Where a left turn crosses the two oncoming lanes, measured along the oncoming
// (straight) route relative to the intersection centre: [inner lane, outer lane].
const LEFT_CONFLICT = LANE_LAT.map((lat) => {
  const k = R_LEFT - LANE_LAT[0];
  return k - R_LEFT * Math.sin(Math.acos((k - lat) / R_LEFT));
});
const LEFT_YIELD = 2.6; // metres into the arc: nose in the junction, still clear of oncoming traffic

const _probe = { x: 0, z: 0, hx: 1, hz: 0 };

export class TrafficSystem {
  constructor(fleet, furniture, rng) {
    this.fleet = fleet;
    this.rng = rng;
    this.signals = new SignalController();
    this.lampMaterials = furniture.lampMaterials;
    this.signalColors = furniture.signalColors;
    this.lampLevels = [0, 1].map(() => ({ red: 0, yellow: 0, green: 0 }));
    this.routes = DIRS.map((_, a) => [0, 1].map((lane) => [STRAIGHT, RIGHT, LEFT].map((move) => makeRoute(a, lane, move))));
    this.vehicles = fleet.slots.map((slot, id) => ({
      id, slot, active: false, route: null, laneKey: 0, s: 0, v: 0, acc: 0, v0: BASE_SPEED, aMax: 2.2, T: 1.2,
      brake: 0, yDecision: 0, stopping: false, leftCleared: false, leadGap: Infinity, held: false, stuck: 0,
      sStop: 0, sBoxIn: 0, rem: 0, pose: { x: 0, z: 0, hx: 1, hz: 0 },
    }));
    this.boxBusy = [false, false];
    this.enabled = true;
    this.density = 0.65;
    this.speedFactor = 1;
    this.beamLevel = 0;
    this.shadowLevel = 0.5;
    this.lampGain = 4;
    this.spawnTimer = 0;
    this.activeCount = 0;
    this.prewarm();
  }

  targetCount() {
    return this.enabled ? Math.round(lerp(4, this.vehicles.length, this.density)) : 0;
  }

  setEnabled(enabled) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.prewarm();
    } else {
      for (const v of this.vehicles) v.active = false;
      this.writeInstances();
    }
  }

  setDensity(density) {
    this.density = clamp(density, 0, 1);
  }

  prewarm() {
    const target = this.targetCount();
    for (const v of this.vehicles) {
      if (this.countActive() >= target) break;
      if (v.active) continue;
      for (let attempt = 0; attempt < 12 && !v.active; attempt++) this.trySpawn(v, true);
    }
    this.writeInstances();
  }

  countActive() {
    let n = 0;
    for (const v of this.vehicles) if (v.active) n++;
    return n;
  }

  trySpawn(v, prewarm) {
    const rng = this.rng;
    const a = rng.int(0, 3);
    let lane = rng.int(0, 1);
    let move = STRAIGHT;
    if (v.slot.type === 'bus') lane = 1;
    else if (lane === 0 && rng.chance(0.24)) move = LEFT;
    else if (lane === 1 && rng.chance(0.38)) move = RIGHT;
    const route = this.routes[a][lane][move];
    const laneKey = a * 2 + lane;
    let s = 0;
    if (prewarm) s = rng.chance(0.55) ? rng.range(15, L - 45) : rng.range(route.sBoxOut + 12, route.total - 15);
    const rem = route.total - s;
    for (const o of this.vehicles) {
      if (!o.active) continue;
      if (o.laneKey === laneKey && Math.abs(o.s - s) < 17) return false;
      if (s > route.sBoxOut && o.route.out === route.out && o.s > o.sBoxIn && Math.abs(o.rem - rem) < 17) return false;
    }
    const len = v.slot.length;
    v.route = route;
    v.laneKey = laneKey;
    v.s = s;
    v.rem = rem;
    v.v0 = BASE_SPEED * v.slot.speed * rng.range(0.88, 1.12);
    v.v = v.v0 * (prewarm ? 0.7 : 0.9) * this.speedFactor;
    v.acc = 0;
    v.aMax = v.slot.type === 'bus' ? 1.3 : rng.range(1.9, 2.6);
    v.T = rng.range(1.0, 1.5);
    v.sStop = L - STOP_FRONT - len / 2;
    v.sBoxIn = L - BOX;
    v.brake = 0;
    v.yDecision = 0;
    v.stopping = false;
    v.leftCleared = false;
    v.leadGap = Infinity;
    v.held = false;
    v.stuck = 0;
    v.active = true;
    routePose(route, s, v.pose);
    this.fleet.repaint(v.id, rng);
    return true;
  }

  update(dt) {
    if (dt <= 0) {
      this.writeInstances();
      return;
    }
    this.signals.update(dt);
    this.updateLamps(dt);
    const steps = dt > 0.05 ? 2 : 1;
    for (let k = 0; k < steps; k++) this.step(dt / steps);
    this.manageSpawns(dt);
    this.writeInstances();
  }

  updateLamps(dt) {
    for (const axis of [0, 1]) {
      const state = this.signals.stateFor(axis);
      const on = { red: state === 'R', yellow: state === 'Y', green: state === 'G' };
      for (const key of ['red', 'yellow', 'green']) {
        const levels = this.lampLevels[axis];
        levels[key] = damp(levels[key], on[key] ? 1 : 0, 22, dt);
        this.lampMaterials[axis][key].color.copy(this.signalColors[key]).multiplyScalar(0.02 + levels[key] * this.lampGain);
      }
    }
  }

  manageSpawns(dt) {
    const target = this.targetCount();
    let active = this.countActive();
    if (active > target) {
      for (const v of this.vehicles) {
        if (active <= target) break;
        if (v.active && Math.max(Math.abs(v.pose.x), Math.abs(v.pose.z)) > 75) {
          v.active = false;
          active--;
        }
      }
    } else if (active < target) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const v = this.vehicles.find((c) => !c.active);
        if (v && this.trySpawn(v, false)) active++;
        this.spawnTimer = this.rng.range(0.3, 1.0);
      }
    }
    this.activeCount = active;
  }

  step(h) {
    const list = this.vehicles;
    this.boxBusy[0] = false;
    this.boxBusy[1] = false;
    for (const v of list) {
      if (!v.active) continue;
      v.rem = v.route.total - v.s;
      if (v.s > v.sBoxIn + 1 && v.s < v.route.sBoxOut - 2.5) this.boxBusy[v.route.a % 2] = true;
    }
    for (const v of list) if (v.active) this.accelerate(v, h);
    for (const v of list) {
      if (!v.active) continue;
      v.v = Math.max(0, v.v + v.acc * h);
      if (v.v < 0.04 && v.acc <= 0) v.v = 0;
      v.s += v.v * h;
      const braking = v.acc < -0.7 || (v.v < 0.6 && v.held);
      v.brake = damp(v.brake, braking ? 1 : 0, braking ? 18 : 7, h);
      if (v.s >= v.route.total - 1) v.active = false;
      else routePose(v.route, v.s, v.pose);
    }
  }

  /** Is an oncoming vehicle about to cross the path of this left turn? */
  oncomingThreat(v, tNeed) {
    const opposite = (v.route.a + 2) % 4;
    for (const o of this.vehicles) {
      if (!o.active || o.route.a !== opposite || o.route.move !== STRAIGHT) continue;
      const conflictS = L + LEFT_CONFLICT[o.route.lane];
      const d = conflictS - o.s;
      if (d < -(o.slot.length / 2 + 2)) continue; // already through
      if (o.stopping && o.s < o.sStop + 0.5) continue; // held by its signal
      if (o.v < 0.6 && o.leadGap < 4 && d > 6) continue; // stuck in a queue
      const t = (-o.v + Math.sqrt(o.v * o.v + 2 * 2.0 * Math.max(d, 0))) / 2.0;
      if (t < tNeed) return true;
    }
    return false;
  }

  accelerate(v, h) {
    const r = v.route;
    const len = v.slot.length;
    let vDes = v.v0 * this.speedFactor;
    if (r.move !== STRAIGHT) {
      const vTurn = r.move === RIGHT ? 4.3 : 6.2;
      const dArc = r.len1 - v.s;
      if (dArc > 0) vDes = Math.min(vDes, Math.sqrt(vTurn * vTurn + 2 * 1.7 * dArc));
      else if (v.s < r.len1 + r.arcLen) vDes = Math.min(vDes, vTurn);
    }
    const freeTerm = Math.max(1 - Math.pow(v.v / Math.max(vDes, 0.5), 4), -1.6);
    let acc = v.aMax * freeTerm;
    let held = false;
    const consider = (gap, closing, s0) => {
      const g = Math.max(gap, 0.05);
      const sStar = s0 + Math.max(0, v.v * v.T + (v.v * closing) / (2 * Math.sqrt(v.aMax * BRAKE_COMFORT)));
      const a = v.aMax * (freeTerm - (sStar / g) * (sStar / g));
      if (a < acc) {
        acc = a;
        if (g < s0 + 3) held = true;
      }
    };

    // --- vehicles ahead: same approach lane, or merging into the same exit lane ---------
    let leadGap = Infinity;
    const inJunction = v.s > v.sBoxIn - 6 && v.s < r.sBoxOut;
    for (const o of this.vehicles) {
      if (!o.active || o === v) continue;
      const half = (len + o.slot.length) / 2;
      let gap = Infinity;
      if (o.laneKey === v.laneKey && o.s > v.s) {
        if (o.route === r || o.s < Math.min(r.len1, o.route.len1) + 7) gap = o.s - v.s - half;
      }
      if (gap === Infinity && o.route.out === r.out && o.route !== r && o.s > o.sBoxIn && v.s > v.sBoxIn - 30 && v.rem > o.rem) {
        gap = v.rem - o.rem - half;
      }
      if (gap < Infinity) {
        if (gap < leadGap) leadGap = gap;
        consider(gap, v.v - o.v, 2.0);
        continue;
      }
      // safety net inside the junction: anything standing on the path just ahead
      if (!inJunction || v.stuck > 5) continue;
      if (Math.abs(o.pose.x) > BOX + 3 || Math.abs(o.pose.z) > BOX + 3) continue;
      const bodyHalf = Math.max(0, o.slot.length / 2 - o.slot.width / 2);
      const reach = (v.slot.width + o.slot.width) / 2 + 0.35;
      for (let j = 0; j < 5; j++) {
        const ahead = len / 2 + j * 2.2;
        routePose(r, v.s + ahead, _probe);
        const px = _probe.x - o.pose.x;
        const pz = _probe.z - o.pose.z;
        const along = clamp(px * o.pose.hx + pz * o.pose.hz, -bodyHalf, bodyHalf);
        const ex = px - o.pose.hx * along;
        const ez = pz - o.pose.hz * along;
        if (ex * ex + ez * ez < reach * reach) {
          const cos = v.pose.hx * o.pose.hx + v.pose.hz * o.pose.hz;
          consider(j * 2.2 - 0.6, v.v - Math.max(0, o.v * cos), 1.0);
          break;
        }
      }
    }
    v.leadGap = leadGap;

    // --- signal ----------------------------------------------------------------------------
    v.stopping = false;
    if (v.s < v.sStop + 0.5) {
      const dStop = v.sStop - v.s;
      const axis = r.a % 2;
      const state = this.signals.stateFor(axis);
      let mustStop = false;
      if (state === 'R') {
        mustStop = dStop > (v.v * v.v) / (2 * 7.5) - 0.5;
        v.yDecision = 0;
      } else if (state === 'Y') {
        if (v.yDecision === 0) v.yDecision = dStop > (v.v * v.v) / (2 * 3.3) ? 1 : 2;
        mustStop = v.yDecision === 1;
      } else {
        v.yDecision = 0;
        // green, but cross traffic is still clearing the junction
        if (dStop < 28 && this.boxBusy[1 - axis]) mustStop = true;
      }
      if (mustStop) {
        v.stopping = true;
        consider(dStop + 0.6, v.v, 0.6);
      }
    }

    // --- permissive left turn: wait inside the junction for a gap ----------------
    if (r.move === LEFT && !v.leftCleared) {
      const dYield = r.len1 + LEFT_YIELD - v.s;
      if (dYield < -0.5) {
        v.leftCleared = true;
      } else if (dYield < 32) {
        if (this.oncomingThreat(v, v.v > 2.5 ? 3.4 : 4.6)) consider(Math.max(dYield, 0) + 0.5, v.v, 0.5);
        else if (dYield < 2) v.leftCleared = true;
      }
    }

    v.acc = clamp(acc, -8, v.aMax);
    v.held = held;
    // a vehicle that has been stationary inside the junction for a while may creep through
    if (inJunction && v.s > v.sBoxIn + 1 && v.v < 0.2) v.stuck += h;
    else if (v.stuck > 0 && (!inJunction || v.v > 2)) v.stuck = 0;
    if (v.stuck > 8) v.stuck = 0;
  }

  writeInstances() {
    const fleet = this.fleet;
    for (const v of this.vehicles) {
      if (!v.active) {
        fleet.hide(v.id);
        continue;
      }
      const r = v.route;
      const turning = r.move !== STRAIGHT && v.s > r.len1 - 45 && v.s < r.len1 + r.arcLen + 2;
      fleet.place(
        v.id, v.pose.x, v.pose.z, v.pose.hx, v.pose.hz, v.brake,
        turning && r.move === LEFT ? 1 : 0, turning && r.move === RIGHT ? 1 : 0,
        this.beamLevel, this.shadowLevel,
      );
    }
    fleet.commit();
  }
}