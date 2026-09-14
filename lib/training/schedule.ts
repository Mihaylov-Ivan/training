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
  0: "recovery",
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
  const role =
    (mapped as DayRole | null | undefined) ?? BASE_ROLES[weekdayNum];

  // Friday swim substitutions
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
    "climbing",
  ].includes(role);
}

export function generateScheduledSessions(opts: {
  userId: string;
  cycle: TrainingCycle;
  weeksAhead?: number;
  weekdayMap?: SchedulePreferences["weekday_map"];
  existing?: ScheduledSession[];
}): ScheduledSession[] {
  const weeks = opts.weeksAhead ?? 6;
  const existing = (opts.existing ?? []).map(normalizeScheduledSession);
  const existingDates = new Set(existing.map((s) => s.date));
  const out: ScheduledSession[] = [...existing];
  const start = opts.cycle.start_date;
  let sequence = Math.max(0, ...existing.map((s) => s.sequence_index), 0);

  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i);
    if (existingDates.has(date)) continue;
    const cw = cycleWeekForDate(start, date);
    const wd = weekday(date);
    const role = resolveDayRole(cw, wd, opts.weekdayMap);
    const routine = getRoutineForDayRole(role, cw);
    if (isMainWorkoutRoleLocal(role)) sequence += 1;

    out.push(
      normalizeScheduledSession({
        id: uid("sched"),
        user_id: opts.userId,
        date,
        original_date: date,
        routine_template_id: routine.id,
        cycle_week: cw,
        cycle_number: opts.cycle.cycle_number,
        day_role: role,
        status: "scheduled",
        generated_from_schedule: true,
        completed_at: null,
        reschedule_count: 0,
        missed_reason: null,
        sequence_index: isMainWorkoutRoleLocal(role) ? sequence : 0,
        is_deload: cw === 4,
        auto_rescheduled: false,
        manually_rescheduled: false,
        rescheduled_from_id: null,
        missed_note: null,
        injury_area: null,
        injury_exercise: null,
      }),
    );
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function isPrimaryRole(role: DayRole): boolean {
  return [
    "strength_power",
    "athleticism_endurance",
    "calisthenics_volume",
    "climbing",
    "swim_performance",
    "swim_recovery",
  ].includes(role);
}

export function isShortRole(role: DayRole): boolean {
  return ["short_mobility_front", "short_deep_flex", "short_recovery"].includes(
    role,
  );
}
