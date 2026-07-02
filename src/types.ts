// Shared contract for every module. Do not add fields without updating all consumers.

export interface Profile {
  markers: string[];
  commands: string[];
}

export interface Config {
  timeoutMs: number;
  profiles: Record<string, Profile>;
}

export type CommandStatus = "passed" | "failed" | "skipped";

export interface CommandResult {
  command: string;
  status: CommandStatus;
  /** Process exit code; null when the process was killed (e.g. timeout) or failed to spawn. */
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  /** Tail-trimmed interleaved stdout+stderr for the report. Empty for passed/skipped. */
  preview: string;
  /** Present only when `preview` was trimmed; full log saved to `logPath`. */
  truncation?: {
    totalLines: number;
    logPath: string;
  };
}

export interface ProfileResult {
  profile: string;
  passed: boolean;
  commands: CommandResult[];
}
