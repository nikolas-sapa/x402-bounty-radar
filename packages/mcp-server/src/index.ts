import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { wrapFetchWithPayment, createSigner } from "x402-fetch";

// Live Bounty Radar endpoint (override with BOUNTY_RADAR_URL).
const BASE_URL =
  process.env.BOUNTY_RADAR_URL ?? "https://x402-bounty-radar.nikolas-sapalidis.workers.dev";
// The CALLER funds payments: a Base wallet private key with a little USDC.
const PK = process.env.PRIVATE_KEY;

async function payingFetch(): Promise<typeof fetch | null> {
  if (!PK) return null;
  const key = PK.startsWith("0x") ? PK : `0x${PK}`;
  // createSigner builds the correct x402 EVM signer from the private key.
  const signer = await createSigner("base", key);
  // x402-fetch intercepts 402s, signs a USDC payment, and retries automatically.
  return wrapFetchWithPayment(fetch, signer) as unknown as typeof fetch;
}

const server = new McpServer({ name: "bounty-radar", version: "0.1.0" });

server.tool(
  "search_bounties",
  "Search real, funded developer bounties from GitHub. Scam-farm clones are filtered out and each bounty is scored for competition (low/medium/high). Costs $0.01 USDC per call via x402 on Base. Requires a PRIVATE_KEY env var (a funded Base wallet) to pay.",
  {
    language: z.string().optional().describe("filter by language, e.g. typescript"),
    minAmount: z.number().optional().describe("minimum USD bounty value"),
    maxAgeDays: z.number().optional().describe("max age in days (freshness cap)"),
    includeSuspect: z.boolean().optional().describe("include scam-suspect listings"),
    limit: z.number().optional().describe("max results (<=50)"),
  },
  async (args: Record<string, unknown>) => {
    const f = await payingFetch();
    if (!f) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Set PRIVATE_KEY (a funded Base wallet, ~$1 USDC) to pay the $0.01/call x402 fee.",
          },
        ],
      };
    }
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(args)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    try {
      const res = await f(`${BASE_URL}/bounties?${qs.toString()}`);
      const body = await res.text();
      if (!res.ok) {
        return { isError: true, content: [{ type: "text" as const, text: `HTTP ${res.status}: ${body}` }] };
      }
      return { content: [{ type: "text" as const, text: body }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      return { isError: true, content: [{ type: "text" as const, text: `Request failed: ${msg}` }] };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
