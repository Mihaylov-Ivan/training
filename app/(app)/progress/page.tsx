"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { Card, PageHeader, Badge } from "@/components/ui/primitives";
import { addDays, todayISO } from "@/lib/utils";
import { adherenceMetrics } from "@/lib/training/adaptive-schedule";

export default function ProgressPage() {
  const scheduled = useAppStore((s) => s.scheduledSessions);
  const sessions = useAppStore((s) => s.trainingSessions);
  const states = useAppStore((s) => s.progressionStates);
  const events = useAppStore((s) => s.progressionEvents);
  const wellbeing = useAppStore((s) => s.wellbeingCheckins);

  const today = todayISO();
  const stats = useMemo(() => {
    const windows = [7, 28, 90] as const;
    return windows.map((days) => {
      const from = addDays(today, -days + 1);
      const sched = scheduled.filter((s) => s.date >= from && s.date <= today);
      const done = sched.filter(
        (s) => s.status === "completed" || s.status === "partially_completed",
      ).length;
      return { days, done, total: sched.length };
    });
  }, [scheduled, today]);

  const adherence = useMemo(() => adherenceMetrics(scheduled), [scheduled]);

  const oahs = states.find((s) => s.scope_id === "oahs");
  const planche = states.find((s) => s.scope_id === "planche");
  const flag = states.find((s) => s.scope_id === "human_flag");
  const frontLever = states.find((s) => s.scope_id === "front_lever");
  const backLever = states.find((s) => s.scope_id === "back_lever");
  const wpu = states.find((s) => s.scope_id === "weighted-pull-up");
  const front = states.find((s) => s.scope_id === "front_split");
  const middle = states.find((s) => s.scope_id === "middle_split");

  const completedSessions = sessions.filter((s) => s.status === "completed").length;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Progress" subtitle="History, skills, and adherence" />

      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.days}>
            <p className="text-xs text-muted">{s.days}-day consistency</p>
            <p className="mt-1 text-2xl font-semibold">
              {s.done}/{s.total || "—"}
            </p>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <p className="text-sm font-semibold">Training adherence</p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted">On planned date</p>
            <p className="text-lg font-semibold">
              {Math.round(adherence.overall.scheduled_adherence * 100)}%
            </p>
          </div>
          <div>
            <p className="text-muted">Eventually completed</p>
            <p className="text-lg font-semibold">
              {Math.round(adherence.overall.eventual_completion_rate * 100)}%
            </p>
          </div>
          <div>
            <p className="text-muted">Core workouts</p>
            <p className="text-lg font-semibold">
              {Math.round(adherence.core.eventual_completion_rate * 100)}%
            </p>
          </div>
          <div>
            <p className="text-muted">Mobility</p>
            <p className="text-lg font-semibold">
              {Math.round(adherence.mobility.eventual_completion_rate * 100)}%
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          Missed {adherence.overall.missed_sessions} · Rescheduled{" "}
          {adherence.overall.rescheduled_sessions} · Completed after move{" "}
          {adherence.overall.completed_after_reschedule}
        </p>
      </Card>

      <Card className="mt-4">
        <p className="text-sm text-muted">Completed sessions (all time)</p>
        <p className="text-2xl font-semibold">{completedSessions}</p>
      </Card>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-muted">
        Skills
      </h2>
      <div className="space-y-2">
        <SkillCard
          title="OAHS"
          href="/progress/oahs-practice"
          lines={[
            `Level: ${String(oahs?.state.level ?? "—").replace(/_/g, " ")}`,
            `Best L/R: ${oahs?.state.best_hold_left_sec ?? 0}s / ${oahs?.state.best_hold_right_sec ?? 0}s`,
            `Credits: ${oahs?.state.skill_credits ?? 0}/3`,
          ]}
        />
        <SkillCard
          title="Planche"
          href="/progress/planche-hold"
          lines={[
            `Level: ${String(planche?.state.level ?? "—").replace(/_/g, " ")}`,
            `Hard holds: ${planche?.state.hard_hold_seconds ?? "—"}s`,
            `Hard credits: ${planche?.state.hard_success_credits ?? 0}/2`,
          ]}
        />
        <SkillCard
          title="Human flag"
          href="/progress/one-leg-human-flag"
          lines={[
            `Level: ${String(flag?.state.level ?? "—").replace(/_/g, " ")}`,
            `Mon/Sat: ${flag?.state.monday_hold_seconds ?? "—"}s / ${flag?.state.saturday_hold_seconds ?? "—"}s`,
          ]}
        />
        <SkillCard
          title="Front lever"
          href="/progress/front-lever-hold"
          lines={[
            `Level: ${String(frontLever?.state.level ?? "—").replace(/_/g, " ")}`,
            `Progress credits: ${frontLever?.state.success_credits ?? 0}/3`,
          ]}
        />
        <SkillCard
          title="Back lever"
          href="/progress/back-lever-hold"
          lines={[
            `Level: ${String(backLever?.state.level ?? "—").replace(/_/g, " ")}`,
            `Progress credits: ${backLever?.state.success_credits ?? 0}/3`,
          ]}
        />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-muted">
        Strength & flexibility
      </h2>
      <div className="space-y-2">
        <SkillCard
          title="Weighted pull-up"
          href="/progress/weighted-pull-up"
          lines={[`Load: +${wpu?.state.load_kg ?? "—"} kg`]}
        />
        <SkillCard
          title="Front split"
          href="/progress/front-split"
          lines={[
            `Gaps L/R: ${front?.state.left_gap_cm ?? "—"} / ${front?.state.right_gap_cm ?? "—"} cm`,
          ]}
        />
        <SkillCard
          title="Middle split"
          href="/progress/middle-split"
          lines={[`Gap: ${middle?.state.gap_cm ?? "—"} cm`]}
        />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-muted">
        Recent progression
      </h2>
      <div className="space-y-2">
        {events
          .slice()
          .reverse()
          .slice(0, 8)
          .map((e) => (
            <Card key={e.id}>
              <div className="flex items-center gap-2">
                <Badge tone={e.undone_at ? "neutral" : "accent"}>
                  {e.event_type}
                </Badge>
                <span className="text-xs text-muted">
                  {new Date(e.created_at).toLocaleString()}
                </span>
              </div>
              <p className="mt-2 text-sm">{e.explanation}</p>
            </Card>
          ))}
        {events.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">Complete a session to see events.</p>
          </Card>
        ) : null}
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-muted">
        Wellbeing
      </h2>
      <Card>
        {wellbeing.length === 0 ? (
          <p className="text-sm text-muted">No check-ins yet. Log from Today.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {wellbeing
              .slice()
              .reverse()
              .slice(0, 7)
              .map((w) => (
                <li key={w.id} className="flex justify-between gap-2">
                  <span>{w.date}</span>
                  <span className="text-muted">
                    sleep {w.sleep_quality_1_5}/5 · energy {w.energy_1_5}/5 · sore{" "}
                    {w.soreness_0_10}/10
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function SkillCard({
  title,
  href,
  lines,
}: {
  title: string;
  href: string;
  lines: string[];
}) {
  return (
    <Link href={href}>
      <Card className="hover:border-accent/40">
        <p className="font-semibold">{title}</p>
        {lines.map((l) => (
          <p key={l} className="text-sm text-muted">
            {l}
          </p>
        ))}
      </Card>
    </Link>
  );
}
