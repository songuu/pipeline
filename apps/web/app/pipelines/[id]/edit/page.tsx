import { DashboardShell } from "../../../ui/dashboard-shell";

export default async function PipelineEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DashboardShell surface="config" pipelineId={id} />;
}
