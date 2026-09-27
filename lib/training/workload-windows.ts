import type {
  Block,
  SchedulePreferences,
  ScheduledSession,
  TrainingCycle,
} from "@/lib/types";
import { getRoutineById, getRoutineForDayRole } from "@/lib/seed/routines";
import {
  cycleWeekForDate,
  resolveDayRole,
} from "@/lib/training/schedule";
import { addDays, weekday } from "@/lib/utils";

export type WorkloadQuality =
  | "explosiveness"
  | "strength"
  | "endurance"
  | "climbing";

export interface WorkloadWindowStatus {
  quality: WorkloadQuality;
  label: string;
  window_start: string;
  nominal_end: string;
  effective_end: string;
  base_days: number;
  target_exposures: number;
  completed_exposures: number;
  lost_exposures: number;
  remaining_exposures: number;
  completion_ratio: number;
  extension_triggered: boolean;
  extension_days: number;
}

type QualityRule = {
  quality: WorkloadQuality;
  label: string;
  blocks: Block[];
  baseDays: number;
  minimumCompletionRatio: number;
};

export const WORKLOAD_QUALITY_RULES: QualityRule[] = [
  {
    quality: "explosiveness",
    label: "Explosiveness",
    blocks: ["power", "speed", "agility"],
    baseDays: 28,
    minimumCompletionRatio: 0.8,
  },
  {
    quality: "strength",
    label: "Strength",
    blocks: ["strength", "legs", "posterior", "volume"],
    baseDays: 28,
    minimumCompletionRatio: 0.8,
  },
  {
    quality: "endurance",
    label: "Endurance",
    blocks: ["run", "swim", "conditioning"],
    baseDays: 28,
    minimumCompletionRatio: 0.8,
  },
  {
    quality: "climbing",
    label: "Climbing",
    blocks: ["climb"],
    baseDays: 28,
    minimumCompletionRatio: 0.8,
  },
];

const COMPLETION_CREDIT: Partial<
  Record<ScheduledSession["status"], number>
> = {
  completed: 1,
  partially_completed: 0.5,
};

const FUTURE_EXPOSURE_STATUSES = new Set<ScheduledSession["status"]>([
  "scheduled",
  "in_progress",
  "pending_missed_confirmation",
  "overdue",
]);

function daysBetween(a: string, b: string): number {
  const ms =
    new Date(b + "T12:00:00").getTime() -
    new Date(a + "T12:00:00").getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

function routineHasQuality(
  routineId: string,
  blocks: Block[],
): boolean {
  const routine = getRoutineById(routineId);
  if (!routine) return false;
  return routine.items.some((item) => blocks.includes(item.block));
}

function basePlannedExposureDates(opts: {
  cycle: TrainingCycle;
  weekdayMap?: SchedulePreferences["weekday_map"];
  rule: QualityRule;
}): string[] {
  const out: string[] = [];
  for (let i = 0; i < opts.rule.baseDays; i += 1) {
    const date = addDays(opts.cycle.start_date, i);
    const cycleWeek = cycleWeekForDate(opts.cycle.start_date, date);
    const role = resolveDayRole(
      cycleWeek,
      weekday(date),
      opts.weekdayMap,
    );
    const routine = getRoutineForDayRole(role, cycleWeek);
    if (
      routine.items.some((item) =>
        opts.rule.blocks.includes(item.block),
      )
    ) {
      out.push(date);
    }
  }
  return out;
}

function completionDate(session: ScheduledSession): string {
  return session.completed_at?.slice(0, 10) ?? session.date;
}

function completedCredits(opts: {
  sessions: ScheduledSession[];
  rule: QualityRule;
  from: string;
  through: string;
}): number {
  return opts.sessions.reduce((sum, session) => {
    const credit = COMPLETION_CREDIT[session.status] ?? 0;
    if (credit <= 0) return sum;
    if (!routineHasQuality(session.routine_template_id, opts.rule.blocks)) {
      return sum;
    }
    const date = completionDate(session);
    if (date < opts.from || date > opts.through) return sum;
    return sum + credit;
  }, 0);
}

function projectEffectiveEnd(opts: {
  sessions: ScheduledSession[];
  rule: QualityRule;
  today: string;
  nominalEnd: string;
  remaining: number;
  averageIntervalDays: number;
}): string {
  if (opts.remaining <= 0) return opts.nominalEnd;

  const candidates = opts.sessions
    .filter(
      (session) =>
        session.date > opts.today &&
        FUTURE_EXPOSURE_STATUSES.has(session.status) &&
        routineHasQuality(
          session.routine_template_id,
          opts.rule.blocks,
        ),
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  let outstanding = opts.remaining;
  let lastDate = opts.today > opts.nominalEnd
    ? opts.today
    : opts.nominalEnd;

  for (const candidate of candidates) {
    outstanding -= 1;
    lastDate = candidate.date;
    if (outstanding <= 0) return lastDate;
  }

  return addDays(
    lastDate,
    Math.ceil(outstanding) * opts.averageIntervalDays,
  );
}

export function calculateWorkloadWindows(opts: {
  cycle: TrainingCycle;
  sessions: ScheduledSession[];
  today: string;
  weekdayMap?: SchedulePreferences["weekday_map"];
}): WorkloadWindowStatus[] {
  return WORKLOAD_QUALITY_RULES.map((rule) => {
    const windowStart = opts.cycle.start_date;
    const nominalEnd = addDays(windowStart, rule.baseDays - 1);
    const plannedDates = basePlannedExposureDates({
      cycle: opts.cycle,
      weekdayMap: opts.weekdayMap,
      rule,
    });
    const target = plannedDates.length;

    if (target === 0) {
      return {
        quality: rule.quality,
        label: rule.label,
        window_start: windowStart,
        nominal_end: nominalEnd,
        effective_end: nominalEnd,
        base_days: rule.baseDays,
        target_exposures: 0,
        completed_exposures: 0,
        lost_exposures: 0,
        remaining_exposures: 0,
        completion_ratio: 1,
        extension_triggered: false,
        extension_days: 0,
      };
    }

    const completedByNominal = completedCredits({
      sessions: opts.sessions,
      rule,
      from: windowStart,
      through: nominalEnd,
    });
    const lost = Math.max(0, target - completedByNominal);
    const completionRatio = Math.min(1, completedByNominal / target);
    const lostThreshold = Math.max(1, Math.ceil(target * 0.2));

    // Do not create catch-up debt mid-window. At the end of the nominal
    // period, extend only when enough exposure was actually lost to matter.
    const triggered =
      opts.today >= nominalEnd &&
      lost >= lostThreshold &&
      completionRatio < rule.minimumCompletionRatio;

    const throughToday =
      opts.today >= windowStart ? opts.today : windowStart;
    const completedToDate = triggered
      ? completedCredits({
          sessions: opts.sessions,
          rule,
          from: windowStart,
          through: throughToday,
        })
      : completedByNominal;
    const remaining = triggered
      ? Math.max(0, target - completedToDate)
      : 0;

    const averageIntervalDays = Math.max(
      1,
      Math.round(rule.baseDays / target),
    );
    const effectiveEnd = triggered
      ? remaining <= 0
        ? opts.today > nominalEnd
          ? opts.today
          : nominalEnd
        : projectEffectiveEnd({
            sessions: opts.sessions,
            rule,
            today: opts.today,
            nominalEnd,
            remaining,
            averageIntervalDays,
          })
      : nominalEnd;

    return {
      quality: rule.quality,
      label: rule.label,
      window_start: windowStart,
      nominal_end: nominalEnd,
      effective_end: effectiveEnd,
      base_days: rule.baseDays,
      target_exposures: target,
      completed_exposures: Math.min(target, completedToDate),
      lost_exposures: lost,
      remaining_exposures: remaining,
      completion_ratio: triggered
        ? Math.min(1, completedToDate / target)
        : completionRatio,
      extension_triggered: triggered,
      extension_days: triggered
        ? daysBetween(nominalEnd, effectiveEnd)
        : 0,
    };
  });
}
