"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store/app-store";

export function OfflineBanner() {
  const syncStatus = useAppStore((s) => s.syncStatus);
  const cloudSyncError = useAppStore((s) => s.cloudSyncError);
  const syncNow = useAppStore((s) => s.syncNow);
  const profile = useAppStore((s) => s.profile);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!profile?.onboarding_complete) return null;

  const base =
    "safe-top pointer-events-none fixed inset-x-0 top-0 z-[60] flex min-h-7 items-end justify-center px-3 pb-1 text-center text-xs font-medium";

  if (offline || syncStatus === "offline") {
    return (
      <div role="status" className={`${base} bg-warning-soft/95 text-warning`}>
        Offline — changes stay on this device and sync when you reconnect
      </div>
    );
  }

  if (syncStatus === "error" || cloudSyncError) {
    return (
      <div role="status" className={`${base} bg-danger-soft/95 text-danger`}>
        <span className="pointer-events-auto inline-flex items-center gap-2">
          <span>Sync issue — local changes are safe</span>
          <button
            type="button"
            className="font-semibold underline underline-offset-2"
            onClick={() => void syncNow()}
          >
            Retry
          </button>
        </span>
      </div>
    );
  }

  return null;
}
