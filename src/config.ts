import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
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

// Minimal runtime validation: a config is valid JSON yet the wrong shape (e.g. `commands`
// as a bare string) would otherwise be executed one character at a time. setTimeout also
// silently clamps a delay outside [1, 2^31-1], so timeoutMs is bounded here.
const ConfigSchema = z.object({
  timeoutMs: z.number().int().positive().max(2_147_483_647),
  profiles: z.record(
    z.string(),
    z.object({
      markers: z.array(z.string()),
      commands: z.array(z.string()),
    }),
  ),
});

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
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in config ${path}: ${message}`);
  }

  const parsed = ConfigSchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid config schema in ${path}: ${detail}`);
  }
  return parsed.data;
}
