import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { configPath, loadConfig, SEED } from "../src/config.js";
import { tempDir, withEnv, writeConfig } from "./helpers.js";

test("loadConfig: seeds a fresh config, creating missing parent dirs", async () => {
  const target = path.join(tempDir(), "sub", "verify-mcp.json");
  const result = await withEnv("VERIFY_MCP_CONFIG", target, () => loadConfig());

  assert.ok(fs.existsSync(target), "config file created");
  assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), SEED, "file content is SEED");
  assert.deepEqual(result, SEED, "returns SEED");
});

test("loadConfig: valid custom config round-trips verbatim", async () => {
  const custom = {
    timeoutMs: 1234,
    profiles: { node: { markers: ["package.json"], commands: ["npm test"] } },
  };
  const cfgPath = writeConfig(tempDir(), custom);
  const result = await withEnv("VERIFY_MCP_CONFIG", cfgPath, () => loadConfig());
  assert.deepEqual(result, custom);
});

test("loadConfig: invalid JSON throws", async () => {
  const cfgPath = path.join(tempDir(), "verify-mcp.json");
  fs.writeFileSync(cfgPath, "{ not json");
  await withEnv("VERIFY_MCP_CONFIG", cfgPath, () => {
    assert.throws(() => loadConfig(), /Invalid JSON in config/);
  });
});

test("loadConfig: commands as a bare string is rejected", async () => {
  const cfgPath = writeConfig(tempDir(), {
    timeoutMs: 600000,
    profiles: { node: { markers: ["package.json"], commands: "npm test" } },
  });
  await withEnv("VERIFY_MCP_CONFIG", cfgPath, () => {
    assert.throws(() => loadConfig(), /Invalid config schema/);
  });
});

test("loadConfig: markers as a bare string is rejected", async () => {
  const cfgPath = writeConfig(tempDir(), {
    timeoutMs: 600000,
    profiles: { node: { markers: "package.json", commands: ["npm test"] } },
  });
  await withEnv("VERIFY_MCP_CONFIG", cfgPath, () => {
    assert.throws(() => loadConfig(), /Invalid config schema/);
  });
});

test("loadConfig: missing timeoutMs is rejected", async () => {
  const cfgPath = writeConfig(tempDir(), {
    profiles: { node: { markers: ["package.json"], commands: ["npm test"] } },
  });
  await withEnv("VERIFY_MCP_CONFIG", cfgPath, () => {
    assert.throws(() => loadConfig(), /Invalid config schema/);
  });
});

test("loadConfig: timeoutMs bounds", async () => {
  const base = { profiles: { node: { markers: ["package.json"], commands: ["npm test"] } } };
  for (const bad of [0, -1, 3.5, 2 ** 31]) {
    const cfgPath = writeConfig(tempDir(), { ...base, timeoutMs: bad });
    await withEnv("VERIFY_MCP_CONFIG", cfgPath, () => {
      assert.throws(() => loadConfig(), /Invalid config schema/, `timeoutMs=${bad} must throw`);
    });
  }

  const okPath = writeConfig(tempDir(), { ...base, timeoutMs: 600000 });
  const ok = await withEnv("VERIFY_MCP_CONFIG", okPath, () => loadConfig());
  assert.equal(ok.timeoutMs, 600000);
});

test("loadConfig: empty profiles and empty markers/commands are accepted", async () => {
  const emptyProfiles = writeConfig(tempDir(), { timeoutMs: 1000, profiles: {} });
  const a = await withEnv("VERIFY_MCP_CONFIG", emptyProfiles, () => loadConfig());
  assert.deepEqual(a.profiles, {});

  const emptyArrays = writeConfig(tempDir(), {
    timeoutMs: 1000,
    profiles: { x: { markers: [], commands: [] } },
  });
  const b = await withEnv("VERIFY_MCP_CONFIG", emptyArrays, () => loadConfig());
  assert.deepEqual(b.profiles.x, { markers: [], commands: [] });
});

test("loadConfig: unknown keys are stripped (zod is non-strict by default)", async () => {
  const cfgPath = writeConfig(tempDir(), {
    timeoutMs: 1000,
    profiles: { node: { markers: ["package.json"], commands: ["npm test"], extra: 1 } },
    extra: "ignored",
  });
  const result = await withEnv("VERIFY_MCP_CONFIG", cfgPath, () => loadConfig());
  assert.equal("extra" in result, false, "root extra key stripped");
  assert.equal("extra" in result.profiles.node, false, "profile extra key stripped");
});

test("configPath: relative override resolves to absolute", async () => {
  const abs = await withEnv("VERIFY_MCP_CONFIG", "relative/verify.json", () => configPath());
  assert.equal(abs, path.resolve("relative/verify.json"));
  assert.ok(path.isAbsolute(abs));
});

test("configPath: without override falls back to ~/.config", () => {
  const prev = process.env.VERIFY_MCP_CONFIG;
  delete process.env.VERIFY_MCP_CONFIG;
  try {
    assert.equal(configPath(), path.join(os.homedir(), ".config", "verify-mcp.json"));
  } finally {
    if (prev !== undefined) {
      process.env.VERIFY_MCP_CONFIG = prev;
    }
  }
});
