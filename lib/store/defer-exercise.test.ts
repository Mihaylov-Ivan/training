import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/lib/store/app-store";
import type { SessionItem, TrainingSession } from "@/lib/types";

function makeSession(): { session: TrainingSession; items: SessionItem[] } {
  const sessionId = "sess-1";
  const session: TrainingSession = {
    id: sessionId,
    user_id: "local-user",
    scheduled_session_id: null,
    routine_template_id: "routine-monday",
    started_at: new Date().toISOString(),
    ended_at: null,
    status: "active",
    readiness_snapshot: null,
    notes: "",
    cycle_week: 1,
    overview_seen: true,
  };
  const items: SessionItem[] = [
    {
      id: "si-a",
      training_session_id: sessionId,
      routine_item_id: "ri-a",
      exercise_id: "ex-a",
      exercise_slug: "handstand-push-up",
      exercise_name: "Handstand push-up",
      sequence: 1,
      block: "strength",
      prescription_snapshot: { sets: 4, reps_per_set: 5, rest_seconds: 150 },
      progression_state_snapshot: null,
      progression_rule_code: null,
      progression_scope: null,
      status: "active",
    },
    {
      id: "si-b",
      training_session_id: sessionId,
      routine_item_id: "ri-b",
      exercise_id: "ex-b",
      exercise_slug: "strict-muscle-up",
      exercise_name: "Strict muscle-up",
      sequence: 2,
      block: "power",
      prescription_snapshot: { sets: 4, reps_per_set: 3, rest_seconds: 150 },
      progression_state_snapshot: null,
      progression_rule_code: null,
      progression_scope: null,
      status: "pending",
    },
    {
      id: "si-c",
      training_session_id: sessionId,
      routine_item_id: "ri-c",
      exercise_id: "ex-c",
      exercise_slug: "push-up",
      exercise_name: "Push-up",
      sequence: 3,
      block: "volume",
      prescription_snapshot: { sets: 3, reps_per_set: 20, rest_seconds: 60 },
      progression_state_snapshot: null,
      progression_rule_code: null,
      progression_scope: null,
      status: "pending",
    },
  ];
  return { session, items };
}

describe("deferExerciseAfterNext", () => {
  beforeEach(() => {
    const { session, items } = makeSession();
    useAppStore.setState({
      trainingSessions: [session],
      sessionItems: items,
      activeTimer: null,
      awaitingCompletion: false,
    });
  });

  it("swaps the current exercise with the next pending one", () => {
    useAppStore.getState().deferExerciseAfterNext("si-a");
    const ordered = useAppStore
      .getState()
      .sessionItems.slice()
      .sort((a, b) => a.sequence - b.sequence);

    expect(ordered.map((i) => i.exercise_slug)).toEqual([
      "strict-muscle-up",
      "handstand-push-up",
      "push-up",
    ]);
    expect(ordered[0]?.status).toBe("active");
    expect(ordered[1]?.status).toBe("pending");
  });
});
