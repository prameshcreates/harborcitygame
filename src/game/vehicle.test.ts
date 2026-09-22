import assert from "node:assert/strict";
import test from "node:test";
import { applyWallImpulse, physFor, stepVehicle, type VehicleSpec, type VehicleState } from "./vehicle.ts";

const spec: VehicleSpec = { max: 34, len: 4.5, h: 1.34, boat: false };
const phys = physFor(spec);

function fresh(): VehicleState {
  return { x: 0, z: 0, yaw: 0, speed: 0, vy: 0, yawRate: 0, wheel: 0, pitch: 0, roll: 0 };
}

function run(state: VehicleState, throttle: number, steer: number, grip: number, frames: number, hand = false) {
  for (let i = 0; i < frames; i++) stepVehicle(state, throttle, steer, hand, spec, phys, grip, 1, 1 / 60);
  return state;
}

function yawDelta(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

test("A increases yaw while moving forward", () => {
  const state = run(fresh(), 1, 0, 1, 50);
  assert.ok(state.speed > 2, `speed ${state.speed}`);
  const y0 = state.yaw;
  run(state, 1, 1, 1, 30);
  const d = yawDelta(y0, state.yaw);
  assert.ok(d > 0.05, `A yaw delta ${d}`);
});

test("D decreases yaw while moving forward", () => {
  const state = run(fresh(), 1, 0, 1, 50);
  const y0 = state.yaw;
  run(state, 1, -1, 1, 30);
  const d = yawDelta(y0, state.yaw);
  assert.ok(d < -0.05, `D yaw delta ${d}`);
});

test("reverse A still matches the kinematic sign", () => {
  const state = fresh();
  state.speed = -6;
  const y0 = state.yaw;
  run(state, -1, 1, 1, 30);
  const d = yawDelta(y0, state.yaw);
  assert.ok(d < -0.02, `reverse A yaw delta ${d}`);
});

test("drag holds top speed near the rated max", () => {
  const state = run(fresh(), 1, 0, 1, 60 * 16);
  assert.ok(state.speed > spec.max * 0.72, `too slow ${state.speed}`);
  assert.ok(state.speed < spec.max * 1.12, `too fast ${state.speed}`);
});

test("asphalt yaws harder than ice", () => {
  const dry = run(fresh(), 1, 0, 1, 70);
  const ice = { ...dry, yaw: 0, vy: 0, yawRate: 0, wheel: 0, x: 0, z: 0 };
  const dry2 = { ...dry, yaw: 0, vy: 0, yawRate: 0, wheel: 0, x: 0, z: 0 };
  run(dry2, 0.2, 1, 1, 45);
  run(ice, 0.2, 1, 0.12, 45);
  const dryYaw = Math.abs(yawDelta(0, dry2.yaw));
  const iceYaw = Math.abs(yawDelta(0, ice.yaw));
  assert.ok(dryYaw > iceYaw, `dry ${dryYaw} ice ${iceYaw}`);
});

test("head-on wall kills closing speed", () => {
  const state = run(fresh(), 1, 0, 1, 80);
  const before = state.speed;
  assert.ok(before > 8, `speed ${before}`);
  const impact = applyWallImpulse(state, 0, 1);
  assert.ok(impact > 4, `impact ${impact}`);
  assert.ok(state.speed < before * 0.35, `speed after ${state.speed}`);
});
