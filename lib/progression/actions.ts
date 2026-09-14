'use server';

/**
 * Progression evaluation entrypoint.
 * Local-first: the client store calls the pure engine directly.
 * When Supabase is wired, move the transactional write here (spec §10.4).
 */
export async function evaluateProgressionAction(payload: unknown) {
  void payload;
  return {
    ok: true as const,
    mode: "local-first" as const,
    message:
      "Progression is evaluated in the local store. Wire this action to Supabase when credentials are available.",
  };
}
