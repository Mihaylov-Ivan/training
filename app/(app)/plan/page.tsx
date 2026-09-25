"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "@/lib/store/app-store";
import { getRoutineById, ROUTINES } from "@/lib/seed/routines";
import {
  cycleWeekForDate,
  isPrimaryRole,
  isShortRole,
} from "@/lib/training/schedule";
import { addDays, formatDuration, todayISO, weekday } from "@/lib/utils";
import type { DayRole, ScheduledSession } from "@/lib/types";
import {
  Badge,
  Card,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui/primitives";
import { MissedSessionPrompt } from "@/components/schedule/missed-session-prompt";
import { ScheduleAdjustmentPreview } from "@/components/schedule/schedule-adjustment-preview";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function monthLabel(year: number, month: number) {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function toISODate(year: number, month: number, day: number) {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function formatLongDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function roleTone(role: DayRole): string {
  if (
    isPrimaryRole(role) &&
    role !== "swim_performance" &&
    role !== "swim_recovery" &&
    role !== "boxing"
  ) {
    return "bg-accent";
  }
  if (role.startsWith("swim") || role === "boxing" || role === "climbing") {
    return "bg-warning";
  }
  if (isShortRole(role)) return "bg-success";
  return "bg-muted";
}

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

function statusLabel(s: ScheduledSession): string {
  if (s.status === "completed") return "✓ Done";
  if (s.status === "partially_completed") return "Partial";
  if (s.status === "missed") return "× Missed";
  if (s.status === "skipped") return "Skipped";
  if (s.status === "pending_missed_confirmation" || s.status === "overdue")
    return "Needs confirm";
  if (s.missed_note?.startsWith("Automatic substitute:")) {
    return "↻ Substituted";
  }
  if (s.auto_rescheduled || s.rescheduled_from_id) return "↪ Moved here";
  if (s.is_deload) return "Deload";
  return "Scheduled";
}

function canMarkMissed(status: string) {
  return [
    "scheduled",
    "in_progress",
    "pending_missed_confirmation",
    "overdue",
  ].includes(status);
}

export default function PlanPage() {
  const router = useRouter();
  const cycles = useAppStore((s) => s.cycles);
  const scheduled = useAppStore((s) => s.scheduledSessions);
  const scanPendingMissedSessions = useAppStore((s) => s.scanPendingMissedSessions);
  const beginManualMiss = useAppStore((s) => s.beginManualMiss);
  const smartAdjustScheduledSession = useAppStore(
    (s) => s.smartAdjustScheduledSession,
  );
  const ensureSchedule = useAppStore((s) => s.ensureSchedule);
  const cycle = cycles[0];
  const today = todayISO();

  const todayDate = new Date(today + "T12:00:00");
  const [cursor, setCursor] = useState({
    year: todayDate.getFullYear(),
    month: todayDate.getMonth(),
  });
  const [selected, setSelected] = useState(today);
  const [smartNotice, setSmartNotice] = useState<string | null>(null);
  const [smartAdjustingId, setSmartAdjustingId] = useState<string | null>(null);

  useEffect(() => {
    ensureSchedule();
    scanPendingMissedSessions();
  }, [ensureSchedule, scanPendingMissedSessions, scheduled.length]);

  const byDate = useMemo(() => {
    const map = new Map<string, ScheduledSession[]>();
    for (const s of scheduled) {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const ap = isPrimaryRole(a.day_role) ? 0 : isShortRole(a.day_role) ? 1 : 2;
        const bp = isPrimaryRole(b.day_role) ? 0 : isShortRole(b.day_role) ? 1 : 2;
        return ap - bp;
      });
    }
    return map;
  }, [scheduled]);

  const calendarCells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const cells: { date: string | null; day: number | null }[] = [];
    for (let i = 0; i < startPad; i++) cells.push({ date: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        date: toISODate(cursor.year, cursor.month, d),
        day: d,
      });
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
    return cells;
  }, [cursor]);

  const weekAhead = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(today, i);
      return { date, sessions: byDate.get(date) ?? [] };
    });
  }, [byDate, today]);

  const selectedSessions = byDate.get(selected) ?? [];
  const selectedWeek = cycle
    ? cycleWeekForDate(cycle.start_date, selected)
    : null;

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  function goToday() {
    setCursor({
      year: todayDate.getFullYear(),
      month: todayDate.getMonth(),
    });
    setSelected(today);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Plan"
        subtitle={
          cycle
            ? `Cycle ${cycle.cycle_number} · plan ahead with confidence`
            : "Your training calendar"
        }
        action={
          <SecondaryButton className="!min-h-10 !px-3 !text-sm" onClick={goToday}>
            Today
          </SecondaryButton>
        }
      />

      {/* Next 7 days strip */}
      <section className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Next 7 days
          </h2>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {weekAhead.map(({ date, sessions }) => {
            const main =
              sessions.find((s) => isPrimaryRole(s.day_role)) ?? sessions[0];
            const isSel = date === selected;
            const isTod = date === today;
            return (
              <button
                key={date}
                type="button"
                onClick={() => {
                  setSelected(date);
                  const d = new Date(date + "T12:00:00");
                  setCursor({ year: d.getFullYear(), month: d.getMonth() });
                }}
                className={`min-w-[4.5rem] flex-1 rounded-2xl border px-2 py-3 text-left transition ${
                  isSel
                    ? "border-accent bg-accent text-white shadow-sm"
                    : isTod
                      ? "border-accent/40 bg-accent-soft"
                      : "border-border bg-card"
                }`}
              >
                <p
                  className={`text-[11px] font-semibold uppercase ${
                    isSel ? "text-white/80" : "text-muted"
                  }`}
                >
                  {WEEKDAYS[weekday(date)]}
                </p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">
                  {date.slice(8)}
                </p>
                <div className="mt-2 flex min-h-2 gap-0.5">
                  {sessions.slice(0, 3).map((s) => (
                    <span
                      key={s.id}
                      className={`h-1.5 flex-1 rounded-full ${
                        isSel ? "bg-white/80" : roleTone(s.day_role)
                      } ${
                        s.status === "missed" || s.status === "skipped"
                          ? "opacity-40"
                          : ""
                      }`}
                    />
                  ))}
                </div>
                <p
                  className={`mt-2 line-clamp-2 text-[10px] leading-tight ${
                    isSel ? "text-white/90" : "text-muted"
                  }`}
                >
                  {main
                    ? getRoutineById(main.routine_template_id)?.name ?? "Session"
                    : "Rest"}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Month calendar */}
      <Card className="mb-5 overflow-hidden !p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <button
            type="button"
            aria-label="Previous month"
            className="inline-flex size-10 items-center justify-center rounded-xl border border-border"
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft className="size-5" />
          </button>
          <div className="text-center">
            <p className="text-base font-semibold">
              {monthLabel(cursor.year, cursor.month)}
            </p>
            {cycle ? (
              <p className="text-xs text-muted">
                Tap a day to preview · Week markers update with your cycle
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Next month"
            className="inline-flex size-10 items-center justify-center rounded-xl border border-border"
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight className="size-5" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-px bg-border/60 px-2 pt-2">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="bg-card pb-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1 p-2">
          {calendarCells.map((cell, idx) => {
            if (!cell.date) {
              return <div key={`empty-${idx}`} className="min-h-16 rounded-xl" />;
            }
            const sessions = byDate.get(cell.date) ?? [];
            const isSel = cell.date === selected;
            const isTod = cell.date === today;
            const week = cycle
              ? cycleWeekForDate(cycle.start_date, cell.date)
              : null;
            const hasMiss = sessions.some(
              (s) => s.status === "missed" || s.status === "skipped",
            );
            const hasDone = sessions.some(
              (s) =>
                s.status === "completed" || s.status === "partially_completed",
            );
            return (
              <button
                key={cell.date}
                type="button"
                onClick={() => setSelected(cell.date!)}
                className={`relative flex min-h-16 flex-col rounded-xl border px-1.5 py-1.5 text-left transition ${
                  isSel
                    ? "border-accent bg-accent-soft ring-2 ring-accent/30"
                    : isTod
                      ? "border-accent/50 bg-card"
                      : "border-transparent bg-background/60 hover:border-border hover:bg-card"
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <span
                    className={`inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums ${
                      isTod
                        ? "bg-accent text-white"
                        : isSel
                          ? "text-accent"
                          : ""
                    }`}
                  >
                    {cell.day}
                  </span>
                  {week === 4 ? (
                    <span className="text-[9px] font-semibold uppercase text-warning">
                      DL
                    </span>
                  ) : null}
                </div>
                <div className="mt-auto flex flex-wrap gap-0.5 pt-1">
                  {sessions.slice(0, 4).map((s) => (
                    <span
                      key={s.id}
                      title={getRoutineById(s.routine_template_id)?.name}
                      className={`h-1.5 w-1.5 rounded-full ${roleTone(s.day_role)} ${
                        s.status === "missed" || s.status === "skipped"
                          ? "opacity-30"
                          : s.status === "completed"
                            ? "ring-1 ring-success"
                            : ""
                      }`}
                    />
                  ))}
                </div>
                {hasMiss ? (
                  <span className="absolute right-1 top-1 size-1.5 rounded-full bg-danger" />
                ) : hasDone && sessions.length > 0 ? (
                  <span className="absolute right-1 top-1 size-1.5 rounded-full bg-success" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-3 border-t border-border px-4 py-3 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-accent" /> Main
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-success" /> Short / mobility
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-warning" /> Swim / climb
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-muted" /> Recovery
          </span>
        </div>
      </Card>

      {/* Selected day detail */}
      <section className="mb-8">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{formatLongDate(selected)}</h2>
            <p className="text-sm text-muted">
              {selected === today ? "Today · " : ""}
              {selectedWeek ? `Cycle week ${selectedWeek}` : "Scheduled sessions"}
              {selectedWeek === 4 ? " · Deload" : ""}
            </p>
          </div>
          {selected !== today ? (
            <SecondaryButton
              className="!min-h-10 !px-3 !text-sm"
              onClick={goToday}
            >
              Jump to today
            </SecondaryButton>
          ) : null}
        </div>

        {smartNotice ? (
          <Card className="mb-3 border-accent/30 bg-accent-soft/20">
            <p className="text-sm font-medium">{smartNotice}</p>
          </Card>
        ) : null}

        {selectedSessions.length === 0 ? (
          <Card>
            <p className="font-medium">No structured session</p>
            <p className="mt-1 text-sm text-muted">
              Open day — keep daily maintenance from Today if you like.
            </p>
            {selected === today ? (
              <PrimaryButton
                className="mt-4 w-full"
                onClick={() => router.push("/today")}
              >
                Go to Today
              </PrimaryButton>
            ) : null}
          </Card>
        ) : (
          <div className="space-y-3">
            {selectedSessions.map((s) => {
              const routine = getRoutineById(s.routine_template_id);
              const missed = s.status === "missed" || s.status === "skipped";
              const done =
                s.status === "completed" || s.status === "partially_completed";
              return (
                <Card
                  key={s.id}
                  className={`${
                    missed
                      ? "border-danger/40 bg-danger-soft/20"
                      : done
                        ? "border-success/40 bg-success-soft/20"
                        : s.auto_rescheduled ||
                            s.rescheduled_from_id ||
                            s.missed_note?.startsWith("Automatic substitute:")
                          ? "border-accent/40 bg-accent-soft/20"
                          : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`size-2.5 shrink-0 rounded-full ${roleTone(s.day_role)}`}
                        />
                        <p
                          className={`font-semibold ${
                            missed
                              ? "text-danger line-through decoration-danger/40"
                              : ""
                          }`}
                        >
                          {routine?.name}
                        </p>
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        {missed
                          ? s.missed_reason
                            ? `Missed · ${s.missed_reason.replaceAll("_", " ")}`
                            : "Marked missed — kept in history"
                          : s.missed_note?.startsWith("Automatic substitute:")
                            ? s.missed_note
                            : s.rescheduled_from_id || s.auto_rescheduled
                              ? `Originally ${s.original_date}`
                              : routine?.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge
                        tone={
                          missed
                            ? "danger"
                            : s.rescheduled_from_id ||
                                s.auto_rescheduled ||
                                s.missed_note?.startsWith("Automatic substitute:")
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
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/plan/${s.routine_template_id}`}
                      className="inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl border border-border px-4 text-sm font-semibold"
                    >
                      View routine
                    </Link>
                    {selected === today && !missed && !done ? (
                      <Link
                        href="/today"
                        className="inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-white"
                      >
                        Open in Today
                      </Link>
                    ) : null}
                    {!missed &&
                    !done &&
                    selected >= today &&
                    s.day_role !== "daily_skill_practice" &&
                    s.day_role !== "recovery" &&
                    !(
                      s.day_role === "gym_workout" &&
                      s.missed_note?.startsWith("Automatic substitute:")
                    ) ? (
                      <SecondaryButton
                        className="flex-1"
                        disabled={smartAdjustingId === s.id}
                        onClick={() => {
                          setSmartAdjustingId(s.id);
                          setSmartNotice(null);
                          try {
                            const result = smartAdjustScheduledSession(s.id);
                            setSmartNotice(result.explanation);
                          } finally {
                            setSmartAdjustingId(null);
                          }
                        }}
                      >
                        {smartAdjustingId === s.id
                          ? "Optimising…"
                          : s.day_role === "climbing" ||
                              s.day_role === "swim_performance" ||
                              s.day_role === "swim_recovery" ||
                              s.missed_note?.startsWith("Automatic substitute:")
                            ? "Auto substitute"
                            : "Smart swap"}
                      </SecondaryButton>
                    ) : null}
                    {canMarkMissed(s.status) && s.day_role !== "recovery" ? (
                      <button
                        type="button"
                        className="min-h-11 rounded-2xl px-3 text-sm font-medium text-muted underline-offset-2 hover:text-foreground hover:underline"
                        onClick={() => beginManualMiss(s.id)}
                      >
                        Mark missed
                      </button>
                    ) : null}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Routine library
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {ROUTINES.filter(
            (r, i, arr) => arr.findIndex((x) => x.id === r.id) === i,
          ).map((r) => (
            <Link key={r.id} href={`/plan/${r.id}`}>
              <Card className="h-full transition hover:border-accent/40">
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="font-semibold">{r.name}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted">
                      {r.description}
                    </p>
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
