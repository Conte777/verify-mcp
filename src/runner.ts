import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandResult, CommandStatus, Config, Profile, ProfileResult } from "./types.js";

// ponytail: keep at most the last ~8MB of a command's output so a runaway command
// (endless log spew) can't grow the server's memory without bound before the timeout.
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

// Process groups (detached child pids) still running, so they can be killed if the
// server is shut down mid-run instead of being orphaned.
const activeGroups = new Set<number>();

export function killActiveChildren(): void {
  for (const pid of activeGroups) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already exited (ESRCH).
    }
  }
  activeGroups.clear();
}

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
  // A single trailing newline terminates the last line — it is not an extra empty line.
  const lines = output.endsWith("\n") ? output.slice(0, -1).split("\n") : output.split("\n");
  const totalLines = output === "" ? 0 : lines.length;

  const kept = lines.slice(-maxLines);
  let preview = kept.join("\n");
  let truncated = kept.length < lines.length;

  const buf = Buffer.from(preview, "utf8");
  if (buf.byteLength > maxBytes) {
    // Cap in the byte domain (maxBytes is bytes, not UTF-16 code units).
    preview = buf.subarray(buf.byteLength - maxBytes).toString("utf8");
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

export function runCommand(cmd: string, dir: string, timeoutMs: number): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn("sh", ["-c", cmd], { cwd: dir, env: process.env, detached: true });
    const pid = child.pid;
    if (pid !== undefined) {
      activeGroups.add(pid);
    }

    const chunks: Buffer[] = [];
    let bytes = 0;
    let timedOut = false;
    let settled = false;

    // Collect stdout and stderr interleaved (as chunks arrive), decoded once at the end
    // so a multi-byte UTF-8 sequence split across two chunks is not corrupted.
    const append = (chunk: Buffer) => {
      chunks.push(chunk);
      bytes += chunk.length;
      while (bytes > MAX_CAPTURE_BYTES && chunks.length > 1) {
        const dropped = chunks.shift();
        bytes -= dropped ? dropped.length : 0;
      }
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    const timer = setTimeout(() => {
      timedOut = true;
      if (pid !== undefined) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          // Process group already exited (ESRCH); nothing to kill.
        }
      }
    }, timeoutMs);

    const finish = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (pid !== undefined) {
        activeGroups.delete(pid);
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({
        exitCode,
        timedOut,
        output: Buffer.concat(chunks).toString("utf8"),
        durationMs: Date.now() - start,
      });
    };

    // Resolve on 'exit' (the process itself terminating), NOT 'close' — 'close' also waits
    // on every inherited pipe holder, so a lingering grandchild would block us until the
    // timeout and mis-report a passing command as a timeout. setImmediate lets already-queued
    // stdout/stderr 'data' events flush before we snapshot the output.
    child.on("exit", (code) => setImmediate(() => finish(code)));
    child.on("error", () => finish(null));
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

export async function runProfile(
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
        // Persisting the full log is best-effort: a filesystem error here must NOT turn a
        // normal failed-check result into an isError response.
        try {
          const logPath = join(ensureLogDir(), `${name}-${i + 1}.log`);
          writeFileSync(logPath, output);
          result.truncation = { totalLines, logPath };
        } catch {
          // Keep the tail preview; drop the full-log reference.
        }
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
