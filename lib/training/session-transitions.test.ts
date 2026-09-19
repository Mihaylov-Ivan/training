import { describe, expect, it } from "vitest";
import type { SessionItem } from "@/lib/types";
import {
  BETWEEN_SKILL_REST_SECONDS,
  PRE_SKILL_REST_SECONDS,
  transitionRestSeconds,
  buildExerciseSubstitution,
} from "@/lib/training/session-transitions";

function item(
  id: string,
  slug: string,
  block: SessionItem["block"],
): SessionItem {
  return {
    id,
    training_session_id: "s",
    routine_item_id: id,
    exercise_id: slug,
    exercise_slug: slug,
    exercise_name: slug,
    sequence: 1,
    block,
    prescription_snapshot: { sets: 1, reps_per_set: 1, rest_seconds: 0 },
    progression_state_snapshot: null,
    progression_rule_code: null,
    progression_scope: null,
    status: "active",
  };
}

describe("session transitions", () => {
  it("gives 90 seconds after upper warmup before first skill", () => {
    expect(
      transitionRestSeconds(
        item("w", "wrist-rocks", "warmup"),
        item("o", "oahs-practice", "skill"),
      ),
    ).toBe(PRE_SKILL_REST_SECONDS);
  });

  it("gives rest between consecutive skills", () => {
    expect(
      transitionRestSeconds(
        item("o", "oahs-practice", "skill"),
        item("p", "planche-hold", "skill"),
      ),
    ).toBe(BETWEEN_SKILL_REST_SECONDS);
  });

  it("never returns zero between normal exercises", () => {
    expect(
      transitionRestSeconds(
        item("a", "push-up", "volume"),
        item("b", "inverted-row", "volume"),
      ),
    ).toBeGreaterThanOrEqual(15);
  });

  it("returns a configured substitute when the current movement cannot be done", () => {
    const current = item("a", "front-lever-hold", "skill");
    current.exercise_name = "Front lever hold";
    const replacement = buildExerciseSubstitution(current);
    expect(replacement?.exercise_slug).toBe("inverted-row");
    expect(replacement?.prescription_snapshot.extras?.substitution_reason).toBe(
      "cannot_do",
    );
  });
});
