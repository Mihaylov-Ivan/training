import type {
  DayRole,
  ScheduledSession,
  TrainingCycle,
  WellbeingCheckin,
} from "@/lib/types";
import { getRoutineById } from "@/lib/seed/routines";
import {
  canonicalizeLiveScheduleRows,
  cycleWeekForDate,
} from "@/lib/training/schedule";
import {
  isMainWorkoutRole,
  recalculateSchedule,
  respectsMainWorkoutBoundaries,
} from "@/lib/training/adaptive-schedule";
import {
  addDays,
  readinessPercent,
  uid,
  weekday,
} from "@/lib/utils";

const ADJUSTABLE = new Set<ScheduledSession["status"]>([
  "scheduled",
  "pending_missed_confirmation",
  "overdue",
]);

const LIVE = new Set<ScheduledSession["status"]>([
  "scheduled",
  "in_progress",
  "pending_missed_confirmation",
  "overdue",
]);

const MAIN_LOAD = new Set<ScheduledSession["status"]>([
  "scheduled",
  "in_progress",
  "pending_missed_confirmation",
  "overdue",
  "completed",
  "partially_completed",
]);

const SPECIAL_ROLES = new Set<DayRole>([
  "swim_performance",
  "swim_recovery",
  "climbing",
]);

export interface SmartScheduleResult {
  changed: boolean;
  updated_sessions: ScheduledSession[];
  explanation: string;
  action: "swap" | "substitute" | "none";
}

function calendarWeekStart(date: string): string {
  const wd = weekday(date);
  const daysFromMonday = wd === 0 ? 6 : wd - 1;
  return addDays(date, -daysFromMonday);
}

function daysBetween(a: string, b: string): number {
  const ms =
    new Date(b + "T12:00:00").getTime() -
    new Date(a + "T12:00:00").getTime();
  return Math.round(ms / 86400000);
}

function inSameCalendarWeek(a: string, b: string): boolean {
  return calendarWeekStart(a) === calendarWeekStart(b);
}

function mainRows(sessions: ScheduledSession[]): ScheduledSession[] {
  return sessions
    .filter(
      (session) =>
        isMainWorkoutRole(session.day_role) &&
        MAIN_LOAD.has(session.status),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

function hasRecoveryGap(sessions: ScheduledSession[]): boolean {
  const mains = mainRows(sessions);
  for (let i = 1; i < mains.length; i += 1) {
    if (daysBetween(mains[i - 1]!.date, mains[i]!.date) <= 1) {
      return false;
    }
  }
  return true;
}

function preservesCoreSequence(sessions: ScheduledSession[]): boolean {
  const mains = mainRows(sessions)
    .filter((session) => session.sequence_index > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  let previous = -Infinity;
  for (const session of mains) {
    if (session.sequence_index < previous) return false;
    previous = session.sequence_index;
  }
  return true;
}

function isValidMainLayout(sessions: ScheduledSession[]): boolean {
  return (
    respectsMainWorkoutBoundaries(sessions) &&
    hasRecoveryGap(sessions) &&
    preservesCoreSequence(sessions)
  );
}

function latestRelevantCheckin(
  checkins: WellbeingCheckin[],
  targetDate: string,
): WellbeingCheckin | null {
  return (
    [...checkins]
      .filter((checkin) => checkin.date <= targetDate)
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
  );
}

function updateDate(
  session: ScheduledSession,
  date: string,
  cycle: TrainingCycle,
  note: string,
): ScheduledSession {
  const cycleWeek = cycleWeekForDate(cycle.start_date, date);
  return {
    ...session,
    date,
    cycle_week: cycleWeek,
    is_deload: cycleWeek === 4,
    reschedule_count: (session.reschedule_count ?? 0) + 1,
    auto_rescheduled: true,
    manually_rescheduled: false,
    missed_note: note,
  };
}

function scheduledSkillForDate(
  sessions: ScheduledSession[],
  date: string,
): ScheduledSession | undefined {
  return sessions.find(
    (session) =>
      session.date === date &&
      session.day_role === "daily_skill_practice" &&
      LIVE.has(session.status),
  );
}

function anySkillRecordForDate(
  sessions: ScheduledSession[],
  date: string,
): boolean {
  return sessions.some(
    (session) =>
      session.date === date &&
      session.day_role === "daily_skill_practice",
  );
}

function baseForDate(
  sessions: ScheduledSession[],
  date: string,
): ScheduledSession | undefined {
  return sessions.find(
    (session) =>
      session.date === date &&
      session.day_role !== "daily_skill_practice" &&
      LIVE.has(session.status),
  );
}

function reconcileDailySkillSlots(
  sessions: ScheduledSession[],
  dates: string[],
  userId: string,
  cycle: TrainingCycle,
): ScheduledSession[] {
  let working = [...sessions];

  for (const date of dates) {
    const base = baseForDate(working, date);

    if (base && isMainWorkoutRole(base.day_role)) {
      const skill = scheduledSkillForDate(working, date);
      if (skill) {
        working = working.filter((session) => session.id !== skill.id);
      }
      continue;
    }

    // If a main workout moved away, the date may now be fully open. OAHS +
    // planche still belongs on that day, so an open day also gets the light
    // daily skill card.
    if (anySkillRecordForDate(working, date)) continue;

    const cycleWeek = cycleWeekForDate(cycle.start_date, date);
    working.push({
      id: uid("sched"),
      user_id: userId,
      date,
      original_date: date,
      routine_template_id: "routine-sunday-skills",
      cycle_week: cycleWeek,
      cycle_number: cycle.cycle_number,
      day_role: "daily_skill_practice",
      status: "scheduled",
      generated_from_schedule: true,
      completed_at: null,
      reschedule_count: 0,
      missed_reason: null,
      sequence_index: 0,
      is_deload: cycleWeek === 4,
      auto_rescheduled: false,
      manually_rescheduled: false,
      rescheduled_from_id: null,
      missed_note: null,
      injury_area: null,
      injury_exercise: null,
    });
  }

  return canonicalizeLiveScheduleRows(working);
}

function substitute(
  target: ScheduledSession,
  sessions: ScheduledSession[],
  cycle: TrainingCycle,
  checkins: WellbeingCheckin[],
): SmartScheduleResult {
  const checkin = latestRelevantCheckin(checkins, target.date);
  const readiness = readinessPercent(checkin);
  const lowReadiness =
    readiness != null && readiness < 50;
  const elevatedPain =
    checkin != null &&
    Math.max(checkin.neck_pain_0_10, checkin.back_pain_0_10) >= 5;

  const weekStart = calendarWeekStart(target.date);
  const weekEnd = addDays(weekStart, 6);
  const weekRows = sessions.filter(
    (session) =>
      session.date >= weekStart && session.date <= weekEnd,
  );

  const missedMain = weekRows.some(
    (session) =>
      isMainWorkoutRole(session.day_role) &&
      ["missed", "skipped", "cancelled"].includes(session.status),
  );

  let replacementRole: DayRole;
  let replacementRoutineId: string;

  if (target.day_role === "climbing") {
    const gymAlreadyThisWeek = weekRows.some(
      (session) =>
        session.day_role === "gym_workout" &&
        MAIN_LOAD.has(session.status),
    );
    if (lowReadiness || elevatedPain || gymAlreadyThisWeek) {
      replacementRole = "boxing";
      replacementRoutineId = "routine-boxing";
    } else {
      replacementRole = "gym_workout";
      replacementRoutineId = "routine-gym-replacement";
    }
  } else {
    // Swimming is conditioning/recovery. Only turn it into another main
    // strength session when the week has actually lost a main stimulus,
    // readiness is good, and the hard recovery constraints still allow it.
    replacementRole = "boxing";
    replacementRoutineId = "routine-boxing";

    if (missedMain && (readiness == null || readiness >= 65)) {
      const proposed = sessions.map((session) =>
        session.id === target.id
          ? {
              ...session,
              day_role: "gym_workout" as DayRole,
              routine_template_id: "routine-gym-replacement",
              sequence_index: 0,
            }
          : session,
      );
      if (isValidMainLayout(proposed)) {
        replacementRole = "gym_workout";
        replacementRoutineId = "routine-gym-replacement";
      }
    }
  }

  const oldName =
    getRoutineById(target.routine_template_id)?.name ??
    target.day_role.replaceAll("_", " ");
  const newName =
    getRoutineById(replacementRoutineId)?.name ??
    replacementRole.replaceAll("_", " ");

  let updated = sessions.map((session) =>
    session.id === target.id
      ? {
          ...session,
          day_role: replacementRole,
          routine_template_id: replacementRoutineId,
          sequence_index:
            replacementRole === "gym_workout"
              ? target.day_role === "climbing"
                ? target.sequence_index
                : 0
              : 0,
          auto_rescheduled: true,
          manually_rescheduled: false,
          reschedule_count: (session.reschedule_count ?? 0) + 1,
          missed_note: `Automatic substitute: ${oldName} → ${newName}`,
        }
      : session,
  );

  if (
    replacementRole === "gym_workout" &&
    !isValidMainLayout(updated)
  ) {
    replacementRole = "boxing";
    replacementRoutineId = "routine-boxing";
    const fallbackName =
      getRoutineById(replacementRoutineId)?.name ?? "Boxing";
    updated = sessions.map((session) =>
      session.id === target.id
        ? {
            ...session,
            day_role: "boxing" as DayRole,
            routine_template_id: replacementRoutineId,
            sequence_index: 0,
            auto_rescheduled: true,
            manually_rescheduled: false,
            reschedule_count: (session.reschedule_count ?? 0) + 1,
            missed_note: `Automatic substitute: ${oldName} → ${fallbackName}`,
          }
        : session,
    );
  }

  updated = reconcileDailySkillSlots(
    updated,
    [target.date],
    target.user_id,
    cycle,
  );

  const reason =
    replacementRole === "gym_workout"
      ? target.day_role === "climbing"
        ? "Gym was selected because it best preserves the climbing day's strength stimulus."
        : "Gym was selected because this week has lost a main strength session and recovery spacing allows one to be restored."
      : target.day_role === "climbing"
        ? "Boxing was selected because current recovery/readiness or this week's load makes another gym-strength session less suitable."
        : "Boxing was selected because it replaces swimming's conditioning stimulus without adding another main strength day.";

  return {
    changed: true,
    updated_sessions: updated,
    explanation: `${oldName} was automatically replaced with ${getRoutineById(replacementRoutineId)?.name ?? replacementRole}. ${reason}`,
    action: "substitute",
  };
}

function candidatePenalty(
  target: ScheduledSession,
  candidate: ScheduledSession,
  readiness: number | null,
  today: string,
): number {
  let score = Math.abs(daysBetween(target.date, candidate.date)) * 10;

  if (candidate.date < today) score += 1000;
  if (candidate.day_role === "short_recovery") score -= 5;
  if (
    candidate.day_role === "short_mobility_front" ||
    candidate.day_role === "short_deep_flex"
  ) {
    score -= 3;
  }
  if (candidate.day_role === "boxing") score += 4;
  if (SPECIAL_ROLES.has(candidate.day_role)) score += 30;

  if (
    isMainWorkoutRole(target.day_role) &&
    readiness != null &&
    readiness < 55
  ) {
    if (candidate.date > target.date) score -= 6;
    if (candidate.date < target.date) score += 15;
  }

  return score;
}

function rebalanceMain(
  target: ScheduledSession,
  sessions: ScheduledSession[],
  cycle: TrainingCycle,
  checkins: WellbeingCheckin[],
): SmartScheduleResult {
  const readiness = readinessPercent(
    latestRelevantCheckin(checkins, target.date),
  );
  const reason =
    readiness != null && readiness < 55 ? "fatigue" : "no_time";
  const proposal = recalculateSchedule({
    missedSession: target,
    upcomingSessions: sessions,
    cycle,
    reason,
  });

  if (
    proposal.recommendation !== "apply" ||
    proposal.moved_sessions.length === 0
  ) {
    return {
      changed: false,
      updated_sessions: sessions,
      explanation:
        "No safe same-week rebalance improves this main workout without breaking recovery or the weekly load limits.",
      action: "none",
    };
  }

  const sourceById = new Map(sessions.map((session) => [session.id, session]));
  const makeupRows = proposal.updated_sessions.filter(
    (session) => session.rescheduled_from_id,
  );
  const movedSourceIds = new Set(
    makeupRows
      .map((session) => session.rescheduled_from_id)
      .filter((id): id is string => Boolean(id)),
  );
  const autoSkippedIds = new Set(
    proposal.skipped_sessions
      .filter((session) => !isMainWorkoutRole(session.day_role))
      .map((session) => session.id),
  );

  let updated = proposal.updated_sessions
    .filter(
      (session) =>
        !movedSourceIds.has(session.id) &&
        !autoSkippedIds.has(session.id),
    )
    .map((session) => {
      if (!session.rescheduled_from_id) return session;
      const source = sourceById.get(session.rescheduled_from_id);
      if (!source) return session;

      return {
        ...session,
        original_date: source.original_date,
        status: "scheduled" as const,
        completed_at: null,
        missed_reason: null,
        rescheduled_from_id: null,
        manually_rescheduled: false,
        auto_rescheduled: true,
        missed_note: `Automatic weekly rebalance from ${source.date}`,
      };
    });

  const affectedDates = new Set<string>([target.date]);
  for (const move of proposal.moved_sessions) {
    affectedDates.add(move.from_date);
    affectedDates.add(move.to_date);
  }

  updated = reconcileDailySkillSlots(
    updated,
    [...affectedDates],
    target.user_id,
    cycle,
  );

  if (!isValidMainLayout(updated)) {
    return {
      changed: false,
      updated_sessions: sessions,
      explanation:
        "The proposed rebalance was rejected because it would break a main-workout recovery or load boundary.",
      action: "none",
    };
  }

  const movedNames = proposal.moved_sessions
    .map((move) => `${move.label}: ${move.from_date} → ${move.to_date}`)
    .join("; ");

  return {
    changed: true,
    updated_sessions: updated,
    explanation: `The week was automatically rebalanced: ${movedNames}. No workout was counted as missed; lower-priority support work was removed only where necessary to protect recovery.`,
    action: "swap",
  };
}

function swapOrdinary(
  target: ScheduledSession,
  sessions: ScheduledSession[],
  cycle: TrainingCycle,
  checkins: WellbeingCheckin[],
  today: string,
): SmartScheduleResult {
  const checkin = latestRelevantCheckin(checkins, target.date);
  const readiness = readinessPercent(checkin);

  const candidates = sessions
    .filter(
      (candidate) =>
        candidate.id !== target.id &&
        candidate.day_role !== "daily_skill_practice" &&
        ADJUSTABLE.has(candidate.status) &&
        inSameCalendarWeek(candidate.date, target.date) &&
        candidate.date >= today &&
        !SPECIAL_ROLES.has(candidate.day_role) &&
        !isMainWorkoutRole(candidate.day_role),
    )
    .sort(
      (a, b) =>
        candidatePenalty(target, a, readiness, today) -
        candidatePenalty(target, b, readiness, today),
    );

  for (const candidate of candidates) {
    const targetName =
      getRoutineById(target.routine_template_id)?.name ??
      target.day_role.replaceAll("_", " ");
    const candidateName =
      getRoutineById(candidate.routine_template_id)?.name ??
      candidate.day_role.replaceAll("_", " ");

    let updated = sessions.map((session) => {
      if (session.id === target.id) {
        return updateDate(
          session,
          candidate.date,
          cycle,
          `Automatic weekly swap with ${candidateName}`,
        );
      }
      if (session.id === candidate.id) {
        return updateDate(
          session,
          target.date,
          cycle,
          `Automatic weekly swap with ${targetName}`,
        );
      }
      return session;
    });

    updated = canonicalizeLiveScheduleRows(updated);

    if (
      isMainWorkoutRole(target.day_role) &&
      !isValidMainLayout(updated)
    ) {
      continue;
    }

    updated = reconcileDailySkillSlots(
      updated,
      [target.date, candidate.date],
      target.user_id,
      cycle,
    );

    return {
      changed: true,
      updated_sessions: updated,
      explanation: `${targetName} was automatically swapped with ${candidateName}. The app chose ${candidate.date} because it is the best fit in the current week while preserving main-workout order and recovery.`,
      action: "swap",
    };
  }

  return {
    changed: false,
    updated_sessions: sessions,
    explanation:
      "No safe same-week swap improves the schedule without breaking recovery, main-workout order, or the weekly load limits.",
    action: "none",
  };
}

export function smartAdjustScheduledSession(opts: {
  scheduledId: string;
  sessions: ScheduledSession[];
  cycle: TrainingCycle;
  wellbeingCheckins: WellbeingCheckin[];
  today: string;
}): SmartScheduleResult {
  const target = opts.sessions.find(
    (session) => session.id === opts.scheduledId,
  );

  if (!target) {
    return {
      changed: false,
      updated_sessions: opts.sessions,
      explanation: "Session not found.",
      action: "none",
    };
  }

  if (!ADJUSTABLE.has(target.status)) {
    return {
      changed: false,
      updated_sessions: opts.sessions,
      explanation:
        "Only upcoming sessions that have not started or finished can be adjusted.",
      action: "none",
    };
  }

  if (target.date < opts.today) {
    return {
      changed: false,
      updated_sessions: opts.sessions,
      explanation:
        "Past sessions are kept as history and are not swapped.",
      action: "none",
    };
  }

  if (target.day_role === "daily_skill_practice") {
    return {
      changed: false,
      updated_sessions: opts.sessions,
      explanation:
        "Daily OAHS + planche stays attached to the day and is not part of weekly swapping.",
      action: "none",
    };
  }

  if (SPECIAL_ROLES.has(target.day_role)) {
    return substitute(
      target,
      opts.sessions,
      opts.cycle,
      opts.wellbeingCheckins,
    );
  }

  if (isMainWorkoutRole(target.day_role)) {
    return rebalanceMain(
      target,
      opts.sessions,
      opts.cycle,
      opts.wellbeingCheckins,
    );
  }

  return swapOrdinary(
    target,
    opts.sessions,
    opts.cycle,
    opts.wellbeingCheckins,
    opts.today,
  );
}
