"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store/app-store";
import { signOut } from "@/lib/auth/actions";
import {
  Card,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui/primitives";

export default function SettingsPage() {
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  const updateProfile = useAppStore((s) => s.updateProfile);
  const exportData = useAppStore((s) => s.exportData);
  const resetDemo = useAppStore((s) => s.resetDemo);
  const resetFutureSchedule = useAppStore((s) => s.resetFutureSchedule);
  const syncNow = useAppStore((s) => s.syncNow);
  const lastSyncedAt = useAppStore((s) => s.lastSyncedAt);
  const syncStatus = useAppStore((s) => s.syncStatus);
  const cloudSyncError = useAppStore((s) => s.cloudSyncError);
  const authUserId = useAppStore((s) => s.authUserId);
  const [syncing, setSyncing] = useState(false);
  const [syncOk, setSyncOk] = useState(false);
  const [resettingSchedule, setResettingSchedule] = useState(false);
  const [scheduleResetMessage, setScheduleResetMessage] = useState<string | null>(null);

  if (!profile) {
    return <p className="text-muted">Complete onboarding first.</p>;
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Settings" subtitle="Equipment, timers, export, sync" />

      <div className="space-y-3">
        <Card className="space-y-3">
          <label className="block text-sm">
            Load increment (kg)
            <input
              type="number"
              step="0.5"
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3"
              value={profile.smallest_load_increment_kg}
              onChange={(e) =>
                updateProfile({
                  smallest_load_increment_kg: Number(e.target.value),
                })
              }
            />
          </label>
          <label className="block text-sm">
            Pool length
            <select
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3"
              value={profile.pool_length_m}
              onChange={(e) =>
                updateProfile({
                  pool_length_m: Number(e.target.value) as 25 | 50,
                })
              }
            >
              <option value={25}>25 m</option>
              <option value={50}>50 m</option>
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={profile.timer_sound}
              onChange={(e) => updateProfile({ timer_sound: e.target.checked })}
            />
            Timer sound
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={profile.timer_haptics}
              onChange={(e) =>
                updateProfile({ timer_haptics: e.target.checked })
              }
            />
            Timer haptics
          </label>
        </Card>

        <Card>
          <p className="font-semibold">Cloud sync</p>
          <p className="mt-1 text-sm text-muted">
            Changes sync automatically while you are online — about every 45s, plus when
            you return to the app.
          </p>
          <p className="mt-2 text-xs text-muted break-all">
            Auth user: {authUserId ?? "not signed in"}
          </p>
          <p className="mt-1 text-xs text-muted">
            Status: {syncStatus}
            {lastSyncedAt
              ? ` · Last synced ${new Date(lastSyncedAt).toLocaleString()}`
              : ""}
          </p>
          {cloudSyncError ? (
            <p className="mt-2 text-sm text-danger">{cloudSyncError}</p>
          ) : null}
          {syncOk ? (
            <p className="mt-2 text-sm text-success">Synced with Supabase.</p>
          ) : null}
        </Card>

        <PrimaryButton
          className="w-full"
          disabled={syncing}
          onClick={() => {
            setSyncing(true);
            setSyncOk(false);
            void syncNow()
              .then(() => setSyncOk(true))
              .finally(() => setSyncing(false));
          }}
        >
          {syncing ? "Syncing…" : "Sync now"}
        </PrimaryButton>

        <Card>
          <p className="font-semibold">Schedule repair</p>
          <p className="mt-1 text-sm text-muted">
            Rebuild the schedule from today using the current training rules. Completed
            workouts, missed-history records, progression, wellbeing and exercise history
            are preserved.
          </p>
          {scheduleResetMessage ? (
            <p className="mt-2 text-sm text-success">{scheduleResetMessage}</p>
          ) : null}
          <SecondaryButton
            className="mt-4 w-full"
            disabled={resettingSchedule}
            onClick={() => {
              if (
                !confirm(
                  "Reset future schedule from today? Completed history and progression will be kept, but future scheduled/rescheduled sessions will be rebuilt.",
                )
              ) {
                return;
              }
              setResettingSchedule(true);
              setScheduleResetMessage(null);
              void resetFutureSchedule()
                .then((result) => {
                  setScheduleResetMessage(
                    `Future schedule rebuilt. Removed ${result.removed} old future entries.`,
                  );
                  router.refresh();
                })
                .catch((err) => {
                  setScheduleResetMessage(
                    err instanceof Error
                      ? err.message
                      : "Could not reset future schedule.",
                  );
                })
                .finally(() => setResettingSchedule(false));
            }}
          >
            {resettingSchedule ? "Rebuilding schedule…" : "Reset future schedule"}
          </SecondaryButton>
        </Card>

        <PrimaryButton
          className="w-full"
          onClick={() => {
            const blob = new Blob([exportData()], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `lifetime-athlete-export-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export data (JSON)
        </PrimaryButton>

        <form action={signOut}>
          <SecondaryButton className="w-full" type="submit">
            Sign out
          </SecondaryButton>
        </form>

        <SecondaryButton
          className="w-full !text-danger"
          onClick={() => {
            if (
              confirm(
                "Reset all local training data and return to onboarding?",
              )
            ) {
              resetDemo();
              router.replace("/onboarding");
            }
          }}
        >
          Reset local demo data
        </SecondaryButton>
      </div>
    </div>
  );
}
