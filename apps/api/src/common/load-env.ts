import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

loadDotEnv();

function loadDotEnv(): void {
  const envPath = findUp(process.cwd(), ".env");
  if (!envPath) return;

  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = stripQuotes(line.slice(separator + 1).trim());
  }
}

function findUp(startDir: string, fileName: string): string | undefined {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, fileName);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
