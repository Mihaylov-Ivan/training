"use client";

import type { ExerciseDef, Prescription } from "@/lib/types";
import { formatPrescription } from "@/lib/utils";
import { SecondaryButton } from "@/components/ui/primitives";

export function ExerciseDrawer({
  exercise,
  prescription,
  onClose,
}: {
  exercise: ExerciseDef;
  prescription: Prescription;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center"
      role="dialog"
      aria-modal
      aria-label={`${exercise.name} instructions`}
    >
      <div className="max-h-[85dvh] w-full max-w-lg overflow-auto rounded-t-3xl border border-border bg-card p-5 md:rounded-3xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{exercise.name}</h2>
            <p className="mt-1 text-sm text-muted">
              {formatPrescription(prescription)}
            </p>
          </div>
          <SecondaryButton className="!min-h-10 !px-3 !text-sm" onClick={onClose}>
            Close
          </SecondaryButton>
        </div>
        <section className="space-y-4 text-sm">
          <div>
            <h3 className="font-semibold">How to perform</h3>
            <p className="mt-1 text-muted">{exercise.instructions}</p>
          </div>
          <div>
            <h3 className="font-semibold">Key cues</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
              {exercise.cues.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-semibold">Common mistakes</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
              {exercise.common_mistakes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          {exercise.purpose ? (
            <div>
              <h3 className="font-semibold">Purpose</h3>
              <p className="mt-1 text-muted">{exercise.purpose}</p>
            </div>
          ) : null}
          {exercise.pain_caution ? (
            <div className="rounded-xl bg-danger-soft/40 p-3 text-danger">
              {exercise.pain_caution}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
