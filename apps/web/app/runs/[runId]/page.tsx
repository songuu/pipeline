import { DashboardShell } from "../../ui/dashboard-shell";

export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <DashboardShell surface="detail" runId={runId} />;
}
