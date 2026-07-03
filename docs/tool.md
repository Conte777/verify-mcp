# The `verify` tool

Registered in `src/index.ts`; the handler is `handleVerify` in `src/handler.ts`.

## Input

```json
{ "directory": "optional string" }
```

`directory` is the project to verify. If omitted, it defaults to the server's
working directory (`process.cwd()`). The path is resolved to an absolute path.

## Output

A single text content block with a Markdown report.

`isError: true` is returned **only** for:

- a non-existent path or a path that is not a directory
  (`verify error: not a directory: <path>`), or
- any thrown error, chiefly an unreadable/invalid config
  (`verify error: <message>`).

A run where checks **fail** is a normal, successful result (`isError` unset) — the
failures are in the report body. This distinction lets an agent tell "your code is
broken" from "the tool couldn't run".

## Report format

Built by `formatReport` / `formatSection` / `formatCommand` in `src/report.ts`.

**No matching profiles:**

```
verify: no matching profiles
Root: <root>

No marker files found in the project root. Known markers: go.mod, pyproject.toml, ...
```

**With results** — a status line, then one section per profile:

```
verify: <PASSED|FAILED> — <profile ✓/✗>, ...
Root: <root>

## <profile> (<ran>/<total>) — all passed      ← header for a passing profile
## <profile> (<ran>/<total>)                    ← header for a failing profile
```

`ran` counts commands that actually ran (passed + failed); `total` is all commands
in the profile. A passing profile prints only its header. A failing profile lists
every command with a status glyph:

| Glyph | Meaning | Line |
|-------|---------|------|
| `✓` | passed | `` - ✓ `cmd` 1.2s `` |
| `✗` | failed | `` - ✗ `cmd` exit 1, 3.4s `` — `exit N`, or `killed` when the exit code is null; ` (timeout)` appended when timed out |
| `⏭` | skipped after failure | `` - ⏭ `cmd` — skipped after failure `` |

A failed command with output also emits a fenced preview block, followed by a
truncation footer when the full log was saved:

```
  ```
  <last lines of stdout+stderr>
  ```
  [truncated <N> lines → <logPath>]
```

## Output limits

Source: `src/runner.ts`.

- **Preview** is the tail of the command's interleaved stdout+stderr, trimmed by
  `truncateTail` to the last **50 lines** and then capped at **8 KB** (trimming in
  the byte domain, so multi-byte UTF-8 is not split).
- **Full log:** when the preview was trimmed, the complete output is written to a
  temp file (`<tmpdir>/verify-mcp-XXXX/<profile>-<n>.log`) and its path appears in
  the footer. Persisting the log is best-effort — a filesystem error there does not
  turn a failed check into an `isError` response.
- **In-memory cap:** while a command runs, at most ~**8 MB** of output is retained
  (`MAX_CAPTURE_BYTES`); a runaway command that spews endless logs cannot grow the
  server's memory without bound before the timeout. Oldest chunks are dropped first.

## Annotated example

```
verify: FAILED — go ✗                                  ← overall status, per-profile summary
Root: /home/dev/project                                ← resolved directory

## go (2/3)                                             ← 2 of 3 commands ran; profile failed
- ✓ `go build ./...` 1.2s                              ← passed, with wall-clock duration
- ✗ `go test ./... -count=1` exit 1, 3.4s              ← failed: exit code + duration
  ```
  --- FAIL: TestFoo (0.01s)                             ← preview: tail of stdout+stderr
      foo_test.go:15: expected 2, got 3
  ```
  [truncated 812 lines → /tmp/verify-mcp-x1y2/go-1.log] ← full log saved; preview was trimmed
- ⏭ `go vet ./...` — skipped after failure             ← not run: an earlier command failed
```
