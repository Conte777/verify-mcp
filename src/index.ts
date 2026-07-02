import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { formatReport } from "./report.js";
import { killActiveChildren, runAll } from "./runner.js";

const server = new McpServer({ name: "verify-mcp", version: "0.1.0" });

server.registerTool(
  "verify",
  {
    description:
      "Run configured verification checks (tests, linters, build) for the project and report failures",
    inputSchema: {
      directory: z
        .string()
        .optional()
        .describe("Project directory; defaults to the server's working directory"),
    },
  },
  async ({ directory }) => {
    try {
      const root = path.resolve(directory ?? process.cwd());
      if (!(fs.existsSync(root) && fs.statSync(root).isDirectory())) {
        return {
          content: [{ type: "text", text: `verify error: not a directory: ${root}` }],
          isError: true,
        };
      }

      const config = loadConfig();
      const { results } = await runAll(root, config);
      const knownMarkers = Object.values(config.profiles).flatMap((p) => p.markers);
      const text = formatReport(root, results, knownMarkers);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `verify error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Kill any still-running check process groups instead of orphaning them on shutdown.
const shutdown = () => {
  killActiveChildren();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
