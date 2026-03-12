/**
 * Test helper for calling the running dashboard service.
 *
 * Tests that need Haiku API access route through the dashboard endpoint
 * instead of calling the API directly. The dashboard service (systemd)
 * has the API key; the test process doesn't need one.
 */

const DASHBOARD_URL = process.env.DASHBOARD_URL || "http://localhost:4321";

export async function isDashboardReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${DASHBOARD_URL}/api/work-loop/status`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function triggerJob(
  jobName: string,
): Promise<{ success: boolean; run?: any; error?: string }> {
  const res = await fetch(
    `${DASHBOARD_URL}/api/work-loop/trigger/${jobName}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
    },
  );
  return res.json();
}

export function getDashboardUrl(): string {
  return DASHBOARD_URL;
}
