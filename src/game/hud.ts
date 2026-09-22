import { create } from "zustand";

export type HudState = {
  booted: boolean;
  bootError: string;
  started: boolean;
  paused: boolean;
  mode: "foot" | "drive";
  speed: number;
  health: number;
  heat: number;
  cash: number;
  best: number;
  district: string;
  facing: string;
  prompt: string;
  vehicle: string;
  banner: string;
  visited: number;
  places: number;
  fade: number;
  fadeText: string;
  radio: string;
  hurt: number;
  mask: number;
  clock: string;
  phase: string;
};

const initial: HudState = {
  booted: false,
  bootError: "",
  started: false,
  paused: false,
  mode: "foot",
  speed: 0,
  health: 100,
  heat: 0,
  cash: 0,
  best: 0,
  district: "Civic Plaza",
  facing: "N",
  prompt: "",
  vehicle: "",
  banner: "",
  visited: 0,
  places: 10,
  fade: 0,
  fadeText: "",
  radio: "Off",
  hurt: 0,
  mask: 0,
  clock: "15:42",
  phase: "Day",
};

export const useHud = create<HudState>(() => initial);

export function patchHud(partial: Partial<HudState>) {
  useHud.setState(partial);
}
