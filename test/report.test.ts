import assert from "node:assert/strict";
import test from "node:test";
import { formatReport } from "../src/report.js";
import type { CommandResult, ProfileResult } from "../src/types.js";

function cmd(over: Partial<CommandResult>): CommandResult {
  return {
    command: "c",
    status: "failed",
    exitCode: 1,
    durationMs: 0,
    timedOut: false,
    preview: "",
    ...over,
  };
}

test("formatReport: failing run surfaces every command state", () => {
  const results: ProfileResult[] = [
    {
      profile: "go",
      passed: false,
      commands: [
        cmd({ command: "go build ./...", status: "passed", exitCode: 0, durationMs: 12 }),
        cmd({
          command: "go test ./...",
          exitCode: 1,
          durationMs: 340,
          preview: "--- FAIL: TestThing\n    want 1, got 2",
          truncation: { totalLines: 200, logPath: "/tmp/verify/go-test.log" },
        }),
        cmd({ command: "go vet ./...", status: "skipped", exitCode: null }),
      ],
    },
    {
      profile: "node",
      passed: true,
      commands: [cmd({ command: "npm test", status: "passed", exitCode: 0, durationMs: 50 })],
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

test("formatReport: all profiles passing yields an overall PASSED verdict", () => {
  const results: ProfileResult[] = [
    {
      profile: "node",
      passed: true,
      commands: [cmd({ command: "npm test", status: "passed", exitCode: 0, durationMs: 10 })],
    },
  ];
  const report = formatReport("/root", results, ["package.json"]);
  assert.ok(report.includes("verify: PASSED"), "overall verdict");
  assert.equal(report.includes("✗"), false, "no failure marker in the summary");
});

test("formatCommand: killed (no timeout) reads 'killed'", () => {
  const results: ProfileResult[] = [
    {
      profile: "p",
      passed: false,
      commands: [cmd({ command: "x", exitCode: null, timedOut: false })],
    },
  ];
  const report = formatReport("/root", results, []);
  assert.ok(report.includes("killed"));
  assert.equal(report.includes("(timeout)"), false);
});

test("formatCommand: timeout with null exit reads 'killed (timeout)'", () => {
  const results: ProfileResult[] = [
    {
      profile: "p",
      passed: false,
      commands: [cmd({ command: "x", exitCode: null, timedOut: true })],
    },
  ];
  assert.ok(formatReport("/root", results, []).includes("killed (timeout)"));
});

test("formatCommand: timeout with an exit code reads 'exit N (timeout)'", () => {
  const results: ProfileResult[] = [
    {
      profile: "p",
      passed: false,
      commands: [cmd({ command: "x", exitCode: 124, timedOut: true })],
    },
  ];
  assert.ok(formatReport("/root", results, []).includes("exit 124 (timeout)"));
});

test("formatCommand: a trailing newline in preview adds no blank line before the fence", () => {
  const results: ProfileResult[] = [
    {
      profile: "p",
      passed: false,
      commands: [cmd({ command: "x", exitCode: 1, preview: "err line\n" })],
    },
  ];
  const report = formatReport("/root", results, []);
  assert.ok(report.includes("  err line\n  ```"), "content sits directly above the closing fence");
  assert.equal(report.includes("  \n  ```"), false, "no blank line before the fence");
});

test("duration: formats to one decimal", () => {
  const results: ProfileResult[] = [
    {
      profile: "p",
      passed: false,
      commands: [
        cmd({ command: "a", status: "passed", exitCode: 0, durationMs: 50 }),
        cmd({ command: "b", status: "passed", exitCode: 0, durationMs: 0 }),
        cmd({ command: "c", exitCode: 1 }),
      ],
    },
  ];
  const report = formatReport("/root", results, []);
  assert.ok(report.includes("0.1s"), "50ms → 0.1s");
  assert.ok(report.includes("0.0s"), "0ms → 0.0s");
});
