"use client";

import { use } from "react";
import Link from "next/link";
import { getRoutineById } from "@/lib/seed/routines";
import { formatPrescription } from "@/lib/utils";
import { Badge, Card, PageHeader } from "@/components/ui/primitives";

export default function RoutineDetailPage({
  params,
}: {
  params: Promise<{ routineId: string }>;
}) {
  const { routineId } = use(params);
  const routine = getRoutineById(routineId);

  if (!routine) {
    return <p className="text-muted">Routine not found.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/plan" className="text-sm text-accent">
        ← Plan
      </Link>
      <PageHeader
        title={routine.name}
        subtitle={`${routine.default_duration_min} min · ${routine.items.length} exercises`}
      />
      <p className="mb-4 text-sm text-muted">{routine.description}</p>
      <div className="space-y-2">
        {routine.items
          .slice()
          .sort((a, b) => a.sequence - b.sequence)
          .map((item) => (
            <Card key={item.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">
                    {item.block} · #{item.sequence}
                  </p>
                  <p className="font-semibold">
                    {item.exercise_slug.replace(/-/g, " ")}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {formatPrescription(item.prescription)}
                    {item.rest_seconds
                      ? ` · ${item.rest_seconds}s rest`
                      : ""}
                  </p>
                </div>
                {item.progression_rule_code ? (
                  <Badge tone="accent">{item.progression_rule_code}</Badge>
                ) : null}
              </div>
            </Card>
          ))}
      </div>
    </div>
  );
}
