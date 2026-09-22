"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { LOCAL_USER_ID } from "@/lib/types";
import { CURRENT_SCHEDULE_RESET_VERSION } from "@/lib/training/schedule-reset";
import {
  createClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { loadCloudSnapshot, queueOrSync, syncProfile } from "@/lib/supabase/sync";

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const setHydrated = useAppStore((s) => s.setHydrated);
  const hydrated = useAppStore((s) => s.hydrated);
  const ensureSchedule = useAppStore((s) => s.ensureSchedule);
  const resetFutureSchedule = useAppStore((s) => s.resetFutureSchedule);
  const profile = useAppStore((s) => s.profile);
  const setAuthUserId = useAppStore((s) => s.setAuthUserId);
  const hydrateFromCloud = useAppStore((s) => s.hydrateFromCloud);
  const adoptAuthUser = useAppStore((s) => s.adoptAuthUser);
  const authUserId = useAppStore((s) => s.authUserId);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    if (!hydrated && useAppStore.persist.hasHydrated()) {
      setHydrated(true);
    }
  }, [hydrated, setHydrated]);

  useEffect(() => {
    if (!hydrated) return;

    if (!isSupabaseConfigured()) {
      setBootstrapping(false);
      return;
    }

    let cancelled = false;
    let loadGen = 0;
    const supabase = createClient();

    async function loadForUser(userId: string | null) {
      if (cancelled) return;
      const gen = ++loadGen;
      setBootstrapping(true);
      setAuthUserId(userId);

      try {
        if (!userId) return;

        const cloud = await loadCloudSnapshot(userId);
        if (cancelled || gen !== loadGen) return;

        const local = useAppStore.getState();
        const cloudOnboarded = Boolean(cloud?.profile?.onboarding_complete);
        const cloudLooksSetup =
          Boolean(cloud?.profile) &&
          ((cloud?.progressionStates?.length ?? 0) > 0 ||
            (cloud?.cycles?.length ?? 0) > 0 ||
            cloudOnboarded);

        if (
          cloudLooksSetup &&
          cloud?.profile &&
          local.profile?.onboarding_complete &&
          local.profile.user_id === LOCAL_USER_ID
        ) {
          // Preserve genuine offline/guest work from this device before merging
          // an existing cloud account. adoptAuthUser changes ids synchronously.
          adoptAuthUser(userId);
        }

        if (cloudLooksSetup && cloud?.profile) {
          const profile = cloudOnboarded
            ? cloud.profile
            : { ...cloud.profile, onboarding_complete: true };
          hydrateFromCloud({ ...cloud, profile });
          if (!cloudOnboarded) {
            queueOrSync(() => syncProfile(profile));
          }
          return;
        }

        // Cloud empty, but this device already finished onboarding under another id
        if (local.profile?.onboarding_complete) {
          if (local.profile.user_id !== userId) {
            adoptAuthUser(userId);
          }
          return;
        }

        // Stale guest/local row for a different user with no useful cloud data
        if (local.profile && local.profile.user_id !== userId) {
          useAppStore.getState().resetDemo();
          setAuthUserId(userId);
        }
      } catch (err) {
        console.error("[auth bootstrap]", err);
      } finally {
        if (!cancelled && gen === loadGen) setBootstrapping(false);
      }
    }

    void supabase.auth.getUser().then(({ data }) => {
      void loadForUser(data.user?.id ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        void loadForUser(null);
        return;
      }
      if (event === "TOKEN_REFRESHED") {
        setAuthUserId(session?.user?.id ?? null);
        return;
      }
      // Re-load after login — fixes empty local store on a new device
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        void loadForUser(session?.user?.id ?? null);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [
    hydrated,
    setAuthUserId,
    hydrateFromCloud,
    adoptAuthUser,
  ]);

  useEffect(() => {
    if (!hydrated || bootstrapping || !profile?.onboarding_complete) return;

    let cancelled = false;

    void (async () => {
      const state = useAppStore.getState();
      const resetVersion =
        state.schedulePrefs?.schedule_reset_version ?? 0;

      try {
        if (resetVersion < CURRENT_SCHEDULE_RESET_VERSION) {
          await resetFutureSchedule();
        } else {
          ensureSchedule();
        }
      } catch (err) {
        console.error("[future schedule reset]", err);
        // Do not mark the migration complete if cloud cleanup failed.
        // A later app load will retry safely.
      }

      if (!cancelled) {
        useAppStore.getState().scanPendingMissedSessions();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hydrated,
    bootstrapping,
    profile?.onboarding_complete,
    profile?.user_id,
    authUserId,
    ensureSchedule,
    resetFutureSchedule,
  ]);

  if (!hydrated || bootstrapping) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  return <>{children}</>;
}
