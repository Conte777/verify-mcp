import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { handleVerify } from "../src/handler.js";
import { tempDir, withEnv, writeConfig } from "./helpers.js";

const textOf = (r: Awaited<ReturnType<typeof handleVerify>>) => r.content[0].text;

test("handleVerify: a missing directory is an error", async () => {
  const missing = path.join(tempDir(), "nope");
  const r = await handleVerify({ directory: missing });
  assert.equal(r.isError, true);
  assert.ok(textOf(r).includes("not a directory"));
});

test("handleVerify: a file path (not a directory) is an error", async () => {
  const file = path.join(tempDir(), "afile");
  fs.writeFileSync(file, "");
  const r = await handleVerify({ directory: file });
  assert.equal(r.isError, true);
  assert.ok(textOf(r).includes("not a directory"));
});

test("handleVerify: happy path runs the configured command and reports PASSED", async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "package.json"), "{}");
  const cfgPath = writeConfig(tempDir(), {
    timeoutMs: 15000,
    profiles: { node: { markers: ["package.json"], commands: ["echo ok"] } },
  });
  const r = await withEnv("VERIFY_MCP_CONFIG", cfgPath, () => handleVerify({ directory: dir }));
  assert.ok(!r.isError);
  assert.ok(textOf(r).includes("verify: PASSED"));
  assert.ok(textOf(r).includes("node"));
});

test("handleVerify: a broken config surfaces as a verify error", async () => {
  const dir = tempDir();
  const cfgPath = path.join(tempDir(), "verify-mcp.json");
  fs.writeFileSync(cfgPath, "{ broken json");
  const r = await withEnv("VERIFY_MCP_CONFIG", cfgPath, () => handleVerify({ directory: dir }));
  assert.equal(r.isError, true);
  assert.ok(textOf(r).includes("verify error:"));
});
