import { describe, expect, it } from "vitest";
import {
  evaluateProgression,
  undoProgressionEvent,
} from "@/lib/progression/engine";
import { applyDeloadToPrescription } from "@/lib/training/deload";
import type { ProgressionState, RoutineItemDef } from "@/lib/types";

function state(partial: Partial<ProgressionState> & { state: Record<string, unknown> }): ProgressionState {
  return {
    id: "ps-1",
    user_id: "local-user",
    scope_type: "routine_item",
    scope_id: "test",
    current_level: null,
    success_credits: 0,
    consecutive_successes: 0,
    consecutive_failures: 0,
    updated_at: new Date().toISOString(),
    ...partial,
  };
}

describe("WEIGHTED_PULLUP_4X5_V1", () => {
  it("success at +20 kg -> +21 kg", () => {
    const r = evaluateProgression(
      state({ state: { load_kg: 20, consecutive_failures: 0 } }),
      {
        ruleCode: "WEIGHTED_PULLUP_4X5_V1",
        completedAll: true,
        sessionItemId: "si",
        userId: "u",
      },
    );
    expect(r.state.state.load_kg).toBe(21);
    expect(r.nextPrescriptionPreview).toContain("21");
  });

  it("two consecutive failures -> -2 kg", () => {
    let s = state({ state: { load_kg: 20, consecutive_failures: 0 } });
    s = evaluateProgression(s, {
      ruleCode: "WEIGHTED_PULLUP_4X5_V1",
      completedAll: false,
      sessionItemId: "si",
      userId: "u",
    }).state;
    expect(s.state.load_kg).toBe(20);
    expect(s.state.consecutive_failures).toBe(1);
    s = evaluateProgression(s, {
      ruleCode: "WEIGHTED_PULLUP_4X5_V1",
      completedAll: false,
      sessionItemId: "si",
      userId: "u",
    }).state;
    expect(s.state.load_kg).toBe(18);
  });
});

describe("HSPU_LEVEL_V1", () => {
  it("4x5 -> 4x6 -> 4x7 -> next level 4x5", () => {
    let s = state({
      scope_id: "handstand-push-up",
      current_level: "wall",
      state: { level: "wall", reps_per_set: 5 },
    });
    s = evaluateProgression(s, {
      ruleCode: "HSPU_LEVEL_V1",
      completedAll: true,
      sessionItemId: "si",
      userId: "u",
    }).state;
    expect(s.state.reps_per_set).toBe(6);
    s = evaluateProgression(s, {
      ruleCode: "HSPU_LEVEL_V1",
      completedAll: true,
      sessionItemId: "si",
      userId: "u",
    }).state;
    expect(s.state.reps_per_set).toBe(7);
    s = evaluateProgression(s, {
      ruleCode: "HSPU_LEVEL_V1",
      completedAll: true,
      sessionItemId: "si",
      userId: "u",
    }).state;
    expect(s.state.level).toBe("freestanding");
    expect(s.state.reps_per_set).toBe(5);
  });
});

describe("PLANCHE_V1", () => {
  it("two successful hard sessions advance level and reset holds", () => {
    let s = state({
      scope_type: "global_skill",
      scope_id: "planche",
      current_level: "tuck",
      state: {
        level: "tuck",
        hard_hold_seconds: 8,
        medium_hold_seconds: 6,
        light_hold_seconds: 6,
        hard_success_credits: 0,
        hard_fail_streak: 0,
      },
    });
    s = evaluateProgression(s, {
      ruleCode: "PLANCHE_V1",
      completedAll: true,
      sessionItemId: "si",
      userId: "u",
      metrics: { protocol: "hard" },
    }).state;
    expect(s.state.hard_success_credits).toBe(1);
    s = evaluateProgression(s, {
      ruleCode: "PLANCHE_V1",
      completedAll: true,
      sessionItemId: "si",
      userId: "u",
      metrics: { protocol: "hard" },
    }).state;
    expect(s.state.level).toBe("advanced_tuck");
    expect(s.state.hard_hold_seconds).toBe(5);
    expect(s.state.medium_hold_seconds).toBe(4);
    expect(s.state.light_hold_seconds).toBe(4);
  });
});

describe("lever progression", () => {
  it("light technique sessions do not earn lever credits", () => {
    const result = evaluateProgression(
      state({
        scope_type: "global_skill",
        scope_id: "front_lever",
        current_level: "tuck",
        state: { level: "tuck", success_credits: 0 },
      }),
      {
        ruleCode: "FRONT_LEVER_V1",
        completedAll: true,
        difficulty: 6,
        sessionItemId: "si",
        userId: "u",
        metrics: { lever_protocol: "light" },
      },
    );
    expect(result.state.state.success_credits).toBe(0);
    expect(result.event.event_type).toBe("hold");
  });

  it("three controlled hard sessions advance the lever level", () => {
    let s = state({
      scope_type: "global_skill",
      scope_id: "front_lever",
      current_level: "tuck",
      state: { level: "tuck", success_credits: 0 },
    });
    for (let i = 0; i < 3; i++) {
      s = evaluateProgression(s, {
        ruleCode: "FRONT_LEVER_V1",
        completedAll: true,
        difficulty: 7,
        sessionItemId: "si",
        userId: "u",
        metrics: { lever_protocol: "hard" },
      }).state;
    }
    expect(s.state.level).toBe("advanced_tuck");
  });
});

describe("RUN_INTERVALS_V1", () => {
  it("reduces easy recovery before adding rounds", () => {
    let s = state({
      scope_type: "capability",
      scope_id: "run_intervals",
      state: {
        rounds: 6,
        strong_sec: 120,
        easy_sec: 120,
        pace_offset_sec_per_km: 0,
      },
    });
    s = evaluateProgression(s, {
      ruleCode: "RUN_INTERVALS_V1",
      completedAll: true,
      difficulty: 7,
      sessionItemId: "si",
      userId: "u",
    }).state;
    expect(s.state.easy_sec).toBe(110);
    expect(s.state.rounds).toBe(6);
  });
});

describe("FRONT_SPLIT_V1", () => {
  it("two credits reduce gap by 1 cm", () => {
    let s = state({
      scope_type: "global_skill",
      scope_id: "front_split",
      state: {
        left_gap_cm: 8,
        right_gap_cm: 8,
        left_credits: 0,
        right_credits: 0,
      },
    });
    s = evaluateProgression(s, {
      ruleCode: "FRONT_SPLIT_V1",
      completedAll: true,
      sessionItemId: "si",
      userId: "u",
      metrics: { side: "left" },
    }).state;
    expect(s.state.left_credits).toBe(1);
    expect(s.state.left_gap_cm).toBe(8);
    s = evaluateProgression(s, {
      ruleCode: "FRONT_SPLIT_V1",
      completedAll: true,
      sessionItemId: "si",
      userId: "u",
      metrics: { side: "left" },
    }).state;
    expect(s.state.left_gap_cm).toBe(7);
  });
});

describe("deload", () => {
  it("Week 4 transforms 4 sets to 3 and 3 sets to 2", () => {
    const item4: RoutineItemDef = {
      id: "1",
      exercise_slug: "weighted-pull-up",
      sequence: 1,
      block: "strength",
      prescription: { sets: 4, reps_per_set: 5 },
      rest_seconds: 150,
    };
    const item3: RoutineItemDef = {
      id: "2",
      exercise_slug: "bulgarian-split-squat",
      sequence: 2,
      block: "strength",
      prescription: { sets: 3, reps_per_set: 8 },
      rest_seconds: 90,
    };
    expect(applyDeloadToPrescription(item4, item4.prescription, 4).sets).toBe(3);
    expect(applyDeloadToPrescription(item3, item3.prescription, 4).sets).toBe(2);
    expect(applyDeloadToPrescription(item4, item4.prescription, 4).reps_per_set).toBe(5);
  });
});

describe("SWIM_PERFORMANCE_V1", () => {
  it("success adds exactly 50 m until 1200 m cap", () => {
    let s = state({
      scope_type: "capability",
      scope_id: "swim_performance",
      state: { strong_repeats: 6, strong_rest: 30, total_m: 900 },
    });
    s = evaluateProgression(s, {
      ruleCode: "SWIM_PERFORMANCE_V1",
      completedAll: true,
      difficulty: 7,
      sessionItemId: "si",
      userId: "u",
    }).state;
    expect(s.state.total_m).toBe(950);
    expect(s.state.strong_repeats).toBe(7);
  });
});

describe("CLIMB_QUALITY_V1", () => {
  it("completed in 2 attempts advances grade; 3 holds", () => {
    let s = state({
      scope_type: "capability",
      scope_id: "climb_quality",
      state: { grades: { A: "V2", B: "V2", C: "V3", D: "V3" } },
    });
    s = evaluateProgression(s, {
      ruleCode: "CLIMB_QUALITY_V1",
      completedAll: true,
      sessionItemId: "si",
      userId: "u",
      problemLetter: "A",
      attemptsToComplete: 2,
    }).state;
    expect((s.state.grades as Record<string, string>).A).toBe("V3");

    s = evaluateProgression(s, {
      ruleCode: "CLIMB_QUALITY_V1",
      completedAll: true,
      sessionItemId: "si",
      userId: "u",
      problemLetter: "B",
      attemptsToComplete: 3,
    }).state;
    expect((s.state.grades as Record<string, string>).B).toBe("V2");
  });
});

describe("undo", () => {
  it("restores exact pre-event progression state", () => {
    const before = state({ state: { load_kg: 20, consecutive_failures: 0 } });
    const r = evaluateProgression(before, {
      ruleCode: "WEIGHTED_PULLUP_4X5_V1",
      completedAll: true,
      sessionItemId: "si",
      userId: "u",
    });
    expect(r.state.state.load_kg).toBe(21);
    const restored = undoProgressionEvent(r.state, r.event);
    expect(restored.state.load_kg).toBe(20);
  });
});
