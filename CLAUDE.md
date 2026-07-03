# CLAUDE.md

MCP server exposing a single `verify` tool that runs a project's configured checks (tests, linters, build) and reports failures. TypeScript, ESM, stdio transport, Node 20/22.

## Commands

- Build: `npm run build` (`tsc`)
- Typecheck: `npm run typecheck` (`tsc --noEmit`)
- Test: `npm test` (`tsx --test test/*.test.ts`) · coverage: `npm run coverage`
- Lint/format: `npx biome check` · `npx biome format --write`

Lefthook pre-commit runs the full gate (format + lint + typecheck + test) on staged `*.ts`. CI (`.github/workflows/ci.yml`) runs typecheck + test + `biome check` on Node 20/22. Never bypass the hook (`--no-verify`, `LEFTHOOK=`) — a Claude Code deny hook blocks it.

## Version

Single source of truth is `package.json`; `src/index.ts` reads it via `createRequire(import.meta.url)("../package.json")`. `createRequire` (not JSON import) because `rootDir: src` won't compile `../package.json`. Never hardcode the version.

## Releasing (npm, OIDC — no tokens)

Release is a pushed git tag — no manual `npm publish`, no `NPM_TOKEN`:

1. Bump `version` in `package.json` via a PR; merge to `main`.
2. Tag `vX.Y.Z` (must equal package.json) and push: `git tag v0.1.1 && git push origin v0.1.1`.
3. `.github/workflows/publish.yml` fires on `v*` tags and runs `npm publish` over **OIDC Trusted Publishing** — provenance is automatic.

Trusted publisher is configured on npmjs.com against repo `Conte777/verify-mcp` + `publish.yml` (see `npm trust list verify-mcp`). The `0.1.0` package was bootstrapped with a one-time manual `npm publish` (a brand-new name can't be trusted-published until it exists); every release after is tag-driven OIDC. Re-tagging an existing version fails (npm rejects duplicates) — bump first.
