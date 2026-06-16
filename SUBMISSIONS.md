# Registry & Listing Submissions

Manifests are ready in `packages/mcp-server/` (`server.json`, `smithery.yaml`). Below is exactly where to list `bounty-radar-mcp` once it's published to npm.

## Step 0 — publish the npm package (needs your `npm login`)
```bash
cd packages/mcp-server
npm install
npm run build
npm publish --access public
```
Everything below points at the published package.

## Registries (most accept the manifest or auto-pull from npm)

| Registry | How | Needs account? |
|---|---|---|
| **Official MCP Registry** | `npx @modelcontextprotocol/publisher` (or PR per registry.modelcontextprotocol.io docs) using `packages/mcp-server/server.json` | GitHub auth |
| **Smithery** (smithery.ai) | Connect the GitHub repo; `smithery.yaml` is detected | GitHub login |
| **Glama** (glama.ai/mcp) | Auto-indexes public MCP servers on GitHub + npm; submit URL if not picked up | optional |
| **PulseMCP** (pulsemcp.com) | Submit form / auto-crawls npm | no |
| **mcp.so** | Submit form | no |
| **mcpservers.org** | PR to their list repo | GitHub |
| **`mcp-submit` CLI** | `npx mcp-submit` — pushes to 10+ directories in one shot | varies |

## x402-specific discovery

| Where | How | Needs account? |
|---|---|---|
| **awesome-mcp-servers** (punkpeye) | PR adding a one-line entry (see copy in DISTRIBUTION.md) | GitHub |
| **xpay directory** (xpay.sh) | List the live endpoint as an x402 service | maybe |
| **x402 community lists / awesome-x402** | PR | GitHub |
| **x402 Discord / Foundation #built-with-x402** | Post the live URL + one-liner | Discord |

## One-line description (reuse everywhere)
> **bounty-radar-mcp** — search real, funded GitHub dev bounties via MCP. Scam-clones filtered, competition scored. Pay-per-call $0.01 USDC over x402 on Base, no account. `npx -y bounty-radar-mcp`

## Bazaar note
The CDP x402 Bazaar auto-indexes services using the **CDP facilitator**. This service uses the keyless **xpay** facilitator (zero-KYC, by design), so it may not appear in the CDP Bazaar automatically — see MARKETING_PLAN.md for the decision (we lean on MCP registries + xpay/community directories instead of reintroducing KYC).
