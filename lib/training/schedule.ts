import type {
  DayRole,
  ScheduledSession,
  SchedulePreferences,
  TrainingCycle,
} from "@/lib/types";
import { getRoutineForDayRole } from "@/lib/seed/routines";
import { addDays, todayISO, uid, weekday } from "@/lib/utils";
import { normalizeScheduledSession } from "@/lib/training/normalize-schedule";

const BASE_ROLES: Record<number, DayRole> = {
  0: "daily_skill_practice",
  1: "strength_power",
  2: "short_mobility_front",
  3: "athleticism_endurance",
  4: "short_deep_flex",
  5: "short_recovery",
  6: "calisthenics_volume",
};

export function resolveDayRole(
  cycleWeek: 1 | 2 | 3 | 4,
  weekdayNum: number,
  weekdayMap?: SchedulePreferences["weekday_map"],
): DayRole {
  const mapped = weekdayMap?.[String(weekdayNum)];
  let role =
    (mapped as DayRole | null | undefined) ?? BASE_ROLES[weekdayNum];

  // Existing profiles may still store the old Sunday "recovery" role.
  // Upgrade it to the daily skill-practice day so OAHS + planche remain daily.
  if (weekdayNum === 0 && role === "recovery") {
    role = "daily_skill_practice";
  }

  // Occasional boxing replaces Thursday deep-flex in Weeks 1 and 3.
  // Friday remains a recovery day before Saturday unless it is a swim week.
  if (
    (weekdayNum === 4 || role === "short_deep_flex") &&
    (cycleWeek === 1 || cycleWeek === 3)
  ) {
    return "boxing";
  }

  // Occasional swimming remains on Friday in Weeks 2 and 4.
  if (weekdayNum === 5 || role === "short_recovery") {
    if (cycleWeek === 2) return "swim_performance";
    if (cycleWeek === 4) return "swim_recovery";
  }

  // Saturday climbing week 3
  if (
    (weekdayNum === 6 || role === "calisthenics_volume") &&
    cycleWeek === 3
  ) {
    return "climbing";
  }

  return role;
}

export function cycleWeekForDate(
  startDate: string,
  date: string,
): 1 | 2 | 3 | 4 {
  const start = new Date(startDate + "T12:00:00");
  const d = new Date(date + "T12:00:00");
  const diff = Math.floor((d.getTime() - start.getTime()) / 86400000);
  const week = (Math.floor(diff / 7) % 4) + 1;
  return week as 1 | 2 | 3 | 4;
}

export function createActiveCycle(
  userId: string,
  startDate = todayISO(),
): TrainingCycle {
  return {
    id: uid("cycle"),
    user_id: userId,
    cycle_number: 1,
    start_date: startDate,
    end_date: addDays(startDate, 27),
    status: "active",
  };
}

function isMainWorkoutRoleLocal(role: DayRole): boolean {
  return [
    "strength_power",
    "athleticism_endurance",
    "calisthenics_volume",
    "gym_workout",
    "climbing",
  ].includes(role);
}

const LIVE_SCHEDULE_STATUSES = new Set<ScheduledSession["status"]>([
  "scheduled",
  "in_progress",
  "pending_missed_confirmation",
  "overdue",
]);

function liveSchedulePriority(session: ScheduledSession): number {
  if (session.status === "in_progress") return 100;
  if (!session.generated_from_schedule) return 80;
  if (session.manually_rescheduled || session.auto_rescheduled) return 75;
  if (isMainWorkoutRoleLocal(session.day_role)) return 60;
  return 40;
}

function scheduleSlot(session: ScheduledSession): "day" | "daily_skill" {
  return session.day_role === "daily_skill_practice"
    ? "daily_skill"
    : "day";
}

function scheduleKey(session: ScheduledSession): string {
  return `${session.date}:${scheduleSlot(session)}`;
}

function needsSeparateDailySkill(role: DayRole): boolean {
  return (
    role !== "daily_skill_practice" &&
    role !== "recovery" &&
    !isMainWorkoutRoleLocal(role)
  );
}

/**
 * Historical rows may coexist on a date. For live rows, keep one entry per
 * schedule slot: the day's main/mobility/sport card plus, when appropriate,
 * one separate daily OAHS+planche card.
 *
 * A main workout already contains OAHS+planche, so any auxiliary daily-skill
 * card on that date is removed as redundant.
 */
export function canonicalizeLiveScheduleRows(
  rows: ScheduledSession[],
): ScheduledSession[] {
  const history: ScheduledSession[] = [];
  const liveByKey = new Map<string, ScheduledSession>();

  for (const raw of rows.map(normalizeScheduledSession)) {
    if (!LIVE_SCHEDULE_STATUSES.has(raw.status)) {
      history.push(raw);
      continue;
    }

    const key = scheduleKey(raw);
    const current = liveByKey.get(key);
    if (
      !current ||
      liveSchedulePriority(raw) > liveSchedulePriority(current)
    ) {
      liveByKey.set(key, raw);
    }
  }

  const mainDates = new Set(
    [...liveByKey.values()]
      .filter((session) => isMainWorkoutRoleLocal(session.day_role))
      .map((session) => session.date),
  );

  const live = [...liveByKey.values()].filter(
    (session) =>
      !(
        session.day_role === "daily_skill_practice" &&
        mainDates.has(session.date)
      ),
  );

  return [...history, ...live].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      scheduleSlot(a).localeCompare(scheduleSlot(b)),
  );
}

export function generateScheduledSessions(opts: {
  userId: string;
  cycle: TrainingCycle;
  weeksAhead?: number;
  weekdayMap?: SchedulePreferences["weekday_map"];
  existing?: ScheduledSession[];
}): ScheduledSession[] {
  const weeks = opts.weeksAhead ?? 6;
  const existing = canonicalizeLiveScheduleRows(
    (opts.existing ?? []).map(normalizeScheduledSession),
  ).map((session) => {
    if (
      !session.generated_from_schedule ||
      session.status !== "scheduled"
    ) {
      return session;
    }

    const cw = cycleWeekForDate(opts.cycle.start_date, session.date);
    const wd = weekday(session.date);
    const baseRole = resolveDayRole(cw, wd, opts.weekdayMap);

    if (session.day_role === "daily_skill_practice") {
      const skillRoutine = getRoutineForDayRole(
        "daily_skill_practice",
        cw,
      );
      return normalizeScheduledSession({
        ...session,
        cycle_week: cw,
        day_role: "daily_skill_practice",
        routine_template_id: skillRoutine.id,
        is_deload: cw === 4,
      });
    }

    const routine = getRoutineForDayRole(baseRole, cw);
    return normalizeScheduledSession({
      ...session,
      cycle_week: cw,
      day_role: baseRole,
      routine_template_id: routine.id,
      is_deload: cw === 4,
    });
  });

  // Any existing row occupies its schedule slot, including completed,
  // missed or skipped rows. This prevents ensureSchedule() from recreating a
  // card after the athlete has already completed or intentionally skipped it.
  const existingKeys = new Set(existing.map(scheduleKey));
  const out: ScheduledSession[] = [...existing];
  const start = opts.cycle.start_date;
  let sequence = Math.max(0, ...existing.map((row) => row.sequence_index), 0);

  const makeScheduled = (
    date: string,
    cw: 1 | 2 | 3 | 4,
    role: DayRole,
    routineId: string,
    sequenceIndex: number,
  ): ScheduledSession =>
    normalizeScheduledSession({
      id: uid("sched"),
      user_id: opts.userId,
      date,
      original_date: date,
      routine_template_id: routineId,
      cycle_week: cw,
      cycle_number: opts.cycle.cycle_number,
      day_role: role,
      status: "scheduled",
      generated_from_schedule: true,
      completed_at: null,
      reschedule_count: 0,
      missed_reason: null,
      sequence_index: sequenceIndex,
      is_deload: cw === 4,
      auto_rescheduled: false,
      manually_rescheduled: false,
      rescheduled_from_id: null,
      missed_note: null,
      injury_area: null,
      injury_exercise: null,
    });

  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i);
    const cw = cycleWeekForDate(start, date);
    const wd = weekday(date);
    const role = resolveDayRole(cw, wd, opts.weekdayMap);
    const routine = getRoutineForDayRole(role, cw);

    const dayKey = `${date}:day`;
    const skillKey = `${date}:daily_skill`;

    if (role === "daily_skill_practice") {
      if (!existingKeys.has(skillKey)) {
        out.push(
          makeScheduled(
            date,
            cw,
            "daily_skill_practice",
            routine.id,
            0,
          ),
        );
        existingKeys.add(skillKey);
      }
      continue;
    }

    if (!existingKeys.has(dayKey)) {
      if (isMainWorkoutRoleLocal(role)) sequence += 1;
      out.push(
        makeScheduled(
          date,
          cw,
          role,
          routine.id,
          isMainWorkoutRoleLocal(role) ? sequence : 0,
        ),
      );
      existingKeys.add(dayKey);
    }

    if (
      needsSeparateDailySkill(role) &&
      !existingKeys.has(skillKey)
    ) {
      const skillRoutine = getRoutineForDayRole(
        "daily_skill_practice",
        cw,
      );
      out.push(
        makeScheduled(
          date,
          cw,
          "daily_skill_practice",
          skillRoutine.id,
          0,
        ),
      );
      existingKeys.add(skillKey);
    }
  }

  return canonicalizeLiveScheduleRows(out);
}

export function isPrimaryRole(role: DayRole): boolean {
  return [
    "strength_power",
    "athleticism_endurance",
    "calisthenics_volume",
    "climbing",
    "swim_performance",
    "swim_recovery",
    "boxing",
  ].includes(role);
}

export function isShortRole(role: DayRole): boolean {
  return [
    "short_mobility_front",
    "short_deep_flex",
    "short_recovery",
    "daily_skill_practice",
  ].includes(role);
}
