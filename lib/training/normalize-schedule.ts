import type { ScheduledSession } from "@/lib/types";

/** Backfill adaptive fields for sessions persisted before the feature existed. */
export function normalizeScheduledSession(
  s: ScheduledSession | (Partial<ScheduledSession> & {
    id: string;
    user_id: string;
    date: string;
    routine_template_id: string;
    cycle_week: 1 | 2 | 3 | 4;
    day_role: ScheduledSession["day_role"];
    status: ScheduledSession["status"];
    generated_from_schedule: boolean;
  }),
): ScheduledSession {
  const status =
    s.status === "overdue" ? "pending_missed_confirmation" : s.status;
  return {
    id: s.id,
    user_id: s.user_id,
    date: s.date,
    original_date: s.original_date ?? s.date,
    routine_template_id: s.routine_template_id,
    cycle_week: s.cycle_week,
    cycle_number: s.cycle_number ?? 1,
    day_role: s.day_role,
    status,
    generated_from_schedule: s.generated_from_schedule,
    completed_at: s.completed_at ?? null,
    reschedule_count: s.reschedule_count ?? 0,
    missed_reason: s.missed_reason ?? null,
    sequence_index: s.sequence_index ?? 0,
    is_deload: s.is_deload ?? s.cycle_week === 4,
    auto_rescheduled: s.auto_rescheduled ?? false,
    manually_rescheduled: s.manually_rescheduled ?? false,
    rescheduled_from_id: s.rescheduled_from_id ?? null,
    missed_note: s.missed_note ?? null,
    injury_area: s.injury_area ?? null,
    injury_exercise: s.injury_exercise ?? null,
  };
}

export function normalizeScheduledSessions(
  rows: ScheduledSession[],
): ScheduledSession[] {
  return rows.map(normalizeScheduledSession);
}
