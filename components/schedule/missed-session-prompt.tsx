"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { getRoutineById } from "@/lib/seed/routines";
import type { MissReason } from "@/lib/types";
import {
  Card,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui/primitives";

const REASONS: { id: MissReason; label: string }[] = [
  { id: "no_time", label: "No time" },
  { id: "fatigue", label: "Fatigue" },
  { id: "poor_sleep", label: "Poor sleep" },
  { id: "illness", label: "Illness" },
  { id: "pain_or_injury", label: "Pain / injury" },
  { id: "travel", label: "Travel" },
  { id: "forgot", label: "Forgot" },
  { id: "intentional_rest", label: "Intentional rest" },
  { id: "other", label: "Other" },
];

export function MissedSessionPrompt() {
  const pendingId = useAppStore((s) => s.pendingMissedSessionId);
  const missPromptMode = useAppStore((s) => s.missPromptMode);
  const sessions = useAppStore((s) => s.scheduledSessions);
  const resolveMissedSession = useAppStore((s) => s.resolveMissedSession);
  const cancelMissPrompt = useAppStore((s) => s.cancelMissPrompt);
  const trainingPause = useAppStore((s) => s.trainingPause);
  const resumeTrainingPause = useAppStore((s) => s.resumeTrainingPause);

  const manual = missPromptMode === "manual_miss";
  const [step, setStep] = useState<"outcome" | "reason" | "injury">(
    manual ? "reason" : "outcome",
  );
  const [reason, setReason] = useState<MissReason | null>(null);
  const [injuryArea, setInjuryArea] = useState("");
  const [injuryExercise, setInjuryExercise] = useState("");

  useEffect(() => {
    if (!pendingId) {
      setStep("outcome");
      setReason(null);
      setInjuryArea("");
      setInjuryExercise("");
      return;
    }
    setStep(missPromptMode === "manual_miss" ? "reason" : "outcome");
    setReason(null);
    setInjuryArea("");
    setInjuryExercise("");
  }, [pendingId, missPromptMode]);

  const session = sessions.find((s) => s.id === pendingId);
  const routine = session
    ? getRoutineById(session.routine_template_id)
    : null;

  if (trainingPause?.active) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 md:items-center">
        <Card className="w-full max-w-md space-y-3">
          <h3 className="text-lg font-semibold">Training paused while recovering</h3>
          <p className="text-sm text-muted">
            Illness was logged. When you feel ready, resume and the app will apply an
            appropriate return-to-training week
            {trainingPause.return_protocol !== "none"
              ? ` (${trainingPause.return_protocol} protocol)`
              : ""}
            .
          </p>
          <PrimaryButton className="w-full" onClick={() => resumeTrainingPause()}>
            I&apos;m ready to train again
          </PrimaryButton>
        </Card>
      </div>
    );
  }

  if (!session || !pendingId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 md:items-center">
      <Card className="w-full max-w-md space-y-4">
        <div>
          <h3 className="text-lg font-semibold">
            {manual
              ? "Mark session as missed"
              : `You didn't log ${session.date}'s workout`}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {routine?.name ?? session.day_role.replaceAll("_", " ")}
            {manual ? ` · ${session.date}` : ""}
          </p>
          <p className="mt-2 text-sm text-muted">
            {manual ? "Why are you missing this session?" : "What happened?"}
          </p>
        </div>

        {step === "outcome" ? (
          <div className="space-y-2">
            <PrimaryButton
              className="w-full"
              onClick={() => {
                resolveMissedSession({
                  scheduledId: pendingId,
                  outcome: "completed",
                });
              }}
            >
              I completed it
            </PrimaryButton>
            <SecondaryButton
              className="w-full"
              onClick={() => {
                resolveMissedSession({
                  scheduledId: pendingId,
                  outcome: "partially_completed",
                });
              }}
            >
              I partially completed it
            </SecondaryButton>
            <SecondaryButton
              className="w-full"
              onClick={() => setStep("reason")}
            >
              I missed it
            </SecondaryButton>
            <button
              type="button"
              className="w-full py-2 text-sm text-muted"
              onClick={() => cancelMissPrompt()}
            >
              Not now
            </button>
          </div>
        ) : null}

        {step === "reason" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {REASONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`min-h-11 rounded-xl border px-3 text-sm font-medium ${
                    reason === r.id
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border"
                  }`}
                  onClick={() => setReason(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <SecondaryButton
                className="flex-1"
                onClick={() => {
                  if (manual) {
                    cancelMissPrompt();
                    return;
                  }
                  setStep("outcome");
                  setReason(null);
                }}
              >
                {manual ? "Cancel" : "Back"}
              </SecondaryButton>
              <PrimaryButton
                className="flex-1"
                disabled={!reason}
                onClick={() => {
                  if (!reason) return;
                  if (reason === "pain_or_injury") {
                    setStep("injury");
                    return;
                  }
                  resolveMissedSession({
                    scheduledId: pendingId,
                    outcome: "missed",
                    reason,
                  });
                }}
              >
                Continue
              </PrimaryButton>
            </div>
          </div>
        ) : null}

        {step === "injury" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              The app will not diagnose injury. This only flags affected work.
            </p>
            <label className="block text-sm">
              Body area
              <input
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2"
                value={injuryArea}
                onChange={(e) => setInjuryArea(e.target.value)}
                placeholder="e.g. shoulder"
              />
            </label>
            <label className="block text-sm">
              Exercise / activity
              <input
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2"
                value={injuryExercise}
                onChange={(e) => setInjuryExercise(e.target.value)}
                placeholder="e.g. weighted pull-up"
              />
            </label>
            <div className="flex gap-2">
              <SecondaryButton className="flex-1" onClick={() => setStep("reason")}>
                Back
              </SecondaryButton>
              <PrimaryButton
                className="flex-1"
                onClick={() => {
                  resolveMissedSession({
                    scheduledId: pendingId,
                    outcome: "missed",
                    reason: "pain_or_injury",
                    injuryArea: injuryArea || null,
                    injuryExercise: injuryExercise || null,
                  });
                }}
              >
                Mark missed
              </PrimaryButton>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
