import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Config } from "./types.js";

export const SEED: Config = {
  timeoutMs: 600000,
  profiles: {
    go: {
      markers: ["go.mod"],
      commands: ["go build ./...", "go test ./... -count=1", "go vet ./..."],
    },
    python: {
      markers: ["pyproject.toml"],
      commands: ["uv run pytest", "uv run ruff check ."],
    },
    node: {
      markers: ["package.json"],
      commands: [
        "npm run --if-present lint",
        "npm run --if-present test",
        "npm run --if-present build",
      ],
    },
    rust: {
      markers: ["Cargo.toml"],
      commands: ["cargo test", "cargo clippy -- -D warnings"],
    },
    java: {
      markers: ["pom.xml"],
      commands: ["mvn -q test"],
    },
  },
};

export function configPath(): string {
  const override = process.env.VERIFY_MCP_CONFIG;
  if (override) {
    return resolve(override);
  }
  return join(homedir(), ".config", "verify-mcp.json");
}

export function loadConfig(): Config {
  const path = configPath();
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(SEED, null, 2)}\n`);
    return SEED;
  }
  const raw = readFileSync(path, "utf8");
  try {
    return JSON.parse(raw) as Config;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in config ${path}: ${message}`);
  }
}
