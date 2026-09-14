"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { isSupabaseConfigured } from "@/lib/supabase/client";

const PUSH_MS = 45_000;
const FULL_SYNC_MS = 120_000;

/**
 * Keeps local Zustand state continuously reconciled with Supabase
 * while the user is online and onboarded.
 */
export function AutoSync() {
  const profile = useAppStore((s) => s.profile);
  const authUserId = useAppStore((s) => s.authUserId);
  const syncNow = useAppStore((s) => s.syncNow);
  const pushToCloud = useAppStore((s) => s.pushToCloud);
  const pullFromCloud = useAppStore((s) => s.pullFromCloud);
  const busy = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    if (!profile?.onboarding_complete || !authUserId) return;

    let cancelled = false;

    async function run(kind: "full" | "push") {
      if (cancelled || busy.current) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        useAppStore.setState({ syncStatus: "offline" });
        return;
      }
      busy.current = true;
      try {
        if (kind === "full") await syncNow();
        else await pushToCloud();
      } catch {
        // errors recorded on store
      } finally {
        busy.current = false;
      }
    }

    // Immediate reconcile after mount / auth
    void run("full");

    const pushTimer = window.setInterval(() => void run("push"), PUSH_MS);
    const fullTimer = window.setInterval(() => void run("full"), FULL_SYNC_MS);

    const onOnline = () => void run("full");
    const onOffline = () =>
      useAppStore.setState({ syncStatus: "offline" });
    const onVisible = () => {
      if (document.visibilityState === "visible") void run("full");
    };
    const onFocus = () => void run("push");

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(pushTimer);
      window.clearInterval(fullTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [
    profile?.onboarding_complete,
    authUserId,
    syncNow,
    pushToCloud,
    pullFromCloud,
  ]);

  return null;
}
