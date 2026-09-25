import type {
  AdaptiveSessionKind,
  DayRole,
  MissReason,
  ScheduleAdjustmentProposal,
  ScheduledSession,
  ScheduleMove,
  TrainingCycle,
  TrainingPause,
} from "@/lib/types";
import { getRoutineById } from "@/lib/seed/routines";
import { addDays, uid, weekday } from "@/lib/utils";
import { cycleWeekForDate, isShortRole } from "@/lib/training/schedule";
import { normalizeScheduledSession } from "@/lib/training/normalize-schedule";

export const MIN_MAIN_SESSION_GAP = 1;
export const MAX_MAIN_WORKOUTS_PER_DAY = 1;
export const MAX_MAIN_WORKOUTS_PER_CALENDAR_WEEK = 4;

const MAIN_ROLES: DayRole[] = [
  "strength_power",
  "athleticism_endurance",
  "calisthenics_volume",
  "gym_workout",
  "climbing",
];

const ACTIVE_STATUSES = new Set([
  "scheduled",
  "in_progress",
  "pending_missed_confirmation",
  "overdue",
]);

const MAIN_LOAD_STATUSES = new Set<ScheduledSession["status"]>([
  "scheduled",
  "in_progress",
  "pending_missed_confirmation",
  "overdue",
  "completed",
  "partially_completed",
]);

export function classifySession(
  session: Pick<ScheduledSession, "day_role" | "cycle_week" | "is_deload">,
): AdaptiveSessionKind {
  const { day_role: role } = session;
  const deload = session.is_deload || session.cycle_week === 4;

  if (role === "climbing") return "CLIMBING";
  if (role === "boxing") return "BOXING";
  if (role === "swim_performance" || role === "swim_recovery") return "SWIMMING";
  if (role === "daily_skill_practice") return "SKILL_PRACTICE";
  if (role === "short_deep_flex") return "DEEP_FLEXIBILITY";
  if (
    role === "short_mobility_front" ||
    role === "short_recovery" ||
    role === "recovery"
  ) {
    return "MOBILITY_RECOVERY";
  }
  if (MAIN_ROLES.includes(role)) {
    return deload ? "DELOAD_WORKOUT" : "MAIN_WORKOUT";
  }
  return "MOBILITY_RECOVERY";
}

export function isMainWorkoutRole(role: DayRole): boolean {
  return MAIN_ROLES.includes(role);
}

export function isActiveScheduled(status: ScheduledSession["status"]): boolean {
  return ACTIVE_STATUSES.has(status);
}

function roleLabel(role: DayRole): string {
  return role.replaceAll("_", " ");
}

function sessionLabel(s: ScheduledSession): string {
  return getRoutineById(s.routine_template_id)?.name ?? roleLabel(s.day_role);
}

function daysBetween(a: string, b: string): number {
  const ms =
    new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime();
  return Math.round(ms / 86400000);
}

function sortByDate(sessions: ScheduledSession[]): ScheduledSession[] {
  return [...sessions].sort((a, b) => a.date.localeCompare(b.date));
}

function countsTowardMainLoad(session: ScheduledSession): boolean {
  return (
    isMainWorkoutRole(session.day_role) &&
    MAIN_LOAD_STATUSES.has(session.status)
  );
}

function calendarWeekStart(date: string): string {
  const wd = weekday(date);
  const daysFromMonday = wd === 0 ? 6 : wd - 1;
  return addDays(date, -daysFromMonday);
}

function mainCountOnDate(
  sessions: ScheduledSession[],
  date: string,
  exceptIds: Set<string> = new Set(),
): number {
  return sessions.filter(
    (session) =>
      !exceptIds.has(session.id) &&
      session.date === date &&
      countsTowardMainLoad(session),
  ).length;
}

function mainCountInCalendarWeek(
  sessions: ScheduledSession[],
  date: string,
  exceptIds: Set<string> = new Set(),
): number {
  const weekStart = calendarWeekStart(date);
  const weekEnd = addDays(weekStart, 6);
  return sessions.filter(
    (session) =>
      !exceptIds.has(session.id) &&
      session.date >= weekStart &&
      session.date <= weekEnd &&
      countsTowardMainLoad(session),
  ).length;
}

export function respectsMainWorkoutBoundaries(
  sessions: ScheduledSession[],
): boolean {
  const dayCounts = new Map<string, number>();
  const weekCounts = new Map<string, number>();

  for (const session of sessions) {
    if (!countsTowardMainLoad(session)) continue;
    dayCounts.set(session.date, (dayCounts.get(session.date) ?? 0) + 1);
    const week = calendarWeekStart(session.date);
    weekCounts.set(week, (weekCounts.get(week) ?? 0) + 1);
  }

  return (
    [...dayCounts.values()].every(
      (count) => count <= MAX_MAIN_WORKOUTS_PER_DAY,
    ) &&
    [...weekCounts.values()].every(
      (count) => count <= MAX_MAIN_WORKOUTS_PER_CALENDAR_WEEK,
    )
  );
}

function canPlaceMainOnDate(
  candidate: string,
  sessions: ScheduledSession[],
  exceptIds: Set<string> = new Set(),
): boolean {
  if (
    mainCountOnDate(sessions, candidate, exceptIds) >=
    MAX_MAIN_WORKOUTS_PER_DAY
  ) {
    return false;
  }
  if (
    mainCountInCalendarWeek(sessions, candidate, exceptIds) >=
    MAX_MAIN_WORKOUTS_PER_CALENDAR_WEEK
  ) {
    return false;
  }
  return true;
}

function occupiedDates(
  sessions: ScheduledSession[],
  exceptIds: Set<string> = new Set(),
): Set<string> {
  const set = new Set<string>();
  for (const session of sessions) {
    if (exceptIds.has(session.id)) continue;
    if (!countsTowardMainLoad(session)) continue;
    set.add(session.date);
  }
  return set;
}

function hasMainGap(
  candidate: string,
  mainDates: Set<string>,
  gap = MIN_MAIN_SESSION_GAP,
): boolean {
  for (const d of mainDates) {
    const dist = Math.abs(daysBetween(candidate, d));
    if (dist === 0) return false;
    if (dist <= gap) return false;
  }
  return true;
}

function findNextMainSlot(opts: {
  fromDate: string;
  sessions: ScheduledSession[];
  cycle: TrainingCycle;
  exceptIds?: Set<string>;
  preferWeekend?: boolean;
  maxLookahead?: number;
  allowDeloadWeek?: boolean;
  sourceWeek: 1 | 2 | 3 | 4;
}): string | null {
  const except = opts.exceptIds ?? new Set();
  const mains = occupiedDates(opts.sessions, except);
  const max = opts.maxLookahead ?? 14;

  for (let i = 1; i <= max; i++) {
    const date = addDays(opts.fromDate, i);
    const week = cycleWeekForDate(opts.cycle.start_date, date);

    // Never dump Week 3 catch-up into Week 4 deload
    if (
      !opts.allowDeloadWeek &&
      opts.sourceWeek <= 3 &&
      week === 4 &&
      opts.sourceWeek === 3
    ) {
      continue;
    }
    if (!opts.allowDeloadWeek && opts.sourceWeek < 4 && week === 4) {
      // allow only if source was already deload
      if (opts.sourceWeek !== 4) continue;
    }

    if (opts.preferWeekend) {
      const wd = weekday(date);
      if (wd !== 0 && wd !== 6) continue;
    }

    if (!canPlaceMainOnDate(date, opts.sessions, except)) continue;
    if (!hasMainGap(date, mains)) continue;
    return date;
  }
  return null;
}

function markTerminal(
  session: ScheduledSession,
  status: "missed" | "skipped",
  reason: MissReason | null,
  extras: Partial<ScheduledSession> = {},
): ScheduledSession {
  return normalizeScheduledSession({
    ...session,
    status,
    missed_reason: reason,
    ...extras,
  });
}

function cloneAsMakeup(
  from: ScheduledSession,
  toDate: string,
  cycle: TrainingCycle,
): ScheduledSession {
  const week = cycleWeekForDate(cycle.start_date, toDate);
  return normalizeScheduledSession({
    id: uid("sched"),
    user_id: from.user_id,
    date: toDate,
    original_date: from.original_date || from.date,
    routine_template_id: from.routine_template_id,
    cycle_week: week,
    cycle_number: from.cycle_number || cycle.cycle_number,
    day_role: from.day_role,
    status: "scheduled",
    generated_from_schedule: false,
    completed_at: null,
    reschedule_count: (from.reschedule_count ?? 0) + 1,
    missed_reason: null,
    sequence_index: from.sequence_index,
    is_deload: week === 4,
    auto_rescheduled: true,
    manually_rescheduled: false,
    rescheduled_from_id: from.id,
    missed_note: null,
    injury_area: null,
    injury_exercise: null,
  });
}

function displaceShortOnDate(
  working: ScheduledSession[],
  date: string,
  cycle: TrainingCycle,
  moves: ScheduleMove[],
  skipped: ScheduledSession[],
  merged: ScheduleMove[],
  options: { preserveSkillPractice?: boolean } = {},
): ScheduledSession[] {
  let next = [...working];
  const blockers = next.filter(
    (s) =>
      s.date === date &&
      isActiveScheduled(s.status) &&
      (isShortRole(s.day_role) || s.day_role === "recovery") &&
      !(
        options.preserveSkillPractice &&
        s.day_role === "daily_skill_practice"
      ),
  );

  for (const short of blockers) {
    const kind = classifySession(short);
    // Mobility usually skip rather than cram; deep flex may move 1 day
    if (kind === "MOBILITY_RECOVERY" || kind === "SKILL_PRACTICE") {
      const marked = markTerminal(short, "skipped", null);
      skipped.push(marked);
      next = next.map((s) => (s.id === short.id ? marked : s));
      continue;
    }
    if (kind === "DEEP_FLEXIBILITY") {
      const fri = addDays(date, 1);
      const week = cycleWeekForDate(cycle.start_date, fri);
      const conflict = next.some(
        (s) =>
          s.date === fri &&
          isActiveScheduled(s.status) &&
          isMainWorkoutRole(s.day_role),
      );
      if (!conflict && week !== 4) {
        const moved = normalizeScheduledSession({
          ...short,
          date: fri,
          cycle_week: week,
          is_deload: false,
          auto_rescheduled: true,
          reschedule_count: short.reschedule_count + 1,
        });
        moves.push({
          from_date: short.date,
          to_date: fri,
          session_id: short.id,
          day_role: short.day_role,
          routine_template_id: short.routine_template_id,
          label: sessionLabel(short),
        });
        merged.push(moves[moves.length - 1]!);
        next = next.map((s) => (s.id === short.id ? moved : s));
      } else {
        const marked = markTerminal(short, "skipped", null);
        skipped.push(marked);
        next = next.map((s) => (s.id === short.id ? marked : s));
      }
    }
  }
  return next;
}

function consecutiveMissedDays(
  sessions: ScheduledSession[],
  beforeDate: string,
): number {
  let count = 0;
  for (let i = 1; i <= 21; i++) {
    const d = addDays(beforeDate, -i);
    const dayRows = sessions.filter((s) => s.date === d);
    if (dayRows.length === 0) continue;
    const meaningful = dayRows.filter(
      (s) =>
        isMainWorkoutRole(s.day_role) ||
        s.day_role.startsWith("swim") ||
        s.day_role === "climbing",
    );
    if (meaningful.length === 0) continue;
    const allMissed = meaningful.every(
      (s) => s.status === "missed" || s.status === "skipped",
    );
    const anyDone = meaningful.some(
      (s) => s.status === "completed" || s.status === "partially_completed",
    );
    if (anyDone) break;
    if (allMissed) count += 1;
    else if (meaningful.some((s) => isActiveScheduled(s.status))) break;
  }
  return count;
}

export function buildTrainingPause(
  reason: MissReason,
  missedDays: number,
  pausedAt: string,
): TrainingPause {
  let return_protocol: TrainingPause["return_protocol"] = "none";
  if (missedDays >= 14) return_protocol = "full";
  else if (missedDays >= 7) return_protocol = "mild";
  return {
    active: true,
    reason,
    paused_at: pausedAt,
    missed_days: missedDays,
    return_protocol,
  };
}

export function detectPendingMissedSessions(
  sessions: ScheduledSession[],
  today: string,
): ScheduledSession[] {
  return sortByDate(sessions).filter((s) => {
    if (s.day_role === "recovery") return false;
    if (s.status === "pending_missed_confirmation" || s.status === "overdue") {
      return true;
    }
    if (!isActiveScheduled(s.status)) return false;
    if (s.date >= today) return false;
    return true;
  });
}

export function markPastSessionsPending(
  sessions: ScheduledSession[],
  today: string,
): ScheduledSession[] {
  return sessions.map((s) => {
    if (!isActiveScheduled(s.status)) return normalizeScheduledSession(s);
    if (s.date >= today) return normalizeScheduledSession(s);
    if (s.status === "in_progress") return normalizeScheduledSession(s);
    if (s.day_role === "recovery") return normalizeScheduledSession(s);
    return normalizeScheduledSession({
      ...s,
      status: "pending_missed_confirmation",
    });
  });
}

/**
 * Core adaptive engine. Preserves missed history; creates makeup rows instead of rewriting dates.
 */
export function recalculateSchedule(opts: {
  missedSession: ScheduledSession;
  upcomingSessions: ScheduledSession[];
  cycle: TrainingCycle;
  reason: MissReason | null;
  injuryArea?: string | null;
  injuryExercise?: string | null;
  forceSkip?: boolean;
  manualTargetDate?: string | null;
}): ScheduleAdjustmentProposal {
  const reason = opts.reason;
  const cycle = opts.cycle;
  const missed = normalizeScheduledSession(opts.missedSession);
  const kind = classifySession(missed);
  const all = sortByDate(
    opts.upcomingSessions.map(normalizeScheduledSession),
  );
  const moves: ScheduleMove[] = [];
  const skipped: ScheduledSession[] = [];
  const merged: ScheduleMove[] = [];
  const warnings: string[] = [];
  const proposalId = uid("adj");

  const streak = consecutiveMissedDays(all, missed.date);
  if (streak >= 3 && streak < 7) {
    warnings.push(
      "Several days were missed — only the next core workout will be reorganised; low-priority sessions will be skipped.",
    );
  }
  if (streak >= 7) {
    warnings.push(
      "Training interruption detected — a return-to-training week is recommended instead of catching up every session.",
    );
  }

  // Illness: pause rather than cascade
  if (reason === "illness") {
    const marked = markTerminal(missed, "missed", reason);
    const updated = all.map((s) => (s.id === missed.id ? marked : s));
    return {
      id: proposalId,
      missed_session_id: missed.id,
      reason,
      updated_sessions: updated,
      moved_sessions: [],
      skipped_sessions: [marked],
      merged_recovery_sessions: [],
      warnings: [
        "Training paused while recovering. Resume when ready — do not keep shifting workouts forward.",
      ],
      explanation:
        "Illness noted. Programme paused instead of rescheduling demanding work.",
      recommendation: "pause",
    };
  }

  // Pain/injury: do not auto-reschedule the same demanding activity
  if (reason === "pain_or_injury") {
    const marked = markTerminal(missed, "missed", reason, {
      injury_area: opts.injuryArea ?? null,
      injury_exercise: opts.injuryExercise ?? null,
    });
    const updated = all.map((s) => (s.id === missed.id ? marked : s));
    return {
      id: proposalId,
      missed_session_id: missed.id,
      reason,
      updated_sessions: updated,
      moved_sessions: [],
      skipped_sessions: [marked],
      merged_recovery_sessions: [],
      warnings: [
        "Pain/injury noted — this session was not automatically moved. Affected exercises will not progress until completed successfully again.",
      ],
      explanation: `Marked missed due to pain/injury${
        opts.injuryArea ? ` (${opts.injuryArea})` : ""
      }. No automatic makeup.`,
      recommendation: "skip_and_resume",
    };
  }

  // Fatigue / poor sleep: prefer recovery — skip makeup for non-core, delay core
  const preferRecovery =
    reason === "fatigue" || reason === "poor_sleep" || reason === "intentional_rest";

  const skipKinds: AdaptiveSessionKind[] = [
    "MOBILITY_RECOVERY",
    "SKILL_PRACTICE",
    "DAILY_MAINTENANCE",
  ];

  if (
    opts.forceSkip ||
    skipKinds.includes(kind) ||
    (kind === "DEEP_FLEXIBILITY" && preferRecovery) ||
    (kind === "DELOAD_WORKOUT" && !opts.manualTargetDate) ||
    (streak >= 3 && kind !== "MAIN_WORKOUT" && kind !== "CLIMBING")
  ) {
    const marked = markTerminal(
      missed,
      kind === "MOBILITY_RECOVERY" || kind === "SKILL_PRACTICE"
        ? "skipped"
        : "missed",
      reason,
    );
    const updated = all.map((s) => (s.id === missed.id ? marked : s));
    const explanation =
      kind === "MOBILITY_RECOVERY"
        ? "No rescheduling needed. Upcoming sessions already include skill and mobility work — missed practice stays missed."
        : kind === "DELOAD_WORKOUT"
          ? "Deload sessions are not compensated with extra volume. Resume the deload plan as written."
          : "Session marked missed/skipped. Programme continues without doubling volume.";
    return {
      id: proposalId,
      missed_session_id: missed.id,
      reason,
      updated_sessions: updated,
      moved_sessions: [],
      skipped_sessions: [marked],
      merged_recovery_sessions: [],
      warnings,
      explanation,
      recommendation: "skip_and_resume",
    };
  }

  // Swimming / boxing: find a low-load slot in the next 7 days; never displace core.
  if (kind === "SWIMMING" || kind === "BOXING") {
    const specialty = kind === "BOXING" ? "Boxing" : "Swimming";
    const marked = markTerminal(missed, "missed", reason);
    let working = all.map((s) => (s.id === missed.id ? marked : s));
    let target: string | null = opts.manualTargetDate ?? null;
    if (!target) {
      for (let i = 1; i <= 7; i++) {
        const date = addDays(missed.date, i);
        const wd = weekday(date);
        const preferred = wd === 0 || wd === 2 || wd === 5;
        if (!preferred && !opts.manualTargetDate) continue;
        const hasMain = working.some(
          (s) =>
            s.date === date &&
            isActiveScheduled(s.status) &&
            isMainWorkoutRole(s.day_role),
        );
        const nextDay = addDays(date, 1);
        const mainNext = working.some(
          (s) =>
            s.date === nextDay &&
            isActiveScheduled(s.status) &&
            isMainWorkoutRole(s.day_role),
        );
        if (hasMain || mainNext) continue;
        target = date;
        break;
      }
    }
    if (!target) {
      const skippedSwim = markTerminal(missed, "skipped", reason);
      working = all.map((s) => (s.id === missed.id ? skippedSwim : s));
      return {
        id: proposalId,
        missed_session_id: missed.id,
        reason,
        updated_sessions: working,
        moved_sessions: [],
        skipped_sessions: [skippedSwim],
        merged_recovery_sessions: [],
        warnings: [
          `No suitable ${specialty.toLowerCase()} slot found without displacing a core workout.`,
        ],
        explanation: `${specialty} skipped — core sessions take priority.`,
        recommendation: "skip_and_resume",
      };
    }
    working = displaceShortOnDate(
      working,
      target,
      cycle,
      moves,
      skipped,
      merged,
      { preserveSkillPractice: true },
    );
    const makeup = cloneAsMakeup(missed, target, cycle);
    working = [...working, makeup];
    moves.push({
      from_date: missed.date,
      to_date: target,
      session_id: makeup.id,
      day_role: missed.day_role,
      routine_template_id: missed.routine_template_id,
      label: sessionLabel(missed),
    });
    return {
      id: proposalId,
      missed_session_id: missed.id,
      reason,
      updated_sessions: sortByDate(working),
      moved_sessions: moves,
      skipped_sessions: skipped.concat(marked),
      merged_recovery_sessions: merged,
      warnings,
      explanation: `${specialty} moved ${missed.date} → ${target}. Daily OAHS + planche remains separate; other low-priority short work may be skipped to avoid stacking.`,
      recommendation: "apply",
    };
  }

  // Climbing: weekend slot; may push Monday strength
  if (kind === "CLIMBING") {
    const marked = markTerminal(missed, "missed", reason);
    let working = all.map((s) => (s.id === missed.id ? marked : s));
    const manualTarget =
      opts.manualTargetDate &&
      canPlaceMainOnDate(
        opts.manualTargetDate,
        working,
        new Set([missed.id]),
      ) &&
      hasMainGap(
        opts.manualTargetDate,
        occupiedDates(working, new Set([missed.id])),
      )
        ? opts.manualTargetDate
        : null;
    const target =
      manualTarget ??
      findNextMainSlot({
        fromDate: missed.date,
        sessions: working,
        cycle,
        exceptIds: new Set([missed.id]),
        preferWeekend: true,
        maxLookahead: 14,
        sourceWeek: missed.cycle_week,
      });

    if (!target) {
      return {
        id: proposalId,
        missed_session_id: missed.id,
        reason,
        updated_sessions: working,
        moved_sessions: [],
        skipped_sessions: [marked],
        merged_recovery_sessions: [],
        warnings: warnings.concat([
          "No slot satisfies the one-main-workout-per-day, recovery-gap, and four-main-workouts-per-week limits.",
        ]),
        explanation:
          "Climbing skipped rather than overloading the day or calendar week.",
        recommendation: "skip_and_resume",
      };
    }

    working = displaceShortOnDate(
      working,
      target,
      cycle,
      moves,
      skipped,
      merged,
    );
    const makeup = cloneAsMakeup(missed, target, cycle);
    working = [...working, makeup];
    moves.push({
      from_date: missed.date,
      to_date: target,
      session_id: makeup.id,
      day_role: missed.day_role,
      routine_template_id: missed.routine_template_id,
      label: sessionLabel(missed),
    });

    // If Sunday climb, shift next Strength off Monday
    if (weekday(target) === 0) {
      const monday = addDays(target, 1);
      const strength = working.find(
        (s) =>
          s.date === monday &&
          s.day_role === "strength_power" &&
          isActiveScheduled(s.status),
      );
      if (strength) {
        const strengthTarget = findNextMainSlot({
          fromDate: monday,
          sessions: working,
          cycle,
          exceptIds: new Set([strength.id]),
          maxLookahead: 7,
          sourceWeek: strength.cycle_week,
          allowDeloadWeek: strength.cycle_week === 4,
        });
        const strengthMissed = markTerminal(strength, "missed", null);
        working = working.map((session) =>
          session.id === strength.id ? strengthMissed : session,
        );

        if (strengthTarget) {
          working = displaceShortOnDate(
            working,
            strengthTarget,
            cycle,
            moves,
            skipped,
            merged,
          );
          const strengthMakeup = cloneAsMakeup(
            strength,
            strengthTarget,
            cycle,
          );
          working = working.concat(strengthMakeup);
          moves.push({
            from_date: monday,
            to_date: strengthTarget,
            session_id: strengthMakeup.id,
            day_role: strength.day_role,
            routine_template_id: strength.routine_template_id,
            label: sessionLabel(strength),
          });
          warnings.push(
            `Monday Strength shifted to ${strengthTarget} to protect recovery after Sunday climbing.`,
          );
        } else {
          skipped.push(strengthMissed);
          warnings.push(
            "Monday Strength could not be moved without breaking the main-workout limits, so it was skipped.",
          );
        }
      }
    }

    return {
      id: proposalId,
      missed_session_id: missed.id,
      reason,
      updated_sessions: sortByDate(working),
      moved_sessions: moves,
      skipped_sessions: skipped.concat(marked),
      merged_recovery_sessions: merged,
      warnings,
      explanation: `Climbing moved ${missed.date} → ${target}.`,
      recommendation: "apply",
    };
  }

  // Deep flexibility alone
  if (kind === "DEEP_FLEXIBILITY") {
    const marked = markTerminal(missed, "missed", reason);
    let working = all.map((s) => (s.id === missed.id ? marked : s));
    const target = opts.manualTargetDate ?? addDays(missed.date, 1);
    const week = cycleWeekForDate(cycle.start_date, target);
    const heavyNext = working.some(
      (s) =>
        s.date === addDays(target, 1) &&
        isActiveScheduled(s.status) &&
        isMainWorkoutRole(s.day_role),
    );
    if (heavyNext || week === 4) {
      return {
        id: proposalId,
        missed_session_id: missed.id,
        reason,
        updated_sessions: working,
        moved_sessions: [],
        skipped_sessions: [marked],
        merged_recovery_sessions: [],
        warnings,
        explanation:
          "Deep flexibility skipped — better than stacking fatigue before a heavy day.",
        recommendation: "skip_and_resume",
      };
    }
    const makeup = cloneAsMakeup(missed, target, cycle);
    working = [...working, makeup];
    moves.push({
      from_date: missed.date,
      to_date: target,
      session_id: makeup.id,
      day_role: missed.day_role,
      routine_template_id: missed.routine_template_id,
      label: sessionLabel(missed),
    });
    return {
      id: proposalId,
      missed_session_id: missed.id,
      reason,
      updated_sessions: sortByDate(working),
      moved_sessions: moves,
      skipped_sessions: [marked],
      merged_recovery_sessions: merged,
      warnings,
      explanation: `Deep flexibility moved ${missed.date} → ${target}.`,
      recommendation: "apply",
    };
  }

  // MAIN / DELOAD workout cascade
  const marked = markTerminal(missed, "missed", reason);
  let working = all.map((s) => (s.id === missed.id ? marked : s));

  // Optional: skip Saturday rather than squeeze before Monday
  if (
    opts.forceSkip ||
    (kind === "MAIN_WORKOUT" &&
      weekday(missed.date) === 6 &&
      !opts.manualTargetDate &&
      reason === "intentional_rest")
  ) {
    return {
      id: proposalId,
      missed_session_id: missed.id,
      reason,
      updated_sessions: working,
      moved_sessions: [],
      skipped_sessions: [marked],
      merged_recovery_sessions: [],
      warnings,
      explanation: "Session skipped — resume the normal programme sequence.",
      recommendation: "skip_and_resume",
    };
  }

  // Upcoming mains after the missed date (not including missed)
  const futureMains = working.filter(
    (s) =>
      s.id !== missed.id &&
      isActiveScheduled(s.status) &&
      isMainWorkoutRole(s.day_role) &&
      s.date > missed.date,
  );

  // Place missed main first, then cascade subsequent mains to keep gaps + order
  const chain: ScheduledSession[] = [missed, ...futureMains];
  let cursor = missed.date;

  for (let idx = 0; idx < chain.length; idx++) {
    const session = chain[idx]!;
    const isFirst = idx === 0;

    // For long interruptions, only place the next core workout
    if (streak >= 3 && !isFirst) break;

    // Deload protection: don't move week-3 mains into week 4
    if (session.cycle_week === 3) {
      const tentative = findNextMainSlot({
        fromDate: cursor,
        sessions: working,
        cycle,
        exceptIds: new Set([session.id, missed.id]),
        sourceWeek: session.cycle_week,
        allowDeloadWeek: false,
        maxLookahead: 10,
      });
      if (!tentative) {
        if (isFirst) {
          // cannot place — skip
          warnings.push(
            "Could not place this Week 3 workout before deload — skipping rather than dumping volume into Week 4.",
          );
          return {
            id: proposalId,
            missed_session_id: missed.id,
            reason,
            updated_sessions: working,
            moved_sessions: moves,
            skipped_sessions: skipped.concat(marked),
            merged_recovery_sessions: merged,
            warnings,
            explanation:
              "Week 3 session skipped to protect deload week. No catch-up volume in Week 4.",
            recommendation: "skip_and_resume",
          };
        }
        break;
      }
    }

    const manualExceptIds = new Set(
      chain.slice(idx).map((candidate) => candidate.id).concat(missed.id),
    );
    const manualMainTarget =
      isFirst &&
      opts.manualTargetDate &&
      canPlaceMainOnDate(
        opts.manualTargetDate,
        working,
        manualExceptIds,
      ) &&
      hasMainGap(
        opts.manualTargetDate,
        occupiedDates(working, manualExceptIds),
      )
        ? opts.manualTargetDate
        : null;

    if (isFirst && opts.manualTargetDate && !manualMainTarget) {
      warnings.push(
        "Requested target rejected: it would break the one-main-per-day, recovery-gap, or four-main-per-week boundary.",
      );
    }

    const target =
      manualMainTarget ??
      findNextMainSlot({
            fromDate: isFirst ? missed.date : cursor,
            sessions: working,
            cycle,
            exceptIds: new Set(
              chain.slice(idx).map((c) => c.id).concat(missed.id),
            ),
            sourceWeek: session.cycle_week,
            allowDeloadWeek: session.cycle_week === 4,
            maxLookahead: preferRecovery && isFirst ? 4 : 14,
          });

    if (!target) {
      if (isFirst) {
        return {
          id: proposalId,
          missed_session_id: missed.id,
          reason,
          updated_sessions: working,
          moved_sessions: moves,
          skipped_sessions: skipped.concat(marked),
          merged_recovery_sessions: merged,
          warnings: warnings.concat([
            "No recovery-safe slot found — recommending skip and resume.",
          ]),
          explanation:
            "Recommended: skip this session and resume normally to protect recovery.",
          recommendation: "skip_and_resume",
        };
      }
      break;
    }

    // If already on target (future main that doesn't need moving), advance cursor
    if (!isFirst && session.date === target) {
      cursor = target;
      continue;
    }

    // If future main already has enough gap from previous placement, leave it
    if (!isFirst) {
      const prevDate = cursor;
      if (daysBetween(prevDate, session.date) > MIN_MAIN_SESSION_GAP) {
        cursor = session.date;
        continue;
      }
    }

    working = displaceShortOnDate(
      working,
      target,
      cycle,
      moves,
      skipped,
      merged,
    );

    if (isFirst) {
      const makeup = cloneAsMakeup(missed, target, cycle);
      working = [...working, makeup];
      moves.push({
        from_date: missed.date,
        to_date: target,
        session_id: makeup.id,
        day_role: missed.day_role,
        routine_template_id: missed.routine_template_id,
        label: sessionLabel(missed),
      });
      cursor = target;
    } else {
      // Move this main: preserve history via missed + makeup
      const old = markTerminal(session, "missed", null);
      const makeup = cloneAsMakeup(session, target, cycle);
      working = working
        .map((s) => (s.id === session.id ? old : s))
        .concat(makeup);
      moves.push({
        from_date: session.date,
        to_date: target,
        session_id: makeup.id,
        day_role: session.day_role,
        routine_template_id: session.routine_template_id,
        label: sessionLabel(session),
      });
      cursor = target;
    }
  }

  const lines = moves.map((m) => `${m.label}: ${m.from_date} → ${m.to_date}`);
  const explanation =
    lines.length > 0
      ? `Schedule adjusted to preserve A→B→C order and recovery gaps.\n${lines.join("\n")}`
      : "No moves required.";

  if (!respectsMainWorkoutBoundaries(working)) {
    warnings.push(
      "Automatic reschedule cancelled because it would exceed a hard main-workout load boundary.",
    );
    return {
      id: proposalId,
      missed_session_id: missed.id,
      reason,
      updated_sessions: all.map((session) =>
        session.id === missed.id ? marked : session,
      ),
      moved_sessions: [],
      skipped_sessions: [marked],
      merged_recovery_sessions: [],
      warnings,
      explanation:
        "Missed main workout skipped rather than creating more than one main workout in a day or more than four in a calendar week.",
      recommendation: "skip_and_resume",
    };
  }

  // Saturday special: offer skip alternative via recommendation when squeeze is bad
  let recommendation: ScheduleAdjustmentProposal["recommendation"] = "apply";
  if (weekday(missed.date) === 6 && moves.length >= 3) {
    recommendation = "apply";
    warnings.push(
      "Alternative: skip Saturday and resume Monday for less disruption.",
    );
  }

  return {
    id: proposalId,
    missed_session_id: missed.id,
    reason,
    updated_sessions: sortByDate(working),
    moved_sessions: moves,
    skipped_sessions: skipped.concat(marked),
    merged_recovery_sessions: merged,
    warnings,
    explanation,
    recommendation,
  };
}

export function adherenceMetrics(sessions: ScheduledSession[]) {
  const planned = sessions.filter(
    (s) =>
      s.generated_from_schedule ||
      s.status !== "cancelled",
  );
  const core = planned.filter((s) => isMainWorkoutRole(s.day_role));
  const mobility = planned.filter(
    (s) => classifySession(s) === "MOBILITY_RECOVERY",
  );
  const skill = planned.filter((s) => classifySession(s) === "SKILL_PRACTICE");

  const count = (rows: ScheduledSession[]) => {
    const planned_sessions = rows.length;
    const completed_sessions = rows.filter(
      (s) => s.status === "completed" || s.status === "partially_completed",
    ).length;
    const missed_sessions = rows.filter(
      (s) => s.status === "missed" || s.status === "skipped",
    ).length;
    const rescheduled_sessions = rows.filter(
      (s) => s.auto_rescheduled || s.manually_rescheduled || s.rescheduled_from_id,
    ).length;
    const completed_after_reschedule = rows.filter(
      (s) =>
        (s.auto_rescheduled || s.rescheduled_from_id) &&
        (s.status === "completed" || s.status === "partially_completed"),
    ).length;
    const on_planned_date = rows.filter(
      (s) =>
        (s.status === "completed" || s.status === "partially_completed") &&
        s.date === s.original_date &&
        !s.rescheduled_from_id,
    ).length;
    const eventual = completed_sessions;
    return {
      planned_sessions,
      completed_sessions,
      missed_sessions,
      rescheduled_sessions,
      completed_after_reschedule,
      scheduled_adherence:
        planned_sessions === 0
          ? 1
          : on_planned_date / planned_sessions,
      eventual_completion_rate:
        planned_sessions === 0 ? 1 : eventual / planned_sessions,
    };
  };

  return {
    overall: count(planned),
    core: count(core),
    mobility: count(mobility),
    skill: count(skill),
  };
}
