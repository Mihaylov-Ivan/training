"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { PrimaryButton, SecondaryButton } from "@/components/ui/primitives";

function subscribeNow(cb: () => void) {
  const id = window.setInterval(cb, 250);
  return () => window.clearInterval(id);
}

function getNow() {
  return Date.now();
}

function getServerNow() {
  return 0;
}

export function RestTimer({
  sound,
  haptics,
}: {
  sound: boolean;
  haptics: boolean;
}) {
  const activeTimer = useAppStore((s) => s.activeTimer);
  const adjustRest = useAppStore((s) => s.adjustRest);
  const skipRest = useAppStore((s) => s.skipRest);
  const now = useSyncExternalStore(subscribeNow, getNow, getServerNow);
  const buzzedFor = useRef<string | null>(null);

  const timerKey = activeTimer
    ? `${activeTimer.rest_started_at}:${activeTimer.rest_duration_seconds}`
    : null;

  const elapsed = activeTimer && now
    ? (now - new Date(activeTimer.rest_started_at).getTime()) / 1000
    : 0;
  const remaining = activeTimer
    ? Math.max(0, Math.ceil(activeTimer.rest_duration_seconds - elapsed))
    : 0;
  const done = Boolean(activeTimer) && now > 0 && remaining <= 0;

  useEffect(() => {
    if (!done || !timerKey || buzzedFor.current === timerKey) return;
    buzzedFor.current = timerKey;
    if (haptics && typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([80, 40, 80]);
    }
    if (sound) {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.05;
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } catch {
        // ignore audio failures
      }
    }
  }, [done, timerKey, sound, haptics]);

  if (!activeTimer) return null;

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="mt-10 flex flex-1 flex-col items-center">
      <p className="text-sm font-medium uppercase tracking-wide text-muted">
        {done ? "Rest complete" : "Rest"}
      </p>
      <p
        className={`mt-4 font-semibold tabular-nums tracking-tight ${
          done ? "animate-pulse text-accent" : ""
        } text-7xl`}
        aria-live="polite"
        aria-label={`${remaining} seconds remaining`}
      >
        {mm}:{ss}
      </p>
      <div className="mt-8 flex gap-3">
        <SecondaryButton
          aria-label="Subtract 15 seconds"
          onClick={() => adjustRest(-15)}
        >
          −15 s
        </SecondaryButton>
        <SecondaryButton
          aria-label="Add 15 seconds"
          onClick={() => adjustRest(15)}
        >
          +15 s
        </SecondaryButton>
      </div>
      <div className="mt-auto w-full space-y-3 pt-10">
        {done ? (
          <PrimaryButton className="w-full" onClick={skipRest}>
            Start next set
          </PrimaryButton>
        ) : (
          <SecondaryButton className="w-full" onClick={skipRest}>
            Skip rest
          </SecondaryButton>
        )}
      </div>
    </div>
  );
}
