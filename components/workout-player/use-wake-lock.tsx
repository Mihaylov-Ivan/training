"use client";

import { useEffect } from "react";

/** Keep screen awake during active sessions when supported. */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined") return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function request() {
      try {
        if (!("wakeLock" in navigator)) return;
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // permission / battery policies may deny
      }
    }

    void request();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && enabled && !cancelled) {
        void request();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release();
    };
  }, [enabled]);
}
