#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { handleVerify } from "./handler.js";
import { killActiveChildren } from "./runner.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const server = new McpServer({ name: "verify-mcp", version });

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
  handleVerify,
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
