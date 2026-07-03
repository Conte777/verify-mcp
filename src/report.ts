import type { CommandResult, ProfileResult } from "./types.js";

function duration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatCommand(command: CommandResult, lines: string[]): void {
  const cmd = `\`${command.command}\``;
  if (command.status === "passed") {
    lines.push(`- ✓ ${cmd} ${duration(command.durationMs)}`);
    return;
  }
  if (command.status === "skipped") {
    lines.push(`- ⏭ ${cmd} — skipped after failure`);
    return;
  }

  let exitPart = command.exitCode === null ? "killed" : `exit ${command.exitCode}`;
  if (command.timedOut) {
    exitPart += " (timeout)";
  }
  lines.push(`- ✗ ${cmd} ${exitPart}, ${duration(command.durationMs)}`);

  if (command.preview === "") {
    return;
  }
  const previewLines = command.preview.split("\n");
  // A trailing newline would otherwise emit a blank line before the closing fence.
  if (previewLines[previewLines.length - 1] === "") {
    previewLines.pop();
  }
  lines.push("  ```");
  for (const line of previewLines) {
    lines.push(`  ${line}`);
  }
  lines.push("  ```");
  if (command.truncation) {
    lines.push(
      `  [truncated ${command.truncation.totalLines} lines → ${command.truncation.logPath}]`,
    );
  }
}

function formatSection(result: ProfileResult): string {
  const total = result.commands.length;
  // Numerator is how many commands actually ran (passed + failed), not just the passing
  // ones — matches the spec's "## go (2/3)" for a build✓/test✗/vet⏭ run.
  const ran = result.commands.filter((c) => c.status !== "skipped").length;
  if (result.passed) {
    return `## ${result.profile} (${ran}/${total}) — all passed`;
  }
  const lines = [`## ${result.profile} (${ran}/${total})`];
  for (const command of result.commands) {
    formatCommand(command, lines);
  }
  return lines.join("\n");
}

export function formatReport(
  root: string,
  results: ProfileResult[],
  knownMarkers: string[],
): string {
  if (results.length === 0) {
    return `verify: no matching profiles\nRoot: ${root}\n\nNo marker files found in the project root. Known markers: ${knownMarkers.join(", ")}`;
  }

  const overall = results.every((r) => r.passed) ? "PASSED" : "FAILED";
  const summary = results.map((r) => `${r.profile} ${r.passed ? "✓" : "✗"}`).join(", ");
  const body = results.map(formatSection).join("\n\n");
  return `verify: ${overall} — ${summary}\nRoot: ${root}\n\n${body}`;
}
