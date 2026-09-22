import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  CITY_EDGE,
  DISTRICT_NAMES,
  DISTRICT_ORDER,
  FOUNTAIN,
  ISLE,
  LIGHTHOUSE,
  PIERS,
  ROAD_HALF,
  SPACING,
  STADIUM,
  START,
  buildCity,
  districtAt,
  footMul,
  inWater,
  onBridge,
  onPier,
  onRoad,
  onSand,
  roadPos,
  surfaceGrip,
  terrainCap,
  type AABB,
  type DistrictId,
} from "./city";
import { edges, joy, keys, live, steerOverride, steerOverrideOn } from "./input";
import { patchHud } from "./hud";
import { session } from "./session";
import { RADIO, crashSound, honk, pickupSound, setDriveAudio, setSiren, setStation, tickMusic, unlockAudio } from "./audio";
import {
  applyWallImpulse,
  physFor,
  setWorldVelocity,
  stepVehicle,
  writeWorldVelocity,
  type PlanarBasis,
  type VehiclePhys,
  type VehicleSpec,
} from "./vehicle";

const SAVE_KEY = "harbor-city-v1";
const STEP = 1 / 60;

const TYPES = [
  { name: "Sentinel", max: 34, accel: 18, turn: 1.95, len: 4.5, wid: 1.86, h: 1.34 },
  { name: "Banshee", max: 48, accel: 27, turn: 2.25, len: 4.2, wid: 1.9, h: 1.06 },
  { name: "Landstalk", max: 30, accel: 14, turn: 1.55, len: 4.7, wid: 2.02, h: 1.7 },
  { name: "Cab", max: 33, accel: 16, turn: 1.78, len: 4.55, wid: 1.88, h: 1.48 },
  { name: "Cruiser", max: 40, accel: 22, turn: 2, len: 4.85, wid: 1.9, h: 1.48 },
  { name: "Skiff", max: 22, accel: 9, turn: 1.25, len: 5.4, wid: 2.05, h: 0.92 },
] as const;

type Ai = "traffic" | "parked" | "chase" | "none";

type Actor = {
  type: number;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  ai: Ai;
  vertical: boolean;
  road: number;
  dir: number;
  color: number;
  active: boolean;
  slot: number;
  stuck: number;
  lock: number;
  lx: number;
  lz: number;
  vy: number;
  yawRate: number;
  wheel: number;
  pitch: number;
  roll: number;
};

type Ped = {
  vertical: boolean;
  road: number;
  dir: number;
  side: number;
  x: number;
  z: number;
  yaw: number;
  down: boolean;
};

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function angNorm(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function dampAngle(cur: number, target: number, lambda: number, dt: number) {
  return cur + angNorm(target - cur) * (1 - Math.exp(-lambda * dt));
}

function hash01(a: number, b: number) {
  let n = Math.imul(a + 1, 374761393) + Math.imul(b + 9, 668265263);
  n = (n ^ (n >>> 13)) >>> 0;
  return (n % 10000) / 10000;
}

function facingLabel(yaw: number) {
  const deg = (((-yaw * 180) / Math.PI) % 360 + 360) % 360;
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(deg / 45) % 8] ?? "N";
}

const DAY_SECONDS = 280;

function formatClock(hour: number) {
  const hh = Math.floor(hour) % 24;
  const mm = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function phaseName(hour: number) {
  if (hour < 5 || hour >= 20.5) return "Night";
  if (hour < 7) return "Dawn";
  if (hour < 16.8) return "Day";
  if (hour < 19.6) return "Dusk";
  return "Night";
}

function smooth(x: number, a: number, b: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function radiusOf(type: number) {
  return TYPES[type]!.wid * 0.72;
}

function paint(geo: THREE.BufferGeometry, color: THREE.Color) {
  const n = geo.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

function buildCarGeometry(type: number) {
  const spec = TYPES[type]!;
  const boat = type === 5;
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.BoxGeometry(spec.wid, spec.h * (boat ? 0.42 : 0.5), spec.len);
  body.translate(0, boat ? spec.h * 0.28 : spec.h * 0.36, boat ? 0 : 0);
  parts.push(paint(body, new THREE.Color(type === 4 ? "#f4f6f8" : "#ffffff")));
  if (!boat) {
    const cab = new THREE.BoxGeometry(spec.wid * 0.78, spec.h * 0.36, spec.len * 0.42);
    cab.translate(0, spec.h * 0.72, -spec.len * 0.05);
    parts.push(paint(cab, new THREE.Color(type === 4 ? "#1d3358" : "#b7dbe6")));
    const wheel = new THREE.CylinderGeometry(spec.h * 0.2, spec.h * 0.2, 0.26, 8);
    wheel.rotateZ(Math.PI / 2);
    const wz = spec.len * 0.32;
    const wx = spec.wid * 0.5;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const w = wheel.clone();
        w.translate(sx * wx, spec.h * 0.2, sz * wz);
        parts.push(paint(w, new THREE.Color("#1a1c22")));
      }
    }
  } else {
    const cabin = new THREE.BoxGeometry(spec.wid * 0.55, spec.h * 0.45, spec.len * 0.28);
    cabin.translate(0, spec.h * 0.62, -spec.len * 0.12);
    parts.push(paint(cabin, new THREE.Color("#d5e7ee")));
  }
  const lamp = new THREE.BoxGeometry(0.16, 0.1, 0.08);
  lamp.translate(spec.wid * 0.28, spec.h * 0.36, spec.len * 0.5);
  parts.push(paint(lamp, new THREE.Color("#fff1c4")));
  const lamp2 = lamp.clone();
  lamp2.translate(-spec.wid * 0.56, 0, 0);
  parts.push(paint(lamp2, new THREE.Color("#fff1c4")));
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error("Could not build vehicle");
  return merged;
}

function makeLabel(text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.clearRect(0, 0, 512, 128);
  g.fillStyle = "rgba(12,16,24,0.55)";
  g.fillRect(36, 28, 440, 72);
  g.font = "600 58px Impact, sans-serif";
  g.fillStyle = "#f4efe4";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(22, 5.5, 1);
  return sprite;
}

export function mount(canvas: HTMLCanvasElement, map: HTMLCanvasElement) {
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T) => {
    disposables.push(item);
    return item;
  };

  const mobile = window.innerWidth < 900;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !mobile,
    alpha: false,
    powerPreference: "high-performance",
    failIfMajorPerformanceCaveat: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.15 : 1.5));
  renderer.setClearColor(0x87a0b8, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x8ea4bc, 0.0018);
  scene.background = new THREE.Color(0x8ea4bc);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.18, 2400);
  camera.position.set(-30, 30, 30);

  const hemi = new THREE.HemisphereLight(0x9eb7e4, 0x3a332c, 0.72);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffe2c4, 0.12);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 8;
  sun.shadow.camera.far = 220;
  sun.shadow.camera.left = -62;
  sun.shadow.camera.right = 62;
  sun.shadow.camera.top = 62;
  sun.shadow.camera.bottom = -62;
  sun.shadow.bias = -0.00018;
  sun.shadow.normalBias = 0.045;
  scene.add(sun);
  scene.add(sun.target);

  const uSunDir = { value: new THREE.Vector3(0.45, 0.32, 0.28) };
  const uNight = { value: 0.22 };
  const uTime = { value: 0 };
  const skyState = { hour: 15.7, night: 0.05, day: 0.95 };

  const skyMat = track(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uSunDir, uTime },
      vertexShader: `
        varying vec3 vP;
        void main() {
          vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vP;
        uniform vec3 uSunDir;
        uniform float uTime;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        void main() {
          vec3 dir = normalize(vP);
          float elev = uSunDir.y;
          float day = smoothstep(-0.06, 0.22, elev);
          float night = 1.0 - smoothstep(-0.16, 0.2, elev);
          float sunset = smoothstep(0.34, 0.0, abs(elev)) * smoothstep(-0.18, 0.06, elev);
          vec3 zenith = mix(vec3(0.004, 0.008, 0.02), vec3(0.15, 0.4, 0.86), day);
          vec3 horizon = mix(vec3(0.06, 0.08, 0.14), vec3(0.64, 0.78, 0.93), day);
          horizon = mix(horizon, vec3(0.97, 0.46, 0.22), sunset * 0.9);
          zenith = mix(zenith, vec3(0.28, 0.2, 0.46), sunset * 0.4);
          float h = dir.y;
          vec3 col = mix(horizon, zenith, smoothstep(-0.02, 0.48, h));
          col = mix(mix(vec3(0.015, 0.012, 0.014), horizon, 0.4), col, smoothstep(-0.22, 0.02, h));
          vec3 sunCol = mix(vec3(1.0, 0.42, 0.16), vec3(1.0, 0.97, 0.9), smoothstep(0.0, 0.45, elev));
          float mu = max(dot(dir, normalize(uSunDir)), 0.0);
          col += sunCol * pow(mu, 7.0) * 0.48 * max(day, sunset);
          col += sunCol * pow(mu, 180.0) * 1.6;
          col += sunCol * pow(mu, 1400.0) * 1.8;
          vec3 moonDir = normalize(vec3(-uSunDir.x, max(0.12, -uSunDir.y * 0.85), -uSunDir.z));
          float md = max(dot(dir, moonDir), 0.0);
          col += vec3(0.8, 0.86, 1.0) * pow(md, 900.0) * night * 1.4;
          col += vec3(0.4, 0.48, 0.7) * pow(md, 5.0) * 0.22 * night;
          float star = step(0.994, hash(floor(dir * 140.0).xy + floor(dir.z * 80.0)));
          star *= smoothstep(0.08, 0.28, h) * night;
          col += vec3(0.9, 0.94, 1.0) * star * (0.35 + 0.65 * hash(dir.xy * 30.0));
          float cloud = noise(dir.xz * 5.5 / max(0.18, dir.y) + vec2(uTime * 0.012, uTime * 0.004));
          cloud = smoothstep(0.52, 0.78, cloud) * smoothstep(0.02, 0.3, h);
          vec3 cloudCol = mix(vec3(0.04, 0.05, 0.08), vec3(1.0, 0.98, 0.96), day);
          cloudCol = mix(cloudCol, vec3(0.98, 0.58, 0.36), sunset);
          col = mix(col, cloudCol, cloud * 0.5);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  const sky = new THREE.Mesh(track(new THREE.SphereGeometry(1500, 48, 32)), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  sky.name = "sky";
  scene.add(sky);

  const groundUniforms = { uTime };
  const groundMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0.02,
    }),
  );
  groundMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = groundUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHcW;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vHcW = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHcW;\nuniform float uTime;\nfloat hcWater;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 w = vHcW.xz;
        float sp = 72.0;
        float rx = abs(mod(w.x + sp * 0.5, sp) - sp * 0.5);
        float rz = abs(mod(w.y + sp * 0.5, sp) - sp * 0.5);
        float halfR = 7.5;
        bool vroad = rx < halfR;
        bool hroad = rz < halfR;
        bool road = vroad || hroad;
        bool side = !road && (rx < halfR + 2.8 || rz < halfR + 2.8);
        bool bridge = abs(w.x) < 8.0 && w.y < -326.0 && w.y > -516.0;
        float isleD = distance(w, vec2(0.0, -545.0));
        bool isle = isleD < 82.0;
        bool sand = w.y > 378.0 && w.y < 432.0 && abs(w.x) < 414.0;
        bool outside = abs(w.x) > 378.0 || abs(w.y) > 378.0;
        float grain = fract(sin(dot(floor(w * 3.5), vec2(127.1, 311.7))) * 43758.5);
        float n = fract(sin(floor(w.x / 72.0) * 127.1 + floor(w.y / 72.0) * 311.7) * 43758.5);
        vec3 asphalt = vec3(0.045, 0.047, 0.05) * (0.92 + 0.08 * grain);
        vec3 walk = vec3(0.22, 0.2, 0.17) * (0.9 + 0.12 * grain);
        vec3 lot = mix(vec3(0.11, 0.12, 0.1), vec3(0.075, 0.08, 0.07), n);
        if (w.x < -200.0 && w.y > -150.0 && w.y < 170.0) lot = vec3(0.07, 0.16, 0.055) * (0.85 + 0.2 * grain);
        if (w.y > 230.0 && w.x > 80.0) lot = vec3(0.34, 0.26, 0.15);
        if (w.x > -68.0 && w.x < -8.0 && w.y > -68.0 && w.y < -8.0) {
          lot = vec3(0.24, 0.22, 0.18);
          float tile = step(0.94, fract(w.x * 0.28)) + step(0.94, fract(w.y * 0.28));
          lot = mix(lot, vec3(0.34, 0.31, 0.26), clamp(tile, 0.0, 1.0));
        }
        vec3 col = lot;
        if (side) col = walk;
        if (road || bridge) col = asphalt;
        bool edgeV = vroad && !hroad && rx > halfR - 0.42 && rx < halfR - 0.16;
        bool edgeH = hroad && !vroad && rz > halfR - 0.42 && rz < halfR - 0.16;
        if (edgeV || edgeH) col = vec3(0.72, 0.72, 0.68);
        float dash = step(0.55, fract((vroad ? w.y : w.x) * 0.09));
        bool center = !(vroad && hroad) && dash > 0.5 && ((vroad && rx < 0.1) || (hroad && rz < 0.1));
        if ((road || bridge) && center) col = vec3(0.72, 0.55, 0.16);
        if (bridge) {
          col = asphalt * 0.9;
          if (abs(w.x) > 6.35) col = vec3(0.42, 0.4, 0.36);
          if (abs(abs(w.x) - 1.15) < 0.07) col = vec3(0.72, 0.55, 0.16);
        }
        if (isle && !bridge) col = mix(vec3(0.09, 0.2, 0.07), vec3(0.55, 0.46, 0.28), smoothstep(62.0, 82.0, isleD));
        hcWater = 0.0;
        if (outside && sand && !isle && !bridge) col = vec3(0.62, 0.5, 0.3) * (0.92 + 0.1 * grain);
        if (outside && !sand && !isle && !bridge) {
          float wave = sin(w.x * 0.07 + uTime * 0.8) * cos(w.y * 0.05 - uTime * 0.65);
          col = vec3(0.012, 0.045, 0.07) + vec3(0.01, 0.03, 0.035) * wave;
          hcWater = 1.0;
        }
        diffuseColor.rgb = col;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.92, 0.05, hcWater);`,
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.22, hcWater);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        if (hcWater > 0.5) {
          vec3 bump = vec3(cos(vHcW.x * 0.17 + uTime * 0.8), 0.0, -sin(vHcW.z * 0.15 - uTime * 0.6));
          normal = normalize(normal + bump * 0.18);
        }`,
      );
  };
  const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(1700, 1700)), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.name = "ground";
  ground.receiveShadow = true;
  scene.add(ground);

  const city = buildCity();
  const boxes: AABB[] = city.boxes;
  const CELL = 42;
  const buckets = new Map<number, number[]>();
  const stamp = new Uint16Array(boxes.length);
  let stampN = 1;
  const qbuf: number[] = [];
  const bucketKey = (ix: number, iz: number) => ix * 73856093 + iz * 19349663;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    const ix0 = Math.floor(b.minX / CELL);
    const ix1 = Math.floor(b.maxX / CELL);
    const iz0 = Math.floor(b.minZ / CELL);
    const iz1 = Math.floor(b.maxZ / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = bucketKey(ix, iz);
        const arr = buckets.get(k);
        if (arr) arr.push(i);
        else buckets.set(k, [i]);
      }
    }
  }

  function query(x: number, z: number, r: number) {
    qbuf.length = 0;
    stampN += 1;
    if (stampN > 65000) {
      stamp.fill(0);
      stampN = 1;
    }
    const ix0 = Math.floor((x - r) / CELL);
    const ix1 = Math.floor((x + r) / CELL);
    const iz0 = Math.floor((z - r) / CELL);
    const iz1 = Math.floor((z + r) / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const arr = buckets.get(bucketKey(ix, iz));
        if (!arr) continue;
        for (const id of arr) {
          if (stamp[id] === stampN) continue;
          stamp[id] = stampN;
          qbuf.push(id);
        }
      }
    }
    return qbuf;
  }

  function resolveCircle(x: number, z: number, radius: number) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      const ids = query(x, z, radius + 2);
      for (const id of ids) {
        const b = boxes[id]!;
        const cx = clamp(x, b.minX, b.maxX);
        const cz = clamp(z, b.minZ, b.maxZ);
        let dx = x - cx;
        let dz = z - cz;
        const r2 = radius * radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r2) continue;
        hit = true;
        if (d2 < 1e-6) {
          const left = x - b.minX;
          const right = b.maxX - x;
          const down = z - b.minZ;
          const up = b.maxZ - z;
          const m = Math.min(left, right, down, up);
          if (m === left) x = b.minX - radius;
          else if (m === right) x = b.maxX + radius;
          else if (m === down) z = b.minZ - radius;
          else z = b.maxZ + radius;
        } else {
          const d = Math.sqrt(d2);
          const push = radius - d + 0.002;
          x += (dx / d) * push;
          z += (dz / d) * push;
        }
      }
    }
    return { x, z, hit };
  }

  function pointInside(x: number, z: number) {
    const ids = query(x, z, 1.5);
    for (const id of ids) {
      const b = boxes[id]!;
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return b;
    }
    return null;
  }

  function resolveVehicleBody(car: Actor) {
    const spec = TYPES[car.type]!;
    const hx = spec.wid * 0.46;
    const hz = spec.len * 0.46;
    const fx = -Math.sin(car.yaw);
    const fz = -Math.cos(car.yaw);
    const rx = Math.cos(car.yaw);
    const rz = -Math.sin(car.yaw);
    const samples: Array<[number, number]> = [
      [hz, hx],
      [hz, -hx],
      [-hz, hx],
      [-hz, -hx],
      [hz, 0],
      [-hz, 0],
      [0, hx],
      [0, -hx],
    ];
    let hit = false;
    let nx = 0;
    let nz = 0;
    for (let iter = 0; iter < 2; iter++) {
      for (const [lz, lx] of samples) {
        const x = car.x + fx * lz + rx * lx;
        const z = car.z + fz * lz + rz * lx;
        const b = pointInside(x, z);
        if (!b) continue;
        hit = true;
        const left = x - b.minX;
        const right = b.maxX - x;
        const down = z - b.minZ;
        const up = b.maxZ - z;
        const m = Math.min(left, right, down, up);
        if (m === left) {
          car.x -= left + 0.02;
          nx -= 1;
        } else if (m === right) {
          car.x += right + 0.02;
          nx += 1;
        } else if (m === down) {
          car.z -= down + 0.02;
          nz -= 1;
        } else {
          car.z += up + 0.02;
          nz += 1;
        }
      }
    }
    return { hit, nx, nz };
  }

  const bldgMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.78,
      metalness: 0.04,
    }),
  );
  bldgMat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uNight;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHcW;\nvarying vec3 vHcN;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 hcLocal = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          hcLocal = instanceMatrix * hcLocal;
        #endif
        vHcW = (modelMatrix * hcLocal).xyz;
        vec3 hcN = objectNormal;
        #ifdef USE_INSTANCING
          hcN = mat3(instanceMatrix) * hcN;
        #endif
        vHcN = normalize(mat3(modelMatrix) * hcN);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vHcW;\nvarying vec3 vHcN;\nuniform float uNight;\nfloat hcPane;\nvec3 hcWinCol;",
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 an = abs(normalize(vHcN));
        float wall = 1.0 - smoothstep(0.5, 0.9, an.y);
        float u = an.x > an.z ? vHcW.z : vHcW.x;
        float vv = vHcW.y;
        float fu = fract(u * 0.48);
        float fv = fract(vv * 0.42);
        hcPane = wall * step(0.14, fu) * step(fu, 0.86) * step(0.2, fv) * step(fv, 0.78);
        float hsh = fract(sin(dot(floor(vec2(u * 0.48, vv * 0.42)), vec2(127.1, 311.7))) * 43758.5453);
        float lit = step(mix(0.72, 0.22, uNight), hsh);
        vec3 facade = diffuseColor.rgb * (an.y > 0.65 ? 0.58 : 0.92);
        facade *= mix(0.62, 1.0, smoothstep(0.0, 2.8, vHcW.y));
        hcWinCol = mix(vec3(0.025, 0.035, 0.05), mix(vec3(1.0, 0.78, 0.42), vec3(0.55, 0.78, 0.98), step(0.8, hsh)), lit);
        diffuseColor.rgb = mix(facade, hcWinCol, hcPane);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.78, 0.12, hcPane);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += hcWinCol * hcPane * (0.05 + uNight * 1.55);`,
      );
  };

  const buildingMesh = new THREE.InstancedMesh(
    track(new THREE.BoxGeometry(1, 1, 1)),
    bldgMat,
    city.buildings.length,
  );
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  city.buildings.forEach((b, i) => {
    dummy.position.set(b.x, b.h / 2, b.z);
    dummy.scale.set(b.w, b.h, b.d);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    buildingMesh.setMatrixAt(i, dummy.matrix);
    buildingMesh.setColorAt(i, color.setHex(b.color));
  });
  buildingMesh.instanceMatrix.needsUpdate = true;
  if (buildingMesh.instanceColor) buildingMesh.instanceColor.needsUpdate = true;
  buildingMesh.frustumCulled = false;
  buildingMesh.castShadow = true;
  buildingMesh.receiveShadow = true;
  scene.add(buildingMesh);

  const stone = track(new THREE.MeshStandardMaterial({ color: 0xb7aea2 }));
  const basin = track(new THREE.MeshStandardMaterial({ color: 0x1c6e78, roughness: 0.05, metalness: 0.18 }));
  const fountain = new THREE.Mesh(track(new THREE.CylinderGeometry(FOUNTAIN.r, FOUNTAIN.r + 0.4, 0.9, 18)), stone);
  fountain.position.set(FOUNTAIN.x, 0.45, FOUNTAIN.z);
  const fountainWater = new THREE.Mesh(track(new THREE.CylinderGeometry(FOUNTAIN.r * 0.72, FOUNTAIN.r * 0.72, 0.25, 18)), basin);
  fountainWater.position.set(FOUNTAIN.x, 0.85, FOUNTAIN.z);
  scene.add(fountain, fountainWater);

  const field = new THREE.Mesh(
    track(new THREE.PlaneGeometry(STADIUM.x1 - STADIUM.x0 - 8, STADIUM.z1 - STADIUM.z0 - 8)),
    track(new THREE.MeshStandardMaterial({ color: 0x2c6a3c })),
  );
  field.rotation.x = -Math.PI / 2;
  field.position.set((STADIUM.x0 + STADIUM.x1) / 2, 0.05, (STADIUM.z0 + STADIUM.z1) / 2);
  scene.add(field);
  const wallMat = track(new THREE.MeshStandardMaterial({ color: 0xc45a3a }));
  const addWall = (x: number, z: number, w: number, d: number, h: number) => {
    const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), wallMat);
    mesh.position.set(x, h / 2, z);
    scene.add(mesh);
  };
  addWall((STADIUM.x0 + STADIUM.x1) / 2, STADIUM.z0 + 1.5, STADIUM.x1 - STADIUM.x0, 3, 7);
  addWall(STADIUM.x0 + 7, STADIUM.z1 - 1.5, 14, 3, 7);
  addWall(STADIUM.x1 - 7, STADIUM.z1 - 1.5, 14, 3, 7);
  addWall(STADIUM.x0 + 1.5, (STADIUM.z0 + STADIUM.z1) / 2, 3, STADIUM.z1 - STADIUM.z0, 7);
  addWall(STADIUM.x1 - 1.5, (STADIUM.z0 + STADIUM.z1) / 2, 3, STADIUM.z1 - STADIUM.z0, 7);

  const deckMat = track(new THREE.MeshStandardMaterial({ color: 0x4a4038 }));
  const railMat = track(new THREE.MeshStandardMaterial({ color: 0xd0d4dc, roughness: 0.28, metalness: 0.72 }));
  const deck = new THREE.Mesh(track(new THREE.BoxGeometry(14, 0.4, 190)), deckMat);
  deck.position.set(0, 0.2, -420);
  scene.add(deck);
  const railL = new THREE.Mesh(track(new THREE.BoxGeometry(0.35, 0.8, 190)), railMat);
  railL.position.set(-6.6, 0.7, -420);
  const railR = railL.clone();
  railR.position.x = 6.6;
  scene.add(railL, railR);

  const pierMat = track(new THREE.MeshStandardMaterial({ color: 0x6b5344 }));
  for (const pier of PIERS) {
    const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(pier.w, 0.35, pier.z1 - pier.z0)), pierMat);
    mesh.position.set(pier.x, 0.2, (pier.z0 + pier.z1) / 2);
    scene.add(mesh);
  }

  const towerMat = track(new THREE.MeshStandardMaterial({ color: 0xf4efe4 }));
  const bandMat = track(new THREE.MeshStandardMaterial({ color: 0xe23d3d }));
  const tower = new THREE.Mesh(track(new THREE.CylinderGeometry(1.5, 2.1, 26, 12)), towerMat);
  tower.position.set(LIGHTHOUSE.x, 13, LIGHTHOUSE.z);
  const band = new THREE.Mesh(track(new THREE.CylinderGeometry(1.7, 1.7, 2.2, 12)), bandMat);
  band.position.set(LIGHTHOUSE.x, 18, LIGHTHOUSE.z);
  const lampMat = track(
    new THREE.MeshStandardMaterial({ color: 0xffe1a8, emissive: 0xffb14a, emissiveIntensity: 1.6 }),
  );
  const lampMesh = new THREE.Mesh(track(new THREE.SphereGeometry(1.15, 12, 10)), lampMat);
  lampMesh.position.set(LIGHTHOUSE.x, 26.4, LIGHTHOUSE.z);
  scene.add(tower, band, lampMesh);

  const trunkMat = track(new THREE.MeshStandardMaterial({ color: 0x5a4032 }));
  const leafMat = track(new THREE.MeshStandardMaterial({ color: 0x2f6b3a }));
  const palmMat = track(new THREE.MeshStandardMaterial({ color: 0x3d8f4a }));
  const trunks = new THREE.InstancedMesh(track(new THREE.CylinderGeometry(0.18, 0.28, 1, 6)), trunkMat, city.trees.length);
  const leaves = new THREE.InstancedMesh(track(new THREE.ConeGeometry(1, 1, 7)), leafMat, city.trees.length);
  const palms = new THREE.InstancedMesh(track(new THREE.SphereGeometry(1, 7, 5)), palmMat, city.trees.length);
  city.trees.forEach((tree, i) => {
    const h = (tree.palm ? 3.2 : 2.4) * tree.s;
    dummy.position.set(tree.x, h / 2, tree.z);
    dummy.scale.set(tree.s, h, tree.s);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    if (tree.palm) {
      dummy.position.set(tree.x, h + 0.4, tree.z);
      dummy.scale.set(1.3 * tree.s, 0.7 * tree.s, 1.3 * tree.s);
      dummy.updateMatrix();
      palms.setMatrixAt(i, dummy.matrix);
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
    } else {
      dummy.position.set(tree.x, h + 1.1 * tree.s, tree.z);
      dummy.scale.set(1.5 * tree.s, 2.2 * tree.s, 1.5 * tree.s);
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      palms.setMatrixAt(i, dummy.matrix);
    }
  });
  trunks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  palms.instanceMatrix.needsUpdate = true;
  trunks.frustumCulled = false;
  leaves.frustumCulled = false;
  palms.frustumCulled = false;
  scene.add(trunks, leaves, palms);

  const poleMat = track(new THREE.MeshStandardMaterial({ color: 0x2a3038 }));
  const headMat = track(
    new THREE.MeshStandardMaterial({ color: 0xffd7a1, emissive: 0xffa24a, emissiveIntensity: 0.8 }),
  );
  const poles = new THREE.InstancedMesh(track(new THREE.BoxGeometry(0.14, 1, 0.14)), poleMat, city.lamps.length);
  const heads = new THREE.InstancedMesh(track(new THREE.BoxGeometry(0.55, 0.12, 0.28)), headMat, city.lamps.length);
  city.lamps.forEach((lamp, i) => {
    dummy.position.set(lamp.x, 2.15, lamp.z);
    dummy.scale.set(1, 4.3, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(lamp.x, 4.35, lamp.z);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
  });
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  poles.frustumCulled = false;
  heads.frustumCulled = false;
  scene.add(poles, heads);

  const actors: Actor[] = [];
  const slotCount = [0, 0, 0, 0, 0, 0];
  const MAX = [48, 28, 28, 20, 8, 6];
  for (const spawn of city.cars) {
    if (slotCount[spawn.type]! >= MAX[spawn.type]!) continue;
    actors.push({
      type: spawn.type,
      x: spawn.x,
      z: spawn.z,
      yaw: spawn.yaw,
      speed: spawn.ai === "traffic" ? 10 : 0,
      ai: spawn.ai,
      vertical: spawn.vertical,
      road: spawn.road,
      dir: spawn.dir,
      color: spawn.color,
      active: true,
      slot: slotCount[spawn.type]!,
      stuck: 0,
      lock: -99,
      lx: spawn.x,
      lz: spawn.z,
      vy: 0,
      yawRate: 0,
      wheel: 0,
      pitch: 0,
      roll: 0,
    });
    slotCount[spawn.type]! += 1;
  }
  for (let i = 0; i < 3; i++) {
    actors.push({
      type: 4,
      x: 0,
      z: -800,
      yaw: 0,
      speed: 0,
      ai: "chase",
      vertical: true,
      road: 5,
      dir: 1,
      color: 0xffffff,
      active: false,
      slot: slotCount[4]!,
      stuck: 0,
      lock: -99,
      lx: 0,
      lz: 0,
      vy: 0,
      yawRate: 0,
      wheel: 0,
      pitch: 0,
      roll: 0,
    });
    slotCount[4]! += 1;
  }

  const carMeshes: THREE.InstancedMesh[] = [];
  const carMat = track(
    new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.26,
      metalness: 0.55,
      clearcoat: 0.7,
      clearcoatRoughness: 0.14,
    }),
  );
  for (let type = 0; type < 6; type++) {
    const mesh = new THREE.InstancedMesh(track(buildCarGeometry(type)), carMat, MAX[type]!);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = slotCount[type]!;
    mesh.frustumCulled = false;
    scene.add(mesh);
    carMeshes.push(mesh);
  }
  for (const car of actors) {
    carMeshes[car.type]!.setColorAt(car.slot, color.setHex(car.color));
  }
  for (const mesh of carMeshes) {
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  const barMat = track(
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff2244, emissiveIntensity: 2.2 }),
  );
  const bars = new THREE.InstancedMesh(track(new THREE.BoxGeometry(0.85, 0.14, 0.32)), barMat, Math.max(1, slotCount[4]!));
  bars.frustumCulled = false;
  scene.add(bars);

  const pedGeo = (() => {
    const body = new THREE.BoxGeometry(0.38, 0.55, 0.22);
    body.translate(0, 1.05, 0);
    const head = new THREE.SphereGeometry(0.14, 8, 6);
    head.translate(0, 1.48, 0);
    const legs = new THREE.BoxGeometry(0.34, 0.6, 0.18);
    legs.translate(0, 0.4, 0);
    const merged = mergeGeometries([
      paint(body, new THREE.Color("#ffffff")),
      paint(head, new THREE.Color("#e0b394")),
      paint(legs, new THREE.Color("#242833")),
    ]);
    if (!merged) throw new Error("ped");
    return track(merged);
  })();
  const pedMat = track(new THREE.MeshStandardMaterial({ vertexColors: true }));
  const peds: Ped[] = city.peds.map((p) => {
    const ped: Ped = { ...p, x: 0, z: 0, yaw: 0, down: false };
    if (p.vertical) {
      ped.x = roadPos(p.road) + p.side * (ROAD_HALF + 1.9);
      ped.z = p.along;
      ped.yaw = p.dir === 1 ? Math.PI : 0;
    } else {
      ped.z = roadPos(p.road) + p.side * (ROAD_HALF + 1.9);
      ped.x = p.along;
      ped.yaw = p.dir === 1 ? -Math.PI / 2 : Math.PI / 2;
    }
    return ped;
  });
  const pedMesh = new THREE.InstancedMesh(pedGeo, pedMat, peds.length);
  const pedColors = [0x3dbeb6, 0xe23d3d, 0xf0b429, 0xf4efe4, 0x4c6cb3, 0xc4547a, 0x87a15b];
  peds.forEach((_, i) => pedMesh.setColorAt(i, color.setHex(pedColors[i % pedColors.length]!)));
  if (pedMesh.instanceColor) pedMesh.instanceColor.needsUpdate = true;
  pedMesh.frustumCulled = false;
  scene.add(pedMesh);

  const pickups = city.pickups.map((p) => ({ ...p, taken: false }));
  const gemMat = track(
    new THREE.MeshStandardMaterial({ color: 0xf0b429, emissive: 0xf0b429, emissiveIntensity: 0.7 }),
  );
  const gems = new THREE.InstancedMesh(track(new THREE.OctahedronGeometry(0.45, 0)), gemMat, pickups.length);
  gems.frustumCulled = false;
  scene.add(gems);

  const cloth = track(new THREE.MeshStandardMaterial({ color: 0x148f86 }));
  const dark = track(new THREE.MeshStandardMaterial({ color: 0x1b1e27 }));
  const skin = track(new THREE.MeshStandardMaterial({ color: 0xe0b394 }));
  const player = new THREE.Group();
  const legL = new THREE.Mesh(track(new THREE.BoxGeometry(0.2, 0.7, 0.2)), dark);
  legL.position.set(-0.12, 0.35, 0);
  const legR = legL.clone();
  legR.position.x = 0.12;
  const torso = new THREE.Mesh(track(new THREE.BoxGeometry(0.5, 0.58, 0.26)), cloth);
  torso.position.set(0, 0.98, 0);
  const armL = new THREE.Mesh(track(new THREE.BoxGeometry(0.14, 0.48, 0.14)), cloth);
  armL.position.set(-0.34, 0.98, 0);
  const armR = armL.clone();
  armR.position.x = 0.34;
  const skull = new THREE.Mesh(track(new THREE.SphereGeometry(0.17, 12, 10)), skin);
  skull.position.set(0, 1.46, 0);
  const visor = new THREE.Mesh(track(new THREE.BoxGeometry(0.2, 0.07, 0.08)), dark);
  visor.position.set(0, 1.48, 0.14);
  player.add(legL, legR, torso, armL, armR, skull, visor);
  scene.add(player);

  const shadowTex = (() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d");
    if (!g) return null;
    const grd = g.createRadialGradient(32, 32, 4, 32, 32, 30);
    grd.addColorStop(0, "rgba(0,0,0,0.45)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  })();
  const shadow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(1, 1)),
    track(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  shadow.name = "blob";
  scene.add(shadow);

  const headL = new THREE.SpotLight(0xfff4d2, 0, 46, 0.58, 0.48, 2);
  const headR = new THREE.SpotLight(0xfff4d2, 0, 46, 0.58, 0.48, 2);
  scene.add(headL, headL.target, headR, headR.target);
  const bulbMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xfff6dd,
      emissive: 0xfff1c2,
      emissiveIntensity: 1.4,
      roughness: 0.18,
    }),
  );
  const bulbL = new THREE.Mesh(track(new THREE.SphereGeometry(0.11, 8, 6)), bulbMat);
  const bulbR = bulbL.clone();
  bulbL.visible = false;
  bulbR.visible = false;
  scene.add(bulbL, bulbR);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(sky.geometry, sky.material));
  const sunWarm = new THREE.Color(0xff7a32);
  const sunWhite = new THREE.Color(0xfff3df);
  const horizonNight = new THREE.Color(0x141820);
  const horizonDay = new THREE.Color(0x93b6d8);
  const horizonSet = new THREE.Color(0xd2643a);
  const horizonColor = new THREE.Color();
  let envMap: THREE.Texture | null = null;
  let envStamp = -10;
  let renderTime = 0;
  let frames = 0;

  function applyAtmosphere(dt: number) {
    renderTime += dt;
    if (dt > 0) skyState.hour = (skyState.hour + (dt * 24) / DAY_SECONDS) % 24;
    const hour = skyState.hour;
    const y = Math.cos(((hour - 12) / 12) * Math.PI) * 0.9;
    const az = ((hour - 12) / 24) * Math.PI * 2 + 0.85;
    const horiz = Math.sqrt(Math.max(0.05, 1 - y * y));
    uSunDir.value.set(Math.sin(az) * horiz, y, Math.cos(az) * horiz).normalize();
    const elev = uSunDir.value.y;
    const day = smooth(elev, -0.04, 0.26);
    const night = 1 - smooth(elev, -0.18, 0.2);
    const sunset = smooth(Math.abs(elev), 0.34, 0.02) * smooth(elev, -0.12, 0.08);
    skyState.day = day;
    skyState.night = night;
    uNight.value = night;
    uTime.value = renderTime;
    sun.color.copy(sunWarm).lerp(sunWhite, smooth(elev, 0.02, 0.45));
    sun.intensity = smooth(elev, -0.03, 0.14) * (2.6 + 1.8 * smooth(elev, 0.06, 0.5));
    hemi.color.set(night > 0.55 ? 0x243456 : 0xa9c4ea);
    hemi.groundColor.set(night > 0.55 ? 0x12141a : 0x4a4036);
    hemi.intensity = 0.55 + day * 0.5 + night * 0.22;
    ambient.color.set(night > 0.55 ? 0x9aafd0 : 0xffe0c2);
    ambient.intensity = 0.14 + night * 0.22 + sunset * 0.05;
    const px = posX();
    const pz = posZ();
    sun.position.set(px, 2, pz).addScaledVector(uSunDir.value, 96);
    sun.target.position.set(px, 0, pz);
    sun.target.updateMatrixWorld();
    horizonColor.copy(horizonNight).lerp(horizonDay, day).lerp(horizonSet, sunset * 0.8);
    const fog = scene.fog as THREE.FogExp2;
    fog.color.copy(horizonColor);
    fog.density = 0.00115 + night * 0.00135 + sunset * 0.00085;
    renderer.toneMappingExposure = 1.02 + day * 0.22 - night * 0.28;
    scene.environmentIntensity = 0.32 + day * 0.6;
    headMat.emissiveIntensity = 0.2 + night * 3.1;
    lampMat.emissiveIntensity = 0.55 + night * 2.4;
    bulbMat.emissiveIntensity = 0.15 + night * 3.4;
    const nightDrive = driven ? night : 0;
    headL.intensity = nightDrive * 36;
    headR.intensity = nightDrive * 36;
    if (driven) {
      const fx = -Math.sin(driven.yaw);
      const fz = -Math.cos(driven.yaw);
      const rx = Math.cos(driven.yaw);
      const rz = -Math.sin(driven.yaw);
      headL.position.set(driven.x + fx * 2.2 + rx * 0.62, 0.72, driven.z + fz * 2.2 + rz * 0.62);
      headR.position.set(driven.x + fx * 2.2 - rx * 0.62, 0.72, driven.z + fz * 2.2 - rz * 0.62);
      headL.target.position.set(driven.x + fx * 20, 0.3, driven.z + fz * 20);
      headR.target.position.set(driven.x + fx * 20, 0.3, driven.z + fz * 20);
      headL.target.updateMatrixWorld();
      headR.target.updateMatrixWorld();
    }
    lampMesh.rotation.y = renderTime * 0.65;
    if (!envMap || renderTime - envStamp > 18) {
      envStamp = renderTime;
      const next = pmrem.fromScene(envScene, 0.04).texture;
      scene.environment = next;
      envMap?.dispose();
      envMap = next;
    }
  }

  for (const text of [
    ["NORTH BOWL", 37, 12, -252],
    ["BEACON ISLE", 0, 32, -528],
    ["LANTERN MARKET", 300, 16, 20],
    ["SOUTH HARBOR", 0, 12, 330],
    ["OAK PARK", -280, 10, 20],
  ] as const) {
    const sprite = makeLabel(text[0]);
    if (!sprite) continue;
    sprite.position.set(text[1], text[2], text[3]);
    scene.add(sprite);
  }

  const foot = { x: START.x, y: 0, z: START.z, vy: 0 };
  let bodyYaw = 0.2;
  let grounded = true;
  let driven: Actor | null = null;
  let camYaw = 0.15;
  let camPitch = 0.22;
  let camOffset = 0;
  let intro = 1;
  let wasStarted = false;
  let health = 100;
  let heat = 0;
  let cash = 0;
  let best = 0;
  let mask = 0;
  let hurtCd = 0;
  let hurtFlash = 0;
  let heatCd = 0;
  let shake = 0;
  let banner = "";
  let bannerT = 0;
  let tut = 0;
  let bustT = 0;
  let coolT = 0;
  let seq: "Busted" | "Wasted" | null = null;
  let seqT = 0;
  let didRespawn = false;
  let prevF = false;
  let prevH = false;
  let prevR = false;
  let prevSpace = false;
  let prevGpA = false;
  let actualSpeed = 0;
  let walkPhase = 0;
  let radio = 0;
  let simTime = 0;
  let hudAcc = 0;
  let district: DistrictId = "plaza";

  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { best?: number; mask?: number; cash?: number };
      best = parsed.best ?? 0;
      mask = parsed.mask ?? 0;
      cash = parsed.cash ?? 0;
    }
  } catch {
    /* ignore broken saves */
  }

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ best, mask, cash }));
    } catch {
      /* ignore */
    }
  }

  function say(text: string, time = 2.8) {
    banner = text;
    bannerT = time;
  }

  function popcount(n: number) {
    let c = 0;
    for (let i = 0; i < DISTRICT_ORDER.length; i++) if (n & (1 << i)) c += 1;
    return c;
  }

  function posX() {
    return driven ? driven.x : foot.x;
  }
  function posZ() {
    return driven ? driven.z : foot.z;
  }
  function speedNow() {
    return driven ? Math.abs(driven.speed) : actualSpeed;
  }

  live.getYaw = () => (driven ? driven.yaw : bodyYaw);
  live.getSpeed = () => speedNow();
  live.getMode = () => (driven ? "drive" : "foot");
  (window as unknown as { __harborDebug?: () => unknown }).__harborDebug = () => {
    const near = actors
      .map((car) => ({
        type: TYPES[car.type]!.name,
        ai: car.ai,
        active: car.active,
        d: Math.hypot(car.x - foot.x, car.z - foot.z),
        x: car.x,
        z: car.z,
      }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 5);
    return {
      foot,
      driven: driven ? TYPES[driven.type]!.name : null,
      speed: driven ? driven.speed : actualSpeed,
      simTime,
      frames,
      keys: [...keys],
      near,
      started: session.started,
    };
  };
  (window as unknown as { __harborTime?: (hour?: number) => number }).__harborTime = (hour?: number) => {
    if (typeof hour === "number") skyState.hour = ((hour % 24) + 24) % 24;
    return skyState.hour;
  };

  function nearestCar() {
    let bestCar: Actor | null = null;
    let bestD = 5.6;
    for (const car of actors) {
      if (!car.active || car.ai === "chase") continue;
      const reach = car.type === 5 ? 6.5 : 5.4;
      const d = Math.hypot(car.x - foot.x, car.z - foot.z);
      if (d < reach && d < bestD) {
        bestD = d;
        bestCar = car;
      }
    }
    return bestCar;
  }

  function placeCops() {
    const yaw = driven ? driven.yaw : bodyYaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const px = posX();
    const pz = posZ();
    let k = 0;
    for (const car of actors) {
      if (car.ai !== "chase") continue;
      if (k >= Math.min(3, heat)) {
        car.active = false;
        k += 1;
        continue;
      }
      const back = 34 + k * 12;
      const side = (k - 1) * 6;
      car.x = px - fx * back + rx * side;
      car.z = pz - fz * back + rz * side;
      car.yaw = yaw;
      car.speed = 18;
      car.active = true;
      resolveVehicleBody(car);
      k += 1;
    }
  }

  function addHeat(amount: number) {
    if (heatCd > 0 || seq) return;
    const prev = heat;
    heat = clamp(heat + amount, 0, 5);
    heatCd = 0.85;
    if (heat > prev) {
      say(heat === 1 ? "Wanted" : `Wanted · ${heat}`);
      placeCops();
    }
  }

  function hurt(amount: number) {
    if (hurtCd > 0 || seq || amount <= 0) return;
    health = Math.max(0, health - amount);
    hurtCd = 0.4;
    hurtFlash = 1;
    shake = Math.min(1.3, shake + amount * 0.025);
    crashSound(amount * 4);
    if (health <= 0) beginSequence("Wasted");
  }

  function respawn() {
    if (driven) {
      driven.ai = "parked";
      driven.speed *= 0.2;
      driven = null;
    }
    foot.x = START.x;
    foot.y = 0;
    foot.z = START.z;
    foot.vy = 0;
    bodyYaw = 0.2;
    camYaw = bodyYaw;
    health = 100;
    heat = 0;
    bustT = 0;
    for (const car of actors) if (car.ai === "chase") car.active = false;
    const keep = seq === "Busted" ? 0.8 : 0.9;
    cash = Math.floor(cash * keep);
    if (cash > best) best = cash;
    save();
  }

  function beginSequence(kind: "Busted" | "Wasted") {
    if (seq) return;
    seq = kind;
    seqT = 0;
    didRespawn = false;
    say(kind === "Busted" ? "Busted" : "Wasted", 2);
  }

  function exitCar(car: Actor) {
    const rx = Math.cos(car.yaw);
    const rz = -Math.sin(car.yaw);
    const fx = -Math.sin(car.yaw);
    const fz = -Math.cos(car.yaw);
    const spots = [
      [car.x + rx * 2.5, car.z + rz * 2.5],
      [car.x - rx * 2.5, car.z - rz * 2.5],
      [car.x - fx * 3.4, car.z - fz * 3.4],
    ];
    let sx = spots[0]![0]!;
    let sz = spots[0]![1]!;
    for (const spot of spots) {
      const hit = resolveCircle(spot[0]!, spot[1]!, 0.42);
      if (!hit.hit) {
        sx = spot[0]!;
        sz = spot[1]!;
        break;
      }
    }
    foot.x = sx;
    foot.z = sz;
    foot.y = 0;
    bodyYaw = car.yaw;
    camYaw = car.yaw;
    car.ai = "parked";
    driven = null;
  }

  function toggleVehicle() {
    if (seq) return;
    if (driven) {
      exitCar(driven);
      return;
    }
    const car = nearestCar();
    if (!car) return;
    driven = car;
    car.ai = "none";
    car.active = true;
    bodyYaw = car.yaw;
    camYaw = car.yaw;
    camOffset = 0;
    if (tut < 2) {
      say("A steers left, D right. Space drifts. F to get out.");
      tut = 2;
      bannerT = 6.5;
    }
  }

  const vehicleSpecs: VehicleSpec[] = TYPES.map((spec, type) => ({
    max: spec.max,
    len: spec.len,
    h: spec.h,
    boat: type === 5,
  }));
  const vehiclePhys: VehiclePhys[] = vehicleSpecs.map((spec) => physFor(spec));
  const velA: PlanarBasis = { x: 0, z: 0, fx: 0, fz: 0, lx: 0, lz: 0 };
  const velB: PlanarBasis = { x: 0, z: 0, fx: 0, fz: 0, lx: 0, lz: 0 };

  function dragMulAt(x: number, z: number, boat: boolean) {
    if (!boat && inWater(x, z)) return 7;
    if (onSand(x, z)) return 2.2;
    if (!boat && !onRoad(x, z) && !onBridge(x, z) && !onPier(x, z)) return 1.4;
    return 1;
  }

  function integrateVehicle(car: Actor, throttle: number, steer: number, hand: boolean, dt: number) {
    const spec = vehicleSpecs[car.type]!;
    stepVehicle(
      car,
      throttle,
      steer,
      hand,
      spec,
      vehiclePhys[car.type]!,
      surfaceGrip(car.x, car.z, spec.boat),
      dragMulAt(car.x, car.z, spec.boat),
      dt,
    );
  }

  function updateTraffic(car: Actor, dt: number) {
    const min = roadPos(0) + 18;
    const max = roadPos(10) - 18;
    if (car.vertical) {
      if (car.z > max && car.dir > 0) car.dir = -1;
      if (car.z < min && car.dir < 0) car.dir = 1;
    } else {
      if (car.x > max && car.dir > 0) car.dir = -1;
      if (car.x < min && car.dir < 0) car.dir = 1;
    }
    const along = car.vertical ? car.z : car.x;
    const crossIndex = clamp(Math.round(along / SPACING + 5), 0, 10);
    if (crossIndex !== car.lock && crossIndex >= 1 && crossIndex <= 9 && Math.abs(along - roadPos(crossIndex)) < 4.5) {
      car.lock = crossIndex;
      if (hash01(car.slot * 19 + (car.vertical ? 3 : 7), crossIndex) < 0.24) {
        const newDir = hash01(car.slot + 4, crossIndex * 5) < 0.5 ? 1 : -1;
        if (car.vertical) {
          car.vertical = false;
          car.road = crossIndex;
          car.dir = newDir;
          car.z = roadPos(crossIndex) + newDir * 2.55;
        } else {
          car.vertical = true;
          car.road = crossIndex;
          car.dir = newDir;
          car.x = roadPos(crossIndex) - newDir * 2.55;
        }
      }
    }
    const ahead = car.vertical
      ? { x: roadPos(car.road) - car.dir * 2.55, z: car.z + car.dir * 14 }
      : { x: car.x + car.dir * 14, z: roadPos(car.road) + car.dir * 2.55 };
    const desiredYaw = Math.atan2(-(ahead.x - car.x), -(ahead.z - car.z));
    car.yaw += clamp(angNorm(desiredYaw - car.yaw), -1.9 * dt, 1.9 * dt);
    let desiredSp = 12 + (car.slot % 5);
    const fx = -Math.sin(car.yaw);
    const fz = -Math.cos(car.yaw);
    for (const other of actors) {
      if (other === car || !other.active) continue;
      const dx = other.x - car.x;
      const dz = other.z - car.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 16) continue;
      const dot = dx * fx + dz * fz;
      if (dot > 0 && dist < 6.5) desiredSp = Math.min(desiredSp, 1.2);
      else if (dot > 0 && dist < 14) desiredSp = Math.min(desiredSp, Math.max(0, other.speed));
    }
    car.speed += (desiredSp - car.speed) * Math.min(1, 1.5 * dt);
    const cap = TYPES[car.type]!.max * terrainCap(car.x, car.z, false);
    if (car.speed > cap) car.speed = cap;
    car.vy *= Math.max(0, 1 - 5 * dt);
    car.yawRate *= Math.max(0, 1 - 6 * dt);
    const lx = -Math.cos(car.yaw);
    const lz = Math.sin(car.yaw);
    car.x += (fx * car.speed + lx * car.vy) * dt;
    car.z += (fz * car.speed + lz * car.vy) * dt;
  }

  function updateChase(car: Actor, dt: number) {
    const tx = posX();
    const tz = posZ();
    const desired = Math.atan2(-(tx - car.x), -(tz - car.z));
    const diff = angNorm(desired - car.yaw);
    const steer = clamp(diff / 0.5, -1, 1);
    const dist = Math.hypot(tx - car.x, tz - car.z);
    let throttle = Math.abs(diff) > 0.85 ? 0.2 : 1;
    if (dist < 7) throttle = 0.45;
    if (dist > 200) {
      placeCops();
      return;
    }
    integrateVehicle(car, throttle, steer, false, dt);
  }

  function step(dt: number) {
    simTime += dt;
    bannerT = Math.max(0, bannerT - dt);
    if (bannerT <= 0) banner = "";
    hurtCd = Math.max(0, hurtCd - dt);
    heatCd = Math.max(0, heatCd - dt);
    hurtFlash = Math.max(0, hurtFlash - dt * 1.6);
    shake = Math.max(0, shake - dt * 1.5);

    if (seq) {
      seqT += dt;
      if (!didRespawn && seqT > 0.85) {
        respawn();
        didRespawn = true;
      }
      if (seqT > 1.8) seq = null;
      return;
    }

    const fKey = keys.has("KeyF") || keys.has("KeyE");
    let wantToggle = (fKey && !prevF) || edges.action > 0;
    edges.action = 0;
    prevF = fKey;
    const hKey = keys.has("KeyH");
    if ((hKey && !prevH) || edges.horn > 0) {
      edges.horn = 0;
      honk();
    }
    prevH = hKey;
    const rKey = keys.has("KeyR");
    if ((rKey && !prevR) || edges.radio > 0) {
      edges.radio = 0;
      radio = (radio + 1) % RADIO.length;
      setStation(radio);
      say(RADIO[radio] ?? "Off", 1.6);
    }
    prevR = rKey;

    let gpAx = 0;
    let gpAy = 0;
    let gpGas = 0;
    let gpBrake = 0;
    let gpA = false;
    let gpHand = false;
    const pads = navigator.getGamepads?.();
    if (pads) {
      for (const gp of pads) {
        if (!gp) continue;
        const ax0 = gp.axes[0] ?? 0;
        const ax1 = gp.axes[1] ?? 0;
        if (Math.abs(ax0) > 0.18) gpAx += ax0;
        if (Math.abs(ax1) > 0.18) gpAy += -ax1;
        if (gp.buttons[0]?.pressed) gpA = true;
        if (gp.buttons[1]?.pressed) gpHand = true;
        if ((gp.buttons[7]?.value ?? 0) > 0.15) gpGas = 1;
        if ((gp.buttons[6]?.value ?? 0) > 0.15) gpBrake = 1;
      }
    }
    if (gpA && !prevGpA) wantToggle = true;
    prevGpA = gpA;
    if (wantToggle) toggleVehicle();

    if (session.started && tut === 0) {
      say("WASD to walk. Press F to take the red Banshee.");
      tut = 1;
      bannerT = 7;
    }

    const look = (keys.has("KeyQ") ? 1 : 0) - (keys.has("KeyE") ? 1 : 0) + joy.look;
    if (driven) camOffset += look * 1.5 * dt;
    else camYaw += look * 1.55 * dt;
    camOffset *= Math.max(0, 1 - dt * 0.45);

    if (!driven) {
      let forward =
        (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
      let right =
        (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
      forward += joy.y + gpAy;
      right += joy.x + gpAx;
      const mag = Math.hypot(forward, right);
      if (mag > 1) {
        forward /= mag;
        right /= mag;
      }
      const fx = -Math.sin(camYaw);
      const fz = -Math.cos(camYaw);
      const rx = Math.cos(camYaw);
      const rz = -Math.sin(camYaw);
      const wx = fx * forward + rx * right;
      const wz = fz * forward + rz * right;
      const moving = wx * wx + wz * wz > 0.0008;
      const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight") || joy.sprint > 0 || gpHand;
      const sp = (sprint ? 8.7 : 5.15) * footMul(foot.x, foot.z);
      if (moving) {
        bodyYaw = dampAngle(bodyYaw, Math.atan2(-wx, -wz), 14, dt);
        const beforeX = foot.x;
        const beforeZ = foot.z;
        foot.x += wx * sp * dt;
        foot.z += wz * sp * dt;
        const resolved = resolveCircle(foot.x, foot.z, 0.42);
        foot.x = resolved.x;
        foot.z = resolved.z;
        for (const car of actors) {
          if (!car.active) continue;
          const dx = foot.x - car.x;
          const dz = foot.z - car.z;
          const min = 0.5 + radiusOf(car.type);
          const dist = Math.hypot(dx, dz);
          if (dist < min && dist > 0.001) {
            foot.x = car.x + (dx / dist) * min;
            foot.z = car.z + (dz / dist) * min;
            if (Math.abs(car.speed) > 8) hurt((Math.abs(car.speed) - 6) * 0.7);
          }
        }
        actualSpeed = Math.hypot(foot.x - beforeX, foot.z - beforeZ) / dt;
        walkPhase += dt * sp;
      } else {
        actualSpeed = 0;
      }
      const space = keys.has("Space");
      if (space && !prevSpace && grounded) {
        foot.vy = 7.1;
        grounded = false;
      }
      prevSpace = space;
      foot.vy -= 22 * dt;
      foot.y += foot.vy * dt;
      if (foot.y <= 0) {
        foot.y = 0;
        foot.vy = 0;
        grounded = true;
      }
    } else {
      prevSpace = keys.has("Space");
      let steer = 0;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) steer += 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) steer -= 1;
      steer -= joy.x + gpAx;
      if (steerOverrideOn) steer = steerOverride;
      steer = clamp(steer, -1, 1);
      let throttle = 0;
      if (keys.has("KeyW") || keys.has("ArrowUp")) throttle += 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) throttle -= 1;
      throttle += joy.y + joy.gas - joy.brake + gpAy + gpGas - gpBrake;
      throttle = clamp(throttle, -1, 1);
      const before = driven.speed;
      integrateVehicle(driven, throttle, steer, keys.has("Space") || joy.hand > 0 || gpHand, dt);
      actualSpeed = Math.abs(driven.speed);
      if (Math.abs(before) > 8 && terrainCap(driven.x, driven.z, driven.type === 5) < 0.25 && Math.abs(driven.speed) < Math.abs(before) - 4) {
        hurt(6);
      }
    }

    for (const car of actors) {
      if (!car.active || car === driven) continue;
      if (car.ai === "traffic") updateTraffic(car, dt);
      else if (car.ai === "chase") updateChase(car, dt);
      else if (car.ai === "parked") {
        car.speed *= Math.max(0, 1 - 2.4 * dt);
        car.vy *= Math.max(0, 1 - 3 * dt);
        car.yawRate *= Math.max(0, 1 - 4 * dt);
        if (Math.abs(car.speed) < 0.2) car.speed = 0;
        const fx = -Math.sin(car.yaw);
        const fz = -Math.cos(car.yaw);
        const lx = -Math.cos(car.yaw);
        const lz = Math.sin(car.yaw);
        car.x += (fx * car.speed + lx * car.vy) * dt;
        car.z += (fz * car.speed + lz * car.vy) * dt;
      }
    }

    for (const car of actors) {
      if (!car.active) continue;
      const wall = resolveVehicleBody(car);
      if (!wall.hit) continue;
      const impact = applyWallImpulse(car, wall.nx, wall.nz);
      if (car === driven && impact > 7) {
        hurt((impact - 5) * 0.85);
        if (impact > 11) addHeat(1);
        shake = Math.min(1.3, shake + impact * 0.02);
      }
    }

    for (let i = 0; i < actors.length; i++) {
      const a = actors[i]!;
      if (!a.active) continue;
      for (let j = i + 1; j < actors.length; j++) {
        const b = actors[j]!;
        if (!b.active) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const min = radiusOf(a.type) + radiusOf(b.type);
        const dist = Math.hypot(dx, dz) || 0.0001;
        if (dist >= min) continue;
        const nx = dx / dist;
        const nz = dz / dist;
        const overlap = min - dist;
        const pushA = a.ai === "parked" ? 0.28 : 0.5;
        const pushB = b.ai === "parked" ? 0.28 : 0.5;
        a.x -= nx * overlap * pushA;
        a.z -= nz * overlap * pushA;
        b.x += nx * overlap * pushB;
        b.z += nz * overlap * pushB;
        writeWorldVelocity(a, velA);
        writeWorldVelocity(b, velB);
        const rel = (velA.x - velB.x) * nx + (velA.z - velB.z) * nz;
        if (rel > 0.2) {
          const ma = vehiclePhys[a.type]!.mass;
          const mb = vehiclePhys[b.type]!.mass;
          const impulse = ((1 + 0.12) * rel) / (1 / ma + 1 / mb);
          setWorldVelocity(a, velA.x - (impulse / ma) * nx, velA.z - (impulse / ma) * nz, velA);
          setWorldVelocity(b, velB.x + (impulse / mb) * nx, velB.z + (impulse / mb) * nz, velB);
          a.yawRate *= 0.92;
          b.yawRate *= 0.92;
          if ((a === driven || b === driven) && rel > 8) {
            hurt(rel * 0.22);
            if (rel > 14) addHeat(1);
          }
        }
      }
    }

    for (const ped of peds) {
      if (ped.down) continue;
      const sp = 1.35;
      if (ped.vertical) {
        ped.z += ped.dir * sp * dt;
        ped.x = roadPos(ped.road) + ped.side * (ROAD_HALF + 1.9);
        ped.yaw = ped.dir === 1 ? Math.PI : 0;
        if (ped.z > 345) ped.dir = -1;
        if (ped.z < -345) ped.dir = 1;
      } else {
        ped.x += ped.dir * sp * dt;
        ped.z = roadPos(ped.road) + ped.side * (ROAD_HALF + 1.9);
        ped.yaw = ped.dir === 1 ? -Math.PI / 2 : Math.PI / 2;
        if (ped.x > 345) ped.dir = -1;
        if (ped.x < -345) ped.dir = 1;
      }
      if (driven && Math.abs(driven.speed) > 7) {
        const d = Math.hypot(ped.x - driven.x, ped.z - driven.z);
        if (d < radiusOf(driven.type) + 0.45) {
          ped.down = true;
          addHeat(1);
          say("Watch the sidewalk");
        }
      }
    }

    const px = posX();
    const pz = posZ();
    for (const gem of pickups) {
      if (gem.taken) continue;
      const reach = driven ? 3 : 1.5;
      if (Math.hypot(gem.x - px, gem.z - pz) < reach) {
        gem.taken = true;
        cash += gem.amt;
        if (cash > best) best = cash;
        save();
        pickupSound();
        say(`+$${gem.amt}`);
      }
    }

    const id = districtAt(px, pz);
    if (id !== district) {
      district = id;
      const idx = DISTRICT_ORDER.indexOf(id);
      if (idx >= 0) {
        if ((mask & (1 << idx)) === 0) {
          mask |= 1 << idx;
          save();
          say(DISTRICT_NAMES[id]);
        } else if (bannerT < 0.2) {
          say(DISTRICT_NAMES[id], 1.8);
        }
      } else if (id === "bay" && bannerT < 0.2) {
        say("The Bay", 1.6);
      }
    }

    if (Math.abs(px) > 760 || Math.abs(pz) > 860) {
      if (driven) {
        driven.x = START.x;
        driven.z = START.z;
        driven.speed = 0;
      } else {
        foot.x = START.x;
        foot.z = START.z;
      }
    }

    let copClose = false;
    let copNear = false;
    const velocity = speedNow();
    for (const car of actors) {
      if (car.ai !== "chase" || !car.active) continue;
      const d = Math.hypot(car.x - px, car.z - pz);
      if (d < 105) copNear = true;
      if (d < 4.3 && velocity < 7) copClose = true;
      if (d > 210) placeCops();
    }
    if (heat > 0 && copClose) bustT += dt;
    else bustT = Math.max(0, bustT - dt);
    if (bustT > 1.3) beginSequence("Busted");
    if (heat > 0 && !copNear) {
      coolT += dt;
      if (coolT > 9) {
        heat -= 1;
        coolT = 0;
        say(heat === 0 ? "Got away clean" : "Heat is dropping");
        let shown = 0;
        for (const car of actors) {
          if (car.ai !== "chase") continue;
          shown += 1;
          if (shown > heat) car.active = false;
        }
      }
    } else coolT = 0;

    if (health < 100 && hurtCd <= 0) health = Math.min(100, health + 5 * dt);

    for (const car of actors) {
      const moved = Math.hypot(car.x - car.lx, car.z - car.lz);
      if (car.ai === "traffic" && moved < 0.04 && Math.abs(car.speed) > 1) car.stuck += dt;
      else car.stuck = 0;
      if (car.stuck > 1.5 && car.ai === "traffic") {
        car.dir *= -1;
        if (car.vertical) car.x = roadPos(car.road) - car.dir * 2.55;
        else car.z = roadPos(car.road) + car.dir * 2.55;
        car.yaw = car.vertical ? (car.dir === 1 ? Math.PI : 0) : car.dir === 1 ? -Math.PI / 2 : Math.PI / 2;
        car.speed = 6;
        car.stuck = 0;
      }
      car.lx = car.x;
      car.lz = car.z;
    }
  }

  function fadeAmount() {
    if (!seq) return 0;
    if (seqT < 0.35) return seqT / 0.35;
    if (seqT < 1.15) return 1;
    return clamp(1 - (seqT - 1.15) / 0.55, 0, 1);
  }

  function publishHud(force = false) {
    hudAcc += force ? 1 : 0;
    if (!force && hudAcc < 0.1) return;
    hudAcc = 0;
    const px = posX();
    const pz = posZ();
    const name = DISTRICT_NAMES[districtAt(px, pz)];
    let prompt = "";
    let vehicle = "";
    if (!seq) {
      if (driven) {
        vehicle = TYPES[driven.type]!.name;
        prompt = `F  Exit ${vehicle}`;
      } else {
        const near = nearestCar();
        if (near) prompt = `F  Enter ${TYPES[near.type]!.name}`;
      }
    }
    patchHud({
      booted: true,
      started: session.started,
      paused: session.paused,
      mode: driven ? "drive" : "foot",
      speed: driven ? driven.speed * 2.15 : 0,
      health,
      heat,
      cash,
      best,
      district: name,
      facing: facingLabel(camYaw),
      prompt,
      vehicle,
      banner,
      visited: popcount(mask),
      places: DISTRICT_ORDER.length,
      fade: fadeAmount(),
      fadeText: seq ?? "",
      radio: RADIO[radio] ?? "Off",
      hurt: hurtFlash,
      mask,
      clock: formatClock(skyState.hour),
      phase: phaseName(skyState.hour),
    });
  }

  function drawMap() {
    const ctx2 = map.getContext("2d");
    if (!ctx2) return;
    const w = map.width;
    const h = map.height;
    const px = posX();
    const pz = posZ();
    const span = driven ? 280 : 180;
    const scale = w / span;
    const toX = (x: number) => w / 2 + (x - px) * scale;
    const toY = (z: number) => h / 2 + (z - pz) * scale;
    ctx2.clearRect(0, 0, w, h);
    ctx2.fillStyle = "#14343c";
    ctx2.fillRect(0, 0, w, h);
    ctx2.fillStyle = "#1c2420";
    ctx2.fillRect(toX(-CITY_EDGE), toY(-CITY_EDGE), CITY_EDGE * 2 * scale, CITY_EDGE * 2 * scale);
    ctx2.fillStyle = "#245c34";
    ctx2.fillRect(toX(-360), toY(-150), 160 * scale, 320 * scale);
    ctx2.fillStyle = "#c2a36a";
    ctx2.fillRect(toX(-CITY_EDGE), toY(CITY_EDGE), (CITY_EDGE * 2) * scale, 50 * scale);
    ctx2.beginPath();
    ctx2.fillStyle = "#2f6a38";
    ctx2.arc(toX(ISLE.x), toY(ISLE.z), ISLE.r * scale, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.strokeStyle = "#3a414c";
    ctx2.lineWidth = Math.max(2, ROAD_HALF * 2 * scale * 0.7);
    ctx2.lineCap = "square";
    for (let i = 0; i <= 10; i++) {
      const c = roadPos(i);
      ctx2.beginPath();
      ctx2.moveTo(toX(c), toY(-360));
      ctx2.lineTo(toX(c), toY(360));
      ctx2.stroke();
      ctx2.beginPath();
      ctx2.moveTo(toX(-360), toY(c));
      ctx2.lineTo(toX(360), toY(c));
      ctx2.stroke();
    }
    ctx2.strokeStyle = "#6d6258";
    ctx2.lineWidth = 3;
    ctx2.beginPath();
    ctx2.moveTo(toX(0), toY(-330));
    ctx2.lineTo(toX(0), toY(-520));
    ctx2.stroke();
    ctx2.fillStyle = "#d7b15a";
    for (const gem of pickups) {
      if (gem.taken) continue;
      ctx2.fillRect(toX(gem.x) - 2, toY(gem.z) - 2, 4, 4);
    }
    for (const car of actors) {
      if (!car.active) continue;
      ctx2.fillStyle = car.ai === "chase" ? "#e23d3d" : car === driven ? "#f4efe4" : "#8fd0cb";
      ctx2.fillRect(toX(car.x) - 2, toY(car.z) - 2, 4, 4);
    }
    const yaw = driven ? driven.yaw : bodyYaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    ctx2.beginPath();
    ctx2.moveTo(w / 2 + fx * 9, h / 2 + fz * 9);
    ctx2.lineTo(w / 2 - fx * 6 + rx * 5, h / 2 - fz * 6 + rz * 5);
    ctx2.lineTo(w / 2 - fx * 6 - rx * 5, h / 2 - fz * 6 - rz * 5);
    ctx2.closePath();
    ctx2.fillStyle = "#f0b429";
    ctx2.fill();
  }

  function updateCamera(dt: number) {
    if (!session.started) {
      camYaw += dt * 0.09;
      intro = 1;
    } else if (!wasStarted) {
      camYaw = driven ? driven.yaw : bodyYaw;
      camPitch = 0.18;
      intro = 1;
    }
    wasStarted = session.started;
    if (session.started) intro = Math.max(0, intro - dt / 1.1);
    if (driven && session.started) camYaw = dampAngle(camYaw, driven.yaw + camOffset, 5.2, dt);

    const px = posX();
    const py = driven ? 0.8 : 1.2 + foot.y;
    const pz = posZ();
    const dist = (driven ? 8.4 : 6.6) + intro * 48;
    const height = (driven ? 2.8 : 2.3) + camPitch * 4.2 + intro * 22;
    const fx = -Math.sin(camYaw);
    const fz = -Math.cos(camYaw);
    const lookAhead = driven ? 6 : 1.2;
    let cx = px - fx * dist;
    let cy = py + height;
    let cz = pz - fz * dist;
    const tx = px + fx * lookAhead;
    const ty = py + 0.4;
    const tz = pz + fz * lookAhead;
    const dx = cx - px;
    const dy = cy - py;
    const dz = cz - pz;
    let clip = 1;
    for (let i = 1; i <= 8; i++) {
      const k = i / 8;
      const sx = px + dx * k;
      const sz = pz + dz * k;
      if (pointInside(sx, sz)) {
        clip = Math.max(0.18, (i - 1) / 8);
        break;
      }
    }
    cx = px + dx * clip;
    cy = py + dy * clip;
    cz = pz + dz * clip;
    const k = 1 - Math.exp(-7 * dt);
    camera.position.x += (cx - camera.position.x) * k;
    camera.position.y += (cy - camera.position.y) * k;
    camera.position.z += (cz - camera.position.z) * k;
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake * 0.35;
      camera.position.y += (Math.random() - 0.5) * shake * 0.25;
    }
    camera.lookAt(tx, ty, tz);
    const fov = 66 + Math.min(8, speedNow() * 0.12) + (driven && keys.has("Space") ? 2 : 0);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  function syncVisuals(dt: number) {
    player.visible = !driven;
    player.position.set(foot.x, foot.y, foot.z);
    player.rotation.y = bodyYaw + Math.PI;
    const swing = driven ? 0 : Math.sin(walkPhase * 1.3) * clamp(actualSpeed / 5, 0, 1);
    legL.rotation.x = swing * 0.7;
    legR.rotation.x = -swing * 0.7;
    armL.rotation.x = -swing * 0.45;
    armR.rotation.x = swing * 0.45;

    for (const car of actors) {
      dummy.rotation.order = "YXZ";
      dummy.position.set(car.x, (car.type === 5 ? 0.06 : 0.02) + Math.max(0, -car.pitch) * 0.35, car.z);
      dummy.rotation.set(car.pitch, car.yaw + Math.PI, car.roll);
      dummy.scale.setScalar(car.active ? 1 : 0);
      dummy.updateMatrix();
      carMeshes[car.type]!.setMatrixAt(car.slot, dummy.matrix);
    }
    dummy.rotation.order = "XYZ";
    dummy.rotation.set(0, 0, 0);
    for (const mesh of carMeshes) mesh.instanceMatrix.needsUpdate = true;

    let bar = 0;
    const flash = Math.sin(simTime * 14) > 0;
    barMat.emissive.set(flash ? 0xff2244 : 0x3377ff);
    for (const car of actors) {
      if (car.type !== 4) continue;
      dummy.position.set(car.x, 1.55, car.z);
      dummy.rotation.set(0, car.yaw + Math.PI, 0);
      dummy.scale.setScalar(car.active ? 1 : 0);
      dummy.updateMatrix();
      bars.setMatrixAt(bar, dummy.matrix);
      bar += 1;
    }
    bars.instanceMatrix.needsUpdate = true;

    peds.forEach((ped, i) => {
      dummy.position.set(ped.x, ped.down ? 0.25 : 0, ped.z);
      dummy.rotation.set(ped.down ? Math.PI / 2 : 0, ped.yaw + Math.PI, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      pedMesh.setMatrixAt(i, dummy.matrix);
    });
    pedMesh.instanceMatrix.needsUpdate = true;

    pickups.forEach((gem, i) => {
      const bob = gem.taken ? 0 : 0.8 + Math.sin(simTime * 2 + i) * 0.15;
      dummy.position.set(gem.x, bob, gem.z);
      dummy.rotation.set(0, simTime + i, 0);
      dummy.scale.setScalar(gem.taken ? 0 : 1);
      dummy.updateMatrix();
      gems.setMatrixAt(i, dummy.matrix);
    });
    gems.instanceMatrix.needsUpdate = true;

    const sx = posX();
    const sz = posZ();
    shadow.position.set(sx, 0.04, sz);
    shadow.scale.setScalar(driven ? 2.2 : 1.1);
    shadow.visible = skyState.night > 0.4;
    if (driven) {
      const fx = -Math.sin(driven.yaw);
      const fz = -Math.cos(driven.yaw);
      const rx = Math.cos(driven.yaw);
      const rz = -Math.sin(driven.yaw);
      bulbL.position.set(driven.x + fx * 2.15 + rx * 0.62, 0.62, driven.z + fz * 2.15 + rz * 0.62);
      bulbR.position.set(driven.x + fx * 2.15 - rx * 0.62, 0.62, driven.z + fz * 2.15 - rz * 0.62);
      bulbL.visible = true;
      bulbR.visible = true;
    } else {
      bulbL.visible = false;
      bulbR.visible = false;
    }

    sky.position.copy(camera.position);
    try {
      setDriveAudio(driven ? driven.speed : 0, !!driven);
      setSiren(heat > 0 && !seq);
      tickMusic();
    } catch {
      /* audio is optional */
    }
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || mesh === sky || mesh === ground || mesh.name === "blob") return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
  buildingMesh.castShadow = true;
  buildingMesh.receiveShadow = true;
  ground.receiveShadow = true;
  for (const mesh of carMeshes) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  player.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  tower.castShadow = true;
  deck.castShadow = true;
  deck.receiveShadow = true;

  resize();
  map.width = 256;
  map.height = 256;

  let acc = 0;
  let last = performance.now();
  const onResize = () => resize();
  const onKeyDown = (event: KeyboardEvent) => {
    keys.add(event.code);
    if (event.code === "Space" || event.code.startsWith("Arrow")) event.preventDefault();
    if (event.code === "Escape" && !event.repeat && session.started) {
      session.paused = !session.paused;
      patchHud({ paused: session.paused });
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    keys.delete(event.code);
  };
  const clearKeys = () => keys.clear();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 2) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
  };
  const onMove = (event: PointerEvent) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    if (driven) camOffset -= dx * 0.005;
    else camYaw -= dx * 0.005;
    camPitch = clamp(camPitch + dy * 0.0032, -0.15, 0.9);
  };
  const onUp = () => {
    dragging = false;
  };
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", clearKeys);
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  const onVis = () => {
    if (document.hidden) keys.clear();
    else unlockAudio();
  };
  document.addEventListener("visibilitychange", onVis);

  let dead = false;
  renderer.setAnimationLoop((now) => {
    if (dead) return;
    const frameDt = Math.min(0.2, (now - last) / 1000);
    last = now;
    frames += 1;
    if (session.started && !session.paused) {
      acc += frameDt;
      let steps = 0;
      while (acc >= STEP && steps < 12) {
        step(STEP);
        acc -= STEP;
        steps += 1;
      }
      if (steps === 12) acc = 0;
    } else acc = 0;
    updateCamera(frameDt);
    syncVisuals(frameDt);
    applyAtmosphere(session.started && session.paused ? 0 : frameDt);
    drawMap();
    hudAcc += frameDt;
    publishHud(false);
    renderer.render(scene, camera);
  });

  publishHud(true);
  patchHud({ booted: true, bootError: "", best, cash, visited: popcount(mask) });

  return () => {
    dead = true;
    renderer.setAnimationLoop(null);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", clearKeys);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.removeEventListener("visibilitychange", onVis);
    keys.clear();
    renderer.dispose();
    pmrem.dispose();
    envMap?.dispose();
    for (const item of disposables) item.dispose();
  };
}
