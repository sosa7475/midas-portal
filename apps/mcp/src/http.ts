/**
 * Remote Streamable-HTTP entrypoint — for claude.ai connectors / hosted agents.
 * Deployable on Fly. Stateless: a fresh server+transport per request.
 *
 * Security: if MIDAS_MCP_TOKEN is set, requests must send
 * `Authorization: Bearer <token>`. Do NOT expose this endpoint publicly without it.
 */
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.MIDAS_MCP_TOKEN;

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.post("/mcp", async (req, res) => {
  if (TOKEN) {
    const header = req.headers.authorization;
    if (header !== `Bearer ${TOKEN}`) {
      return res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
    }
  }

  // Stateless: new transport + server per request (Fly is persistent, but
  // stateless keeps this simple and avoids cross-request session leakage).
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createServer();
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.error(`Midas MCP (Streamable HTTP) on :${PORT}${TOKEN ? " [token-protected]" : " [OPEN — set MIDAS_MCP_TOKEN]"}`);
});
