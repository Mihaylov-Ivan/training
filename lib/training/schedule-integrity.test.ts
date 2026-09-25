import { describe, expect, it } from "vitest";
import {
  canonicalizeLiveScheduleRows,
  createActiveCycle,
  generateScheduledSessions,
} from "@/lib/training/schedule";
import { normalizeScheduledSession } from "@/lib/training/normalize-schedule";

describe("schedule live-row integrity", () => {
  it("keeps only one live card per schedule slot while allowing separate daily skills", () => {
    const cycle = createActiveCycle("user-1", "2026-09-21");
    const rows = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 1,
    });
    const tuesday = rows.find(
      (row) =>
        row.date === "2026-09-22" &&
        row.day_role === "short_mobility_front",
    )!;
    const duplicate = normalizeScheduledSession({
      ...tuesday,
      id: "duplicate-tuesday",
    });

    const clean = canonicalizeLiveScheduleRows([...rows, duplicate]);

    const liveTuesday = clean.filter(
      (row) =>
        row.date === "2026-09-22" &&
        row.status === "scheduled",
    );
    expect(liveTuesday).toHaveLength(2);
    expect(
      liveTuesday.filter(
        (row) => row.day_role === "short_mobility_front",
      ),
    ).toHaveLength(1);
    expect(
      liveTuesday.filter(
        (row) => row.day_role === "daily_skill_practice",
      ),
    ).toHaveLength(1);
  });

  it("prefers a moved/rescheduled main workout over a generated short session", () => {
    const cycle = createActiveCycle("user-1", "2026-09-21");
    const rows = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 1,
    });
    const tuesday = rows.find(
      (row) =>
        row.date === "2026-09-22" &&
        row.day_role === "short_mobility_front",
    )!;
    const movedStrength = normalizeScheduledSession({
      ...tuesday,
      id: "moved-strength",
      day_role: "strength_power",
      routine_template_id: "routine-monday",
      generated_from_schedule: false,
      auto_rescheduled: true,
      original_date: "2026-09-21",
    });

    const skill = rows.find(
      (row) =>
        row.date === "2026-09-22" &&
        row.day_role === "daily_skill_practice",
    )!;
    const clean = canonicalizeLiveScheduleRows([
      tuesday,
      skill,
      movedStrength,
    ]);

    const liveTuesday = clean.filter(
      (row) =>
        row.date === "2026-09-22" &&
        row.status === "scheduled",
    );
    expect(liveTuesday).toHaveLength(1);
    expect(liveTuesday[0]!.id).toBe("moved-strength");
  });

  it("does not regenerate a completed daily-skill card on ensure-style generation", () => {
    const cycle = createActiveCycle("user-1", "2026-09-21");
    const rows = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 1,
    });
    const skill = rows.find(
      (row) =>
        row.date === "2026-09-22" &&
        row.day_role === "daily_skill_practice",
    )!;
    const completed = normalizeScheduledSession({
      ...skill,
      status: "completed",
      completed_at: "2026-09-22T08:00:00.000Z",
    });
    const existing = rows.map((row) =>
      row.id === skill.id ? completed : row,
    );

    const regenerated = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 1,
      existing,
    });

    expect(
      regenerated.filter(
        (row) =>
          row.date === "2026-09-22" &&
          row.day_role === "daily_skill_practice",
      ),
    ).toHaveLength(1);
    expect(
      regenerated.find((row) => row.id === skill.id)?.status,
    ).toBe("completed");
  });

  it("preserves an early-started future session as in progress during schedule regeneration", () => {
    const cycle = createActiveCycle("user-1", "2026-09-21");
    const rows = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 2,
    });
    const future = rows.find(
      (row) =>
        row.date === "2026-09-23" &&
        row.day_role === "athleticism_endurance",
    )!;
    const started = normalizeScheduledSession({
      ...future,
      status: "in_progress",
    });
    const existing = rows.map((row) =>
      row.id === future.id ? started : row,
    );

    const regenerated = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 2,
      existing,
    });

    expect(
      regenerated.find((row) => row.id === future.id)?.status,
    ).toBe("in_progress");
    expect(
      regenerated.filter(
        (row) =>
          row.date === future.date &&
          row.day_role === "athleticism_endurance",
      ),
    ).toHaveLength(1);
  });

  it("allows terminal history alongside the two intentional live cards", () => {
    const cycle = createActiveCycle("user-1", "2026-09-21");
    const rows = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 1,
    });
    const tuesday = rows.find(
      (row) =>
        row.date === "2026-09-22" &&
        row.day_role === "short_mobility_front",
    )!;
    const skill = rows.find(
      (row) =>
        row.date === "2026-09-22" &&
        row.day_role === "daily_skill_practice",
    )!;
    const missedHistory = normalizeScheduledSession({
      ...tuesday,
      id: "missed-history",
      status: "missed",
      generated_from_schedule: false,
    });

    const clean = canonicalizeLiveScheduleRows([
      tuesday,
      skill,
      missedHistory,
    ]);

    expect(
      clean.filter(
        (row) =>
          row.date === "2026-09-22" &&
          row.status === "scheduled",
      ),
    ).toHaveLength(2);
    expect(
      clean.find((row) => row.id === "missed-history")?.status,
    ).toBe("missed");
  });
});
