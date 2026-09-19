/** Domain types aligned with Lifetime Athlete build spec §9 */

export type MetricType =
  | "reps"
  | "hold"
  | "distance"
  | "duration"
  | "load_reps"
  | "swim"
  | "climb"
  | "split"
  | "skill_block"
  | "circuit";

export type ExerciseCategory =
  | "mobility"
  | "warmup"
  | "skill"
  | "power"
  | "strength"
  | "volume"
  | "endurance"
  | "flexibility"
  | "core"
  | "conditioning"
  | "swim"
  | "climb"
  | "recovery";

export type Block =
  | "warmup"
  | "skill"
  | "power"
  | "strength"
  | "volume"
  | "legs"
  | "core"
  | "conditioning"
  | "flexibility"
  | "run"
  | "swim"
  | "climb"
  | "antagonist"
  | "forearm"
  | "maintenance"
  | "speed"
  | "agility"
  | "stability"
  | "posterior"
  | "lower_leg";

export type SessionStatus =
  | "planned"
  | "active"
  | "resting"
  | "paused"
  | "completed"
  | "abandoned";

export type ScheduledStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "partially_completed"
  | "missed"
  | "skipped"
  | "cancelled"
  | "pending_missed_confirmation"
  /** @deprecated prefer pending_missed_confirmation */
  | "overdue";

export type MissReason =
  | "no_time"
  | "fatigue"
  | "poor_sleep"
  | "illness"
  | "pain_or_injury"
  | "travel"
  | "forgot"
  | "intentional_rest"
  | "other";

export type SkipExerciseReason = "cannot_do" | "skip";

export type AdaptiveSessionKind =
  | "MAIN_WORKOUT"
  | "SKILL_PRACTICE"
  | "MOBILITY_RECOVERY"
  | "DEEP_FLEXIBILITY"
  | "DAILY_MAINTENANCE"
  | "RUNNING"
  | "SWIMMING"
  | "CLIMBING"
  | "DELOAD_WORKOUT";

export type MissOutcome = "completed" | "partially_completed" | "missed";

export type DayRole =
  | "strength_power"
  | "short_mobility_front"
  | "athleticism_endurance"
  | "short_deep_flex"
  | "short_recovery"
  | "swim_performance"
  | "swim_recovery"
  | "calisthenics_volume"
  | "climbing"
  | "recovery";

export type ProgressionScope = "global_skill" | "routine_item" | "capability";

export type PlancheProtocol = "hard" | "medium" | "light";

export interface Prescription {
  sets?: number;
  reps_per_set?: number;
  hold_seconds?: number | null;
  distance_m?: number | null;
  duration_seconds?: number | null;
  load_kg?: number | null;
  exercise_level?: string | null;
  tempo?: string | null;
  rest_seconds?: number;
  per_side?: boolean;
  notes?: string;
  protocol?: PlancheProtocol;
  extras?: Record<string, unknown>;
}

export interface ExerciseDef {
  id: string;
  slug: string;
  name: string;
  category: ExerciseCategory;
  metric_type: MetricType;
  instructions: string;
  cues: string[];
  common_mistakes: string[];
  purpose?: string;
  progression_family?: string;
  pain_caution?: string;
}

export interface ProgressionRuleDef {
  id: string;
  code: string;
  name: string;
  version: number;
  description: string;
  scope: ProgressionScope;
}

export interface RoutineItemDef {
  id: string;
  exercise_slug: string;
  sequence: number;
  block: Block;
  prescription: Prescription;
  rest_seconds: number;
  progression_rule_code?: string;
  progression_scope?: ProgressionScope;
  /** Resolve load/level/holds from progression state at snapshot time */
  load_from_state?: boolean;
  level_from_state?: boolean;
  protocol?: PlancheProtocol;
}

export interface RoutineTemplateDef {
  id: string;
  name: string;
  kind: "primary" | "short" | "maintenance" | "swim" | "climb" | "recovery";
  default_duration_min: number;
  description: string;
  day_roles: DayRole[];
  items: RoutineItemDef[];
}

export interface Profile {
  user_id: string;
  display_name: string;
  units: "metric" | "imperial";
  timezone: string;
  smallest_load_increment_kg: number;
  pool_length_m: 25 | 50;
  equipment: {
    pull_up_bar: boolean;
    dip_bars: boolean;
    rings: boolean;
    weight_belt: boolean;
    pool: boolean;
    climbing_gym: boolean;
  };
  onboarding_complete: boolean;
  timer_sound: boolean;
  timer_haptics: boolean;
  created_at: string;
  updated_at: string;
}

export interface SchedulePreferences {
  user_id: string;
  /** weekday 0=Sun .. 6=Sat -> day_role key for base week */
  weekday_map: Record<string, DayRole | null>;
}

export interface TrainingCycle {
  id: string;
  user_id: string;
  cycle_number: number;
  start_date: string;
  end_date: string;
  status: "active" | "completed";
}

export interface ScheduledSession {
  id: string;
  user_id: string;
  /** Live calendar date for this instance */
  date: string;
  /** First planned date (preserved when moved) */
  original_date: string;
  routine_template_id: string;
  cycle_week: 1 | 2 | 3 | 4;
  cycle_number: number;
  day_role: DayRole;
  status: ScheduledStatus;
  generated_from_schedule: boolean;
  completed_at: string | null;
  reschedule_count: number;
  missed_reason: MissReason | null;
  /** Programme order among core sessions (A→B→C) */
  sequence_index: number;
  is_deload: boolean;
  auto_rescheduled: boolean;
  manually_rescheduled: boolean;
  /** Prior missed instance this makeup replaces */
  rescheduled_from_id: string | null;
  missed_note: string | null;
  injury_area: string | null;
  injury_exercise: string | null;
}

export interface TrainingPause {
  active: boolean;
  reason: MissReason;
  paused_at: string;
  /** Consecutive calendar days without meaningful training */
  missed_days: number;
  return_protocol: "none" | "mild" | "full";
}

export interface ScheduleMove {
  from_date: string;
  to_date: string;
  session_id: string;
  day_role: DayRole;
  routine_template_id: string;
  label: string;
}

export interface ScheduleAdjustmentProposal {
  id: string;
  missed_session_id: string;
  reason: MissReason | null;
  updated_sessions: ScheduledSession[];
  moved_sessions: ScheduleMove[];
  skipped_sessions: ScheduledSession[];
  merged_recovery_sessions: ScheduleMove[];
  warnings: string[];
  explanation: string;
  recommendation: "apply" | "skip_and_resume" | "pause";
}

export interface TrainingSession {
  id: string;
  user_id: string;
  scheduled_session_id: string | null;
  routine_template_id: string;
  started_at: string | null;
  ended_at: string | null;
  status: SessionStatus;
  readiness_snapshot: WellbeingCheckin | null;
  notes: string;
  cycle_week: 1 | 2 | 3 | 4;
  overview_seen: boolean;
}

export interface SessionItem {
  id: string;
  training_session_id: string;
  routine_item_id: string;
  exercise_id: string;
  exercise_slug: string;
  exercise_name: string;
  sequence: number;
  block: Block;
  prescription_snapshot: Prescription;
  progression_state_snapshot: Record<string, unknown> | null;
  progression_rule_code: string | null;
  progression_scope: ProgressionScope | null;
  status: "pending" | "active" | "completed" | "partial" | "skipped" | "pain_limited";
}

export interface SetResult {
  id: string;
  session_item_id: string;
  set_index: number;
  prescribed: Prescription;
  actual: {
    reps?: number;
    hold_seconds?: number;
    load_kg?: number;
    distance_m?: number;
    duration_seconds?: number;
    side?: "left" | "right" | "both";
    extras?: Record<string, unknown>;
  };
  started_at: string | null;
  completed_at: string | null;
  success: boolean | null;
  note: string;
}

export interface ExerciseResult {
  id: string;
  session_item_id: string;
  completed_all: boolean;
  difficulty: number | null;
  pain_score: number | null;
  sharp_pain: boolean;
  note: string;
  metrics: Record<string, unknown>;
  idempotency_key: string;
}

export interface ProgressionState {
  id: string;
  user_id: string;
  scope_type: ProgressionScope;
  scope_id: string;
  current_level: string | null;
  state: Record<string, unknown>;
  success_credits: number;
  consecutive_successes: number;
  consecutive_failures: number;
  updated_at: string;
}

export interface ProgressionEvent {
  id: string;
  user_id: string;
  session_item_id: string;
  rule_code: string;
  event_type: "success" | "failure" | "credit" | "advance" | "hold" | "pain_freeze" | "undo";
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  explanation: string;
  next_prescription_preview: string;
  created_at: string;
  undone_at: string | null;
}

export interface WellbeingCheckin {
  id: string;
  user_id: string;
  date: string;
  sleep_quality_1_5: number;
  energy_1_5: number;
  soreness_0_10: number;
  neck_pain_0_10: number;
  back_pain_0_10: number;
  notes: string;
}

export interface ActiveTimer {
  session_id: string;
  session_item_id: string;
  /** ISO timestamp when the countdown started (rest or work). */
  rest_started_at: string;
  /** Countdown length in seconds (rest or work). */
  rest_duration_seconds: number;
  /** rest = between sets; hold = isometric hold; work = timed duration bout */
  kind: "rest" | "hold" | "work";
  /** Countdown shown before hold/work begins so the athlete can get into position. */
  prep_seconds?: number;
  /** Optional activity label for recovery intervals, e.g. Easy jog. */
  rest_label?: string;
}

export interface OfflineMutation {
  id: string;
  created_at: string;
  type: string;
  payload: unknown;
  idempotency_key: string;
}

export interface OnboardingDraft {
  units: "metric" | "imperial";
  smallest_load_increment_kg: number;
  pool_length_m: 25 | 50;
  equipment: Profile["equipment"];
  oahs_level: string;
  planche_level: string;
  flag_level: string;
  hspu_level: string;
  weighted_pullup_kg: number;
  bulgarian_kg: number;
  front_split_left_cm: number | null;
  front_split_right_cm: number | null;
  middle_split_cm: number | null;
  climbing_grade: string | null;
  project_grade: string | null;
  weekday_map: SchedulePreferences["weekday_map"];
}

export const LOCAL_USER_ID = "local-user";

export const OAHS_LEVELS = [
  "wall_weight_shift",
  "five_finger",
  "three_finger",
  "one_finger",
  "free_straddle",
  "free_legs_together",
] as const;

export const PLANCHE_LEVELS = [
  "tuck",
  "advanced_tuck",
  "one_leg",
  "straddle",
  "full",
] as const;

export const FLAG_LEVELS = ["one_leg", "straddle", "full"] as const;

export const LEVER_LEVELS = [
  "tuck",
  "advanced_tuck",
  "one_leg",
  "straddle",
  "full",
] as const;

export const HSPU_LEVELS = [
  "wall",
  "freestanding",
  "deficit_2cm",
  "deficit_4cm",
  "deficit_6cm",
] as const;
