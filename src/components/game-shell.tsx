import { useEffect, useRef, useState } from "react";
import { Pause, Star } from "lucide-react";
import { DISTRICT_NAMES, DISTRICT_ORDER } from "../game/city";
import { useHud } from "../game/hud";
import { installProbe, joy, pulseAction, pulseHorn, pulseRadio } from "../game/input";
import { session } from "../game/session";
import { unlockAudio } from "../game/audio";

function startRun() {
  session.started = true;
  session.paused = false;
  unlockAudio();
  useHud.setState({ started: true, paused: false });
}

function HoldButton({
  label,
  className,
  onHold,
}: {
  label: string;
  className?: string;
  onHold: (down: number) => void;
}) {
  return (
    <button
      type="button"
      className={`hold-btn ${className ?? ""}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onHold(1);
      }}
      onPointerUp={() => onHold(0)}
      onPointerCancel={() => onHold(0)}
    >
      {label}
    </button>
  );
}

function Stick() {
  const ref = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let active = -1;
    let originX = 0;
    let originY = 0;
    const max = 46;
    const setFrom = (clientX: number, clientY: number) => {
      const dx = clientX - originX;
      const dy = clientY - originY;
      const mag = Math.hypot(dx, dy) || 1;
      const scale = Math.min(1, mag / max);
      joy.x = (dx / mag) * scale;
      joy.y = (-dy / mag) * scale;
      setKnob({ x: joy.x * max, y: -joy.y * max });
    };
    const down = (event: PointerEvent) => {
      active = event.pointerId;
      const rect = el.getBoundingClientRect();
      originX = rect.left + rect.width / 2;
      originY = rect.top + rect.height / 2;
      el.setPointerCapture(event.pointerId);
      setFrom(event.clientX, event.clientY);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== active) return;
      setFrom(event.clientX, event.clientY);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== active) return;
      active = -1;
      joy.x = 0;
      joy.y = 0;
      setKnob({ x: 0, y: 0 });
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      joy.x = 0;
      joy.y = 0;
      joy.gas = 0;
      joy.brake = 0;
      joy.hand = 0;
      joy.sprint = 0;
      joy.look = 0;
    };
  }, []);
  return (
    <div ref={ref} className="stick" aria-label="Move">
      <div className="stick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

export function GameShell() {
  const viewRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const hud = useHud();

  useEffect(() => {
    installProbe();
    const view = viewRef.current;
    const map = mapRef.current;
    if (!view || !map) return;
    let cleanup = () => {};
    let dead = false;
    void import("../game/engine").then((mod) => {
      if (dead) return;
      try {
        cleanup = mod.mount(view, map);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The city failed to start";
        useHud.setState({ bootError: message, booted: true });
      }
    });
    return () => {
      dead = true;
      cleanup();
    };
  }, []);

  const visited = (index: number) => (hud.mask & (1 << index)) !== 0;

  return (
    <main className="game-root">
      <canvas ref={viewRef} className="game-canvas" aria-label="Harbor City" />
      <div className="vignette" />
      <div className="minimap-card" aria-hidden="true">
        <canvas ref={mapRef} />
      </div>

      <div className="pointer-events-none absolute inset-0 z-20">
        <header className="pointer-events-none absolute top-0 right-0 left-0 flex items-start justify-between gap-3 p-4">
          <div>
            <p className="font-display hidden text-sm tracking-widest text-primary sm:block">HARBOR CITY</p>
            <h1 className="font-display text-xl leading-none sm:text-2xl">
              {hud.district}
              <span className="ml-2 text-primary">{hud.facing}</span>
            </h1>
            <p className="mt-1 text-sm text-muted">
              {hud.clock} · {hud.phase}
            </p>
            <p className="text-sm text-muted">
              {hud.visited}/{hud.places} districts
            </p>
            <div className="mt-2 h-2 w-36 overflow-hidden rounded-full bg-surface">
              <div className="h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, hud.health))}%` }} />
            </div>
            <div className="mt-2 flex gap-1 text-primary">
              {Array.from({ length: 5 }, (_, index) => (
                <Star key={index} className="size-4" fill={index < hud.heat ? "currentColor" : "none"} />
              ))}
            </div>
          </div>
          <div className="pointer-events-auto flex flex-col items-end gap-2">
            <p className="font-display text-2xl leading-none">${hud.cash.toLocaleString()}</p>
            <p className="text-sm text-muted">{hud.radio}</p>
            {hud.started ? (
              <button
                type="button"
                className="hold-btn"
                aria-label="Pause"
                onClick={() => {
                  session.paused = true;
                  useHud.setState({ paused: true });
                }}
              >
                <Pause className="size-4" />
              </button>
            ) : null}
          </div>
        </header>

        {hud.banner ? (
          <div className="banner-pop pointer-events-none absolute top-36 left-1/2 -translate-x-1/2 rounded-lg border border-border bg-surface/90 px-4 py-2 text-center">
            <p className="font-display text-lg tracking-wide">{hud.banner}</p>
          </div>
        ) : null}

        {hud.prompt ? (
          <div className="hud-prompt rounded-lg border border-border bg-surface/90 px-4 py-2 text-center">
            <p className="font-display tracking-wide">{hud.prompt}</p>
          </div>
        ) : null}

        {hud.mode === "drive" && hud.started ? (
          <div className="hud-speed">
            <p className="font-display text-4xl leading-none tabular-nums">{Math.abs(Math.round(hud.speed))}</p>
            <p className="text-sm text-muted">{hud.vehicle} · mph</p>
          </div>
        ) : null}
      </div>

      {hud.started && !hud.paused ? (
        <div className="touch-controls">
          <Stick />
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <HoldButton label="Look L" onHold={(down) => (joy.look = down ? 1 : 0)} />
              <HoldButton label="Look R" onHold={(down) => (joy.look = down ? -1 : 0)} />
            </div>
            <div className="flex gap-2">
              {hud.mode === "foot" ? (
                <HoldButton label="Run" className="primary" onHold={(down) => (joy.sprint = down)} />
              ) : (
                <HoldButton label="Drift" onHold={(down) => (joy.hand = down)} />
              )}
              <button type="button" className="hold-btn primary" onPointerDown={() => pulseAction()}>
                {hud.mode === "drive" ? "Exit" : "Enter"}
              </button>
            </div>
            {hud.mode === "drive" ? (
              <div className="flex gap-2">
                <HoldButton label="Brake" className="danger" onHold={(down) => (joy.brake = down)} />
                <HoldButton label="Gas" className="primary" onHold={(down) => (joy.gas = down)} />
              </div>
            ) : (
              <div className="flex gap-2">
                <button type="button" className="hold-btn" onPointerDown={() => pulseHorn()}>
                  Horn
                </button>
                <button type="button" className="hold-btn" onPointerDown={() => pulseRadio()}>
                  Radio
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {hud.hurt > 0.02 ? (
        <div className="pointer-events-none absolute inset-0 z-30 bg-danger" style={{ opacity: Math.min(0.45, hud.hurt * 0.4) }} />
      ) : null}
      {hud.fade > 0.02 ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-bg" style={{ opacity: hud.fade }}>
          <p className="font-display text-5xl tracking-widest">{hud.fadeText}</p>
        </div>
      ) : null}

      {!hud.started ? (
        <div className="absolute inset-0 z-30 flex items-end justify-center overflow-y-auto bg-bg/70 p-4 sm:items-center">
          <section className="w-full max-w-md rounded-lg border border-border bg-surface/95 p-6">
            <p className="font-display text-sm tracking-widest text-primary">OPEN WORLD</p>
            <h2 className="font-display text-5xl leading-none">HARBOR CITY</h2>
            <p className="mt-3 text-muted">
              Walk the blocks, take any car, and drive until the sun drops. Headlights and windows come on after dark. Cars have weight — they grip, slide, and shove.
            </p>
            {hud.bootError ? <p className="mt-3 text-danger">{hud.bootError}</p> : null}
            <button type="button" className="mt-5 w-full rounded-lg bg-primary px-4 py-3 font-display text-xl tracking-wide text-bg" onClick={startRun}>
              Start
            </button>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-fg">WASD</dt>
                <dd className="text-muted">Walk and drive</dd>
              </div>
              <div>
                <dt className="text-fg">Drag</dt>
                <dd className="text-muted">Look around</dd>
              </div>
              <div>
                <dt className="text-fg">F</dt>
                <dd className="text-muted">Enter or exit</dd>
              </div>
              <div>
                <dt className="text-fg">A / D</dt>
                <dd className="text-muted">Steer left / right</dd>
              </div>
              <div>
                <dt className="text-fg">Space</dt>
                <dd className="text-muted">Jump or drift</dd>
              </div>
              <div>
                <dt className="text-fg">H / R</dt>
                <dd className="text-muted">Horn / radio</dd>
              </div>
            </dl>
            {hud.best > 0 ? <p className="mt-4 text-sm text-muted">Best haul ${hud.best.toLocaleString()}</p> : null}
          </section>
        </div>
      ) : null}

      {hud.started && hud.paused ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg/75 p-4">
          <section className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
            <h2 className="font-display text-4xl leading-none">Paused</h2>
            <p className="mt-2 text-muted">
              {hud.visited} of {hud.places} districts found. Cash stays on this browser.
            </p>
            <ul className="mt-4 grid grid-cols-2 gap-2 text-sm">
              {DISTRICT_ORDER.map((id, index) => (
                <li key={id} className={visited(index) ? "text-fg" : "text-muted"}>
                  {visited(index) ? "Found" : "Hidden"} · {DISTRICT_NAMES[id]}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-5 w-full rounded-lg bg-primary px-4 py-3 font-display text-xl text-bg"
              onClick={() => {
                session.paused = false;
                useHud.setState({ paused: false });
              }}
            >
              Resume
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
