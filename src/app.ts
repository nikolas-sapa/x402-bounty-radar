import { Hono } from "hono";
import { paymentMiddleware, type Network } from "x402-hono";
import { getBounties, cacheStats, type Query } from "./bounties.js";
import { landingHtml } from "./landing.js";

// USDC contract per network — surfaced in discovery metadata so agents/tools
// can verify the asset before paying.
const USDC: Record<string, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

// One representative result, so an agent knows the exact output shape pre-payment.
const OUTPUT_EXAMPLE = {
  count: 1,
  bounties: [
    {
      repo: "owner/project",
      number: 1234,
      title: "Implement TypeScript SDK",
      url: "https://github.com/owner/project/issues/1234",
      createdAt: "2026-06-10T12:00:00Z",
      ageDays: 6,
      comments: 2,
      labels: ["bounty", "$250"],
      amountUsd: 250,
      competition: "low",
      trust: "likely_real",
      scamReasons: [],
    },
  ],
};

// --- Config (all via env; nothing hardcoded) ---
// Read at buildApp() call time, NOT module-load time: on Workers the env is
// bridged into process.env inside the fetch handler, which runs after import.
export function buildApp() {
  // Fallback to the burn address keeps cold-starts from crashing; a real deploy
  // MUST set PAY_TO_ADDRESS or it cannot be paid.
  const PAY_TO = (process.env.PAY_TO_ADDRESS ?? "0x000000000000000000000000000000000000dEaD") as `0x${string}`;
  const NETWORK = (process.env.X402_NETWORK ?? "base-sepolia") as Network;
  const PRICE = process.env.X402_PRICE ?? "$0.01";
  const FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator";

  const app = new Hono();
  let paidCount = 0;

  app.get("/", (c) => {
    // Content negotiation: browsers get the HTML landing; everything else
    // (agents, curl, x402 clients) keeps the JSON discovery doc unchanged.
    if (c.req.header("accept")?.includes("text/html")) {
      return c.html(landingHtml({ origin: new URL(c.req.url).origin, price: PRICE, network: NETWORK }));
    }
    return c.json({
      name: "x402-bounty-radar",
      version: "0.1.0",
      description:
        "Paid API for real, funded developer bounties with scam-farm filtering and competition scoring. Pay-per-call, no account, no API key.",
      paid_endpoint: "/bounties",
      // x402 payment surface (machine-readable for agent discovery).
      payment: {
        protocol: "x402",
        price: PRICE,
        currency: "USDC",
        network: NETWORK,
        asset: USDC[NETWORK] ?? null,
        payTo: PAY_TO,
        facilitator: FACILITATOR_URL,
      },
      inputSchema: {
        type: "object",
        properties: {
          language: { type: "string", description: "filter by language, e.g. typescript" },
          minAmount: { type: "number", description: "min USD bounty value" },
          maxAgeDays: { type: "number", description: "max age in days (freshness cap)" },
          includeSuspect: { type: "boolean", description: "include scam-suspect listings" },
          limit: { type: "number", description: "max results (<=50)" },
        },
      },
      output: { example: OUTPUT_EXAMPLE },
      links: { repo: "https://github.com/nikolas-sapa/x402-bounty-radar", protocol: "https://x402.org" },
    });
  });
  app.get("/health", (c) => c.json({ ok: true }));
  // Approximate, this-isolate-only counters. Source of truth for true totals:
  // Cloudflare Workers Analytics (calls) + Basescan on payTo (revenue).
  app.get("/metrics", (c) =>
    c.json({
      note: "isolate-local approximation; true totals via Cloudflare Analytics + Basescan",
      paidRequests: paidCount,
      cache: cacheStats(),
      payTo: PAY_TO,
      network: NETWORK,
    }),
  );

  // Gate the paid route behind x402 payment.
  app.use(
    paymentMiddleware(
      PAY_TO,
      {
        "/bounties": {
          price: PRICE,
          network: NETWORK,
          config: {
            description: "Curated, scam-filtered, competition-scored developer bounties.",
          },
        },
      },
      { url: FACILITATOR_URL as `${string}://${string}` },
    ),
  );

  app.get("/bounties", async (c) => {
    const q = c.req.query();
    const query: Query = {
      language: q.language,
      minAmount: q.minAmount ? Number(q.minAmount) : undefined,
      maxAgeDays: q.maxAgeDays ? Number(q.maxAgeDays) : undefined,
      includeSuspect: q.includeSuspect === "true",
      limit: q.limit ? Number(q.limit) : undefined,
    };
    try {
      const bounties = await getBounties(query);
      paidCount++;
      return c.json({ count: bounties.length, query, bounties });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      return c.json({ error: msg }, 502);
    }
  });

  return app;
}

// Config snapshot for logging (read at call time, same source as buildApp).
export function readConfig() {
  return {
    PAY_TO: process.env.PAY_TO_ADDRESS ?? "0x000000000000000000000000000000000000dEaD",
    NETWORK: process.env.X402_NETWORK ?? "base-sepolia",
  };
}
