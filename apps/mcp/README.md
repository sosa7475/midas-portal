# Midas MCP Server

Exposes Midas's market analysis, strategy, and (guarded) trading tools to any MCP
client. **Your agent is the trading brain; Midas provides live data + execution.**

Two transports, same tools:
- **stdio** (`dist/stdio.js`) — local, for Claude Desktop / Claude Code
- **Streamable HTTP** (`dist/http.js`) — remote, for claude.ai connectors / hosted agents (deploy on Fly)

## Tools
| Tool | Needs creds? | What it does |
|---|---|---|
| `analyze_market` | no | Live snapshot + full indicator suite (RSI, EMA, MACD, ATR, VWAP, Bollinger, S/R). **Use before any trade opinion.** |
| `get_market_snapshot` | no | Price/funding/OI snapshot only |
| `get_candles` | no | Raw OHLCV |
| `get_strategy` / `set_strategy` | no | Read/save your strategy (local JSON) |
| `get_account` | Phase 3 | Balance & positions — returns "not enabled" until Orderly ed25519 auth |
| `place_trade` | Phase 3 | **Never fires yet** — gated behind ed25519 auth + risk engine + confirmation |

Market data is live from Orderly's public endpoints — **no credentials required** for analysis.

## Build first
```
pnpm --filter @midas/mcp build     # from repo root
```

## Connect to Claude Desktop
Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "midas": {
      "command": "node",
      "args": ["/Users/agility/Documents/agility-automations/Apps/midas-portal/apps/mcp/dist/stdio.js"]
    }
  }
}
```
Restart Claude Desktop. Then ask: *"Use Midas to analyze BTC on the 4h and tell me if a long fits my strategy."*

## Connect to Claude Code
```
claude mcp add midas -- node /Users/agility/Documents/agility-automations/Apps/midas-portal/apps/mcp/dist/stdio.js
```

## Remote (Streamable HTTP) — for claude.ai
```
MIDAS_MCP_TOKEN=$(openssl rand -hex 24) node dist/http.js   # POST /mcp, Bearer-protected
```
Deploy on Fly with `apps/mcp/fly.toml` + `apps/mcp/Dockerfile`, set `MIDAS_MCP_TOKEN` as a secret, then add
`https://<app>.fly.dev/mcp` as a custom connector in claude.ai. **Always set the token** — never expose `/mcp` open.

## Config
- `MIDAS_DATA_DIR` — where the strategy JSON lives (default `~/.midas`)
- `ORDERLY_BASE_URL` — market-data host (default `https://api-evm.orderly.org`)
- `MIDAS_MCP_TOKEN` — bearer token required by the HTTP transport (recommended)
