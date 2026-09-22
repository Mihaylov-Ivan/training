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
    const tuesday = rows.find((row) => row.date === "2026-09-22")!;
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
    const tuesday = rows.find((row) => row.date === "2026-09-22")!;
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

  it("allows terminal history alongside one live card", () => {
    const cycle = createActiveCycle("user-1", "2026-09-21");
    const rows = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 1,
    });
    const tuesday = rows.find((row) => row.date === "2026-09-22")!;
    const missedHistory = normalizeScheduledSession({
      ...tuesday,
      id: "missed-history",
      status: "missed",
      generated_from_schedule: false,
    });

    const clean = canonicalizeLiveScheduleRows([
      tuesday,
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
