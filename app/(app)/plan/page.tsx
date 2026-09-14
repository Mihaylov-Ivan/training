"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { getRoutineById, ROUTINES } from "@/lib/seed/routines";
import { cycleWeekForDate } from "@/lib/training/schedule";
import { formatDuration, todayISO } from "@/lib/utils";
import { Badge, Card, PageHeader } from "@/components/ui/primitives";

export default function PlanPage() {
  const cycles = useAppStore((s) => s.cycles);
  const scheduled = useAppStore((s) => s.scheduledSessions);
  const cycle = cycles[0];
  const today = todayISO();

  const byDate = useMemo(() => {
    const map = new Map<string, typeof scheduled>();
    for (const s of scheduled.slice(0, 42)) {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    }
    return [...map.entries()];
  }, [scheduled]);

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
            const s = sessions[0]!;
            const routine = getRoutineById(s.routine_template_id);
            const week = cycle
              ? cycleWeekForDate(cycle.start_date, date)
              : s.cycle_week;
            const isToday = date === today;
            return (
              <Link key={date} href={`/plan/${s.routine_template_id}`}>
                <Card
                  className={`mb-2 transition hover:border-accent/40 ${
                    isToday ? "border-accent/50" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted">
                        {date}
                        {isToday ? " · Today" : ""} · Week {week}
                        {week === 4 ? " · Deload" : ""}
                      </p>
                      <p className="mt-1 font-semibold">{routine?.name}</p>
                      <p className="text-sm text-muted">{routine?.description}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge
                        tone={
                          s.status === "completed"
                            ? "success"
                            : s.status === "overdue"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {s.status}
                      </Badge>
                      <span className="text-xs text-muted">
                        {formatDuration(routine?.default_duration_min ?? 0)}
                      </span>
                    </div>
                  </div>
                </Card>
              </Link>
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
    </div>
  );
}
