"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppNav } from "@/components/nav/app-nav";
import { useAppStore } from "@/lib/store/app-store";
import { OfflineBanner } from "@/components/offline-banner";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const profile = useAppStore((s) => s.profile);
  const hydrated = useAppStore((s) => s.hydrated);

  useEffect(() => {
    if (!hydrated) return;
    if (!profile?.onboarding_complete && !pathname?.startsWith("/onboarding")) {
      router.replace("/onboarding");
    }
  }, [hydrated, profile, pathname, router]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl md:flex-row">
      <AppNav />
      <div className="flex min-h-dvh flex-1 flex-col">
        <OfflineBanner />
        <main className="flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-8">{children}</main>
      </div>
    </div>
  );
}
