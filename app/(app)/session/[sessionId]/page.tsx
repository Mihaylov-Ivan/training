"use client";

import { use } from "react";
import { SessionPlayer } from "@/components/workout-player/session-player";

export default function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  return <SessionPlayer sessionId={sessionId} />;
}
