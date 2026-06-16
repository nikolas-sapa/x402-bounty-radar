import { Hono } from "hono";
import { paymentMiddleware, type Network } from "x402-hono";
import { getBounties, type Query } from "./bounties.js";

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

  app.get("/", (c) =>
    c.json({
      name: "x402-bounty-radar",
      description:
        "Paid API for real, funded developer bounties with scam-farm filtering and competition scoring.",
      paid_endpoint: "/bounties",
      price: PRICE,
      network: NETWORK,
      pay_to: PAY_TO,
      params: {
        language: "filter by language, e.g. typescript",
        minAmount: "min USD bounty value",
        maxAgeDays: "freshness cap",
        includeSuspect: "true to include scam-suspect listings",
        limit: "max results (<=50)",
      },
    }),
  );
  app.get("/health", (c) => c.json({ ok: true }));

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
