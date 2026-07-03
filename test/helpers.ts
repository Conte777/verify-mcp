import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "verify-test-"));
}

export function writeConfig(dir: string, obj: unknown): string {
  const cfgPath = path.join(dir, "verify-mcp.json");
  fs.writeFileSync(cfgPath, JSON.stringify(obj));
  return cfgPath;
}

// Set VERIFY_MCP_CONFIG for the duration of fn, restoring the prior value (or absence) after.
export async function withEnv<T>(key: string, val: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = process.env[key];
  process.env[key] = val;
  try {
    return await fn();
  } finally {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
}
