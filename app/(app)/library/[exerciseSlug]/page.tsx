"use client";

import { use } from "react";
import Link from "next/link";
import { getExerciseBySlug } from "@/lib/seed/exercises";
import { Card, PageHeader } from "@/components/ui/primitives";

export default function LibraryExercisePage({
  params,
}: {
  params: Promise<{ exerciseSlug: string }>;
}) {
  const { exerciseSlug } = use(params);
  const exercise = getExerciseBySlug(exerciseSlug);

  if (!exercise) {
    return <p className="text-muted">Exercise not found.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/library" className="text-sm text-accent">
        ← Library
      </Link>
      <PageHeader title={exercise.name} subtitle={exercise.category} />
      <div className="space-y-3">
        <Card>
          <h2 className="font-semibold">How to perform</h2>
          <p className="mt-2 text-sm text-muted">{exercise.instructions}</p>
        </Card>
        <Card>
          <h2 className="font-semibold">Key cues</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {exercise.cues.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="font-semibold">Common mistakes</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {exercise.common_mistakes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Card>
        {exercise.purpose ? (
          <Card>
            <h2 className="font-semibold">Purpose</h2>
            <p className="mt-2 text-sm text-muted">{exercise.purpose}</p>
          </Card>
        ) : null}
        {exercise.pain_caution ? (
          <Card className="border-danger/40 bg-danger-soft/20">
            <h2 className="font-semibold text-danger">Pain caution</h2>
            <p className="mt-2 text-sm">{exercise.pain_caution}</p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
