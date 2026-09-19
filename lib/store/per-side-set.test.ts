import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/lib/store/app-store";
import type { SessionItem, TrainingSession } from "@/lib/types";

function setup(perSide = true) {
  const session: TrainingSession = {
    id: "sess-side",
    user_id: "local-user",
    scheduled_session_id: null,
    routine_template_id: "routine-wednesday-w1",
    started_at: new Date().toISOString(),
    ended_at: null,
    status: "active",
    readiness_snapshot: null,
    notes: "",
    cycle_week: 1,
    overview_seen: true,
  };
  const item: SessionItem = {
    id: "si-side",
    training_session_id: session.id,
    routine_item_id: "ri-side",
    exercise_id: "ex-pistol",
    exercise_slug: "pistol-squat",
    exercise_name: "Pistol squat",
    sequence: 1,
    block: "legs",
    prescription_snapshot: {
      sets: 3,
      reps_per_set: 6,
      per_side: perSide,
      rest_seconds: 90,
    },
    progression_state_snapshot: null,
    progression_rule_code: null,
    progression_scope: null,
    status: "active",
  };
  useAppStore.setState({
    trainingSessions: [session],
    sessionItems: [item],
    setResults: [],
    activeTimer: null,
    awaitingCompletion: false,
  });
}

describe("per-side set logging", () => {
  beforeEach(() => setup());

  it("does not rest between left and right sides of the same set", () => {
    useAppStore.getState().completeSet({
      sessionItemId: "si-side",
      setIndex: 1,
      actual: { reps: 6, side: "left" },
    });
    expect(useAppStore.getState().activeTimer).toBeNull();
    expect(useAppStore.getState().awaitingCompletion).toBe(false);

    useAppStore.getState().completeSet({
      sessionItemId: "si-side",
      setIndex: 1,
      actual: { reps: 6, side: "right" },
    });
    expect(useAppStore.getState().activeTimer).toMatchObject({
      kind: "rest",
      rest_duration_seconds: 90,
    });
  });

  it("stores the two sides as separate results under one logical set", () => {
    useAppStore.getState().completeSet({
      sessionItemId: "si-side",
      setIndex: 1,
      actual: { reps: 6, side: "left" },
    });
    useAppStore.getState().completeSet({
      sessionItemId: "si-side",
      setIndex: 1,
      actual: { reps: 5, side: "right" },
    });
    const rows = useAppStore
      .getState()
      .setResults.filter((row) => row.session_item_id === "si-side");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.actual.side, row.actual.reps])).toEqual([
      ["left", 6],
      ["right", 5],
    ]);
  });
});
