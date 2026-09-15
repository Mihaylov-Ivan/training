/** Minimum rest between sets when a rest period is prescribed. */
export const MIN_BETWEEN_SET_REST_SECONDS = 15;

/**
 * Floors positive rest values to the minimum between-set rest.
 * Zero stays zero (warmup singles, intentional supersets, continuous work).
 */
export function applyMinBetweenSetRest(
  restSeconds: number | undefined | null,
): number {
  const r = restSeconds ?? 0;
  if (r > 0 && r < MIN_BETWEEN_SET_REST_SECONDS) {
    return MIN_BETWEEN_SET_REST_SECONDS;
  }
  return r;
}
