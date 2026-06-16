# bounty-radar-mcp

MCP server that lets any agent search **real, funded developer bounties** from GitHub — scam-farm clones filtered out, competition scored. Pay-per-call **$0.01 USDC** via [x402](https://x402.org) on Base. No account, no API key.

## Install

```bash
npx -y bounty-radar-mcp
```

Or add to your MCP client config (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "bounty-radar": {
      "command": "npx",
      "args": ["-y", "bounty-radar-mcp"],
      "env": { "PRIVATE_KEY": "0xYOUR_BASE_WALLET_KEY" }
    }
  }
}
```

## Configuration

| Env | Required | Purpose |
|---|---|---|
| `PRIVATE_KEY` | yes (to call the paid tool) | A Base wallet private key with a little USDC. The caller funds the $0.01/call x402 fee. Your key never leaves your machine. |
| `BOUNTY_RADAR_URL` | no | Override the endpoint (defaults to the hosted service). |

## Tool: `search_bounties`

| Param | Type | Notes |
|---|---|---|
| `language` | string | e.g. `typescript` |
| `minAmount` | number | min USD bounty value |
| `maxAgeDays` | number | freshness cap |
| `includeSuspect` | boolean | include scam-suspect listings |
| `limit` | number | max results (≤50) |

Returns JSON: each bounty has `repo`, `number`, `title`, `url`, `ageDays`, `comments`, `amountUsd`, `competition` (low/medium/high), `trust` (likely_real/suspect_scam), `scamReasons`.

## How payment works

The tool calls the hosted API, which answers `402 Payment Required`. `x402-fetch` signs a USDC micropayment from your `PRIVATE_KEY` and retries automatically — the LLM never sees the payment handshake. Settlement is on Base via a keyless facilitator. No accounts, no KYC.

## Develop

```bash
npm install
npm run build      # esbuild bundle -> dist/index.js
npm run typecheck
```

License: MIT · Source: https://github.com/nikolas-sapa/x402-bounty-radar
