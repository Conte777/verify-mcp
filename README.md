# verify-mcp

An [MCP](https://modelcontextprotocol.io) server exposing a single tool, **`verify`**, that an
AI coding agent can call after making edits. It detects the project's language by marker files,
runs the configured verification commands (tests, linters, build) and returns a short Markdown
report of what failed — so the agent checks its own work instead of you running the suite by hand.

## Install

Run it directly with `npx` (no global install needed):

```bash
npx -y verify-mcp
```

### Register with Claude Code

```bash
claude mcp add --scope user verify -- npx -y verify-mcp
```

The agent will call `verify` on its own after edits, or you can ask it to.

## The `verify` tool

- **Input:** `{ directory?: string }` — project directory; defaults to the server's working directory.
- **Output:** a Markdown report. Failed checks are a normal result; `isError` is returned only for
  an unreadable/invalid config or a non-existent directory.

Example report:

```
verify: FAILED — go ✗
Root: /home/dev/project

## go (2/3)
- ✓ `go build ./...` 1.2s
- ✗ `go test ./... -count=1` exit 1, 3.4s
  ```
  --- FAIL: TestFoo (0.01s)
      foo_test.go:15: expected 2, got 3
  ```
  [truncated 812 lines → /tmp/verify-mcp-x1y2/go-1.log]
- ⏭ `go vet ./...` — skipped after failure
```

Each profile stops at its first failing command; the rest are marked skipped. A failing command's
output is trimmed to the last ~50 lines / 8 KB, and the full log is written to a temp file whose
path appears in the report.

## Configuration

Config lives at `$VERIFY_MCP_CONFIG` or `~/.config/verify-mcp.json`. It is **seeded with defaults on
first run** if absent. Schema:

```json
{
  "timeoutMs": 600000,
  "profiles": {
    "go":     { "markers": ["go.mod"],        "commands": ["go build ./...", "go test ./... -count=1", "go vet ./..."] },
    "python": { "markers": ["pyproject.toml"], "commands": ["uv run pytest", "uv run ruff check ."] },
    "node":   { "markers": ["package.json"],   "commands": ["npm run --if-present lint", "npm run --if-present test", "npm run --if-present build"] },
    "rust":   { "markers": ["Cargo.toml"],     "commands": ["cargo test", "cargo clippy -- -D warnings"] },
    "java":   { "markers": ["pom.xml"],        "commands": ["mvn -q test"] }
  }
}
```

- A profile matches if **any** of its `markers` exists in the project root (no recursion). All matched
  profiles run, in config order.
- Each command runs via `sh -c` with the project directory as `cwd`, inheriting the server's environment.
- `timeoutMs` is a global per-command timeout; on timeout the whole process group is killed and the
  command counts as failed.

## Development

```bash
npm install     # also builds via the prepare hook
npm run build   # tsc -> dist/
npm test        # node:test via tsx
npm run typecheck
```

Linting/formatting is [Biome](https://biomejs.dev); a `pre-commit` hook (in `.githooks/`) blocks
commits that fail it.

## License

MIT
