"use client";

import { use, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store/app-store";
import { getRoutineById } from "@/lib/seed/routines";
import {
  Badge,
  Card,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui/primitives";

export default function SessionSummaryPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const router = useRouter();
  const session = useAppStore((s) =>
    s.trainingSessions.find((t) => t.id === sessionId),
  );
  const sessionItems = useAppStore((s) => s.sessionItems);
  const progressionEvents = useAppStore((s) => s.progressionEvents);
  const undoProgression = useAppStore((s) => s.undoProgression);
  const completeSession = useAppStore((s) => s.completeSession);

  const items = useMemo(
    () => sessionItems.filter((i) => i.training_session_id === sessionId),
    [sessionItems, sessionId],
  );
  const itemIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const events = useMemo(
    () => progressionEvents.filter((e) => itemIds.has(e.session_item_id)),
    [progressionEvents, itemIds],
  );

  if (!session) {
    return <p className="p-6 text-muted">Session not found.</p>;
  }

  const routine = getRoutineById(session.routine_template_id);
  const completed = items.filter((i) => i.status === "completed").length;
  const partial = items.filter((i) => i.status === "partial").length;
  const skipped = items.filter((i) => i.status === "skipped").length;
  const durationMin =
    session.started_at && session.ended_at
      ? Math.round(
          (new Date(session.ended_at).getTime() -
            new Date(session.started_at).getTime()) /
            60000,
        )
      : null;

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <PageHeader title="Session summary" subtitle={routine?.name} />

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs text-muted">Duration</p>
          <p className="text-2xl font-semibold">
            {durationMin != null ? `${durationMin} min` : "—"}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Exercises</p>
          <p className="text-2xl font-semibold">
            {completed}
            <span className="text-sm font-normal text-muted">
              {" "}
              ok / {partial} partial / {skipped} skip
            </span>
          </p>
        </Card>
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-muted">
        Progression changes
      </h2>
      <div className="space-y-2">
        {events.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No progression events this session.</p>
          </Card>
        ) : (
          events.map((e) => (
            <Card key={e.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Badge
                    tone={
                      e.undone_at
                        ? "neutral"
                        : e.event_type === "failure" ||
                            e.event_type === "pain_freeze"
                          ? "danger"
                          : "success"
                    }
                  >
                    {e.undone_at ? "Undone" : e.event_type}
                  </Badge>
                  <p className="mt-2 text-sm font-medium">{e.explanation}</p>
                  <p className="mt-1 text-sm text-muted">
                    {e.next_prescription_preview}
                  </p>
                </div>
                {!e.undone_at ? (
                  <SecondaryButton
                    className="!min-h-10 !px-3 !text-sm"
                    onClick={() => undoProgression(e.id)}
                  >
                    Undo
                  </SecondaryButton>
                ) : null}
              </div>
            </Card>
          ))
        )}
      </div>

      <PrimaryButton
        className="mt-8 w-full"
        onClick={() => {
          if (session.status !== "completed") completeSession(sessionId);
          router.push("/today");
        }}
      >
        Done
      </PrimaryButton>
    </div>
  );
}
