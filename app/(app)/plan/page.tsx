"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { getRoutineById, ROUTINES } from "@/lib/seed/routines";
import { cycleWeekForDate } from "@/lib/training/schedule";
import { formatDuration, todayISO } from "@/lib/utils";
import { Badge, Card, PageHeader } from "@/components/ui/primitives";
import { MissedSessionPrompt } from "@/components/schedule/missed-session-prompt";
import { ScheduleAdjustmentPreview } from "@/components/schedule/schedule-adjustment-preview";

function statusTone(
  status: string,
): "success" | "warning" | "danger" | "accent" | "neutral" {
  if (status === "completed" || status === "partially_completed") return "success";
  if (status === "missed" || status === "skipped" || status === "cancelled")
    return "danger";
  if (
    status === "pending_missed_confirmation" ||
    status === "overdue" ||
    status === "in_progress"
  )
    return "warning";
  return "neutral";
}

function statusLabel(s: {
  status: string;
  auto_rescheduled?: boolean;
  rescheduled_from_id?: string | null;
  is_deload?: boolean;
  missed_reason?: string | null;
}): string {
  if (s.status === "completed") return "✓ Done";
  if (s.status === "partially_completed") return "Partial";
  if (s.status === "missed") return "× Missed";
  if (s.status === "skipped") return "Skipped";
  if (s.status === "pending_missed_confirmation" || s.status === "overdue")
    return "Needs confirm";
  if (s.auto_rescheduled || s.rescheduled_from_id) return "↪ Moved here";
  if (s.is_deload) return "Deload";
  return "Scheduled";
}

export default function PlanPage() {
  const cycles = useAppStore((s) => s.cycles);
  const scheduled = useAppStore((s) => s.scheduledSessions);
  const scanPendingMissedSessions = useAppStore((s) => s.scanPendingMissedSessions);
  const beginManualMiss = useAppStore((s) => s.beginManualMiss);
  const cycle = cycles[0];
  const today = todayISO();

  useEffect(() => {
    scanPendingMissedSessions();
  }, [scanPendingMissedSessions, scheduled.length]);

  const byDate = useMemo(() => {
    const map = new Map<string, typeof scheduled>();
    const sorted = [...scheduled].sort((a, b) => a.date.localeCompare(b.date));
    for (const s of sorted.slice(0, 80)) {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    }
    return [...map.entries()].slice(0, 42);
  }, [scheduled]);

  const canMarkMissed = (status: string) =>
    ["scheduled", "in_progress", "pending_missed_confirmation", "overdue"].includes(
      status,
    );

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Plan"
        subtitle={
          cycle
            ? `Cycle ${cycle.cycle_number} · ${cycle.start_date} → ${cycle.end_date}`
            : "No active cycle"
        }
      />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Next 6 weeks
        </h2>
        <div className="space-y-2">
          {byDate.map(([date, sessions]) => {
            const isToday = date === today;
            return (
              <div key={date} className="space-y-2">
                {sessions.map((s) => {
                  const routine = getRoutineById(s.routine_template_id);
                  const week = cycle
                    ? cycleWeekForDate(cycle.start_date, date)
                    : s.cycle_week;
                  return (
                    <Card
                      key={s.id}
                      className={`mb-2 transition ${
                        isToday ? "border-accent/50" : ""
                      } ${
                        s.status === "missed" || s.status === "skipped"
                          ? "border-danger/40 bg-danger-soft/20"
                          : ""
                      } ${
                        s.auto_rescheduled || s.rescheduled_from_id
                          ? "border-accent/40 bg-accent-soft/20"
                          : ""
                      } ${
                        s.day_role === "recovery" &&
                        s.status !== "missed" &&
                        s.status !== "skipped"
                          ? "border-border/60"
                          : ""
                      }`}
                    >
                      <Link
                        href={`/plan/${s.routine_template_id}`}
                        className="block hover:opacity-90"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs text-muted">
                              {date}
                              {isToday ? " · Today" : ""} · Week {week}
                              {week === 4 || s.is_deload ? " · Deload" : ""}
                            </p>
                            <p
                              className={`mt-1 font-semibold ${
                                s.status === "missed" || s.status === "skipped"
                                  ? "text-danger line-through decoration-danger/40"
                                  : ""
                              }`}
                            >
                              {routine?.name}
                            </p>
                            <p className="text-sm text-muted">
                              {s.status === "missed" || s.status === "skipped"
                                ? s.missed_reason
                                  ? `Missed · ${s.missed_reason.replaceAll("_", " ")}`
                                  : "Marked missed — kept in history"
                                : s.rescheduled_from_id || s.auto_rescheduled
                                  ? `Originally ${s.original_date}`
                                  : routine?.description}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <Badge
                              tone={
                                s.status === "missed" || s.status === "skipped"
                                  ? "danger"
                                  : s.rescheduled_from_id || s.auto_rescheduled
                                    ? "accent"
                                    : statusTone(s.status)
                              }
                            >
                              {statusLabel(s)}
                            </Badge>
                            <span className="text-xs text-muted">
                              {formatDuration(routine?.default_duration_min ?? 0)}
                            </span>
                          </div>
                        </div>
                      </Link>
                      {canMarkMissed(s.status) && s.day_role !== "recovery" ? (
                        <button
                          type="button"
                          className="mt-3 text-sm font-medium text-muted underline-offset-2 hover:text-foreground hover:underline"
                          onClick={() => beginManualMiss(s.id)}
                        >
                          Mark as missed
                        </button>
                      ) : null}
                    </Card>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Routine library
        </h2>
        <div className="space-y-2">
          {ROUTINES.filter(
            (r, i, arr) => arr.findIndex((x) => x.id === r.id) === i,
          ).map((r) => (
            <Link key={r.id} href={`/plan/${r.id}`}>
              <Card className="mb-2 hover:border-accent/40">
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-sm text-muted">{r.description}</p>
                  </div>
                  <Badge>{formatDuration(r.default_duration_min)}</Badge>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <MissedSessionPrompt />
      <ScheduleAdjustmentPreview />
    </div>
  );
}
