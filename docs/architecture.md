# Architecture & development

## Module map

| Module | Responsibility |
|--------|----------------|
| `src/index.ts` | MCP server: registers the `verify` tool, wires `SIGINT`/`SIGTERM` shutdown, connects the stdio transport. |
| `src/handler.ts` | `handleVerify` — orchestrates one tool call: resolve dir, validate, load config, run, format. |
| `src/config.ts` | `SEED`, `configPath()`, `loadConfig()` (seed if absent, parse, zod-validate). |
| `src/runner.ts` | Profile detection, command spawn/capture/timeout, process-group kill, output trimming. |
| `src/report.ts` | `formatReport` — turns results into the Markdown report. |
| `src/types.ts` | Shared `Config` / `Profile` / `CommandResult` / `ProfileResult` contract. |

## Request flow

```
verify(directory?)
  → resolve dir, check it is a directory        (handler.ts)
  → loadConfig()                                (config.ts: seed if absent, validate)
  → runAll()                                    (runner.ts)
      → detectProfiles()                        marker match against config
      → for each matched profile, sequentially:
          runProfile() → runCommand() per cmd   sh -c, capture, timeout, stop on first failure
  → formatReport()                              (report.ts)
```

## Non-obvious design points

The "why" behind decisions that aren't self-evident from the code:

- **Detached process groups + shutdown kill.** Each command is spawned
  `detached: true`, and its pid is tracked in `activeGroups`. On timeout the whole
  group is killed (`process.kill(-pid, ...)`), not just the shell — otherwise a
  child like `go test` would survive its parent `sh`. On server shutdown,
  `killActiveChildren()` kills every tracked group so no check is orphaned.
- **Resolve on `exit`, not `close`.** `runCommand` finishes on the child's `exit`
  event. `close` also waits on every inherited pipe holder, so a lingering
  grandchild would block until the timeout and mis-report a passing command as a
  timeout. A `setImmediate` before snapshotting lets queued stdout/stderr `data`
  events flush first.
- **Byte-domain output cap.** Both the live capture cap (`MAX_CAPTURE_BYTES`, ~8 MB)
  and the preview trim (`truncateTail`, 8 KB) work in bytes, and output is decoded
  from `Buffer` to UTF-8 **once** at the end — so a multi-byte character split
  across two chunks is never corrupted.
- **`timeoutMs` bounded in the schema.** `setTimeout` silently clamps a delay
  outside `[1, 2^31-1]`, so the config schema rejects out-of-range values rather
  than letting a huge timeout become a surprise short one.

## Development

```bash
npm install       # also builds via the prepare hook
npm run build     # tsc → dist/
npm run typecheck # tsc --noEmit
npm test          # node:test via tsx (test/*.test.ts)
npm run coverage  # test run with V8 coverage
```

Linting/formatting is [Biome](https://biomejs.dev). A `pre-commit` hook in
`.githooks/` blocks commits that fail it.

**Tech stack:** TypeScript (NodeNext modules, strict), `@modelcontextprotocol/sdk`
`^1.29`, `zod` `^4`. Node `>=18`.

## Tests

| File | Covers |
|------|--------|
| `test/config.test.ts` | config path resolution, seeding, schema validation. |
| `test/runner.test.ts` | detection, spawn/capture, timeout, skip-on-failure, output trimming. |
| `test/report.test.ts` | report formatting, glyphs, section headers, truncation footer. |
| `test/index.test.ts` | tool registration / handler wiring. |
