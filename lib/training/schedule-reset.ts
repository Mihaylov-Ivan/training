import type {
  ScheduledSession,
  SchedulePreferences,
  TrainingCycle,
  TrainingSession,
} from "@/lib/types";
import { generateScheduledSessions } from "@/lib/training/schedule";
import { normalizeScheduledSessions } from "@/lib/training/normalize-schedule";

export const CURRENT_SCHEDULE_RESET_VERSION = 3;

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

  // From the reset date onward, keep only schedule rows that are attached to
  // a real training session. Missed/skipped/rescheduled schedule-only rows are
  // calendar metadata, not the training history itself, and are deliberately
  // removed so the rebuilt calendar is visually clean.
  const removedIds = scheduled
    .filter(
      (session) =>
        session.date >= opts.fromDate &&
        !linkedScheduledIds.has(session.id),
    )
    .map((session) => session.id);
  const removed = new Set(removedIds);

  const preserved = scheduled.filter((session) => !removed.has(session.id));

  const regenerated = generateScheduledSessions({
    userId: opts.userId,
    cycle: opts.cycle,
    weeksAhead: opts.weeksAhead ?? 6,
    weekdayMap: opts.weekdayMap,
    existing: preserved,
  });

  return {
    scheduledSessions: regenerated.sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    removedIds,
  };
}
