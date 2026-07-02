import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig, SEED } from "../src/config.js";
import { formatReport } from "../src/report.js";
import { detectProfiles, truncateTail } from "../src/runner.js";
import type { ProfileResult } from "../src/types.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "verify-test-"));
}

test("detectProfiles: empty dir matches nothing", () => {
  const dir = tempDir();
  assert.deepEqual(detectProfiles(dir, SEED), []);
});

test("detectProfiles: go.mod matches the go profile", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "go.mod"), "");
  assert.deepEqual(detectProfiles(dir, SEED), ["go"]);
});

test("detectProfiles: go.mod + package.json keep SEED profile order", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "go.mod"), "");
  fs.writeFileSync(path.join(dir, "package.json"), "{}");
  assert.deepEqual(detectProfiles(dir, SEED), ["go", "node"]);
});

test("truncateTail: short output is returned verbatim", () => {
  const input = "line1\nline2\nline3";
  const { preview, truncated, totalLines } = truncateTail(input);
  assert.equal(truncated, false);
  assert.equal(preview, input);
  assert.equal(totalLines, 3);
});

test("truncateTail: long output is trimmed to the tail", () => {
  const input = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");
  const { preview, truncated, totalLines } = truncateTail(input);
  assert.equal(truncated, true);
  assert.equal(totalLines, 200);
  assert.ok(preview.split("\n").length <= 50, "preview must keep at most 50 lines");
});

test("truncateTail: a trailing newline is not counted as an extra line", () => {
  const { preview, truncated, totalLines } = truncateTail("a\nb\n");
  assert.equal(totalLines, 2);
  assert.equal(truncated, false);
  assert.equal(preview, "a\nb");
});

test("truncateTail: exactly 50 lines with a trailing newline is not truncated", () => {
  const input = `${Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
  const { truncated, totalLines } = truncateTail(input);
  assert.equal(totalLines, 50);
  assert.equal(truncated, false);
});

test("formatReport: failing run surfaces every command state", () => {
  const results: ProfileResult[] = [
    {
      profile: "go",
      passed: false,
      commands: [
        {
          command: "go build ./...",
          status: "passed",
          exitCode: 0,
          durationMs: 12,
          timedOut: false,
          preview: "",
        },
        {
          command: "go test ./...",
          status: "failed",
          exitCode: 1,
          durationMs: 340,
          timedOut: false,
          preview: "--- FAIL: TestThing\n    want 1, got 2",
          truncation: { totalLines: 200, logPath: "/tmp/verify/go-test.log" },
        },
        {
          command: "go vet ./...",
          status: "skipped",
          exitCode: null,
          durationMs: 0,
          timedOut: false,
          preview: "",
        },
      ],
    },
    {
      profile: "node",
      passed: true,
      commands: [
        {
          command: "npm test",
          status: "passed",
          exitCode: 0,
          durationMs: 50,
          timedOut: false,
          preview: "",
        },
      ],
    },
  ];

  const report = formatReport("/home/dev/project", results, ["go.mod", "package.json"]);

  assert.ok(report.includes("verify: FAILED"), "overall verdict");
  assert.ok(report.includes("go ✗"), "failing profile marker");
  assert.ok(report.includes("node ✓"), "passing profile marker");
  assert.ok(report.includes("go test ./..."), "failed command line");
  assert.ok(report.includes("exit 1"), "failed exit code");
  assert.ok(report.includes("--- FAIL: TestThing"), "failure preview text");
  assert.ok(report.includes("[truncated"), "truncation marker");
  assert.ok(report.includes("/tmp/verify/go-test.log"), "truncation log path");
  assert.ok(report.includes("## go (2/3)"), "header counts ran (passed+failed), not just passed");
  assert.ok(report.includes("skipped after failure"), "skipped command note");
  assert.match(report, /## node[^\n]*all passed/, "passing profile one-liner");
});

test("formatReport: no matches lists the known markers", () => {
  const report = formatReport("/home/dev/project", [], ["go.mod", "package.json"]);
  assert.ok(report.includes("no matching profiles"));
  assert.ok(report.includes("go.mod"));
  assert.ok(report.includes("package.json"));
});

test("loadConfig: rejects a wrong-shaped config (commands as a bare string)", () => {
  const cfgPath = path.join(tempDir(), "verify-mcp.json");
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      timeoutMs: 600000,
      profiles: { node: { markers: ["package.json"], commands: "npm test" } },
    }),
  );
  const prev = process.env.VERIFY_MCP_CONFIG;
  process.env.VERIFY_MCP_CONFIG = cfgPath;
  try {
    assert.throws(() => loadConfig(), /Invalid config schema/);
  } finally {
    if (prev === undefined) {
      delete process.env.VERIFY_MCP_CONFIG;
    } else {
      process.env.VERIFY_MCP_CONFIG = prev;
    }
  }
});
