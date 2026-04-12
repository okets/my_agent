/**
 * M9.4-S5 timing instrumentation — temporary, removed in cleanup task.
 * Tracks per-job timestamps from executor completion through alert delivery.
 */

const t0Map = new Map<string, number>();

export function timingMark(jobId: string): void {
  t0Map.set(jobId, Date.now());
  console.log(`[timing] job:done id=${jobId}`);
}

export function timingLog(jobId: string, label: string): void {
  const t0 = t0Map.get(jobId);
  if (t0 === undefined) {
    console.log(`[timing] ${label} id=${jobId} (no t0)`);
    return;
  }
  console.log(`[timing] ${label} id=${jobId} +${Date.now() - t0}ms`);
}

export function timingClear(jobId: string): void {
  t0Map.delete(jobId);
}
