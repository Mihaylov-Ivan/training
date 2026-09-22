import type { RoutineItemDef, RoutineTemplateDef } from "@/lib/types";
import { estimateRoutineDurationMin } from "@/lib/training/estimate-duration";
import { resolveIntensityRestSeconds } from "@/lib/training/intensity-rest";
import { applyMinBetweenSetRest } from "@/lib/training/rest";
import { normalizeRoutineItemOrder } from "@/lib/training/routine-order";

let seqCounter = 0;
function item(
  partial: Omit<RoutineItemDef, "id" | "sequence"> & { sequence?: number },
): RoutineItemDef {
  seqCounter += 1;
  return {
    id: `ri-${seqCounter}`,
    sequence: partial.sequence ?? seqCounter,
    ...partial,
  };
}

function resetSeq() {
  seqCounter = 0;
}

function finalizeItems(items: RoutineItemDef[]): RoutineItemDef[] {
  return normalizeRoutineItemOrder(items).map((entry) => {
    const rest_seconds = resolveIntensityRestSeconds(entry);
    const prescription = {
      ...entry.prescription,
      rest_seconds,
    };
    const steps = prescription.extras?.steps;
    if (Array.isArray(steps)) {
      prescription.extras = {
        ...prescription.extras,
        steps: steps.map((step) => {
          if (!step || typeof step !== "object") return step;
          const s = step as { rest?: number };
          if (s.rest == null) return step;
          return { ...s, rest: applyMinBetweenSetRest(s.rest) };
        }),
      };
    }
    return { ...entry, rest_seconds, prescription };
  });
}

function withEstimatedDuration(
  def: Omit<RoutineTemplateDef, "default_duration_min" | "items"> & {
    items: RoutineItemDef[];
    default_duration_min?: number;
  },
): RoutineTemplateDef {
  const items = finalizeItems(def.items);
  return {
    ...def,
    items,
    default_duration_min: estimateRoutineDurationMin({ items }),
  };
}

function oahsItem(sequence: number): RoutineItemDef {
  return item({
    sequence,
    exercise_slug: "oahs-practice",
    block: "skill",
    prescription: {
      duration_seconds: 300,
      rest_seconds: 0,
      notes: "5-min OAHS protocol after wrist warm-up; quality over fatigue",
      extras: {
        steps: [
          { name: "Wall weight shifts", detail: "2 x 20 sec", rest: 20 },
          {
            name: "Fingertip-assisted OAHS",
            detail: "2 x 8 sec each arm",
            rest: 15,
          },
          {
            name: "Free OAHS attempts",
            detail: "4 quality attempts each arm, max 8 sec",
            rest: 15,
          },
        ],
      },
    },
    rest_seconds: 0,
    progression_rule_code: "OAHS_V1",
    progression_scope: "global_skill",
  });
}

function plancheItem(sequence: number, protocol: "hard" | "medium" | "light"): RoutineItemDef {
  const map = {
    hard: { lean: "2 x 20 sec", holds: "5 x 8 sec", leanRest: 30, holdRest: 40 },
    medium: { lean: "2 x 15 sec", holds: "4 x 6 sec", leanRest: 30, holdRest: 45 },
    light: { lean: "4 x 15 sec", holds: "2 x 6 sec", leanRest: 30, holdRest: 45 },
  }[protocol];
  return item({
    sequence,
    exercise_slug: "planche-hold",
    block: "skill",
    protocol,
    prescription: {
      duration_seconds: 300,
      protocol,
      rest_seconds: map.holdRest,
      notes: `Planche ${protocol}: lean ${map.lean}; level holds ${map.holds}`,
      extras: { ...map },
    },
    rest_seconds: map.holdRest,
    progression_rule_code: "PLANCHE_V1",
    progression_scope: "global_skill",
  });
}

function dailySkillPrimerItems(): RoutineItemDef[] {
  return [
    item({
      exercise_slug: "wrist-rocks",
      block: "warmup",
      prescription: {
        sets: 1,
        reps_per_set: 10,
        rest_seconds: 0,
        notes: "Quick wrist prep before daily skills",
        extras: { forward: 10, lateral: 10 },
      },
      rest_seconds: 0,
    }),
    item({
      exercise_slug: "oahs-practice",
      block: "skill",
      prescription: {
        duration_seconds: 300,
        rest_seconds: 0,
        notes: "5-min light OAHS technique — quality first, stop before fatigue",
        extras: {
          oahs_protocol: "light",
          daily_primer: true,
          steps: [
            { name: "Wall weight shifts", detail: "1 x 20 sec", rest: 20 },
            {
              name: "Fingertip-assisted OAHS",
              detail: "2 x 8 sec each arm",
              rest: 15,
            },
            {
              name: "Free OAHS attempts",
              detail: "3 quality attempts each arm, max 8 sec",
              rest: 15,
            },
          ],
        },
      },
      rest_seconds: 0,
      progression_rule_code: "OAHS_V1",
      progression_scope: "global_skill",
    }),
    item({
      exercise_slug: "planche-hold",
      block: "skill",
      protocol: "light",
      prescription: {
        duration_seconds: 120,
        protocol: "light",
        rest_seconds: 45,
        notes: "2-min light planche technique — easy lean + clean current-level attempts",
        extras: {
          daily_primer: true,
          lean: "2 x 15 sec",
          holds: "2 easy current-level attempts",
          leanRest: 20,
          holdRest: 30,
        },
      },
      rest_seconds: 45,
      progression_rule_code: "PLANCHE_V1",
      progression_scope: "global_skill",
    }),
  ];
}

function flagItem(
  sequence: number,
  opts: {
    holdSeconds: number;
    sets?: number;
    saturday?: boolean;
    notes?: string;
  },
): RoutineItemDef {
  return item({
    sequence,
    exercise_slug: "one-leg-human-flag",
    block: "skill",
    prescription: {
      sets: opts.sets ?? 3,
      hold_seconds: opts.holdSeconds,
      per_side: true,
      rest_seconds: 60,
      notes: opts.notes,
      extras: opts.saturday ? { flag_context: "saturday" } : undefined,
    },
    rest_seconds: 60,
    progression_rule_code: "HUMAN_FLAG_V1",
    progression_scope: "global_skill",
  });
}

function leverItem(
  sequence: number,
  slug: "front-lever-hold" | "back-lever-hold",
  protocol: "hard" | "light" = "hard",
): RoutineItemDef {
  const hard = protocol === "hard";
  return item({
    sequence,
    exercise_slug: slug,
    block: "skill",
    prescription: {
      sets: hard ? 3 : 2,
      hold_seconds: hard ? 8 : 6,
      exercise_level: "tuck",
      rest_seconds: 60,
      notes: hard ? "Quality straight-arm holds" : "Light technique holds",
      extras: { lever_protocol: protocol },
    },
    rest_seconds: 60,
    progression_rule_code:
      slug === "front-lever-hold" ? "FRONT_LEVER_V1" : "BACK_LEVER_V1",
    progression_scope: "global_skill",
  });
}

resetSeq();
const maintenanceItems: RoutineItemDef[] = [
  item({
    exercise_slug: "chin-tuck",
    block: "maintenance",
    prescription: { sets: 1, reps_per_set: 8, rest_seconds: 0 },
    rest_seconds: 0,
    progression_rule_code: "MOBILITY_MAINTAIN_V1",
    progression_scope: "routine_item",
  }),
  item({
    exercise_slug: "neck-rotation",
    block: "maintenance",
    prescription: { sets: 1, reps_per_set: 5, per_side: true, rest_seconds: 0 },
    rest_seconds: 0,
    progression_rule_code: "MOBILITY_MAINTAIN_V1",
    progression_scope: "routine_item",
  }),
  item({
    exercise_slug: "wall-slide",
    block: "maintenance",
    prescription: { sets: 1, reps_per_set: 10, rest_seconds: 0 },
    rest_seconds: 0,
    progression_rule_code: "MOBILITY_MAINTAIN_V1",
    progression_scope: "routine_item",
  }),
  item({
    exercise_slug: "cat-cow",
    block: "maintenance",
    prescription: { sets: 1, reps_per_set: 8, rest_seconds: 0 },
    rest_seconds: 0,
    progression_rule_code: "MOBILITY_MAINTAIN_V1",
    progression_scope: "routine_item",
  }),
  item({
    exercise_slug: "open-book-rotation",
    block: "maintenance",
    prescription: { sets: 1, reps_per_set: 5, per_side: true, rest_seconds: 0 },
    rest_seconds: 0,
    progression_rule_code: "MOBILITY_MAINTAIN_V1",
    progression_scope: "routine_item",
  }),
  item({
    exercise_slug: "90-90-hip-switch",
    block: "maintenance",
    prescription: { sets: 1, reps_per_set: 10, rest_seconds: 0, notes: "10 total" },
    rest_seconds: 0,
    progression_rule_code: "MOBILITY_MAINTAIN_V1",
    progression_scope: "routine_item",
  }),
  item({
    exercise_slug: "deep-squat-hold",
    block: "maintenance",
    prescription: { sets: 1, hold_seconds: 30, rest_seconds: 0 },
    rest_seconds: 0,
    progression_rule_code: "MOBILITY_MAINTAIN_V1",
    progression_scope: "routine_item",
  }),
  item({
    exercise_slug: "knee-over-toe-ankle-rock",
    block: "maintenance",
    prescription: { sets: 1, reps_per_set: 10, per_side: true, rest_seconds: 0 },
    rest_seconds: 0,
    progression_rule_code: "MOBILITY_MAINTAIN_V1",
    progression_scope: "routine_item",
  }),
];

resetSeq();
const mondayItems: RoutineItemDef[] = [
  item({
    exercise_slug: "wrist-rocks",
    block: "warmup",
    prescription: {
      sets: 1,
      reps_per_set: 10,
      rest_seconds: 0,
      extras: { forward: 10, lateral: 10 },
    },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "scapular-push-up",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 10, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "scapular-pull-up",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 8, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "arm-circles",
    block: "warmup",
    prescription: {
      sets: 1,
      reps_per_set: 10,
      rest_seconds: 0,
      extras: { forward: 10, backward: 10 },
    },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "hollow-hold",
    block: "warmup",
    prescription: { sets: 1, hold_seconds: 20, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "arch-hold",
    block: "warmup",
    prescription: { sets: 1, hold_seconds: 20, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "air-squat",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 15, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "reverse-lunge",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 8, per_side: true, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  // Skills + hard work — finalizeItems reorders to flag → planche → OAHS,
  // then HSPU → muscle-up → remaining strength/power/core/flex.
  oahsItem(9),
  plancheItem(10, "hard"),
  flagItem(11, { holdSeconds: 6, notes: "Left → right → 60 sec" }),
  leverItem(12, "front-lever-hold", "hard"),
  leverItem(13, "back-lever-hold", "hard"),
  item({
    sequence: 14,
    exercise_slug: "handstand-push-up",
    block: "strength",
    prescription: {
      sets: 4,
      reps_per_set: 5,
      exercise_level: "wall",
      rest_seconds: 150,
    },
    rest_seconds: 150,
    level_from_state: true,
    progression_rule_code: "HSPU_LEVEL_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 13,
    exercise_slug: "strict-muscle-up",
    block: "power",
    prescription: { sets: 4, reps_per_set: 3, load_kg: 0, rest_seconds: 90 },
    rest_seconds: 90,
    load_from_state: true,
    progression_rule_code: "STRICT_MUSCLE_UP_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 14,
    exercise_slug: "clap-push-up",
    block: "power",
    prescription: { sets: 3, reps_per_set: 5, rest_seconds: 60 },
    rest_seconds: 60,
    progression_rule_code: "CLAP_PUSHUP_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 15,
    exercise_slug: "standing-broad-jump",
    block: "power",
    prescription: { sets: 3, reps_per_set: 3, rest_seconds: 75 },
    rest_seconds: 75,
    progression_rule_code: "BROAD_JUMP_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 16,
    exercise_slug: "weighted-pull-up",
    block: "strength",
    prescription: { sets: 4, reps_per_set: 5, load_kg: 20, rest_seconds: 150 },
    rest_seconds: 150,
    load_from_state: true,
    progression_rule_code: "WEIGHTED_PULLUP_4X5_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 17,
    exercise_slug: "bulgarian-split-squat",
    block: "strength",
    prescription: {
      sets: 3,
      reps_per_set: 8,
      load_kg: 0,
      per_side: true,
      rest_seconds: 90,
      notes: "90 sec after both legs",
    },
    rest_seconds: 90,
    load_from_state: true,
    progression_rule_code: "BULGARIAN_SPLIT_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 18,
    exercise_slug: "nordic-hamstring-curl",
    block: "strength",
    prescription: {
      sets: 3,
      reps_per_set: 5,
      tempo: "3-sec eccentric",
      rest_seconds: 90,
    },
    rest_seconds: 90,
    progression_rule_code: "NORDIC_CURL_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 19,
    exercise_slug: "hanging-straight-leg-raise",
    block: "core",
    prescription: { sets: 3, reps_per_set: 10, rest_seconds: 60 },
    rest_seconds: 60,
    progression_rule_code: "HANGING_SLR_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 20,
    exercise_slug: "couch-stretch",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 45, per_side: true, rest_seconds: 15 },
    rest_seconds: 15,
  }),
  item({
    sequence: 21,
    exercise_slug: "half-split",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 45, per_side: true, rest_seconds: 15 },
    rest_seconds: 15,
  }),
  item({
    sequence: 22,
    exercise_slug: "front-split",
    block: "flexibility",
    prescription: { sets: 2, hold_seconds: 45, per_side: true, rest_seconds: 20 },
    rest_seconds: 20,
    progression_rule_code: "FRONT_SPLIT_V1",
    progression_scope: "global_skill",
  }),
  item({
    sequence: 23,
    exercise_slug: "pancake",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 60, rest_seconds: 20 },
    rest_seconds: 20,
  }),
  item({
    sequence: 24,
    exercise_slug: "middle-split",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 60, rest_seconds: 0 },
    rest_seconds: 0,
    progression_rule_code: "MIDDLE_SPLIT_V1",
    progression_scope: "global_skill",
  }),
];

resetSeq();
const wednesdayBase: RoutineItemDef[] = [
  item({
    exercise_slug: "wrist-rocks",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 10, rest_seconds: 0, extras: { forward: 10, lateral: 10 } },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "scapular-push-up",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 10, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "scapular-pull-up",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 8, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "easy-jog",
    block: "warmup",
    prescription: { duration_seconds: 120, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "leg-swings-front-back",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 10, per_side: true, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "leg-swings-lateral",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 10, per_side: true, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "walking-lunge",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 8, per_side: true, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "high-knees",
    block: "warmup",
    prescription: { duration_seconds: 20, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "butt-kicks",
    block: "warmup",
    prescription: { duration_seconds: 20, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  oahsItem(8),
  plancheItem(9, "medium"),
  flagItem(10, { holdSeconds: 6, notes: "Left → right → 60 sec" }),
  leverItem(11, "front-lever-hold", "light"),
  leverItem(12, "back-lever-hold", "light"),
  item({
    sequence: 12,
    exercise_slug: "20m-acceleration-sprint",
    block: "speed",
    prescription: { sets: 4, distance_m: 20, rest_seconds: 90 },
    rest_seconds: 90,
    progression_rule_code: "SPRINT_20M_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 13,
    exercise_slug: "5-10-5-shuttle",
    block: "agility",
    prescription: { sets: 4, reps_per_set: 1, rest_seconds: 75, notes: "Alternate start side" },
    rest_seconds: 75,
    progression_rule_code: "SHUTTLE_5105_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 14,
    exercise_slug: "pistol-squat",
    block: "legs",
    prescription: {
      sets: 3,
      reps_per_set: 6,
      load_kg: 0,
      per_side: true,
      rest_seconds: 90,
    },
    rest_seconds: 90,
    load_from_state: true,
    progression_rule_code: "PISTOL_SQUAT_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 15,
    exercise_slug: "single-leg-rdl",
    block: "posterior",
    prescription: {
      sets: 3,
      reps_per_set: 8,
      load_kg: 0,
      per_side: true,
      rest_seconds: 90,
      tempo: "3-sec controlled eccentric",
      notes: "Complete left and right before the set rest",
    },
    rest_seconds: 90,
    load_from_state: true,
    progression_rule_code: "SINGLE_LEG_RDL_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 16,
    exercise_slug: "copenhagen-plank",
    block: "stability",
    prescription: {
      sets: 3,
      hold_seconds: 20,
      per_side: true,
      rest_seconds: 45,
    },
    rest_seconds: 45,
    progression_rule_code: "COPENHAGEN_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 17,
    exercise_slug: "single-leg-calf-raise",
    block: "lower_leg",
    prescription: { sets: 3, reps_per_set: 15, per_side: true, rest_seconds: 45 },
    rest_seconds: 45,
    progression_rule_code: "CALF_RAISE_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 18,
    exercise_slug: "tibialis-wall-raise",
    block: "lower_leg",
    prescription: { sets: 3, reps_per_set: 20, rest_seconds: 45 },
    rest_seconds: 45,
    progression_rule_code: "TIBIALIS_V1",
    progression_scope: "routine_item",
  }),
];

function wednesdayFlex(startSeq: number): RoutineItemDef[] {
  resetSeq();
  seqCounter = startSeq - 1;
  return [
    item({
      exercise_slug: "front-split",
      block: "flexibility",
      prescription: { sets: 1, hold_seconds: 45, per_side: true, rest_seconds: 15 },
      rest_seconds: 15,
      progression_rule_code: "FRONT_SPLIT_V1",
      progression_scope: "global_skill",
    }),
    item({
      exercise_slug: "frog-stretch",
      block: "flexibility",
      prescription: { sets: 1, hold_seconds: 60, rest_seconds: 15 },
      rest_seconds: 15,
    }),
    item({
      exercise_slug: "pancake",
      block: "flexibility",
      prescription: { sets: 1, hold_seconds: 60, rest_seconds: 0 },
      rest_seconds: 0,
    }),
  ];
}

function withRun(
  week: 1 | 2 | 3 | 4,
  omitLower: boolean,
): RoutineItemDef[] {
  const base = omitLower
    ? wednesdayBase.filter(
        (i) =>
          i.exercise_slug !== "single-leg-rdl" &&
          i.exercise_slug !== "single-leg-calf-raise" &&
          i.exercise_slug !== "tibialis-wall-raise",
      )
    : wednesdayBase;
  const runSeq = 19;
  const flexStart = 20;
  const runMap = {
    1: item({
      sequence: runSeq,
      exercise_slug: "strong-easy-intervals",
      block: "run",
      prescription: {
        sets: 6,
        duration_seconds: 120,
        rest_seconds: 120,
        notes: "6 strong reps: 2:00 strong @ RPE 7–8/10, then 2:00 easy jog @ RPE 2–3/10 between reps",
        extras: {
          intervals: 6,
          strong_sec: 120,
          easy_sec: 120,
          strong_rpe: "7–8/10",
          easy_rpe: "2–3/10",
          rest_label: "Easy jog",
        },
      },
      rest_seconds: 120,
      progression_rule_code: "RUN_INTERVALS_V1",
      progression_scope: "capability",
    }),
    2: item({
      sequence: runSeq,
      exercise_slug: "steady-continuous-run",
      block: "run",
      prescription: { duration_seconds: 1440, rest_seconds: 0, notes: "24 min steady" },
      rest_seconds: 0,
      progression_rule_code: "RUN_STEADY_V1",
      progression_scope: "capability",
    }),
    3: item({
      sequence: runSeq,
      exercise_slug: "easy-continuous-run",
      block: "run",
      prescription: { duration_seconds: 2400, rest_seconds: 0, notes: "40 min easy" },
      rest_seconds: 0,
      progression_rule_code: "RUN_LONG_V1",
      progression_scope: "capability",
    }),
    4: item({
      sequence: runSeq,
      exercise_slug: "very-easy-deload-run",
      block: "run",
      prescription: { duration_seconds: 1080, rest_seconds: 0, notes: "18 min very easy" },
      rest_seconds: 0,
      progression_rule_code: "RUN_DELOAD_V1",
      progression_scope: "capability",
    }),
  } as const;
  return [...base, runMap[week], ...wednesdayFlex(flexStart)];
}

resetSeq();
const saturdayItems: RoutineItemDef[] = [
  item({
    exercise_slug: "wrist-rocks",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 10, rest_seconds: 0, extras: { forward: 10, lateral: 10 } },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "scapular-push-up",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 10, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "scapular-pull-up",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 8, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "hollow-hold",
    block: "warmup",
    prescription: { sets: 1, hold_seconds: 20, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "arch-hold",
    block: "warmup",
    prescription: { sets: 1, hold_seconds: 20, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "bodyweight-squat",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 15, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "reverse-lunge",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 8, per_side: true, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "shoulder-circles",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 10, rest_seconds: 0, notes: "Each direction" },
    rest_seconds: 0,
  }),
  oahsItem(9),
  plancheItem(10, "hard"),
  flagItem(11, {
    holdSeconds: 8,
    saturday: true,
    notes: "Saturday flag context",
  }),
  leverItem(12, "front-lever-hold", "hard"),
  leverItem(13, "back-lever-hold", "hard"),
  item({
    sequence: 14,
    exercise_slug: "strict-muscle-up",
    block: "power",
    prescription: { sets: 4, reps_per_set: 3, load_kg: 0, rest_seconds: 90 },
    rest_seconds: 90,
    load_from_state: true,
    progression_rule_code: "STRICT_MUSCLE_UP_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 13,
    exercise_slug: "pull-up",
    block: "volume",
    prescription: { sets: 4, reps_per_set: 10, load_kg: 0, rest_seconds: 90 },
    rest_seconds: 90,
    load_from_state: true,
    progression_rule_code: "PULLUP_VOLUME_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 14,
    exercise_slug: "parallel-bar-dip",
    block: "volume",
    prescription: { sets: 4, reps_per_set: 12, load_kg: 0, rest_seconds: 90 },
    rest_seconds: 90,
    load_from_state: true,
    progression_rule_code: "DIP_VOLUME_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 15,
    exercise_slug: "inverted-row",
    block: "volume",
    prescription: { sets: 3, reps_per_set: 12, rest_seconds: 60 },
    rest_seconds: 60,
    progression_rule_code: "INVERTED_ROW_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 16,
    exercise_slug: "push-up",
    block: "volume",
    prescription: { sets: 3, reps_per_set: 20, load_kg: 0, rest_seconds: 60 },
    rest_seconds: 60,
    load_from_state: true,
    progression_rule_code: "PUSHUP_VOLUME_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 17,
    exercise_slug: "walking-lunge",
    block: "legs",
    prescription: { sets: 3, reps_per_set: 12, per_side: true, rest_seconds: 60 },
    rest_seconds: 60,
    progression_rule_code: "WALKING_LUNGE_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 18,
    exercise_slug: "dragon-flag",
    block: "core",
    prescription: { sets: 3, reps_per_set: 6, tempo: "3-sec lowering", rest_seconds: 90 },
    rest_seconds: 90,
    progression_rule_code: "DRAGON_FLAG_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 19,
    exercise_slug: "burpee",
    block: "conditioning",
    prescription: {
      sets: 4,
      reps_per_set: 8,
      rest_seconds: 30,
      notes: "Controlled conditioning rounds",
    },
    rest_seconds: 30,
    progression_rule_code: "BURPEE_CLIMBER_V1",
    progression_scope: "routine_item",
  }),
  item({
    sequence: 20,
    exercise_slug: "mountain-climber",
    block: "conditioning",
    prescription: {
      sets: 4,
      reps_per_set: 20,
      rest_seconds: 30,
      notes: "30 sec after round",
    },
    rest_seconds: 30,
  }),
  item({
    sequence: 21,
    exercise_slug: "couch-stretch",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 60, per_side: true, rest_seconds: 15 },
    rest_seconds: 15,
  }),
  item({
    sequence: 22,
    exercise_slug: "half-split",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 60, per_side: true, rest_seconds: 15 },
    rest_seconds: 15,
  }),
  item({
    sequence: 23,
    exercise_slug: "front-split",
    block: "flexibility",
    prescription: { sets: 2, hold_seconds: 60, per_side: true, rest_seconds: 20 },
    rest_seconds: 20,
    progression_rule_code: "FRONT_SPLIT_V1",
    progression_scope: "global_skill",
  }),
  item({
    sequence: 24,
    exercise_slug: "cossack-squat",
    block: "flexibility",
    prescription: { sets: 1, reps_per_set: 8, per_side: true, rest_seconds: 20 },
    rest_seconds: 20,
  }),
  item({
    sequence: 25,
    exercise_slug: "frog-stretch",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 60, rest_seconds: 20 },
    rest_seconds: 20,
  }),
  item({
    sequence: 26,
    exercise_slug: "pancake",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 60, rest_seconds: 20 },
    rest_seconds: 20,
  }),
  item({
    sequence: 27,
    exercise_slug: "middle-split",
    block: "flexibility",
    prescription: { sets: 2, hold_seconds: 45, rest_seconds: 20 },
    rest_seconds: 20,
    progression_rule_code: "MIDDLE_SPLIT_V1",
    progression_scope: "global_skill",
  }),
];

resetSeq();
const tuesdayItems: RoutineItemDef[] = [
  ...dailySkillPrimerItems(),
  item({
    sequence: 4,
    exercise_slug: "wall-slide",
    block: "flexibility",
    prescription: { sets: 2, reps_per_set: 10, rest_seconds: 20 },
    rest_seconds: 20,
  }),
  item({
    sequence: 5,
    exercise_slug: "open-book-rotation",
    block: "flexibility",
    prescription: { sets: 1, reps_per_set: 8, per_side: true, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    sequence: 6,
    exercise_slug: "90-90-hip-switch",
    block: "flexibility",
    prescription: { sets: 2, reps_per_set: 10, rest_seconds: 20 },
    rest_seconds: 20,
  }),
  item({
    sequence: 7,
    exercise_slug: "couch-stretch",
    block: "flexibility",
    prescription: { sets: 2, hold_seconds: 45, per_side: true, rest_seconds: 15 },
    rest_seconds: 15,
  }),
  item({
    sequence: 8,
    exercise_slug: "half-split",
    block: "flexibility",
    prescription: { sets: 2, hold_seconds: 45, per_side: true, rest_seconds: 15 },
    rest_seconds: 15,
  }),
  item({
    sequence: 9,
    exercise_slug: "front-split",
    block: "flexibility",
    prescription: { sets: 2, hold_seconds: 45, per_side: true, rest_seconds: 20 },
    rest_seconds: 20,
    progression_rule_code: "FRONT_SPLIT_V1",
    progression_scope: "global_skill",
  }),
  item({
    sequence: 10,
    exercise_slug: "dead-bug",
    block: "core",
    prescription: { sets: 2, reps_per_set: 8, per_side: true, rest_seconds: 30 },
    rest_seconds: 30,
  }),
];

resetSeq();
const thursdayItems: RoutineItemDef[] = [
  ...dailySkillPrimerItems(),
  item({
    sequence: 4,
    exercise_slug: "cossack-squat",
    block: "flexibility",
    prescription: { sets: 2, reps_per_set: 8, per_side: true, rest_seconds: 20 },
    rest_seconds: 20,
  }),
  item({
    sequence: 5,
    exercise_slug: "90-90-hip-switch",
    block: "flexibility",
    prescription: { sets: 1, reps_per_set: 10, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    sequence: 6,
    exercise_slug: "couch-stretch",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 60, per_side: true, rest_seconds: 15 },
    rest_seconds: 15,
  }),
  item({
    sequence: 7,
    exercise_slug: "half-split",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 60, per_side: true, rest_seconds: 15 },
    rest_seconds: 15,
  }),
  item({
    sequence: 8,
    exercise_slug: "front-split",
    block: "flexibility",
    prescription: { sets: 2, hold_seconds: 45, per_side: true, rest_seconds: 20 },
    rest_seconds: 20,
    progression_rule_code: "FRONT_SPLIT_V1",
    progression_scope: "global_skill",
  }),
  item({
    sequence: 9,
    exercise_slug: "frog-stretch",
    block: "flexibility",
    prescription: { sets: 2, hold_seconds: 60, rest_seconds: 20 },
    rest_seconds: 20,
  }),
  item({
    sequence: 10,
    exercise_slug: "pancake",
    block: "flexibility",
    prescription: { sets: 2, hold_seconds: 60, rest_seconds: 20 },
    rest_seconds: 20,
  }),
  item({
    sequence: 11,
    exercise_slug: "middle-split",
    block: "flexibility",
    prescription: { sets: 2, hold_seconds: 45, rest_seconds: 20 },
    rest_seconds: 20,
    progression_rule_code: "MIDDLE_SPLIT_V1",
    progression_scope: "global_skill",
  }),
  item({
    sequence: 12,
    exercise_slug: "straight-leg-seated-lift",
    block: "core",
    prescription: { sets: 2, reps_per_set: 8, per_side: true, rest_seconds: 30 },
    rest_seconds: 30,
  }),
];

resetSeq();
const fridayItems: RoutineItemDef[] = [
  ...dailySkillPrimerItems(),
  item({
    sequence: 4,
    exercise_slug: "chin-tuck",
    block: "flexibility",
    prescription: { sets: 1, reps_per_set: 10, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    sequence: 5,
    exercise_slug: "wall-slide",
    block: "flexibility",
    prescription: { sets: 2, reps_per_set: 10, rest_seconds: 20 },
    rest_seconds: 20,
  }),
  item({
    sequence: 6,
    exercise_slug: "open-book-rotation",
    block: "flexibility",
    prescription: { sets: 1, reps_per_set: 8, per_side: true, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    sequence: 7,
    exercise_slug: "bird-dog",
    block: "core",
    prescription: {
      sets: 2,
      reps_per_set: 6,
      per_side: true,
      rest_seconds: 30,
      tempo: "3-sec hold",
    },
    rest_seconds: 30,
  }),
  item({
    sequence: 8,
    exercise_slug: "90-90-hip-switch",
    block: "flexibility",
    prescription: { sets: 2, reps_per_set: 8, rest_seconds: 20 },
    rest_seconds: 20,
  }),
  item({
    sequence: 9,
    exercise_slug: "knee-to-wall-ankle",
    block: "flexibility",
    prescription: { sets: 1, reps_per_set: 10, per_side: true, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    sequence: 10,
    exercise_slug: "calf-stretch",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 45, per_side: true, rest_seconds: 15 },
    rest_seconds: 15,
  }),
  item({
    sequence: 11,
    exercise_slug: "front-split",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 30, per_side: true, rest_seconds: 15 },
    rest_seconds: 15,
    progression_rule_code: "FRONT_SPLIT_V1",
    progression_scope: "global_skill",
  }),
  item({
    sequence: 12,
    exercise_slug: "frog-stretch",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 45, rest_seconds: 15 },
    rest_seconds: 15,
  }),
  item({
    sequence: 13,
    exercise_slug: "pancake",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 45, rest_seconds: 0 },
    rest_seconds: 0,
  }),
];

resetSeq();
const swimPerfItems: RoutineItemDef[] = [
  ...dailySkillPrimerItems(),
  item({
    exercise_slug: "swimming-session",
    block: "swim",
    prescription: {
      duration_seconds: 2700,
      rest_seconds: 0,
      notes: "45 minutes swimming — choose the session yourself",
    },
    rest_seconds: 0,
  }),
];

resetSeq();
const swimRecItems: RoutineItemDef[] = [
  ...dailySkillPrimerItems(),
  item({
    exercise_slug: "swimming-session",
    block: "swim",
    prescription: {
      duration_seconds: 1800,
      rest_seconds: 0,
      notes: "30 minutes swimming — choose the session yourself",
    },
    rest_seconds: 0,
  }),
];

resetSeq();
const boxingItems: RoutineItemDef[] = [
  ...dailySkillPrimerItems(),
  item({
    exercise_slug: "boxing-session",
    block: "conditioning",
    prescription: {
      duration_seconds: 2700,
      rest_seconds: 0,
      notes: "45 minutes boxing — choose the session yourself",
    },
    rest_seconds: 0,
  }),
];

resetSeq();
const sundaySkillItems: RoutineItemDef[] = [
  ...dailySkillPrimerItems(),
];

resetSeq();
const climbItems: RoutineItemDef[] = [
  item({
    exercise_slug: "wrist-circles",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 10, rest_seconds: 0, notes: "Each direction" },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "finger-open-close",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 20, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    exercise_slug: "scapular-pull-up",
    block: "warmup",
    prescription: { sets: 2, reps_per_set: 8, rest_seconds: 20 },
    rest_seconds: 20,
  }),
  item({
    exercise_slug: "scapular-push-up",
    block: "warmup",
    prescription: { sets: 2, reps_per_set: 10, rest_seconds: 20 },
    rest_seconds: 20,
  }),
  item({
    exercise_slug: "arm-circles",
    block: "warmup",
    prescription: { sets: 1, reps_per_set: 10, rest_seconds: 0, notes: "Each direction" },
    rest_seconds: 0,
  }),
  oahsItem(6),
  plancheItem(7, "hard"),
  flagItem(8, { holdSeconds: 6, notes: "Left → right → 60 sec" }),
  leverItem(9, "front-lever-hold", "light"),
  leverItem(10, "back-lever-hold", "light"),
  item({
    sequence: 11,
    exercise_slug: "easy-climb-problems",
    block: "climb",
    prescription: { sets: 2, rest_seconds: 60, notes: "2 easy problems" },
    rest_seconds: 60,
  }),
  item({
    sequence: 10,
    exercise_slug: "harder-climb-problems",
    block: "climb",
    prescription: { sets: 2, rest_seconds: 90, notes: "2 slightly harder" },
    rest_seconds: 90,
  }),
  ...(["A", "B", "C", "D"] as const).map((letter, i) =>
    item({
      sequence: 11 + i,
      exercise_slug: "climbing-quality-attempt",
      block: "climb",
      prescription: {
        sets: 3,
        rest_seconds: 120,
        notes: `Problem ${letter} — 3 attempts`,
        extras: { problem: letter },
      },
      rest_seconds: 120,
      progression_rule_code: "CLIMB_QUALITY_V1",
      progression_scope: "capability",
    }),
  ),
  item({
    sequence: 15,
    exercise_slug: "continuous-easy-climbing",
    block: "climb",
    prescription: { sets: 3, duration_seconds: 240, rest_seconds: 120 },
    rest_seconds: 120,
    progression_rule_code: "CLIMB_ENDURANCE_V1",
    progression_scope: "capability",
  }),
  item({
    sequence: 16,
    exercise_slug: "push-up",
    block: "antagonist",
    prescription: { sets: 2, reps_per_set: 20, rest_seconds: 45 },
    rest_seconds: 45,
  }),
  item({
    sequence: 17,
    exercise_slug: "band-finger-extension",
    block: "antagonist",
    prescription: { sets: 2, reps_per_set: 20, rest_seconds: 30 },
    rest_seconds: 30,
  }),
  item({
    sequence: 18,
    exercise_slug: "couch-stretch",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 45, per_side: true, rest_seconds: 15 },
    rest_seconds: 15,
  }),
  item({
    sequence: 19,
    exercise_slug: "half-split",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 45, per_side: true, rest_seconds: 15 },
    rest_seconds: 15,
  }),
  item({
    sequence: 20,
    exercise_slug: "front-split",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 60, per_side: true, rest_seconds: 15 },
    rest_seconds: 15,
    progression_rule_code: "FRONT_SPLIT_V1",
    progression_scope: "global_skill",
  }),
  item({
    sequence: 21,
    exercise_slug: "frog-stretch",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 60, rest_seconds: 15 },
    rest_seconds: 15,
  }),
  item({
    sequence: 22,
    exercise_slug: "pancake",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 60, rest_seconds: 15 },
    rest_seconds: 15,
  }),
  item({
    sequence: 23,
    exercise_slug: "middle-split",
    block: "flexibility",
    prescription: { sets: 1, hold_seconds: 60, rest_seconds: 15 },
    rest_seconds: 15,
    progression_rule_code: "MIDDLE_SPLIT_V1",
    progression_scope: "global_skill",
  }),
  item({
    sequence: 24,
    exercise_slug: "flexor-stretch",
    block: "forearm",
    prescription: { sets: 1, hold_seconds: 30, per_side: true, rest_seconds: 0 },
    rest_seconds: 0,
  }),
  item({
    sequence: 25,
    exercise_slug: "extensor-stretch",
    block: "forearm",
    prescription: { sets: 1, hold_seconds: 30, per_side: true, rest_seconds: 0 },
    rest_seconds: 0,
  }),
];

export const ROUTINES: RoutineTemplateDef[] = [
  withEstimatedDuration({
    id: "routine-maintenance",
    name: "Daily maintenance",
    kind: "maintenance",
    description: "Neck + shoulders + spine + hips + ankles",
    day_roles: [],
    items: maintenanceItems,
  }),
  withEstimatedDuration({
    id: "routine-sunday-skills",
    name: "Sunday — Light OAHS + Planche",
    kind: "recovery",
    description: "10-minute light skill primer · OAHS emphasis + planche",
    day_roles: ["recovery"],
    items: sundaySkillItems,
  }),
  withEstimatedDuration({
    id: "routine-monday",
    name: "Monday — Strength + Power",
    kind: "primary",
    description:
      "Wrist/upper warmup → OAHS → Planche → Flag → Front lever → Back lever → lower-body warmup → HSPU → Muscle-up → Strength → Core → Splits",
    day_roles: ["strength_power"],
    items: mondayItems,
  }),
  withEstimatedDuration({
    id: "routine-tuesday",
    name: "Tuesday — Skills + Front split / mobility",
    kind: "short",
    description: "Flag → Planche → OAHS + front-split focused mobility",
    day_roles: ["short_mobility_front"],
    items: tuesdayItems,
  }),
  withEstimatedDuration({
    id: "routine-wednesday-w1",
    name: "Wednesday — Athleticism + Intervals (W1)",
    kind: "primary",
    description: "Skills + power + 6x strong/easy intervals",
    day_roles: ["athleticism_endurance"],
    items: withRun(1, false),
  }),
  withEstimatedDuration({
    id: "routine-wednesday-w2",
    name: "Wednesday — Athleticism + Steady run (W2)",
    kind: "primary",
    description: "Skills + power + 24 min steady run",
    day_roles: ["athleticism_endurance"],
    items: withRun(2, false),
  }),
  withEstimatedDuration({
    id: "routine-wednesday-w3",
    name: "Wednesday — Athleticism + Long easy (W3)",
    kind: "primary",
    description: "Skills + power + 40 min easy (omit lower-leg blocks)",
    day_roles: ["athleticism_endurance"],
    items: withRun(3, true),
  }),
  withEstimatedDuration({
    id: "routine-wednesday-w4",
    name: "Wednesday — Athleticism + Deload run (W4)",
    kind: "primary",
    description: "Skills + power + 18 min very easy",
    day_roles: ["athleticism_endurance"],
    items: withRun(4, false),
  }),
  withEstimatedDuration({
    id: "routine-thursday",
    name: "Thursday — Skills + Deep flexibility",
    kind: "short",
    description: "Flag → Planche → OAHS + deep flexibility",
    day_roles: ["short_deep_flex"],
    items: thursdayItems,
  }),
  withEstimatedDuration({
    id: "routine-friday",
    name: "Friday — Skills + Joint/spine recovery",
    kind: "short",
    description: "Flag → Planche → OAHS + joint/spine recovery",
    day_roles: ["short_recovery"],
    items: fridayItems,
  }),
  withEstimatedDuration({
    id: "routine-swim-perf",
    name: "Friday — Swimming · 45 min",
    kind: "swim",
    description: "Daily light OAHS + planche primer, then 45 minutes swimming",
    day_roles: ["swim_performance"],
    items: swimPerfItems,
  }),
  withEstimatedDuration({
    id: "routine-swim-rec",
    name: "Friday — Swimming · 30 min",
    kind: "swim",
    description: "Daily light OAHS + planche primer, then 30 minutes swimming",
    day_roles: ["swim_recovery"],
    items: swimRecItems,
  }),
  withEstimatedDuration({
    id: "routine-boxing",
    name: "Friday — Boxing · 45 min",
    kind: "boxing",
    description: "Daily light OAHS + planche primer, then 45 minutes boxing",
    day_roles: ["boxing"],
    items: boxingItems,
  }),
  withEstimatedDuration({
    id: "routine-saturday",
    name: "Saturday — Calisthenics Volume + Work Capacity",
    kind: "primary",
    description:
      "Wrist/upper warmup → OAHS → Planche → Flag → Front lever → Back lever → lower-body warmup → Muscle-up → Volume → Core → Conditioning → Flexibility",
    day_roles: ["calisthenics_volume"],
    items: saturdayItems,
  }),
  withEstimatedDuration({
    id: "routine-climbing",
    name: "Saturday — Climbing session",
    kind: "climb",
    description: "Warmup → Skills → Climbing quality + antagonists + flexibility",
    day_roles: ["climbing"],
    items: climbItems,
  }),
];

export function getRoutineById(id: string): RoutineTemplateDef | undefined {
  return ROUTINES.find((r) => r.id === id);
}

export function getRoutineForDayRole(
  role: RoutineTemplateDef["day_roles"][number],
  cycleWeek: 1 | 2 | 3 | 4,
): RoutineTemplateDef {
  if (role === "athleticism_endurance") {
    return getRoutineById(`routine-wednesday-w${cycleWeek}`)!;
  }
  if (role === "swim_performance") return getRoutineById("routine-swim-perf")!;
  if (role === "swim_recovery") return getRoutineById("routine-swim-rec")!;
  if (role === "boxing") return getRoutineById("routine-boxing")!;
  if (role === "climbing") return getRoutineById("routine-climbing")!;
  if (role === "recovery") return getRoutineById("routine-sunday-skills")!;
  const match = ROUTINES.find(
    (r) =>
      r.day_roles.includes(role) &&
      !r.id.startsWith("routine-wednesday") &&
      r.kind !== "swim" &&
      r.kind !== "boxing" &&
      r.kind !== "climb",
  );
  if (!match) throw new Error(`No routine for role ${role}`);
  return match;
}
