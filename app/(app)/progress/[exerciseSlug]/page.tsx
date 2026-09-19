"use client";

import { use } from "react";
import Link from "next/link";
import { getExerciseBySlug } from "@/lib/seed/exercises";
import { getRuleByCode } from "@/lib/seed/rules";
import { useAppStore } from "@/lib/store/app-store";
import { Badge, Card, PageHeader } from "@/components/ui/primitives";

export default function ExerciseProgressPage({
  params,
}: {
  params: Promise<{ exerciseSlug: string }>;
}) {
  const { exerciseSlug } = use(params);
  const exercise = getExerciseBySlug(exerciseSlug);
  const states = useAppStore((s) => s.progressionStates);
  const items = useAppStore((s) => s.sessionItems);
  const results = useAppStore((s) => s.exerciseResults);
  const events = useAppStore((s) => s.progressionEvents);

  const relatedItems = items.filter((i) => i.exercise_slug === exerciseSlug);
  const relatedResults = results.filter((r) =>
    relatedItems.some((i) => i.id === r.session_item_id),
  );
  const relatedEvents = events.filter((e) =>
    relatedItems.some((i) => i.id === e.session_item_id),
  );

  const stateMap: Record<string, string> = {
    "oahs-practice": "oahs",
    "planche-hold": "planche",
    "one-leg-human-flag": "human_flag",
    "front-lever-hold": "front_lever",
    "back-lever-hold": "back_lever",
    "front-split": "front_split",
    "middle-split": "middle_split",
  };
  const mappedScope = stateMap[exerciseSlug] ?? exerciseSlug;
  const state =
    states.find((s) => s.scope_id === exerciseSlug) ??
    states.find((s) => s.scope_id === mappedScope);

  const lastItem = relatedItems.slice().reverse()[0];
  const rule = lastItem?.progression_rule_code
    ? getRuleByCode(lastItem.progression_rule_code)
    : undefined;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/progress" className="text-sm text-accent">
        ← Progress
      </Link>
      <PageHeader
        title={exercise?.name ?? exerciseSlug}
        subtitle={exercise?.category}
      />

      <Card className="mb-4">
        <p className="text-xs font-semibold uppercase text-muted">Current state</p>
        <pre className="mt-2 overflow-auto text-sm">
          {JSON.stringify(state?.state ?? {}, null, 2)}
        </pre>
      </Card>

      {rule ? (
        <Card className="mb-4">
          <p className="text-xs font-semibold uppercase text-muted">
            Progression rule
          </p>
          <p className="mt-1 font-semibold">{rule.name}</p>
          <p className="mt-1 text-sm text-muted">{rule.description}</p>
        </Card>
      ) : null}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
        Session history
      </h2>
      <div className="space-y-2">
        {relatedResults.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No logged results yet.</p>
          </Card>
        ) : (
          relatedResults
            .slice()
            .reverse()
            .map((r) => {
              const item = relatedItems.find((i) => i.id === r.session_item_id);
              return (
                <Card key={r.id}>
                  <div className="flex gap-2">
                    <Badge tone={r.completed_all ? "success" : "warning"}>
                      {r.completed_all ? "complete" : "partial"}
                    </Badge>
                    {r.pain_score != null && r.pain_score > 0 ? (
                      <Badge tone="danger">pain {r.pain_score}</Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm">
                    {item ? JSON.stringify(item.prescription_snapshot) : ""}
                  </p>
                </Card>
              );
            })
        )}
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-muted">
        Progression timeline
      </h2>
      <div className="space-y-2">
        {relatedEvents
          .slice()
          .reverse()
          .map((e) => (
            <Card key={e.id}>
              <p className="text-xs text-muted">
                {new Date(e.created_at).toLocaleString()}
              </p>
              <p className="mt-1 text-sm">{e.explanation}</p>
              <p className="text-sm text-muted">{e.next_prescription_preview}</p>
            </Card>
          ))}
        {relatedEvents.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No events yet.</p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
