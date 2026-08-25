#!/usr/bin/env node
/**
 * Local stdio entrypoint — for Claude Desktop / Claude Code.
 * The client launches this process and speaks MCP over stdin/stdout.
 * IMPORTANT: never write logs to stdout here (it's the protocol channel);
 * diagnostics go to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Midas MCP server running on stdio");
}

main().catch((err) => {
  console.error("Midas MCP fatal:", err);
  process.exit(1);
});
