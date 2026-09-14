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

  if (offline || syncStatus === "offline") {
    return (
      <div
        role="status"
        className="bg-warning-soft px-4 py-2 text-center text-sm font-medium text-warning"
      >
        Offline — changes will sync when you reconnect
      </div>
    );
  }

  if (syncStatus === "error" || cloudSyncError) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-3 bg-danger-soft px-4 py-2 text-center text-sm font-medium text-danger"
      >
        <span>Sync issue{cloudSyncError ? `: ${cloudSyncError}` : ""}</span>
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => void syncNow()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (syncStatus === "syncing") {
    return (
      <div
        role="status"
        className="bg-accent-soft px-4 py-1.5 text-center text-xs font-medium text-accent"
      >
        Syncing with cloud…
      </div>
    );
  }

  return null;
}
