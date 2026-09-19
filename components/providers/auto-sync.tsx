"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/lib/store/app-store";

const PUSH_MS = 30_000;

/**
 * Local state is authoritative while the app is open.
 * Background sync only pushes local changes; cloud pulls happen during
 * bootstrap/manual sync and are merged local-first by the store.
 */
export function AutoSync() {
  const pushToCloud = useAppStore((s) => s.pushToCloud);
  const running = useRef(false);

  useEffect(() => {
    let disposed = false;

    const push = async () => {
      if (disposed || running.current) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      running.current = true;
      try {
        await pushToCloud();
      } catch {
        // Store exposes sync failure without replacing local edits.
      } finally {
        running.current = false;
      }
    };

    const initial = window.setTimeout(() => void push(), 1200);
    const interval = window.setInterval(() => void push(), PUSH_MS);
    const onOnline = () => void push();
    const onVisible = () => {
      if (document.visibilityState === "visible") void push();
    };
    const onFocus = () => void push();

    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pushToCloud]);

  return null;
}
