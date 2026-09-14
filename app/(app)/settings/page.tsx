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
  const pushToCloud = useAppStore((s) => s.pushToCloud);
  const cloudSyncError = useAppStore((s) => s.cloudSyncError);
  const authUserId = useAppStore((s) => s.authUserId);
  const [syncing, setSyncing] = useState(false);
  const [syncOk, setSyncOk] = useState(false);

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
          <p className="text-sm text-muted">
            Dark mode follows system preference. Units: {profile.units}.
          </p>
          <p className="mt-2 text-xs text-muted break-all">
            Auth user: {authUserId ?? "not signed in"}
          </p>
          {cloudSyncError ? (
            <p className="mt-2 text-sm text-danger">{cloudSyncError}</p>
          ) : null}
          {syncOk ? (
            <p className="mt-2 text-sm text-success">Synced to Supabase.</p>
          ) : null}
        </Card>

        <PrimaryButton
          className="w-full"
          disabled={syncing}
          onClick={() => {
            setSyncing(true);
            setSyncOk(false);
            void pushToCloud()
              .then(() => setSyncOk(true))
              .finally(() => setSyncing(false));
          }}
        >
          {syncing ? "Syncing…" : "Sync now to Supabase"}
        </PrimaryButton>

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
