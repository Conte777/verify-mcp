import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandResult, CommandStatus, Config, Profile, ProfileResult } from "./types.js";

export function detectProfiles(dir: string, config: Config): string[] {
  const matched: string[] = [];
  for (const [name, profile] of Object.entries(config.profiles)) {
    if (profile.markers.some((marker) => existsSync(join(dir, marker)))) {
      matched.push(name);
    }
  }
  return matched;
}

export function truncateTail(
  output: string,
  maxLines = 50,
  maxBytes = 8192,
): { preview: string; truncated: boolean; totalLines: number } {
  const lines = output.split("\n");

  // A single trailing newline denotes line termination, not an extra empty line.
  let totalLines = lines.length;
  if (totalLines > 0 && lines[totalLines - 1] === "") {
    totalLines -= 1;
  }

  const kept = lines.slice(-maxLines);
  let preview = kept.join("\n");
  let truncated = kept.length < lines.length;

  if (Buffer.byteLength(preview) > maxBytes) {
    preview = preview.slice(-maxBytes);
    truncated = true;
  }

  return { preview, truncated, totalLines };
}

interface RunOutcome {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
  durationMs: number;
}

function runCommand(cmd: string, dir: string, timeoutMs: number): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn("sh", ["-c", cmd], { cwd: dir, env: process.env, detached: true });

    let output = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Process group already exited (ESRCH); nothing to kill.
        }
      }
    }, timeoutMs);

    const append = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    const finish = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, timedOut, output, durationMs: Date.now() - start });
    };

    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
}

function skippedResult(command: string): CommandResult {
  return {
    command,
    status: "skipped",
    exitCode: null,
    durationMs: 0,
    timedOut: false,
    preview: "",
  };
}

async function runProfile(
  name: string,
  profile: Profile,
  dir: string,
  timeoutMs: number,
  ensureLogDir: () => string,
): Promise<ProfileResult> {
  const commands: CommandResult[] = [];

  for (let i = 0; i < profile.commands.length; i++) {
    const cmd = profile.commands[i];
    const { exitCode, timedOut, output, durationMs } = await runCommand(cmd, dir, timeoutMs);
    const status: CommandStatus = exitCode === 0 && !timedOut ? "passed" : "failed";

    const result: CommandResult = {
      command: cmd,
      status,
      exitCode,
      durationMs,
      timedOut,
      preview: "",
    };

    if (status === "failed") {
      const { preview, truncated, totalLines } = truncateTail(output);
      if (truncated) {
        const logPath = join(ensureLogDir(), `${name}-${i + 1}.log`);
        writeFileSync(logPath, output);
        result.truncation = { totalLines, logPath };
      }
      result.preview = preview;
      commands.push(result);

      for (let j = i + 1; j < profile.commands.length; j++) {
        commands.push(skippedResult(profile.commands[j]));
      }
      break;
    }

    commands.push(result);
  }

  const passed = commands.every((c) => c.status === "passed");
  return { profile: name, passed, commands };
}

export async function runAll(
  dir: string,
  config: Config,
): Promise<{ matched: string[]; results: ProfileResult[] }> {
  const matched = detectProfiles(dir, config);

  let logDir: string | undefined;
  const ensureLogDir = (): string => {
    if (logDir === undefined) {
      logDir = mkdtempSync(join(tmpdir(), "verify-mcp-"));
    }
    return logDir;
  };

  const results: ProfileResult[] = [];
  for (const name of matched) {
    results.push(
      await runProfile(name, config.profiles[name], dir, config.timeoutMs, ensureLogDir),
    );
  }

  return { matched, results };
}
