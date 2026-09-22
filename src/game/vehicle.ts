export type VehicleSpec = {
  max: number;
  len: number;
  h: number;
  boat: boolean;
};

export type VehiclePhys = {
  mass: number;
  L: number;
  a: number;
  b: number;
  Iz: number;
  cf: number;
  cr: number;
  cdA: number;
  crr: number;
  mu: number;
  maxSteer: number;
};

export type VehicleState = {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  vy: number;
  yawRate: number;
  wheel: number;
  pitch: number;
  roll: number;
};

export type PlanarBasis = {
  x: number;
  z: number;
  fx: number;
  fz: number;
  lx: number;
  lz: number;
};

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export function physFor(spec: VehicleSpec): VehiclePhys {
  const mass = spec.boat ? 860 : 1080 + spec.h * 260;
  const L = Math.max(2.2, spec.len * 0.62);
  const a = L * 0.46;
  const b = L - a;
  return {
    mass,
    L,
    a,
    b,
    Iz: mass * (0.4 * spec.len) ** 2,
    cf: mass * (spec.boat ? 9 : 42),
    cr: mass * (spec.boat ? 12 : 50),
    cdA: spec.boat ? 0.42 : 0.58 + spec.h * 0.1,
    crr: spec.boat ? 0.028 : 0.013,
    mu: spec.boat ? 0.4 : 1.05,
    maxSteer: spec.boat ? 0.36 : 0.48,
  };
}

function lateral(alpha: number, corner: number, peak: number) {
  const linear = corner * alpha;
  const x = linear / Math.max(1, peak);
  return peak * (x / Math.sqrt(1 + x * x));
}

function substep(
  state: VehicleState,
  throttle: number,
  steer: number,
  hand: boolean,
  spec: VehicleSpec,
  phys: VehiclePhys,
  grip: number,
  dragMul: number,
  h: number,
) {
  const target = clamp(steer, -1, 1) * phys.maxSteer;
  const limit = 3.4 * h;
  state.wheel += clamp(target - state.wheel, -limit, limit);
  const delta = state.wheel;
  const vx = state.speed;
  const vy = state.vy;
  const w = state.yawRate;
  const vxSafe = Math.abs(vx) < 0.8 ? (vx >= 0 ? 0.8 : -0.8) : vx;
  const reversing = vx < -0.35;
  const slipDen = Math.max(0.8, Math.abs(vxSafe));
  const af = (reversing ? -delta : delta) - Math.atan2(vy + phys.a * w, slipDen);
  const ar = -Math.atan2(vy - phys.b * w, slipDen);
  const axleLoad = phys.mass * 9.81 * 0.5;
  const mu = phys.mu * grip;
  const peak = mu * axleLoad;
  const speedScale = clamp(Math.abs(vx) / 1.6, 0, 1);
  let Fyf = lateral(af, phys.cf, peak) * speedScale;
  let Fyr = lateral(ar, phys.cr * (hand && !spec.boat ? 0.25 : 1), peak * (hand && !spec.boat ? 0.25 : 1)) * speedScale;

  const curve = clamp(1 - Math.abs(vx) / spec.max, 0, 1);
  const driveCap = mu * phys.mass * 9.81 * (spec.boat ? 0.34 : 0.7);
  let Fx = 0;
  if (throttle >= 0) Fx = throttle * driveCap * (0.16 + 0.84 * curve);
  else if (vx > 0.35) Fx = throttle * driveCap * 1.55;
  else Fx = throttle * driveCap * 0.42;
  if (hand && !spec.boat) Fx -= Math.sign(vx || 1) * driveCap * 0.55;
  Fx -= 0.5 * 1.225 * phys.cdA * dragMul * vx * Math.abs(vx);
  Fx -= phys.crr * dragMul * phys.mass * 9.81 * Math.sign(vx || 0);

  const lim = mu * phys.mass * 9.81;
  const used = Math.hypot(Fx, Fyf + Fyr);
  if (used > lim && used > 1) {
    const s = lim / used;
    Fx *= s;
    Fyf *= s;
    Fyr *= s;
  }

  const cosD = Math.cos(delta);
  const sinD = Math.sin(delta);
  const ax = (Fx - Fyf * sinD) / phys.mass + vy * w;
  const ay = (Fyf * cosD + Fyr) / phys.mass - vx * w;
  let yw = (phys.a * Fyf * cosD - phys.b * Fyr) / phys.Iz;
  yw -= (w * 0.55) / Math.max(1, phys.Iz / phys.mass);

  const kin = Math.abs(vx) < 0.25 ? 0 : (vx / phys.L) * Math.tan(clamp(delta, -1.05, 1.05));
  const blend = reversing ? 0.85 : clamp((3.2 - Math.abs(vx)) / 3.2, 0, 1);

  state.speed = vx + ax * h;
  state.vy = vy + ay * h;
  state.yawRate = (w + yw * h) * (1 - blend) + kin * blend;
  const cap = spec.max * 1.08;
  if (state.speed > cap) state.speed = cap;
  if (state.speed < -cap * 0.34) state.speed = -cap * 0.34;
  state.vy = clamp(state.vy, -12, 12);
  state.yawRate = clamp(state.yawRate, -2.5, 2.5);
  if (Math.abs(state.speed) < 0.08 && Math.abs(throttle) < 0.04 && Math.abs(state.vy) < 0.2) {
    state.speed = 0;
    state.vy = 0;
    state.yawRate = 0;
  }

  state.yaw += state.yawRate * h;
  const fx = -Math.sin(state.yaw);
  const fz = -Math.cos(state.yaw);
  const lx = -Math.cos(state.yaw);
  const lz = Math.sin(state.yaw);
  state.x += (fx * state.speed + lx * state.vy) * h;
  state.z += (fz * state.speed + lz * state.vy) * h;
  state.pitch += (clamp(-ax / 48, -0.09, 0.09) - state.pitch) * Math.min(1, 10 * h);
  state.roll += (clamp(-ay / 36, -0.12, 0.12) - state.roll) * Math.min(1, 10 * h);
}

export function stepVehicle(
  state: VehicleState,
  throttle: number,
  steer: number,
  hand: boolean,
  spec: VehicleSpec,
  phys: VehiclePhys,
  grip: number,
  dragMul: number,
  dt: number,
) {
  const h = dt / 2;
  substep(state, throttle, steer, hand, spec, phys, grip, dragMul, h);
  substep(state, throttle, steer, hand, spec, phys, grip, dragMul, h);
}

export function writeWorldVelocity(state: VehicleState, out: PlanarBasis) {
  out.fx = -Math.sin(state.yaw);
  out.fz = -Math.cos(state.yaw);
  out.lx = -Math.cos(state.yaw);
  out.lz = Math.sin(state.yaw);
  out.x = out.fx * state.speed + out.lx * state.vy;
  out.z = out.fz * state.speed + out.lz * state.vy;
  return out;
}

export function setWorldVelocity(state: VehicleState, wx: number, wz: number, basis: PlanarBasis) {
  state.speed = wx * basis.fx + wz * basis.fz;
  state.vy = wx * basis.lx + wz * basis.lz;
}

export function applyWallImpulse(state: VehicleState, nx: number, nz: number) {
  const nlen = Math.hypot(nx, nz);
  if (nlen < 1e-5) return 0;
  const ox = nx / nlen;
  const oz = nz / nlen;
  const basis = writeWorldVelocity(state, wallScratch);
  const vn = basis.x * ox + basis.z * oz;
  if (vn >= -0.05) return 0;
  const e = 0.06;
  const tx = basis.x - vn * ox;
  const tz = basis.z - vn * oz;
  const wx = tx * 0.86 - (1 + e) * vn * ox;
  const wz = tz * 0.86 - (1 + e) * vn * oz;
  setWorldVelocity(state, wx, wz, basis);
  state.yawRate *= 0.72;
  return -vn;
}

const wallScratch: PlanarBasis = { x: 0, z: 0, fx: 0, fz: 0, lx: 0, lz: 0 };
