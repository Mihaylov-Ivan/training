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
  scheduledSessionEmbedsDailySkill,
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
    generated_from_schedule: false,
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

    if (base && scheduledSessionEmbedsDailySkill(base)) {
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

const FIXED_REPLACEMENT_PREFIX = "Fixed replacement:";
const MOVED_ORIGINAL_PREFIX = "Moved original after replacement:";

function isFixedReplacement(session: ScheduledSession): boolean {
  return session.missed_note?.startsWith(FIXED_REPLACEMENT_PREFIX) ?? false;
}

function replacementHistory(
  session: ScheduledSession,
): Array<"boxing" | "gym"> {
  const note = session.missed_note ?? "";
  const match = /replacement-history=([a-z,]+)/.exec(note);
  if (!match) return [];
  return match[1]!
    .split(",")
    .filter(
      (value): value is "boxing" | "gym" =>
        value === "boxing" || value === "gym",
    );
}

function chooseReplacement(opts: {
  target: ScheduledSession;
  sessions: ScheduledSession[];
  checkins: WellbeingCheckin[];
}): {
  role: "boxing" | "gym_workout";
  routineId: string;
  historyToken: "boxing" | "gym";
} | null {
  const history = replacementHistory(opts.target);
  const unused = (["boxing", "gym"] as const).filter(
    (candidate) => !history.includes(candidate),
  );
  if (unused.length === 0) return null;

  let choice: "boxing" | "gym";
  if (history.length > 0) {
    choice = unused[0]!;
  } else if (opts.target.day_role === "climbing") {
    const checkin = latestRelevantCheckin(
      opts.checkins,
      opts.target.date,
    );
    const readiness = readinessPercent(checkin);
    const lowReadiness = readiness != null && readiness < 50;
    const elevatedPain =
      checkin != null &&
      Math.max(
        checkin.neck_pain_0_10,
        checkin.back_pain_0_10,
      ) >= 5;
    const weekStart = calendarWeekStart(opts.target.date);
    const weekEnd = addDays(weekStart, 6);
    const gymAlreadyThisWeek = opts.sessions.some(
      (session) =>
        session.date >= weekStart &&
        session.date <= weekEnd &&
        session.day_role === "gym_workout" &&
        MAIN_LOAD.has(session.status),
    );
    choice =
      lowReadiness || elevatedPain || gymAlreadyThisWeek
        ? "boxing"
        : "gym";
  } else {
    // Swimming is primarily conditioning, so Boxing is the closest default.
    // If the moved original is substituted again, Gym becomes the next option.
    choice = "boxing";
  }

  if (choice === "boxing") {
    return {
      role: "boxing",
      routineId: "routine-boxing",
      historyToken: "boxing",
    };
  }

  const targetEmbeddedSkills =
    scheduledSessionEmbedsDailySkill(opts.target);
  return {
    role: "gym_workout",
    routineId: targetEmbeddedSkills
      ? "routine-gym-replacement-skills"
      : "routine-gym-replacement",
    historyToken: "gym",
  };
}

function makeFixedReplacement(opts: {
  target: ScheduledSession;
  replacement: {
    role: "boxing" | "gym_workout";
    routineId: string;
  };
  oldName: string;
  newName: string;
}): ScheduledSession {
  return {
    ...opts.target,
    id: uid("sched"),
    date: opts.target.date,
    original_date: opts.target.date,
    day_role: opts.replacement.role,
    routine_template_id: opts.replacement.routineId,
    status: "scheduled",
    generated_from_schedule: false,
    completed_at: null,
    missed_reason: null,
    sequence_index: 0,
    auto_rescheduled: false,
    manually_rescheduled: false,
    rescheduled_from_id: null,
    missed_note:
      `${FIXED_REPLACEMENT_PREFIX} ${opts.oldName} → ${opts.newName}`,
    injury_area: null,
    injury_exercise: null,
  };
}

function cleanAdaptiveMoveProposal(opts: {
  proposal: ReturnType<typeof recalculateSchedule>;
  sourceSessions: ScheduledSession[];
  target: ScheduledSession;
  replacementId: string;
  replacementHistory: Array<"boxing" | "gym">;
}): {
  sessions: ScheduledSession[];
  movedTarget: ScheduledSession | null;
  affectedDates: string[];
} {
  const sourceById = new Map(
    opts.sourceSessions.map((session) => [session.id, session]),
  );
  const makeupRows = opts.proposal.updated_sessions.filter(
    (session) => session.rescheduled_from_id,
  );
  const targetMakeup = makeupRows.find(
    (session) => session.rescheduled_from_id === opts.target.id,
  );
  const movedSourceIds = new Set(
    makeupRows
      .map((session) => session.rescheduled_from_id)
      .filter((id): id is string => Boolean(id)),
  );
  const skippedSupportIds = new Set(
    opts.proposal.skipped_sessions
      .filter(
        (session) =>
          session.id !== opts.target.id &&
          !isMainWorkoutRole(session.day_role),
      )
      .map((session) => session.id),
  );

  let movedTarget: ScheduledSession | null = null;
  const cleaned = opts.proposal.updated_sessions
    .filter(
      (session) =>
        !movedSourceIds.has(session.id) &&
        !skippedSupportIds.has(session.id),
    )
    .map((session) => {
      if (!session.rescheduled_from_id) return session;
      const source = sourceById.get(session.rescheduled_from_id);
      if (!source) return session;

      const isTarget = source.id === opts.target.id;
      const moved: ScheduledSession = {
        ...session,
        original_date: source.original_date,
        routine_template_id: source.routine_template_id,
        day_role: source.day_role,
        status: "scheduled",
        completed_at: null,
        missed_reason: null,
        sequence_index: source.sequence_index,
        rescheduled_from_id: null,
        generated_from_schedule: false,
        manually_rescheduled: false,
        auto_rescheduled: true,
        missed_note: isTarget
          ? `${MOVED_ORIGINAL_PREFIX} from ${source.date}; replacement-history=${opts.replacementHistory.join(",")}`
          : `Automatic cascade from ${source.date}`,
      };
      if (isTarget) movedTarget = moved;
      return moved;
    });

  if (!movedTarget && targetMakeup) {
    movedTarget =
      cleaned.find((session) => session.id === targetMakeup.id) ?? null;
  }

  const affected = new Set<string>([opts.target.date]);
  for (const move of opts.proposal.moved_sessions) {
    affected.add(move.from_date);
    affected.add(move.to_date);
  }

  return {
    sessions: cleaned,
    movedTarget,
    affectedDates: [...affected],
  };
}

function substitute(
  target: ScheduledSession,
  sessions: ScheduledSession[],
  cycle: TrainingCycle,
  checkins: WellbeingCheckin[],
  today: string,
): SmartScheduleResult {
  if (isFixedReplacement(target)) {
    return {
      changed: false,
      updated_sessions: sessions,
      explanation:
        "This is a fixed replacement. Adjust the moved original workout if you still cannot perform the original activity.",
      action: "none",
    };
  }

  const oldName =
    getRoutineById(target.routine_template_id)?.name ??
    target.day_role.replaceAll("_", " ");
  const replacement = chooseReplacement({
    target,
    sessions,
    checkins,
  });

  if (!replacement) {
    return {
      changed: false,
      updated_sessions: sessions,
      explanation:
        "Boxing and Gym have already both been used as replacements for this original workout chain. The original workout was left in place.",
      action: "none",
    };
  }

  const newName =
    getRoutineById(replacement.routineId)?.name ??
    replacement.role.replaceAll("_", " ");
  const fixedReplacement = makeFixedReplacement({
    target,
    replacement,
    oldName,
    newName,
  });

  // Climbing uses the generic main-workout cascade here so the original
  // climbing stimulus can move while the fixed replacement reserves the old
  // date. This lets downstream mains shift safely instead of deleting climb.
  const planningTarget =
    target.day_role === "climbing"
      ? {
          ...target,
          day_role: "calisthenics_volume" as DayRole,
        }
      : target;

  const sourceWithReplacement = [...sessions, fixedReplacement];
  const proposal = recalculateSchedule({
    missedSession: planningTarget,
    upcomingSessions: sourceWithReplacement,
    cycle,
    reason: "no_time",
  });

  const targetMakeup = proposal.updated_sessions.find(
    (session) => session.rescheduled_from_id === target.id,
  );
  if (
    proposal.recommendation !== "apply" ||
    proposal.moved_sessions.length === 0 ||
    !targetMakeup
  ) {
    return {
      changed: false,
      updated_sessions: sessions,
      explanation:
        "No safe slot was available to move the original workout, so no replacement was inserted. The original schedule was kept intact.",
      action: "none",
    };
  }

  const history = [
    ...replacementHistory(target),
    replacement.historyToken,
  ];
  const cleaned = cleanAdaptiveMoveProposal({
    proposal,
    sourceSessions: sourceWithReplacement,
    target,
    replacementId: fixedReplacement.id,
    replacementHistory: history,
  });
  if (!cleaned.movedTarget) {
    return {
      changed: false,
      updated_sessions: sessions,
      explanation:
        "The original workout could not be moved safely, so the replacement was cancelled.",
      action: "none",
    };
  }

  let updated = cleaned.sessions.map((session) =>
    session.id === fixedReplacement.id
      ? {
          ...session,
          missed_note:
            `${FIXED_REPLACEMENT_PREFIX} ${oldName} → ${newName}. Original moved to ${cleaned.movedTarget!.date}`,
        }
      : session,
  );

  updated = reconcileDailySkillSlots(
    updated,
    cleaned.affectedDates,
    target.user_id,
    cycle,
  );
  updated = canonicalizeLiveScheduleRows(updated);

  if (!respectsMainWorkoutBoundaries(updated)) {
    return {
      changed: false,
      updated_sessions: sessions,
      explanation:
        "The replacement would exceed the hard limit of one main workout per day or four main workouts in the calendar week, so the original schedule was kept.",
      action: "none",
    };
  }

  return {
    changed: true,
    updated_sessions: updated,
    explanation:
      `${newName} is fixed on ${target.date}. The original ${oldName} moved to ${cleaned.movedTarget.date}. If the moved original still cannot be done, use Auto substitute on that moved original.`,
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
        generated_from_schedule: false,
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

  if (isFixedReplacement(target)) {
    return {
      changed: false,
      updated_sessions: opts.sessions,
      explanation:
        "Fixed replacements stay on their assigned date. Adjust the moved original workout instead.",
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
      opts.today,
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
