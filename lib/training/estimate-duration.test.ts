import { describe, expect, it } from "vitest";
import { estimateRoutineDurationMin } from "@/lib/training/estimate-duration";
import {
  intensityForItem,
  resolveIntensityRestSeconds,
} from "@/lib/training/intensity-rest";
import { applyMinBetweenSetRest } from "@/lib/training/rest";
import { normalizeRoutineItemOrder } from "@/lib/training/routine-order";
import { getRoutineById, ROUTINES } from "@/lib/seed/routines";
import type { RoutineItemDef } from "@/lib/types";

describe("applyMinBetweenSetRest", () => {
  it("floors positive rests below 15s up to 15", () => {
    expect(applyMinBetweenSetRest(10)).toBe(15);
    expect(applyMinBetweenSetRest(12)).toBe(15);
    expect(applyMinBetweenSetRest(15)).toBe(15);
    expect(applyMinBetweenSetRest(90)).toBe(90);
  });

  it("leaves zero rest unchanged", () => {
    expect(applyMinBetweenSetRest(0)).toBe(0);
    expect(applyMinBetweenSetRest(null)).toBe(0);
  });
});

describe("intensity rest", () => {
  it("classifies HSPU and muscle-up as max intensity", () => {
    expect(
      intensityForItem({
        block: "strength",
        exercise_slug: "handstand-push-up",
        prescription: { sets: 4, reps_per_set: 5, rest_seconds: 150 },
      }),
    ).toBe("max");
    expect(
      intensityForItem({
        block: "power",
        exercise_slug: "strict-muscle-up",
        prescription: { sets: 4, reps_per_set: 3, rest_seconds: 90 },
      }),
    ).toBe("max");
  });

  it("raises short rests to the intensity recommendation", () => {
    const rest = resolveIntensityRestSeconds({
      id: "x",
      sequence: 1,
      block: "power",
      exercise_slug: "clap-push-up",
      prescription: { sets: 3, reps_per_set: 5, rest_seconds: 30 },
      rest_seconds: 30,
    });
    expect(rest).toBe(90);
  });

  it("keeps intentional zero rest for supersets and warmup", () => {
    expect(
      resolveIntensityRestSeconds({
        id: "x",
        sequence: 1,
        block: "volume",
        exercise_slug: "pull-up",
        prescription: {
          sets: 4,
          reps_per_set: 10,
          rest_seconds: 0,
          notes: "Then dips",
        },
        rest_seconds: 0,
      }),
    ).toBe(0);
  });
});

describe("normalizeRoutineItemOrder", () => {
  it("places upper warmup first, then OAHS → planche → flag → levers, then lower warmup", () => {
    const items: RoutineItemDef[] = [
      {
        id: "1",
        exercise_slug: "wrist-rocks",
        sequence: 1,
        block: "warmup",
        prescription: { sets: 1, reps_per_set: 10, rest_seconds: 0 },
        rest_seconds: 0,
      },
      {
        id: "2",
        exercise_slug: "reverse-lunge",
        sequence: 2,
        block: "warmup",
        prescription: { sets: 1, reps_per_set: 8, per_side: true, rest_seconds: 0 },
        rest_seconds: 0,
      },
      {
        id: "3",
        exercise_slug: "one-leg-human-flag",
        sequence: 3,
        block: "skill",
        prescription: { sets: 3, hold_seconds: 6, rest_seconds: 60 },
        rest_seconds: 60,
      },
      {
        id: "4",
        exercise_slug: "back-lever-hold",
        sequence: 4,
        block: "skill",
        prescription: { sets: 3, hold_seconds: 8, rest_seconds: 60 },
        rest_seconds: 60,
      },
      {
        id: "5",
        exercise_slug: "oahs-practice",
        sequence: 5,
        block: "skill",
        prescription: { duration_seconds: 300, rest_seconds: 0 },
        rest_seconds: 0,
      },
      {
        id: "6",
        exercise_slug: "front-lever-hold",
        sequence: 6,
        block: "skill",
        prescription: { sets: 3, hold_seconds: 8, rest_seconds: 60 },
        rest_seconds: 60,
      },
      {
        id: "7",
        exercise_slug: "planche-hold",
        sequence: 7,
        block: "skill",
        prescription: { duration_seconds: 300, rest_seconds: 40 },
        rest_seconds: 40,
      },
    ];

    const ordered = normalizeRoutineItemOrder(items).map((i) => i.exercise_slug);
    expect(ordered).toEqual([
      "wrist-rocks",
      "oahs-practice",
      "planche-hold",
      "one-leg-human-flag",
      "front-lever-hold",
      "back-lever-hold",
      "reverse-lunge",
    ]);
  });
});

describe("estimateRoutineDurationMin", () => {
  it("counts set work and between-set rest", () => {
    const min = estimateRoutineDurationMin({
      items: [
        {
          id: "a",
          exercise_slug: "push-up",
          sequence: 1,
          block: "volume",
          prescription: { sets: 3, reps_per_set: 10, rest_seconds: 60 },
          rest_seconds: 60,
        },
      ],
    });
    // 3 sets × 10 reps × 3s = 90s work + 2 × 60s rest = 210s ≈ 4 min
    expect(min).toBe(4);
  });

  it("returns a positive estimate for seeded primary routines", () => {
    const monday = getRoutineById("routine-monday")!;
    const est = estimateRoutineDurationMin(monday);
    expect(est).toBeGreaterThan(30);
    expect(est).toBeLessThan(180);
  });

  it("every seeded routine has a matching default_duration_min", () => {
    for (const r of ROUTINES) {
      expect(r.default_duration_min).toBe(estimateRoutineDurationMin(r));
    }
  });

  it("monday keeps skills fresh before lower-body warmup", () => {
    const mon = getRoutineById("routine-monday")!;
    const slugs = mon.items.map((i) => i.exercise_slug);
    const order = [
      slugs.indexOf("oahs-practice"),
      slugs.indexOf("planche-hold"),
      slugs.indexOf("one-leg-human-flag"),
      slugs.indexOf("front-lever-hold"),
      slugs.indexOf("back-lever-hold"),
    ];
    expect(slugs.indexOf("wrist-rocks")).toBeLessThan(order[0]!);
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(order[4]!).toBeLessThan(slugs.indexOf("air-squat"));
  });
});
