import { DashboardShell } from "../../ui/dashboard-shell";

export default async function PipelineDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DashboardShell surface="detail" pipelineId={id} />;
}
