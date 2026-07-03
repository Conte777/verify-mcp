# Configuration

## Location

The config file is resolved in `src/config.ts` (`configPath()`):

1. `$VERIFY_MCP_CONFIG`, if set (resolved to an absolute path).
2. Otherwise `~/.config/verify-mcp.json`.

## First-run seeding

If the resolved path does not exist, `loadConfig()` writes the built-in `SEED`
defaults to it (creating the parent directory as needed), then loads it. So the
first run always leaves an editable config on disk.

## Schema

Validated by `ConfigSchema` (zod) in `src/config.ts`. Invalid JSON shape (or an
out-of-range `timeoutMs`) fails the load with an `Invalid config schema` error.

| Field | Type | Constraint |
|-------|------|------------|
| `timeoutMs` | integer | `1 .. 2_147_483_647` (positive; bounded because `setTimeout` silently clamps outside `[1, 2^31-1]`) |
| `profiles` | object | map of profile name → profile |
| `profiles.<name>.markers` | string[] | marker filenames that trigger the profile |
| `profiles.<name>.commands` | string[] | shell commands to run, in order |

## Default profiles

From `SEED` (`timeoutMs: 600000`):

| Profile | Markers | Commands |
|---------|---------|----------|
| `go` | `go.mod` | `go build ./...` · `go test ./... -count=1` · `go vet ./...` |
| `python` | `pyproject.toml` | `uv run pytest` · `uv run ruff check .` |
| `node` | `package.json` | `npm run --if-present lint` · `npm run --if-present test` · `npm run --if-present build` |
| `rust` | `Cargo.toml` | `cargo test` · `cargo clippy -- -D warnings` |
| `java` | `pom.xml` | `mvn -q test` |

## Detection & run semantics

Source: `src/runner.ts`.

- **Marker match:** a profile matches if **any** of its `markers` exists in the
  project root. No recursion — only the root is checked.
- **Multiple profiles:** all matched profiles run, in config (object) order.
- **Command execution:** each command runs via `sh -c <command>` with the project
  directory as `cwd`, inheriting the server's environment (`process.env`).
- **Timeout:** `timeoutMs` is a global per-command timeout. On timeout the whole
  process group is killed (`SIGKILL`) and the command counts as failed.
- **First failure stops the profile:** within a profile, commands run
  sequentially; the first failing command ends the profile and the remaining
  commands are marked skipped. Other profiles still run.

## Adding or overriding a profile

Edit the JSON. Profile names are arbitrary; markers and commands are yours. Example
— add a `deno` profile and tighten the timeout:

```json
{
  "timeoutMs": 300000,
  "profiles": {
    "deno": {
      "markers": ["deno.json", "deno.jsonc"],
      "commands": ["deno lint", "deno test -A"]
    }
  }
}
```

To override a default, keep the profile name and change its `markers`/`commands`.
Note: editing the file replaces the defaults you omit — the config is not merged
with `SEED`, it is loaded as-is once it exists.
