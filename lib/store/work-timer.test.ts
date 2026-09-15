import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/lib/store/app-store";
import type { SessionItem, TrainingSession } from "@/lib/types";

function seedHoldSession() {
  const session: TrainingSession = {
    id: "sess-hold",
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
      id: "si-hold",
      training_session_id: session.id,
      routine_item_id: "ri-hold",
      exercise_id: "ex-hollow",
      exercise_slug: "hollow-hold",
      exercise_name: "Hollow-body hold",
      sequence: 1,
      block: "warmup",
      prescription_snapshot: { sets: 1, hold_seconds: 20, rest_seconds: 0 },
      progression_state_snapshot: null,
      progression_rule_code: null,
      progression_scope: null,
      status: "active",
    },
    {
      id: "si-run",
      training_session_id: session.id,
      routine_item_id: "ri-run",
      exercise_id: "ex-easy-jog",
      exercise_slug: "easy-jog",
      exercise_name: "Easy jog",
      sequence: 2,
      block: "warmup",
      prescription_snapshot: { duration_seconds: 120, rest_seconds: 0 },
      progression_state_snapshot: null,
      progression_rule_code: null,
      progression_scope: null,
      status: "pending",
    },
  ];
  useAppStore.setState({
    trainingSessions: [session],
    sessionItems: items,
    activeTimer: null,
    awaitingCompletion: false,
    setResults: [],
  });
}

describe("startWorkTimer", () => {
  beforeEach(() => {
    seedHoldSession();
  });

  it("starts a hold countdown from hold_seconds", () => {
    useAppStore.getState().startWorkTimer("si-hold");
    const t = useAppStore.getState().activeTimer;
    expect(t).toMatchObject({
      session_item_id: "si-hold",
      rest_duration_seconds: 20,
      kind: "hold",
    });
  });

  it("starts a work countdown from duration_seconds", () => {
    useAppStore.getState().startWorkTimer("si-run");
    const t = useAppStore.getState().activeTimer;
    expect(t).toMatchObject({
      session_item_id: "si-run",
      rest_duration_seconds: 120,
      kind: "work",
    });
  });
});
