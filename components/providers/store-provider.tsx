"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import {
  createClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { loadCloudSnapshot } from "@/lib/supabase/sync";

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const setHydrated = useAppStore((s) => s.setHydrated);
  const hydrated = useAppStore((s) => s.hydrated);
  const ensureSchedule = useAppStore((s) => s.ensureSchedule);
  const profile = useAppStore((s) => s.profile);
  const setAuthUserId = useAppStore((s) => s.setAuthUserId);
  const hydrateFromCloud = useAppStore((s) => s.hydrateFromCloud);
  const authUserId = useAppStore((s) => s.authUserId);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    if (!hydrated && useAppStore.persist.hasHydrated()) {
      setHydrated(true);
    }
  }, [hydrated, setHydrated]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!isSupabaseConfigured()) {
        if (!cancelled) setBootstrapping(false);
        return;
      }
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getClaims();
        const userId = (data?.claims?.sub as string | undefined) ?? null;
        if (cancelled) return;
        setAuthUserId(userId);

        if (userId) {
          const cloud = await loadCloudSnapshot(userId);
          if (!cancelled && cloud?.profile?.onboarding_complete) {
            // Prefer cloud when it has an onboarded profile
            hydrateFromCloud(cloud);
          } else if (
            !cancelled &&
            cloud &&
            !cloud.profile &&
            useAppStore.getState().profile?.user_id === userId
          ) {
            // Local profile already for this user — keep it
          } else if (
            !cancelled &&
            useAppStore.getState().profile &&
            useAppStore.getState().profile?.user_id !== userId
          ) {
            // Stale local-user data from before auth — clear onboarding until cloud/local for this uuid
            useAppStore.getState().resetDemo();
            setAuthUserId(userId);
          }
        }
      } catch (err) {
        console.error("[auth bootstrap]", err);
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    }

    if (hydrated) void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [hydrated, setAuthUserId, hydrateFromCloud]);

  useEffect(() => {
    if (hydrated && !bootstrapping && profile?.onboarding_complete) {
      ensureSchedule();
      useAppStore.getState().scanPendingMissedSessions();
    }
  }, [hydrated, bootstrapping, profile, ensureSchedule, authUserId]);

  if (!hydrated || bootstrapping) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  return <>{children}</>;
}
