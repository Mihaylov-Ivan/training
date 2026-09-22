import type { OnboardingDraft, ProgressionState } from "@/lib/types";
import { LOCAL_USER_ID } from "@/lib/types";

export function uid(_prefix?: string): string {
  void _prefix;
  return crypto.randomUUID();
}

export function todayISO(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekday(iso: string): number {
  return new Date(iso + "T12:00:00").getDay();
}

export function greetingForNow(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatPrescription(p: {
  sets?: number;
  reps_per_set?: number;
  hold_seconds?: number | null;
  distance_m?: number | null;
  duration_seconds?: number | null;
  load_kg?: number | null;
  exercise_level?: string | null;
  per_side?: boolean;
  notes?: string;
  protocol?: string;
}): string {
  const parts: string[] = [];
  const side = p.per_side ? " per side" : "";
  if (p.protocol) parts.push(`${p.protocol} protocol`);
  if (p.sets && p.reps_per_set != null) {
    parts.push(`${p.sets} × ${p.reps_per_set}${side}`);
  } else if (p.sets && p.hold_seconds != null) {
    parts.push(`${p.sets} × ${p.hold_seconds}s${side}`);
  } else if (p.hold_seconds != null && !p.sets) {
    parts.push(`${p.hold_seconds}s${side}`);
  }
  if (p.duration_seconds != null && p.duration_seconds > 0) {
    const m = Math.round(p.duration_seconds / 60);
    const duration =
      m >= 1 && p.duration_seconds % 60 === 0
        ? `${m} min`
        : `${p.duration_seconds}s`;
    parts.push(p.sets ? `${p.sets} × ${duration}` : duration);
  }
  if (p.distance_m != null) {
    parts.push(
      p.sets ? `${p.sets} × ${p.distance_m} m` : `${p.distance_m} m`,
    );
  }
  if (p.load_kg != null && p.load_kg > 0) parts.push(`+${p.load_kg} kg`);
  if (p.exercise_level) parts.push(p.exercise_level.replace(/_/g, " "));
  if (p.notes && parts.length === 0) parts.push(p.notes);
  return parts.join(" · ") || p.notes || "As prescribed";
}

export function readinessPercent(checkin: {
  sleep_quality_1_5: number;
  energy_1_5: number;
  soreness_0_10: number;
  neck_pain_0_10: number;
  back_pain_0_10: number;
} | null): number | null {
  if (!checkin) return null;
  const sleep = (checkin.sleep_quality_1_5 / 5) * 100;
  const energy = (checkin.energy_1_5 / 5) * 100;
  const sore = 100 - checkin.soreness_0_10 * 8;
  const neck = 100 - checkin.neck_pain_0_10 * 8;
  const back = 100 - checkin.back_pain_0_10 * 8;
  return Math.round(
    Math.max(0, Math.min(100, (sleep + energy + sore + neck + back) / 5)),
  );
}

export function defaultWeekdayMap(): Record<string, string | null> {
  return {
    "0": "daily_skill_practice",
    "1": "strength_power",
    "2": "short_mobility_front",
    "3": "athleticism_endurance",
    "4": "short_deep_flex",
    "5": "short_recovery",
    "6": "calisthenics_volume",
  };
}

export function createInitialProgressionStates(
  draft: OnboardingDraft,
  userId: string = LOCAL_USER_ID,
): ProgressionState[] {
  const now = new Date().toISOString();
  const base = (
    scope_id: string,
    scope_type: ProgressionState["scope_type"],
    state: Record<string, unknown>,
    current_level: string | null = null,
  ): ProgressionState => ({
    id: uid("ps"),
    user_id: userId,
    scope_type,
    scope_id,
    current_level,
    state,
    success_credits: 0,
    consecutive_successes: 0,
    consecutive_failures: 0,
    updated_at: now,
  });

  return [
    base(
      "oahs",
      "global_skill",
      {
        level: draft.oahs_level,
        best_hold_left_sec: 0,
        best_hold_right_sec: 0,
        skill_credits: 0,
      },
      draft.oahs_level,
    ),
    base(
      "planche",
      "global_skill",
      {
        level: draft.planche_level,
        hard_hold_seconds: 8,
        medium_hold_seconds: 6,
        light_hold_seconds: 6,
        hard_success_credits: 0,
        hard_fail_streak: 0,
      },
      draft.planche_level,
    ),
    base(
      "human_flag",
      "global_skill",
      {
        level: draft.flag_level,
        monday_hold_seconds: 6,
        saturday_hold_seconds: 8,
      },
      draft.flag_level,
    ),
    base(
      "front_lever",
      "global_skill",
      { level: "tuck", success_credits: 0 },
      "tuck",
    ),
    base(
      "back_lever",
      "global_skill",
      { level: "tuck", success_credits: 0 },
      "tuck",
    ),
    base(
      "front_split",
      "global_skill",
      {
        left_gap_cm: draft.front_split_left_cm ?? 10,
        right_gap_cm: draft.front_split_right_cm ?? 10,
        left_credits: 0,
        right_credits: 0,
      },
    ),
    base(
      "middle_split",
      "global_skill",
      {
        gap_cm: draft.middle_split_cm ?? 15,
        success_credits: 0,
      },
    ),
    base("weighted-pull-up", "routine_item", {
      load_kg: draft.weighted_pullup_kg,
      consecutive_failures: 0,
    }),
    base(
      "handstand-push-up",
      "routine_item",
      {
        level: draft.hspu_level,
        reps_per_set: 5,
      },
      draft.hspu_level,
    ),
    base("bulgarian-split-squat", "routine_item", {
      load_kg: draft.bulgarian_kg,
      consecutive_failures: 0,
    }),
    base("strict-muscle-up", "routine_item", {
      load_kg: 0,
      success_credits: 0,
      fail_credits: 0,
    }),
    base("clap-push-up", "routine_item", {
      success_credits: 0,
      level: 0,
    }),
    base("standing-broad-jump", "routine_item", {
      target_cm: null,
      last_median_cm: null,
    }),
    base("nordic-hamstring-curl", "routine_item", {
      assistance_level: 2,
      eccentric_sec: 3,
      reps_per_set: 5,
      load_kg: 0,
    }),
    base("hanging-straight-leg-raise", "routine_item", {
      variation: "straight_leg",
      reps_per_set: 10,
      load_kg: 0,
    }),
    base("20m-acceleration-sprint", "routine_item", { best_sec: null }),
    base("5-10-5-shuttle", "routine_item", { best_sec: null }),
    base("pistol-squat", "routine_item", { load_kg: 0 }),
    base("single-leg-rdl", "routine_item", {
      load_kg: 0,
    }),
    base("copenhagen-plank", "routine_item", {
      hold_seconds: 20,
      longer_lever: false,
    }),
    base("single-leg-calf-raise", "routine_item", {
      reps_per_set: 15,
      load_kg: 0,
    }),
    base("tibialis-wall-raise", "routine_item", {
      reps_per_set: 20,
      feet_distance_cm: 0,
    }),
    base("pull-up", "routine_item", { reps_per_set: 10, load_kg: 0 }),
    base("parallel-bar-dip", "routine_item", { reps_per_set: 12, load_kg: 0 }),
    base("inverted-row", "routine_item", { reps_per_set: 12, level: 0 }),
    base("push-up", "routine_item", { reps_per_set: 20, load_kg: 0 }),
    base("walking-lunge", "routine_item", { reps_per_set: 12, load_kg: 0 }),
    base("dragon-flag", "routine_item", { reps_per_set: 6, load_kg: 0 }),
    base("burpee", "routine_item", {
      round_rest: 30,
      burpees: 8,
      climbers: 20,
    }),
    base("run_intervals", "capability", { rounds: 6, strong_sec: 120, easy_sec: 120, pace_offset_sec_per_km: 0 }),
    base("run_steady", "capability", {
      duration_sec: 1440,
      pace_offset_sec_per_km: 0,
    }),
    base("run_long", "capability", {
      duration_sec: 2400,
      pace_offset_sec_per_km: 0,
    }),
    base("swim_performance", "capability", {
      strong_repeats: 6,
      strong_rest: 30,
      total_m: 900,
    }),
    base("climb_quality", "capability", {
      grades: { A: draft.climbing_grade ?? "V2", B: "V2", C: "V3", D: "V3" },
    }),
    base("climb_endurance", "capability", {
      interval_sec: 240,
      grade_step: 0,
    }),
  ];
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
