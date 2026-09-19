"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import {
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui/primitives";

function labelForKind(
  kind: "rest" | "hold" | "work",
  done: boolean,
  restLabel?: string,
): string {
  if (kind === "rest") {
    return done
      ? `${restLabel ?? "Rest"} complete`
      : restLabel ?? "Rest";
  }
  if (kind === "hold") return done ? "Hold complete" : "Hold";
  return done ? "Time complete" : "Work";
}

export function RestTimer({
  sound,
  haptics,
  onWorkComplete,
}: {
  sound: boolean;
  haptics: boolean;
  onWorkComplete?: () => void;
}) {
  const activeTimer = useAppStore((state) => state.activeTimer);
  const adjustRest = useAppStore((state) => state.adjustRest);
  const skipRest = useAppStore((state) => state.skipRest);
  const [now, setNow] = useState(0);
  const buzzedFor = useRef<string | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  const elapsed =
    activeTimer && now > 0
      ? (now - new Date(activeTimer.rest_started_at).getTime()) / 1000
      : 0;
  const isWork =
    activeTimer?.kind === "hold" || activeTimer?.kind === "work";
  const prep = isWork ? activeTimer?.prep_seconds ?? 0 : 0;
  const inPrep = Boolean(activeTimer) && isWork && elapsed < prep;
  const workElapsed = Math.max(0, elapsed - prep);
  const remaining = activeTimer
    ? inPrep
      ? Math.max(0, Math.ceil(prep - elapsed))
      : Math.max(
          0,
          Math.ceil(activeTimer.rest_duration_seconds - workElapsed),
        )
    : 0;
  const done =
    Boolean(activeTimer) &&
    now > 0 &&
    elapsed >= (activeTimer?.rest_duration_seconds ?? 0) + prep;
  const timerKey = activeTimer
    ? `${activeTimer.kind}:${activeTimer.rest_started_at}:${activeTimer.rest_duration_seconds}:${prep}`
    : null;

  useEffect(() => {
    if (
      !activeTimer ||
      !done ||
      !timerKey ||
      buzzedFor.current === timerKey
    ) {
      return;
    }
    buzzedFor.current = timerKey;
    if (haptics && typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(
        isWork ? [100, 50, 100, 50, 100] : [80, 40, 80],
      );
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
        // Audio is optional.
      }
    }
  }, [activeTimer, done, haptics, isWork, sound, timerKey]);

  if (!activeTimer) return null;

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const label = inPrep
    ? "Get ready"
    : labelForKind(
        activeTimer.kind,
        done,
        activeTimer.rest_label,
      );

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center pt-6">
      <p className="text-sm font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p
        className={`mt-3 font-semibold tabular-nums tracking-tight ${
          inPrep ? "text-6xl text-accent" : "text-7xl"
        }`}
      >
        {mm}:{ss}
      </p>
      {inPrep ? (
        <p className="mt-2 text-center text-sm text-muted">
          Position yourself. The{" "}
          {activeTimer.kind === "hold" ? "hold" : "work"} timer starts
          automatically.
        </p>
      ) : null}

      {!isWork && !done ? (
        <div className="mt-5 flex gap-3">
          <SecondaryButton onClick={() => adjustRest(-15)}>
            −15s
          </SecondaryButton>
          <SecondaryButton onClick={() => adjustRest(15)}>
            +15s
          </SecondaryButton>
        </div>
      ) : null}

      <div className="mt-auto w-full space-y-3 pt-6">
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
                disabled={inPrep}
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
            Continue
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
