# verify-mcp docs

`verify-mcp` is an MCP server with one tool, `verify`, that detects a project's
language by marker files, runs the configured checks (tests, linters, build) and
returns a Markdown report of what failed. This lets an AI coding agent check its
own work after edits.

For install and a quick start, see the [root README](../README.md). These docs go
deeper: the config reference, the tool's contract and report format, and the
internals.

## Contents

- [configuration.md](./configuration.md) — config location, seeding, schema,
  default profiles, and detection/run semantics.
- [tool.md](./tool.md) — the `verify` tool: input, output, report format, output
  limits, annotated example.
- [architecture.md](./architecture.md) — module map, request flow, non-obvious
  design decisions, and the dev workflow.
