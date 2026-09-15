import type {
  Prescription,
  ProgressionState,
  RoutineItemDef,
  RoutineTemplateDef,
  SessionItem,
  TrainingSession,
} from "@/lib/types";
import { getExerciseBySlug } from "@/lib/seed/exercises";
import { applyDeloadToPrescription, resolvePlancheHolds } from "@/lib/training/deload";
import { applyIntensityRestToPrescription } from "@/lib/training/intensity-rest";
import { clone, uid } from "@/lib/utils";

function findState(
  states: ProgressionState[],
  item: RoutineItemDef,
): ProgressionState | undefined {
  if (item.progression_scope === "global_skill") {
    const map: Record<string, string> = {
      "oahs-practice": "oahs",
      "planche-hold": "planche",
      "one-leg-human-flag": "human_flag",
      "front-split": "front_split",
      "middle-split": "middle_split",
    };
    const scopeId = map[item.exercise_slug];
    return states.find(
      (s) => s.scope_type === "global_skill" && s.scope_id === scopeId,
    );
  }
  if (item.progression_scope === "capability") {
    const map: Record<string, string> = {
      "strong-easy-intervals": "run_intervals",
      "steady-continuous-run": "run_steady",
      "easy-continuous-run": "run_long",
      "very-easy-deload-run": "run_long",
      "strong-controlled-freestyle": "swim_performance",
      "freestyle-breathing-3": "swim_performance",
      "climbing-quality-attempt": "climb_quality",
      "continuous-easy-climbing": "climb_endurance",
    };
    const scopeId = map[item.exercise_slug] ?? item.exercise_slug;
    return states.find(
      (s) => s.scope_type === "capability" && s.scope_id === scopeId,
    );
  }
  return states.find(
    (s) =>
      s.scope_type === "routine_item" &&
      s.scope_id === item.exercise_slug,
  );
}

export function resolvePrescription(
  item: RoutineItemDef,
  states: ProgressionState[],
  cycleWeek: 1 | 2 | 3 | 4,
  flagContext?: "monday" | "saturday",
): { prescription: Prescription; stateSnapshot: Record<string, unknown> | null } {
  const state = findState(states, item);
  let p = clone(item.prescription);

  if (state) {
    if (item.load_from_state && typeof state.state.load_kg === "number") {
      p.load_kg = state.state.load_kg as number;
    }
    if (item.level_from_state) {
      p.exercise_level = (state.current_level ??
        state.state.level ??
        p.exercise_level) as string;
      if (typeof state.state.reps_per_set === "number") {
        p.reps_per_set = state.state.reps_per_set as number;
      }
    }
    if (item.exercise_slug === "planche-hold") {
      const protocol =
        cycleWeek === 4
          ? "light"
          : (p.protocol ?? item.protocol ?? "medium");
      const holds = resolvePlancheHolds(protocol, state.state);
      p.protocol = protocol;
      p.exercise_level = (state.current_level ?? state.state.level) as string;
      p.notes = `Planche ${protocol} @ ${p.exercise_level}: lean ${holds.lean}; holds ${holds.holds}`;
      p.extras = { ...p.extras, ...holds, level: p.exercise_level };
      p.hold_seconds = holds.holdSec;
      p.sets = holds.sets;
    }
    if (item.exercise_slug === "oahs-practice") {
      p.exercise_level = (state.current_level ?? state.state.level) as string;
      p.notes = `OAHS level: ${String(p.exercise_level).replace(/_/g, " ")}`;
    }
    if (item.exercise_slug === "one-leg-human-flag") {
      const ctx =
        flagContext ??
        (item.prescription.extras?.flag_context === "saturday"
          ? "saturday"
          : "monday");
      const sec =
        ctx === "saturday"
          ? Number(state.state.saturday_hold_seconds ?? 8)
          : Number(state.state.monday_hold_seconds ?? 6);
      p.hold_seconds = sec;
      p.exercise_level = (state.current_level ?? state.state.level) as string;
      p.extras = { ...p.extras, flag_context: ctx };
    }
    if (item.exercise_slug === "front-split") {
      p.extras = {
        ...p.extras,
        left_gap_cm: state.state.left_gap_cm,
        right_gap_cm: state.state.right_gap_cm,
      };
      p.notes = `Target gaps L ${state.state.left_gap_cm} cm / R ${state.state.right_gap_cm} cm`;
    }
    if (item.exercise_slug === "middle-split") {
      p.extras = { ...p.extras, gap_cm: state.state.gap_cm };
      p.notes = `Target gap ${state.state.gap_cm} cm`;
    }
    // Volume / other state-driven fields
    if (typeof state.state.reps_per_set === "number" && !item.level_from_state) {
      const slug = item.exercise_slug;
      if (
        [
          "pull-up",
          "parallel-bar-dip",
          "inverted-row",
          "push-up",
          "walking-lunge",
          "dragon-flag",
          "single-leg-glute-bridge",
          "single-leg-calf-raise",
          "tibialis-wall-raise",
          "hanging-straight-leg-raise",
          "nordic-hamstring-curl",
        ].includes(slug)
      ) {
        p.reps_per_set = state.state.reps_per_set as number;
      }
    }
    if (item.exercise_slug === "copenhagen-plank" && typeof state.state.hold_seconds === "number") {
      p.hold_seconds = state.state.hold_seconds as number;
    }
    if (item.exercise_slug === "burpee" && typeof state.state.round_rest === "number") {
      p.extras = {
        ...p.extras,
        round_rest: state.state.round_rest,
        burpees: state.state.burpees,
        climbers: state.state.climbers,
      };
      p.reps_per_set = Number(state.state.burpees ?? p.reps_per_set);
      p.rest_seconds = Number(state.state.round_rest ?? p.rest_seconds);
    }
    if (item.exercise_slug === "steady-continuous-run" && typeof state.state.duration_sec === "number") {
      p.duration_seconds = state.state.duration_sec as number;
    }
    if (item.exercise_slug === "easy-continuous-run" && typeof state.state.duration_sec === "number") {
      p.duration_seconds = state.state.duration_sec as number;
    }
    if (
      item.exercise_slug === "strong-controlled-freestyle" &&
      typeof state.state.strong_repeats === "number"
    ) {
      p.sets = state.state.strong_repeats as number;
      p.rest_seconds = Number(state.state.strong_rest ?? 30);
    }
    if (
      item.exercise_slug === "continuous-easy-climbing" &&
      typeof state.state.interval_sec === "number"
    ) {
      p.duration_seconds = state.state.interval_sec as number;
    }
    if (item.exercise_slug === "climbing-quality-attempt") {
      const problem = String(p.extras?.problem ?? "A");
      const grades = (state.state.grades ?? {}) as Record<string, string>;
      p.extras = { ...p.extras, grade: grades[problem] ?? "V2" };
      p.notes = `Problem ${problem} @ ${grades[problem] ?? "V2"} — 3 attempts`;
    }
  }

  p = applyDeloadToPrescription(item, p, cycleWeek);
  p = applyIntensityRestToPrescription(item, {
    ...p,
    rest_seconds: p.rest_seconds ?? item.rest_seconds,
  });

  return {
    prescription: p,
    stateSnapshot: state ? clone(state.state) : null,
  };
}

export function snapshotSession(opts: {
  userId: string;
  routine: RoutineTemplateDef;
  scheduledSessionId: string | null;
  cycleWeek: 1 | 2 | 3 | 4;
  states: ProgressionState[];
  dayRole?: string;
}): { session: TrainingSession; items: SessionItem[] } {
  const sessionId = uid("session");
  const flagContext =
    opts.dayRole === "calisthenics_volume" || opts.routine.id === "routine-saturday"
      ? "saturday"
      : "monday";

  const items: SessionItem[] = opts.routine.items
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((ri) => {
      const ex = getExerciseBySlug(ri.exercise_slug);
      const { prescription, stateSnapshot } = resolvePrescription(
        ri,
        opts.states,
        opts.cycleWeek,
        flagContext,
      );
      return {
        id: uid("si"),
        training_session_id: sessionId,
        routine_item_id: ri.id,
        exercise_id: ex?.id ?? ri.exercise_slug,
        exercise_slug: ri.exercise_slug,
        exercise_name: ex?.name ?? ri.exercise_slug,
        sequence: ri.sequence,
        block: ri.block,
        prescription_snapshot: prescription,
        progression_state_snapshot: stateSnapshot,
        progression_rule_code: ri.progression_rule_code ?? null,
        progression_scope: ri.progression_scope ?? null,
        status: "pending" as const,
      };
    });

  const session: TrainingSession = {
    id: sessionId,
    user_id: opts.userId,
    scheduled_session_id: opts.scheduledSessionId,
    routine_template_id: opts.routine.id,
    started_at: null,
    ended_at: null,
    status: "planned",
    readiness_snapshot: null,
    notes: "",
    cycle_week: opts.cycleWeek,
    overview_seen: false,
  };

  return { session, items };
}
