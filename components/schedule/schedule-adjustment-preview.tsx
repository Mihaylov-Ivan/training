"use client";

import { useAppStore } from "@/lib/store/app-store";
import { getRoutineById } from "@/lib/seed/routines";
import {
  Card,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui/primitives";

export function ScheduleAdjustmentPreview() {
  const proposal = useAppStore((s) => s.pendingAdjustment);
  const applyScheduleAdjustment = useAppStore((s) => s.applyScheduleAdjustment);
  const keepOriginalSchedule = useAppStore((s) => s.keepOriginalSchedule);
  const dismissScheduleAdjustment = useAppStore((s) => s.dismissScheduleAdjustment);
  const skipScheduledSession = useAppStore((s) => s.skipScheduledSession);

  if (!proposal) return null;

  const show =
    proposal.moved_sessions.length > 0 ||
    proposal.recommendation === "pause" ||
    proposal.recommendation === "apply" ||
    (proposal.recommendation === "skip_and_resume" &&
      proposal.warnings.length > 0);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 md:items-center">
      <Card className="max-h-[85dvh] w-full max-w-md space-y-4 overflow-y-auto">
        <div>
          <h3 className="text-lg font-semibold">
            {proposal.recommendation === "pause"
              ? "Training paused"
              : "We adjusted your schedule"}
          </h3>
          <p className="mt-2 whitespace-pre-line text-sm text-muted">
            {proposal.explanation}
          </p>
        </div>

        {proposal.moved_sessions.length > 0 ? (
          <ul className="space-y-2">
            {proposal.moved_sessions.map((m) => (
              <li
                key={`${m.session_id}-${m.to_date}`}
                className="rounded-xl border border-border px-3 py-2 text-sm"
              >
                <p className="font-semibold">
                  {m.label ||
                    getRoutineById(m.routine_template_id)?.name ||
                    m.day_role}
                </p>
                <p className="text-muted">
                  {m.from_date} → {m.to_date}
                </p>
              </li>
            ))}
          </ul>
        ) : null}

        {proposal.warnings.length > 0 ? (
          <div className="space-y-1 rounded-xl bg-warning-soft/40 px-3 py-2 text-sm text-warning">
            {proposal.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        ) : null}

        <div className="space-y-2">
          {proposal.recommendation === "pause" ? (
            <PrimaryButton
              className="w-full"
              onClick={() => applyScheduleAdjustment(proposal)}
            >
              Confirm pause
            </PrimaryButton>
          ) : (
            <PrimaryButton
              className="w-full"
              onClick={() => applyScheduleAdjustment(proposal)}
            >
              Apply changes
            </PrimaryButton>
          )}
          <SecondaryButton
            className="w-full"
            onClick={() =>
              skipScheduledSession(
                proposal.missed_session_id,
                proposal.reason,
              )
            }
          >
            Skip session &amp; resume normally
          </SecondaryButton>
          <SecondaryButton
            className="w-full"
            onClick={() =>
              keepOriginalSchedule(
                proposal.missed_session_id,
                proposal.reason,
              )
            }
          >
            Keep original schedule
          </SecondaryButton>
          <button
            type="button"
            className="w-full py-2 text-sm text-muted"
            onClick={() => dismissScheduleAdjustment()}
          >
            Close
          </button>
        </div>
      </Card>
    </div>
  );
}
