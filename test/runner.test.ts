import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SEED } from "../src/config.js";
import {
  detectProfiles,
  killActiveChildren,
  runAll,
  runCommand,
  runProfile,
  truncateTail,
} from "../src/runner.js";
import type { Config, Profile } from "../src/types.js";
import { tempDir } from "./helpers.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- detectProfiles ---

test("detectProfiles: empty dir matches nothing", () => {
  assert.deepEqual(detectProfiles(tempDir(), SEED), []);
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

test("detectProfiles: any marker in the list matches", () => {
  const cfg: Config = { timeoutMs: 1000, profiles: { p: { markers: ["a", "b"], commands: [] } } };
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "b"), "");
  assert.deepEqual(detectProfiles(dir, cfg), ["p"]);
});

test("detectProfiles: no marker present does not match", () => {
  const cfg: Config = { timeoutMs: 1000, profiles: { p: { markers: ["a"], commands: [] } } };
  assert.deepEqual(detectProfiles(tempDir(), cfg), []);
});

// --- truncateTail ---

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

test("truncateTail: a single line over the byte cap is trimmed in the byte domain", () => {
  const input = "x".repeat(10000);
  const { preview, truncated, totalLines } = truncateTail(input);
  assert.equal(truncated, true);
  assert.equal(totalLines, 1);
  assert.ok(Buffer.byteLength(preview, "utf8") <= 8192);
});

test("truncateTail: byte-cut on a multibyte boundary bounds size, keeps tail intact", () => {
  // 3-byte euro signs; 8192 is not a multiple of 3, so the cut lands mid-sequence.
  // The cap is on the byte *slice*, not the decoded string: orphaned leading bytes decode
  // to U+FFFD (3 bytes each), so the re-encoded preview can run a few bytes over 8192.
  const input = "€".repeat(4000); // 12000 bytes, one line
  const { preview, truncated, totalLines } = truncateTail(input);
  assert.equal(truncated, true);
  assert.equal(totalLines, 1);
  assert.ok(Buffer.byteLength(preview, "utf8") <= 8192 + 8, "roughly bounded by the byte cap");
  assert.ok(preview.endsWith("€€€"), "tail euros are intact");
});

test("truncateTail: byte cap applies even under the line cap", () => {
  const input = `${"z".repeat(9000)}\ntail`; // 2 lines, > 8192 bytes
  const { preview, truncated } = truncateTail(input);
  assert.equal(truncated, true);
  assert.ok(Buffer.byteLength(preview, "utf8") <= 8192);
});

test("truncateTail: empty output", () => {
  const { preview, truncated, totalLines } = truncateTail("");
  assert.equal(totalLines, 0);
  assert.equal(preview, "");
  assert.equal(truncated, false);
});

// --- runCommand (real subprocesses) ---

test("runCommand: echo captures stdout, exit 0", async () => {
  const r = await runCommand("echo hello", tempDir(), 5000);
  assert.equal(r.exitCode, 0);
  assert.equal(r.timedOut, false);
  assert.ok(r.output.includes("hello"));
});

test("runCommand: non-zero exit codes are reported", async () => {
  assert.equal((await runCommand("exit 1", tempDir(), 5000)).exitCode, 1);
  assert.equal((await runCommand("exit 7", tempDir(), 5000)).exitCode, 7);
});

test("runCommand: stdout and stderr are both captured", async () => {
  const r = await runCommand("echo out; echo err 1>&2", tempDir(), 5000);
  assert.ok(r.output.includes("out"));
  assert.ok(r.output.includes("err"));
});

test("runCommand: timeout kills the command", async () => {
  const start = Date.now();
  const r = await runCommand("sleep 5", tempDir(), 200);
  assert.equal(r.timedOut, true);
  assert.equal(r.exitCode, null);
  assert.ok(Date.now() - start < 2000, "resolves near the timeout, not the full sleep");
});

test("runCommand: timeout kills the whole process group", async () => {
  const dir = tempDir();
  const marker = path.join(dir, "MARKER");
  // Grandchild would touch the marker at 1s; group SIGKILL at 200ms must prevent it.
  await runCommand(`(sleep 1; touch "${marker}") & sleep 5`, dir, 200);
  await delay(1300);
  assert.equal(fs.existsSync(marker), false, "grandchild was killed with the group");
});

test("runCommand: spawn error (missing cwd) resolves with null exit code", async () => {
  const r = await runCommand("echo hi", path.join(tempDir(), "does-not-exist"), 5000);
  assert.equal(r.exitCode, null);
  assert.equal(r.timedOut, false);
});

test("runCommand: output is ring-buffered to ~8MB", async () => {
  const r = await runCommand(
    "head -c 9000000 /dev/zero | tr '\\0' 'a'; echo ENDMARKER",
    tempDir(),
    15000,
  );
  assert.ok(r.output.length < 9_000_000, "head of the output was dropped");
  assert.ok(r.output.length > 8_000_000, "kept close to the 8MB tail");
  assert.ok(r.output.includes("ENDMARKER"), "tail is retained");
});

test("runCommand: UTF-8 sequences split across chunks are not corrupted", async () => {
  const r = await runCommand("yes '€' | head -100000 | tr -d '\\n'", tempDir(), 15000);
  assert.equal(r.output.includes("�"), false, "no replacement chars at chunk boundaries");
  assert.equal(r.output, "€".repeat(100000));
});

// --- runProfile ---

function logDirFactory(dir: string): () => string {
  return () => dir;
}

test("runProfile: all commands pass", async () => {
  const p: Profile = { markers: [], commands: ["true", "true"] };
  const r = await runProfile("p", p, tempDir(), 5000, logDirFactory(tempDir()));
  assert.equal(r.passed, true);
  assert.ok(r.commands.every((c) => c.status === "passed"));
});

test("runProfile: first failure skips the rest", async () => {
  const p: Profile = { markers: [], commands: ["exit 3", "echo second"] };
  const r = await runProfile("p", p, tempDir(), 5000, logDirFactory(tempDir()));
  assert.equal(r.passed, false);
  assert.equal(r.commands[0].status, "failed");
  assert.equal(r.commands[0].exitCode, 3);
  assert.equal(r.commands[1].status, "skipped");
});

test("runProfile: large failing output is truncated and logged", async () => {
  const logDir = tempDir();
  const p: Profile = { markers: [], commands: ["seq 1 100; exit 1"] };
  const r = await runProfile("build", p, tempDir(), 5000, logDirFactory(logDir));
  const cmd = r.commands[0];
  assert.ok(cmd.truncation, "truncation metadata present");
  assert.equal(cmd.truncation?.totalLines, 100);
  const logPath = path.join(logDir, "build-1.log");
  assert.equal(cmd.truncation?.logPath, logPath);
  const expected = `${Array.from({ length: 100 }, (_, i) => i + 1).join("\n")}\n`;
  assert.equal(fs.readFileSync(logPath, "utf8"), expected, "full output persisted");
});

test("runProfile: small failing output keeps a tail preview, no log", async () => {
  const p: Profile = { markers: [], commands: ["echo boom; exit 1"] };
  const r = await runProfile("p", p, tempDir(), 5000, logDirFactory(tempDir()));
  const cmd = r.commands[0];
  assert.equal(cmd.truncation, undefined);
  assert.equal(cmd.preview, "boom");
});

test("runProfile: a log-write failure does not throw", async () => {
  const throwingLogDir = () => {
    throw new Error("no log dir");
  };
  const p: Profile = { markers: [], commands: ["seq 1 100; exit 1"] };
  const r = await runProfile("p", p, tempDir(), 5000, throwingLogDir);
  const cmd = r.commands[0];
  assert.equal(cmd.truncation, undefined, "truncation reference dropped");
  assert.ok(cmd.preview.length > 0, "tail preview still populated");
});

// --- runAll ---

test("runAll: no matching profiles yields empty results", async () => {
  const cfg: Config = { timeoutMs: 5000, profiles: { go: { markers: ["go.mod"], commands: [] } } };
  const r = await runAll(tempDir(), cfg);
  assert.deepEqual(r.matched, []);
  assert.deepEqual(r.results, []);
});

test("runAll: profiles run in config order", async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "a"), "");
  fs.writeFileSync(path.join(dir, "b"), "");
  const cfg: Config = {
    timeoutMs: 5000,
    profiles: {
      first: { markers: ["a"], commands: ["true"] },
      second: { markers: ["b"], commands: ["true"] },
    },
  };
  const r = await runAll(dir, cfg);
  assert.deepEqual(r.matched, ["first", "second"]);
  assert.deepEqual(
    r.results.map((x) => x.profile),
    ["first", "second"],
  );
});

test("runAll: all passing writes no logs", async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "a"), "");
  const cfg: Config = {
    timeoutMs: 5000,
    profiles: { p: { markers: ["a"], commands: ["true", "echo ok"] } },
  };
  const r = await runAll(dir, cfg);
  assert.ok(r.results[0].commands.every((c) => c.truncation === undefined));
});

// --- killActiveChildren ---

test("killActiveChildren: kills the process group of a running command", async () => {
  const dir = tempDir();
  const marker = path.join(dir, "MARKER");
  const running = runCommand(`(sleep 1; touch "${marker}") & sleep 5`, dir, 30000);
  killActiveChildren();
  await running;
  await delay(1300);
  assert.equal(fs.existsSync(marker), false, "group killed before the grandchild touched");
});
