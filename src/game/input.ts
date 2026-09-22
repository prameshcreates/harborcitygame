export const keys = new Set<string>();

export const joy = {
  x: 0,
  y: 0,
  gas: 0,
  brake: 0,
  hand: 0,
  sprint: 0,
  look: 0,
};

export const edges = {
  action: 0,
  horn: 0,
  radio: 0,
};

export let steerOverride = 0;
export let steerOverrideOn = false;

export const live = {
  getYaw: (): number => 0,
  getSpeed: (): number => 0,
  getMode: (): string => "foot",
};

export function pulseAction() {
  edges.action += 1;
}

export function pulseHorn() {
  edges.horn += 1;
}

export function pulseRadio() {
  edges.radio += 1;
}

export function installProbe() {
  if (typeof window === "undefined") return;
  window.__controlsTest = {
    getYaw: () => live.getYaw(),
    getSpeed: () => live.getSpeed(),
    setKeys(codes: string[]) {
      keys.clear();
      steerOverrideOn = false;
      for (const code of codes) keys.add(code);
    },
    setSteer(v: number) {
      steerOverride = v;
      steerOverrideOn = true;
    },
  };
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setSteer?: (v: number) => void;
      setKeys?: (codes: string[]) => void;
    };
  }
}
