"use client";

import { useState } from "react";
import type { SessionItem } from "@/lib/types";
import { formatPrescription } from "@/lib/utils";
import {
  Card,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui/primitives";

export function CompletionPrompt({
  item,
  onSubmit,
}: {
  item: SessionItem;
  onSubmit: (payload: {
    completedAll: boolean;
    difficulty: number | null;
    painScore: number | null;
    sharpPain: boolean;
    metrics?: Record<string, unknown>;
    attemptsToComplete?: number | null;
  }) => void;
}) {
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [pain, setPain] = useState(0);
  const [sharp, setSharp] = useState(false);
  const [attempts, setAttempts] = useState<number | null>(null);
  const isClimb = item.exercise_slug === "climbing-quality-attempt";

  return (
    <div className="mt-8 flex flex-1 flex-col">
      <Card>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Exercise complete
        </p>
        <h2 className="mt-2 text-xl font-semibold uppercase">
          {item.exercise_name}
        </h2>
        <p className="mt-2 text-sm text-muted">
          Prescription: {formatPrescription(item.prescription_snapshot)}
          {item.prescription_snapshot.rest_seconds
            ? `, ${item.prescription_snapshot.rest_seconds}s rest`
            : ""}
        </p>
        <p className="mt-4 text-sm font-medium">
          Did you complete every prescribed rep with clean form?
        </p>

        <label className="mt-4 block text-sm">
          Difficulty (optional)
          <div className="mt-2 flex gap-2">
            {[
              ["Easy", 3],
              ["Right", 6],
              ["Hard", 9],
            ].map(([label, val]) => (
              <SecondaryButton
                key={label}
                className={`flex-1 !min-h-10 !text-sm ${
                  difficulty === val ? "!border-accent !text-accent" : ""
                }`}
                onClick={() => setDifficulty(Number(val))}
              >
                {label}
              </SecondaryButton>
            ))}
          </div>
        </label>

        <label className="mt-4 block text-sm">
          Pain 0–10
          <input
            type="range"
            min={0}
            max={10}
            value={pain}
            onChange={(e) => setPain(Number(e.target.value))}
            className="mt-2 w-full"
          />
          <span className="font-semibold">{pain}</span>
        </label>

        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-danger">
          <input
            type="checkbox"
            checked={sharp}
            onChange={(e) => setSharp(e.target.checked)}
          />
          Sharp / radiating pain, numbness, or weakness
        </label>

        {isClimb ? (
          <label className="mt-3 block text-sm">
            Attempts to complete (1–3)
            <input
              type="number"
              min={1}
              max={3}
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3"
              value={attempts ?? ""}
              onChange={(e) =>
                setAttempts(e.target.value ? Number(e.target.value) : null)
              }
            />
          </label>
        ) : null}
      </Card>

      <div className="mt-auto space-y-3 pt-6">
        <PrimaryButton
          className="w-full"
          onClick={() =>
            onSubmit({
              completedAll: true,
              difficulty,
              painScore: pain,
              sharpPain: sharp,
              attemptsToComplete: attempts,
              metrics: {
                protocol: item.prescription_snapshot.protocol,
              },
            })
          }
        >
          Yes, complete
        </PrimaryButton>
        <SecondaryButton
          className="w-full"
          onClick={() =>
            onSubmit({
              completedAll: false,
              difficulty,
              painScore: pain,
              sharpPain: sharp,
              attemptsToComplete: attempts,
              metrics: {
                protocol: item.prescription_snapshot.protocol,
              },
            })
          }
        >
          No / partial
        </SecondaryButton>
      </div>
    </div>
  );
}
