import {
  Activity,
  Archive,
  CheckCircle2,
  Cloud,
  Code2,
  KeyRound,
  GitBranch,
  PackageCheck,
  Rocket,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import type { LifecycleStageKey } from "@deploy-management/shared";

export const stageIcons: Record<LifecycleStageKey, LucideIcon> = {
  source: GitBranch,
  test: CheckCircle2,
  build: Code2,
  env: KeyRound,
  package: PackageCheck,
  upload: Archive,
  deploy: Rocket,
  canary: Activity,
  approval: UserCheck,
  promote: Cloud,
};
