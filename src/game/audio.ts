let ac: AudioContext | null = null;
let master: GainNode | null = null;
let hum: OscillatorNode | null = null;
let humGain: GainNode | null = null;
let sirenA: OscillatorNode | null = null;
let sirenB: OscillatorNode | null = null;
let sirenGainA: GainNode | null = null;
let sirenGainB: GainNode | null = null;
let bed: AudioBufferSourceNode | null = null;
let station = 0;
let nextNote = 0;
let crashAt = 0;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ac) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ac = new Ctor();
    master = ac.createGain();
    master.gain.value = 0.8;
    master.connect(ac.destination);
    hum = ac.createOscillator();
    hum.type = "sawtooth";
    hum.frequency.value = 48;
    humGain = ac.createGain();
    humGain.gain.value = 0;
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 240;
    hum.connect(filter);
    filter.connect(humGain);
    humGain.connect(master);
    hum.start();
    sirenA = ac.createOscillator();
    sirenB = ac.createOscillator();
    sirenA.frequency.value = 680;
    sirenB.frequency.value = 860;
    sirenGainA = ac.createGain();
    sirenGainB = ac.createGain();
    sirenGainA.gain.value = 0;
    sirenGainB.gain.value = 0;
    sirenA.connect(sirenGainA);
    sirenB.connect(sirenGainB);
    sirenGainA.connect(master);
    sirenGainB.connect(master);
    sirenA.start();
    sirenB.start();
    const noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    bed = ac.createBufferSource();
    bed.buffer = noise;
    bed.loop = true;
    const bedFilter = ac.createBiquadFilter();
    bedFilter.type = "lowpass";
    bedFilter.frequency.value = 180;
    const bedGain = ac.createGain();
    bedGain.gain.value = 0.015;
    bed.connect(bedFilter);
    bedFilter.connect(bedGain);
    bedGain.connect(master);
    bed.start();
  }
  return ac;
}

export function unlockAudio() {
  try {
    const context = ctx();
    if (context && context.state === "suspended") void context.resume();
  } catch {
    ac = null;
  }
}

export function setDriveAudio(speed: number, driving: boolean) {
  if (!hum || !humGain || !ac) return;
  const mag = Math.abs(speed);
  const target = driving && mag > 0.4 ? Math.min(0.045, 0.008 + mag * 0.0009) : 0;
  humGain.gain.setTargetAtTime(target, ac.currentTime, 0.08);
  hum.frequency.setTargetAtTime(42 + mag * 3.1, ac.currentTime, 0.08);
}

export function setSiren(on: boolean) {
  if (!ac || !sirenGainA || !sirenGainB) return;
  if (!on) {
    sirenGainA.gain.setTargetAtTime(0, ac.currentTime, 0.1);
    sirenGainB.gain.setTargetAtTime(0, ac.currentTime, 0.1);
    return;
  }
  const s = (Math.sin(ac.currentTime * 7) + 1) / 2;
  sirenGainA.gain.setTargetAtTime(0.02 * s, ac.currentTime, 0.05);
  sirenGainB.gain.setTargetAtTime(0.02 * (1 - s), ac.currentTime, 0.05);
}

export function blip(freq: number, dur: number, vol: number, type: OscillatorType = "square") {
  if (!ac || !master) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  o.connect(g);
  g.connect(master);
  o.start();
  o.stop(ac.currentTime + dur + 0.02);
}

export function honk() {
  try {
    blip(196, 0.18, 0.05, "square");
    blip(164, 0.22, 0.03, "sawtooth");
  } catch {
    /* ignore */
  }
}

export function crashSound(force: number) {
  if (!ac) return;
  if (ac.currentTime - crashAt < 0.12) return;
  crashAt = ac.currentTime;
  try {
    blip(70 + Math.min(80, force), 0.28, Math.min(0.08, 0.02 + force * 0.001), "sawtooth");
  } catch {
    /* ignore */
  }
}

export function pickupSound() {
  try {
    blip(520, 0.08, 0.04, "triangle");
    blip(780, 0.12, 0.03, "triangle");
  } catch {
    /* ignore */
  }
}

const NIGHT = [220, 261, 311, 196, 247, 330, 174];
const TIDE = [146, 174, 196, 164, 220, 130];

export function setStation(index: number) {
  station = index;
  nextNote = 0;
}

export function tickMusic() {
  if (!ac || !master || station === 0) return;
  const now = ac.currentTime;
  if (nextNote < now) nextNote = now + 0.02;
  const scale = station === 1 ? NIGHT : TIDE;
  let guard = 0;
  while (nextNote < now + 0.25 && guard < 4) {
    const freq = scale[Math.floor(nextNote * 3) % scale.length] ?? 220;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = station === 1 ? "triangle" : "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, nextNote);
    g.gain.exponentialRampToValueAtTime(0.03, nextNote + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, nextNote + (station === 1 ? 0.2 : 0.28));
    o.connect(g);
    g.connect(master);
    o.start(nextNote);
    o.stop(nextNote + 0.32);
    nextNote += station === 1 ? 0.24 : 0.34;
    guard += 1;
  }
}

export const RADIO = ["Off", "Night Drive", "Low Tide"];
