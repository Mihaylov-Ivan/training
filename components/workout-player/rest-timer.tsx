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

function labelForKind(kind: "rest" | "hold" | "work", done: boolean): string {
  if (kind === "rest") return done ? "Rest complete" : "Rest";
  if (kind === "hold") return done ? "Hold complete" : "Hold";
  return done ? "Time complete" : "Timer";
}

export function RestTimer({
  sound,
  haptics,
  onWorkComplete,
}: {
  sound: boolean;
  haptics: boolean;
  /** Called when a hold/work countdown finishes and the user confirms. */
  onWorkComplete?: () => void;
}) {
  const activeTimer = useAppStore((s) => s.activeTimer);
  const adjustRest = useAppStore((s) => s.adjustRest);
  const skipRest = useAppStore((s) => s.skipRest);
  const now = useSyncExternalStore(subscribeNow, getNow, getServerNow);
  const buzzedFor = useRef<string | null>(null);

  const timerKey = activeTimer
    ? `${activeTimer.kind}:${activeTimer.rest_started_at}:${activeTimer.rest_duration_seconds}`
    : null;

  const elapsed =
    activeTimer && now
      ? (now - new Date(activeTimer.rest_started_at).getTime()) / 1000
      : 0;
  const remaining = activeTimer
    ? Math.max(0, Math.ceil(activeTimer.rest_duration_seconds - elapsed))
    : 0;
  const done = Boolean(activeTimer) && now > 0 && remaining <= 0;
  const isWork =
    activeTimer?.kind === "hold" || activeTimer?.kind === "work";

  useEffect(() => {
    if (!done || !timerKey || buzzedFor.current === timerKey) return;
    buzzedFor.current = timerKey;
    if (haptics && typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(isWork ? [100, 50, 100, 50, 100] : [80, 40, 80]);
    }
    if (sound) {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = isWork ? 660 : 880;
        gain.gain.value = 0.05;
        osc.start();
        osc.stop(ctx.currentTime + (isWork ? 0.25 : 0.15));
      } catch {
        // ignore audio failures
      }
    }
  }, [done, timerKey, sound, haptics, isWork]);

  if (!activeTimer) return null;

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const label = labelForKind(activeTimer.kind, done);

  return (
    <div className="mt-10 flex flex-1 flex-col items-center">
      <p className="text-sm font-medium uppercase tracking-wide text-muted">
        {label}
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
        {isWork ? (
          done ? (
            <PrimaryButton
              className="w-full"
              onClick={() => {
                skipRest();
                onWorkComplete?.();
              }}
            >
              Complete set
            </PrimaryButton>
          ) : (
            <>
              <PrimaryButton
                className="w-full"
                onClick={() => {
                  skipRest();
                  onWorkComplete?.();
                }}
              >
                Finish early & complete set
              </PrimaryButton>
              <SecondaryButton className="w-full" onClick={skipRest}>
                Cancel timer
              </SecondaryButton>
            </>
          )
        ) : done ? (
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
