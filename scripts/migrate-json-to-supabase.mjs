import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const STORAGE_TABLES = [
  ["applications", "dm_applications"],
  ["code-repositories", "dm_source_repositories"],
  ["pipelines", "dm_pipelines"],
  ["runs", "dm_pipeline_runs"],
  ["run-events", "dm_run_events"],
  ["artifacts", "dm_artifacts"],
  ["releases", "dm_releases"],
  ["deployment-targets", "dm_deployment_targets"],
  ["environment-locks", "dm_environment_locks"],
  ["release-plans", "dm_release_plans"],
  ["release-executions", "dm_release_executions"],
  ["release-events", "dm_release_events"],
  ["approvals", "dm_approvals"],
  ["webhook-deliveries", "dm_webhook_deliveries"],
  ["audit-events", "dm_audit_events"],
  ["environments", "dm_environments"],
  ["runner-pools", "dm_runner_pools"],
];

await loadEnvFile(".env");
await loadEnvFile(".env.local");

const schema = process.env.SUPABASE_SCHEMA ?? "public";
const dataDir = path.resolve(process.env.DEPLOYMENT_DATA_DIR ?? ".deploy-data");
const dryRun = process.env.DRY_RUN === "true";
const supabaseUrl = dryRun ? "" : requiredEnv("SUPABASE_URL").replace(/\/+$/, "");
const serviceRoleKey = dryRun ? "" : requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
  Accept: "application/json",
  "Accept-Profile": schema,
  "Content-Profile": schema,
};

let migratedTables = 0;
for (const [collection, tableName] of STORAGE_TABLES) {
  const filePath = path.join(dataDir, `${collection}.json`);
  if (!existsSync(filePath)) {
    console.log(`skip ${collection}: ${filePath} not found`);
    continue;
  }

  const records = await readJsonArray(filePath);
  console.log(`${dryRun ? "dry-run" : "migrate"} ${collection} -> ${tableName}: ${records.length} records`);
  if (dryRun) continue;

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/replace_dm_records`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_table: tableName,
      p_records: records,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Supabase migration failed for ${collection}/${tableName}: ${response.status} ${text}`);
  }
  migratedTables += 1;
}

console.log(`Supabase migration completed. tables=${migratedTables} dryRun=${dryRun}`);

async function readJsonArray(filePath) {
  const raw = await readFile(filePath, "utf8");
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Repository data file must contain an array: ${filePath}`);
  }
  return parsed;
}

async function loadEnvFile(fileName) {
  const filePath = path.resolve(fileName);
  if (!existsSync(filePath)) return;
  const raw = await readFile(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (process.env[key]) continue;
    process.env[key] = unquote(trimmed.slice(separator + 1).trim());
  }
}

function unquote(value) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Set it in the shell or .env before running this migration.`);
  }
  return value;
}
