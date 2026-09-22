import type {
  ScheduledSession,
  SchedulePreferences,
  TrainingCycle,
  TrainingSession,
} from "@/lib/types";
import { generateScheduledSessions } from "@/lib/training/schedule";
import { normalizeScheduledSessions } from "@/lib/training/normalize-schedule";

export const CURRENT_SCHEDULE_RESET_VERSION = 1;

const RESETTABLE_STATUSES = new Set<ScheduledSession["status"]>([
  "scheduled",
  "pending_missed_confirmation",
  "overdue",
  "cancelled",
]);

const TERMINAL_HISTORY_STATUSES = new Set<ScheduledSession["status"]>([
  "completed",
  "partially_completed",
  "missed",
  "skipped",
]);

export function buildFutureScheduleReset(opts: {
  userId: string;
  cycle: TrainingCycle;
  weekdayMap?: SchedulePreferences["weekday_map"];
  scheduledSessions: ScheduledSession[];
  trainingSessions: TrainingSession[];
  fromDate: string;
  weeksAhead?: number;
}): {
  scheduledSessions: ScheduledSession[];
  removedIds: string[];
} {
  const scheduled = normalizeScheduledSessions(opts.scheduledSessions);
  const linkedScheduledIds = new Set(
    opts.trainingSessions
      .map((session) => session.scheduled_session_id)
      .filter((id): id is string => Boolean(id)),
  );

  const removedIds = scheduled
    .filter(
      (session) =>
        session.date >= opts.fromDate &&
        RESETTABLE_STATUSES.has(session.status) &&
        !linkedScheduledIds.has(session.id),
    )
    .map((session) => session.id);
  const removed = new Set(removedIds);

  const preserved = scheduled.filter((session) => !removed.has(session.id));

  // Historical terminal rows are preserved for adherence/history, but they
  // should not occupy the rebuilt future date. Active/completed linked rows
  // remain calendar blockers.
  const generationExisting = preserved.filter(
    (session) =>
      session.date < opts.fromDate ||
      !TERMINAL_HISTORY_STATUSES.has(session.status),
  );
  const futureHistory = preserved.filter(
    (session) =>
      session.date >= opts.fromDate &&
      TERMINAL_HISTORY_STATUSES.has(session.status),
  );

  const regenerated = generateScheduledSessions({
    userId: opts.userId,
    cycle: opts.cycle,
    weeksAhead: opts.weeksAhead ?? 6,
    weekdayMap: opts.weekdayMap,
    existing: generationExisting,
  });

  const byId = new Map<string, ScheduledSession>();
  for (const session of regenerated) byId.set(session.id, session);
  for (const session of futureHistory) byId.set(session.id, session);

  return {
    scheduledSessions: [...byId.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    removedIds,
  };
}
