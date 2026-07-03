import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { formatReport } from "./report.js";
import { runAll } from "./runner.js";

export async function handleVerify({ directory }: { directory?: string }) {
  try {
    const root = path.resolve(directory ?? process.cwd());
    if (!(fs.existsSync(root) && fs.statSync(root).isDirectory())) {
      return {
        content: [{ type: "text" as const, text: `verify error: not a directory: ${root}` }],
        isError: true,
      };
    }

    const config = loadConfig();
    const { results } = await runAll(root, config);
    const knownMarkers = Object.values(config.profiles).flatMap((p) => p.markers);
    const text = formatReport(root, results, knownMarkers);
    return { content: [{ type: "text" as const, text }] };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: `verify error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
