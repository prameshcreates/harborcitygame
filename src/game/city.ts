export const SPACING = 72;
export const CENTER = 5;
export const ROAD_HALF = 7.5;
export const CITY_EDGE = 378;
export const START = { x: -30, z: -26 };

export type DistrictId =
  | "plaza"
  | "finance"
  | "midtown"
  | "market"
  | "harbor"
  | "beach"
  | "park"
  | "yards"
  | "stadium"
  | "isle"
  | "bay";

export const DISTRICT_ORDER: DistrictId[] = [
  "plaza",
  "finance",
  "midtown",
  "market",
  "harbor",
  "beach",
  "park",
  "yards",
  "stadium",
  "isle",
];

export const DISTRICT_NAMES: Record<DistrictId, string> = {
  plaza: "Civic Plaza",
  finance: "Financial District",
  midtown: "Midtown",
  market: "Lantern Market",
  harbor: "South Harbor",
  beach: "Pier Beach",
  park: "Oak Park",
  yards: "The Yards",
  stadium: "North Bowl",
  isle: "Beacon Isle",
  bay: "The Bay",
};

export type AABB = { minX: number; maxX: number; minZ: number; maxZ: number };
export type Building = { x: number; z: number; w: number; h: number; d: number; color: number };
export type CarSpawn = {
  type: number;
  x: number;
  z: number;
  yaw: number;
  ai: "traffic" | "parked";
  vertical: boolean;
  road: number;
  dir: number;
  color: number;
};
export type TreeSpawn = { x: number; z: number; s: number; palm: boolean };
export type LampSpawn = { x: number; z: number };
export type PickupSpawn = { x: number; z: number; amt: number };
export type PedSpawn = { vertical: boolean; road: number; dir: number; side: number; along: number };
export type Pier = { x: number; z0: number; z1: number; w: number };

export const PIERS: Pier[] = [
  { x: -90, z0: 368, z1: 450, w: 8 },
  { x: 28, z0: 368, z1: 468, w: 10 },
  { x: 150, z0: 368, z1: 442, w: 7 },
];

export const ISLE = { x: 0, z: -545, r: 82 };
export const LIGHTHOUSE = { x: 0, z: -528 };
export const STADIUM = { x0: 16, x1: 58, z0: -270, z1: -234 };
export const FOUNTAIN = { x: -36, z: -48, r: 3.3 };

export function roadPos(i: number) {
  return (i - CENTER) * SPACING;
}

export function axisDist(v: number) {
  const m = (((v + SPACING / 2) % SPACING) + SPACING) % SPACING - SPACING / 2;
  return Math.abs(m);
}

export function onRoad(x: number, z: number) {
  return Math.min(axisDist(x), axisDist(z)) < ROAD_HALF - 0.15;
}

export function onBridge(x: number, z: number) {
  return Math.abs(x) < 8 && z < -326 && z > -516;
}

export function onIsle(x: number, z: number) {
  const dx = x - ISLE.x;
  const dz = z - ISLE.z;
  return dx * dx + dz * dz < ISLE.r * ISLE.r;
}

export function onSand(x: number, z: number) {
  return z > CITY_EDGE && z < CITY_EDGE + 54 && Math.abs(x) < CITY_EDGE + 36;
}

export function onPier(x: number, z: number) {
  for (const p of PIERS) {
    if (Math.abs(x - p.x) < p.w * 0.5 && z > p.z0 && z < p.z1) return true;
  }
  return false;
}

export function inWater(x: number, z: number) {
  if (onBridge(x, z) || onIsle(x, z) || onSand(x, z) || onPier(x, z)) return false;
  return Math.abs(x) > CITY_EDGE || Math.abs(z) > CITY_EDGE;
}

export function terrainCap(x: number, z: number, boat: boolean) {
  const water = inWater(x, z);
  if (boat) {
    if (water) return 1;
    if (onSand(x, z) || onPier(x, z)) return 0.72;
    return 0.3;
  }
  if (water) return 0.16;
  if (onSand(x, z)) return 0.5;
  if (onPier(x, z) || onBridge(x, z) || onIsle(x, z)) return 1;
  if (!onRoad(x, z) && Math.abs(x) < CITY_EDGE && Math.abs(z) < CITY_EDGE) return 0.55;
  return 1;
}

export function surfaceGrip(x: number, z: number, boat: boolean) {
  if (boat) {
    if (inWater(x, z)) return 0.62;
    if (onSand(x, z) || onPier(x, z)) return 0.38;
    return 0.2;
  }
  if (inWater(x, z)) return 0.1;
  if (onSand(x, z)) return 0.38;
  if (onPier(x, z)) return 0.7;
  if (onBridge(x, z) || onRoad(x, z)) return 1;
  if (onIsle(x, z)) return 0.78;
  return 0.52;
}

export function footMul(x: number, z: number) {
  if (inWater(x, z)) return 0.3;
  if (onSand(x, z)) return 0.88;
  return 1;
}

export function districtAt(x: number, z: number): DistrictId {
  if (onIsle(x, z)) return "isle";
  if (inWater(x, z)) return "bay";
  if (x > -70 && x < -6 && z > -70 && z < -6) return "plaza";
  if (z > 230 && x > 80) return "beach";
  if (z > 230 && x > -180) return "harbor";
  if (z < -210 && x > -20 && x < 190) return "stadium";
  if (z < -185 && x < -20) return "yards";
  if (x < -200 && z > -150 && z < 170) return "park";
  if (x > 200) return "market";
  if (Math.abs(x) < 168 && Math.abs(z) < 168) return "finance";
  if (Math.abs(x) > 250 || Math.abs(z) > 250) return "midtown";
  return "midtown";
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTE: Record<string, number[]> = {
  finance: [0x9aafc4, 0x6d88a3, 0xc5d0dc, 0x4d6d8c, 0x8aa0b8],
  midtown: [0xcbbba6, 0x8d7968, 0xdcd6cb, 0x667480, 0xb7a394],
  market: [0x1b2230, 0x241c33, 0x102e36, 0x2a1a28, 0x14283a],
  uptown: [0xe2d0bc, 0xb7c3a4, 0xd0927a, 0xeee8dc, 0xc4b09a],
  yards: [0x6d675c, 0x8d5d3c, 0x4c5854, 0x7d7364],
  harbor: [0x5c6e78, 0x3d4c56, 0x7c6848, 0x4e5c68],
  beach: [0xf0d2b0, 0xe7b8c8, 0xc9d7c4, 0xf3e2cf],
  stadium: [0x6e7c8a, 0x8a9098, 0x556068],
  default: [0xd0c6b8, 0x8a7d70, 0x6e8494],
};

function heightFor(dist: DistrictId, rand: () => number) {
  switch (dist) {
    case "finance":
      return 34 + rand() * 58;
    case "market":
      return 8 + rand() * 18;
    case "beach":
      return 3.2 + rand() * 4.2;
    case "yards":
      return 6 + rand() * 9;
    case "harbor":
      return 7 + rand() * 11;
    case "stadium":
      return 8 + rand() * 12;
    default:
      return 8 + rand() * 16;
  }
}

function inStadium(x: number, z: number) {
  return x > STADIUM.x0 - 6 && x < STADIUM.x1 + 6 && z > STADIUM.z0 - 8 && z < STADIUM.z1 + 8;
}

export type CityData = {
  buildings: Building[];
  boxes: AABB[];
  cars: CarSpawn[];
  trees: TreeSpawn[];
  lamps: LampSpawn[];
  pickups: PickupSpawn[];
  peds: PedSpawn[];
};

function pushBox(boxes: AABB[], x: number, z: number, w: number, d: number) {
  boxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
}

export function buildCity(): CityData {
  const buildings: Building[] = [];
  const boxes: AABB[] = [];
  const cars: CarSpawn[] = [];
  const trees: TreeSpawn[] = [];
  const lamps: LampSpawn[] = [];
  const pickups: PickupSpawn[] = [];
  const peds: PedSpawn[] = [];

  const addBuilding = (x: number, z: number, w: number, h: number, d: number, color: number) => {
    buildings.push({ x, z, w, h, d, color });
    pushBox(boxes, x, z, w, d);
  };

  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      const x0 = roadPos(i) + ROAD_HALF + 3.5;
      const x1 = roadPos(i + 1) - ROAD_HALF - 3.5;
      const z0 = roadPos(j) + ROAD_HALF + 3.5;
      const z1 = roadPos(j + 1) - ROAD_HALF - 3.5;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const dist = districtAt(cx, cz);
      const rand = mulberry32(i * 131 + j * 17 + 9);
      const bw = x1 - x0;
      const bd = z1 - z0;

      if (dist === "plaza") {
        trees.push({ x: x0 + 4, z: z0 + 4, s: 1.1, palm: false });
        trees.push({ x: x1 - 4, z: z0 + 5, s: 0.9, palm: false });
        trees.push({ x: x0 + 5, z: z1 - 4, s: 1, palm: false });
        trees.push({ x: x1 - 5, z: z1 - 5, s: 1.15, palm: false });
        continue;
      }
      if (inStadium(cx, cz)) continue;

      if (dist === "park") {
        const n = 6;
        for (let k = 0; k < n; k++) {
          trees.push({
            x: x0 + 3 + rand() * (bw - 6),
            z: z0 + 3 + rand() * (bd - 6),
            s: 0.85 + rand() * 0.7,
            palm: false,
          });
        }
        continue;
      }

      const colors = PALETTE[dist] ?? PALETTE.default;
      const cols = 2;
      const rows = 2;
      const gapX = dist === "finance" ? 4.2 : 2.8;
      const gapZ = dist === "finance" ? 3.4 : 2.8;
      const cw = (bw - gapX * (cols - 1)) / cols;
      const cd = (bd - gapZ * (rows - 1)) / rows;

      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (rand() < (dist === "beach" ? 0.28 : 0.16)) continue;
          const shrinkW = dist === "finance" ? 0.86 + rand() * 0.14 : 0.68 + rand() * 0.3;
          const shrinkD = dist === "yards" ? 0.9 : 0.66 + rand() * 0.32;
          const w = Math.max(4, cw * shrinkW);
          const d = Math.max(4, cd * shrinkD);
          const h = heightFor(dist, rand);
          const x = x0 + c * (cw + gapX) + (cw - w) / 2 + w / 2;
          const z = z0 + r * (cd + gapZ) + (cd - d) / 2 + d / 2;
          const color = colors[Math.floor(rand() * colors.length)] ?? 0xc8c2b6;
          addBuilding(x, z, w, h, d, color);
        }
      }

      if (dist === "beach") {
        for (let k = 0; k < 3; k++) {
          trees.push({
            x: x0 + rand() * bw,
            z: z0 + rand() * bd,
            s: 0.8 + rand() * 0.4,
            palm: true,
          });
        }
      }
    }
  }

  addBuilding(22, -562, 8, 5.2, 7, 0xe6d3bf);
  addBuilding(-26, -558, 9, 4.6, 8, 0xd0927a);
  addBuilding(10, -578, 7, 6, 7, 0xf4efe4);

  for (let z = -250; z <= 430; z += 26) {
    trees.push({ x: -8 + Math.sin(z * 0.1) * 6, z, s: 0.9, palm: true });
  }

  pushBox(boxes, FOUNTAIN.x, FOUNTAIN.z, FOUNTAIN.r * 2, FOUNTAIN.r * 2);
  const wall = 3.1;
  boxes.push({ minX: STADIUM.x0, maxX: STADIUM.x1, minZ: STADIUM.z0, maxZ: STADIUM.z0 + wall });
  boxes.push({ minX: STADIUM.x0, maxX: STADIUM.x0 + 14, minZ: STADIUM.z1 - wall, maxZ: STADIUM.z1 });
  boxes.push({ minX: STADIUM.x1 - 14, maxX: STADIUM.x1, minZ: STADIUM.z1 - wall, maxZ: STADIUM.z1 });
  boxes.push({ minX: STADIUM.x0, maxX: STADIUM.x0 + wall, minZ: STADIUM.z0, maxZ: STADIUM.z1 });
  boxes.push({ minX: STADIUM.x1 - wall, maxX: STADIUM.x1, minZ: STADIUM.z0, maxZ: STADIUM.z1 });
  pushBox(boxes, LIGHTHOUSE.x, LIGHTHOUSE.z, 5.2, 5.2);

  const paint = [0xe23d3d, 0xf0b429, 0x3dbeb6, 0xf4efe4, 0x4c6cb3, 0xd07a3a, 0x222833, 0xc4547a, 0x87a15b, 0x8e6cc4];
  for (let i = 1; i <= 9; i++) {
    for (const dir of [-1, 1] as const) {
      const z = dir === 1 ? -250 + i * 24 : 250 - i * 20;
      cars.push({
        type: (i + (dir > 0 ? 0 : 1)) % 4,
        x: roadPos(i) - dir * 2.55,
        z,
        yaw: dir === 1 ? Math.PI : 0,
        ai: "traffic",
        vertical: true,
        road: i,
        dir,
        color: paint[(i * 3 + (dir > 0 ? 1 : 4)) % paint.length]!,
      });
      const x = dir === 1 ? -250 + i * 28 : 230 - i * 22;
      cars.push({
        type: (i + 2) % 4,
        x,
        z: roadPos(i) + dir * 2.55,
        yaw: dir === 1 ? -Math.PI / 2 : Math.PI / 2,
        ai: "traffic",
        vertical: false,
        road: i,
        dir,
        color: paint[(i * 5 + 2) % paint.length]!,
      });
    }
  }

  cars.push(
    { type: 1, x: -27.5, z: -22.2, yaw: 0.5, ai: "parked", vertical: false, road: 4, dir: 1, color: 0xe23d3d },
    { type: 0, x: -52, z: -30, yaw: 1.1, ai: "parked", vertical: false, road: 4, dir: 1, color: 0x3dbeb6 },
    { type: 2, x: -50, z: -54, yaw: 0.15, ai: "parked", vertical: false, road: 4, dir: 1, color: 0xf4efe4 },
    { type: 3, x: -20, z: -54, yaw: 2.6, ai: "parked", vertical: false, road: 4, dir: 1, color: 0xf0b429 },
    { type: 4, x: -54, z: -40, yaw: -0.4, ai: "parked", vertical: false, road: 4, dir: 1, color: 0xffffff },
    { type: 5, x: 28, z: CITY_EDGE + 12, yaw: 0, ai: "parked", vertical: true, road: 5, dir: 1, color: 0xf4efe4 },
    { type: 5, x: 0, z: -430, yaw: Math.PI, ai: "parked", vertical: true, road: 5, dir: -1, color: 0x3dbeb6 },
  );
  for (let k = 0; k < 6; k++) {
    cars.push({
      type: k % 4,
      x: -160 + k * 32,
      z: CITY_EDGE + 10,
      yaw: Math.PI,
      ai: "parked",
      vertical: true,
      road: 5,
      dir: 1,
      color: paint[k % paint.length]!,
    });
  }
  for (let k = 0; k < 4; k++) {
    cars.push({
      type: k % 3,
      x: -270,
      z: -30 + k * 16,
      yaw: Math.PI / 2,
      ai: "parked",
      vertical: false,
      road: 3,
      dir: 1,
      color: paint[(k + 4) % paint.length]!,
    });
  }

  for (let i = 0; i <= 10; i++) {
    const c = roadPos(i);
    for (let t = -348; t <= 348; t += 46) {
      if (axisDist(t) < ROAD_HALF + 4) continue;
      lamps.push({ x: c + ROAD_HALF + 0.15, z: t });
      lamps.push({ x: c - ROAD_HALF - 0.15, z: t });
      lamps.push({ x: t, z: c + ROAD_HALF + 0.15 });
      lamps.push({ x: t, z: c - ROAD_HALF - 0.15 });
    }
  }

  const loot: PickupSpawn[] = [
    { x: -44, z: -34, amt: 100 },
    { x: 40, z: 20, amt: 80 },
    { x: -280, z: 10, amt: 150 },
    { x: 280, z: -20, amt: 120 },
    { x: 120, z: 300, amt: 90 },
    { x: -40, z: 320, amt: 110 },
    { x: 40, z: -250, amt: 200 },
    { x: -250, z: -280, amt: 130 },
    { x: 12, z: -560, amt: 250 },
    { x: 180, z: 400, amt: 70 },
    { x: -120, z: 80, amt: 60 },
    { x: 90, z: -80, amt: 140 },
    { x: 300, z: 120, amt: 160 },
    { x: -300, z: 140, amt: 100 },
    { x: 0, z: -400, amt: 180 },
    { x: 220, z: -200, amt: 90 },
  ];
  pickups.push(...loot);

  for (let n = 0; n < 26; n++) {
    peds.push({
      vertical: n % 2 === 0,
      road: 1 + (n % 9),
      dir: n % 3 === 0 ? -1 : 1,
      side: n % 2 === 0 ? 1 : -1,
      along: -320 + ((n * 67) % 640),
    });
  }

  return { buildings, boxes, cars, trees, lamps, pickups, peds };
}
