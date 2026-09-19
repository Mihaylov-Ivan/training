import type {
  Block,
  Prescription,
  SessionItem,
} from "@/lib/types";
import { getExerciseBySlug } from "@/lib/seed/exercises";
import { recommendedBetweenExerciseRest } from "@/lib/training/intensity-rest";

export const WORK_TIMER_PREP_SECONDS = 5;
export const PRE_SKILL_REST_SECONDS = 90;
export const BETWEEN_SKILL_REST_SECONDS = 60;

function restForItem(item: SessionItem): number {
  return recommendedBetweenExerciseRest({
    block: item.block,
    exercise_slug: item.exercise_slug,
    prescription: item.prescription_snapshot,
  });
}

export function transitionRestSeconds(
  current: SessionItem,
  next: SessionItem,
): number {
  if (current.block === "warmup" && next.block === "skill") {
    return PRE_SKILL_REST_SECONDS;
  }
  if (current.block === "skill" && next.block === "skill") {
    return BETWEEN_SKILL_REST_SECONDS;
  }
  return Math.max(15, restForItem(current), restForItem(next));
}

type Substitution = {
  slug: string;
  block: Block;
  prescription: Prescription;
};

const SUBSTITUTIONS: Record<string, Substitution> = {
  "oahs-practice": {
    slug: "wall-handstand-hold",
    block: "skill",
    prescription: { sets: 3, hold_seconds: 20, rest_seconds: 60 },
  },
  "planche-hold": {
    slug: "scapular-push-up",
    block: "skill",
    prescription: { sets: 3, reps_per_set: 10, rest_seconds: 60 },
  },
  "one-leg-human-flag": {
    slug: "copenhagen-plank",
    block: "stability",
    prescription: {
      sets: 3,
      hold_seconds: 20,
      per_side: true,
      rest_seconds: 60,
    },
  },
  "front-lever-hold": {
    slug: "inverted-row",
    block: "volume",
    prescription: { sets: 3, reps_per_set: 10, rest_seconds: 60 },
  },
  "back-lever-hold": {
    slug: "arch-hold",
    block: "core",
    prescription: { sets: 3, hold_seconds: 20, rest_seconds: 45 },
  },
  "strict-muscle-up": {
    slug: "pull-up",
    block: "strength",
    prescription: { sets: 4, reps_per_set: 6, rest_seconds: 90 },
  },
  "weighted-pull-up": {
    slug: "pull-up",
    block: "strength",
    prescription: { sets: 4, reps_per_set: 8, rest_seconds: 90 },
  },
  "handstand-push-up": {
    slug: "push-up",
    block: "strength",
    prescription: { sets: 4, reps_per_set: 12, rest_seconds: 90 },
  },
  "bulgarian-split-squat": {
    slug: "walking-lunge",
    block: "legs",
    prescription: {
      sets: 3,
      reps_per_set: 10,
      per_side: true,
      rest_seconds: 75,
    },
  },
  "pistol-squat": {
    slug: "bulgarian-split-squat",
    block: "legs",
    prescription: {
      sets: 3,
      reps_per_set: 8,
      per_side: true,
      rest_seconds: 90,
    },
  },
  "nordic-hamstring-curl": {
    slug: "single-leg-rdl",
    block: "posterior",
    prescription: {
      sets: 3,
      reps_per_set: 8,
      per_side: true,
      rest_seconds: 90,
    },
  },
  "single-leg-rdl": {
    slug: "walking-lunge",
    block: "legs",
    prescription: {
      sets: 3,
      reps_per_set: 10,
      per_side: true,
      rest_seconds: 75,
    },
  },
  "pull-up": {
    slug: "inverted-row",
    block: "volume",
    prescription: { sets: 3, reps_per_set: 12, rest_seconds: 60 },
  },
  "parallel-bar-dip": {
    slug: "push-up",
    block: "volume",
    prescription: { sets: 3, reps_per_set: 15, rest_seconds: 60 },
  },
  "dragon-flag": {
    slug: "hanging-straight-leg-raise",
    block: "core",
    prescription: { sets: 3, reps_per_set: 10, rest_seconds: 60 },
  },
  "20m-acceleration-sprint": {
    slug: "high-knees",
    block: "speed",
    prescription: { sets: 4, duration_seconds: 20, rest_seconds: 60 },
  },
  "burpee": {
    slug: "mountain-climber",
    block: "conditioning",
    prescription: { sets: 4, reps_per_set: 20, rest_seconds: 30 },
  },
};

export function buildExerciseSubstitution(
  item: SessionItem,
): {
  exercise_slug: string;
  exercise_name: string;
  block: Block;
  prescription_snapshot: Prescription;
} | null {
  const sub = SUBSTITUTIONS[item.exercise_slug];
  if (!sub) return null;
  const exercise = getExerciseBySlug(sub.slug);
  if (!exercise) return null;
  return {
    exercise_slug: sub.slug,
    exercise_name: exercise.name,
    block: sub.block,
    prescription_snapshot: {
      ...sub.prescription,
      extras: {
        ...sub.prescription.extras,
        substituted_from_slug: item.exercise_slug,
        substituted_from_name: item.exercise_name,
        substitution_reason: "cannot_do",
      },
    },
  };
}
