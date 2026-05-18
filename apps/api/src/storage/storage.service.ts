import { Injectable } from "@nestjs/common";
import { deploymentStorageCollections, type DeploymentStorageCollection } from "../common/in-memory.repository";

export type StorageHealth = {
  backend: "json" | "supabase";
  ready: boolean;
  table?: string;
  tables?: string[];
  collections: string[];
  domains: DeploymentStorageCollection[];
  issues: Array<{
    code: string;
    message: string;
    remediation?: string;
  }>;
};

@Injectable()
export class StorageService {
  async health(): Promise<StorageHealth> {
    if (process.env.DEPLOYMENT_STORAGE !== "supabase") {
      return {
        backend: "json",
        ready: true,
        collections: expectedCollections(),
        domains: deploymentStorageCollections(),
        issues: [],
      };
    }

    const issues = this.configIssues();
    if (issues.length > 0) {
      return {
        backend: "supabase",
        ready: false,
        table: "dm_*",
        tables: expectedTables(),
        collections: expectedCollections(),
        domains: deploymentStorageCollections(),
        issues,
      };
    }

    const baseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "") ?? "";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const schema = process.env.SUPABASE_SCHEMA ?? "public";
    const checks = await Promise.all(
      deploymentStorageCollections().map(async (domain) => {
        const response: Response | Error = await fetch(`${baseUrl}/rest/v1/${domain.tableName}?select=entity_id&limit=1`, {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            Accept: "application/json",
            "Accept-Profile": schema,
          },
        }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));

        if (response instanceof Error) {
          return {
            domain,
            issue: {
              code: "supabase.unreachable",
              message: `${domain.tableName}: ${response.message}`,
              remediation: "检查 SUPABASE_URL 网络连通性，并确认 API 服务器能访问 Supabase REST endpoint。",
            },
          };
        }

        if (!response.ok) {
          return {
            domain,
            issue: {
              code: response.status === 404 ? "supabase.domain_table_missing" : "supabase.rest_failed",
              message: `${domain.tableName}: Supabase REST returned ${response.status}: ${await response.text()}`,
              remediation: "先在 Supabase SQL Editor 执行 supabase/migrations/20260518_domain_storage_tables.sql。",
            },
          };
        }

        return { domain, issue: undefined };
      }),
    );
    const tableIssues = checks.flatMap((check) => (check.issue ? [check.issue] : []));

    if (tableIssues.length > 0) {
      return {
        backend: "supabase",
        ready: false,
        table: "dm_*",
        tables: expectedTables(),
        collections: expectedCollections(),
        domains: deploymentStorageCollections(),
        issues: tableIssues,
      };
    }

    return {
      backend: "supabase",
      ready: true,
      table: "dm_*",
      tables: expectedTables(),
      collections: expectedCollections(),
      domains: deploymentStorageCollections(),
      issues: [],
    };
  }

  private configIssues(): StorageHealth["issues"] {
    const issues: StorageHealth["issues"] = [];
    if (!process.env.SUPABASE_URL) {
      issues.push({
        code: "supabase.url_missing",
        message: "SUPABASE_URL 未配置。",
        remediation: "设置 SUPABASE_URL=https://<project-ref>.supabase.co。",
      });
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      issues.push({
        code: "supabase.service_role_missing",
        message: "SUPABASE_SERVICE_ROLE_KEY 未配置。",
        remediation: "把 Supabase service_role key 放在 API 服务端环境变量中，不要暴露给前端。",
      });
    }
    return issues;
  }
}

function expectedCollections(): string[] {
  return deploymentStorageCollections().map((domain) => domain.collection);
}

function expectedTables(): string[] {
  return deploymentStorageCollections().map((domain) => domain.tableName);
}
