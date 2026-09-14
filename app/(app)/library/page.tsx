"use client";

import Link from "next/link";
import { EXERCISES } from "@/lib/seed/exercises";
import { Card, PageHeader } from "@/components/ui/primitives";

export default function LibraryPage() {
  const sorted = [...EXERCISES].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Library"
        subtitle="Exercise explanations, cues, and mistakes"
      />
      <div className="space-y-2">
        {sorted.map((ex) => (
          <Link key={ex.id} href={`/library/${ex.slug}`}>
            <Card className="mb-2 hover:border-accent/40">
              <p className="text-xs uppercase tracking-wide text-muted">
                {ex.category}
              </p>
              <p className="font-semibold">{ex.name}</p>
              <p className="line-clamp-2 text-sm text-muted">{ex.instructions}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
