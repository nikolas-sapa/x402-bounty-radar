# Distribution — get traffic so the endpoint earns

The API is live; revenue = calls. These are ready to post the moment mainnet is flipped.
Live URL: `https://x402-bounty-radar.nikolas-sapalidis.workers.dev`

---

## 1. x402 Bazaar / ecosystem directory (highest intent: agents that already pay)

x402 services get discovered via the Bazaar (CDP `/discovery/resources`) and community lists.
Action: open a PR to the x402 ecosystem "awesome/services" list and submit to the Bazaar.

**Listing blurb:**
> **Bounty Radar** — Pay-per-call API of real, funded developer bounties. Aggregates open GitHub bounties, filters scam-farm clones, scores competition. $0.01/call, USDC on Base. No key, no account. `GET /bounties?language=typescript&minAmount=100`

**Machine-readable (for resource discovery):**
```json
{
  "resource": "https://x402-bounty-radar.nikolas-sapalidis.workers.dev/bounties",
  "type": "http",
  "x402Version": 1,
  "accepts": [{ "scheme": "exact", "network": "base", "asset": "USDC", "maxAmountRequired": "10000" }],
  "description": "Real funded dev bounties, scam-filtered, competition-scored.",
  "tags": ["developer-tools", "bounties", "github", "data"]
}
```

---

## 2. Show HN

**Title:** Show HN: A pay-per-call API for real dev bounties (x402, $0.01 in USDC, no signup)

**Body:**
> I kept hitting two problems hunting open-source bounties: half the "bounty" repos on GitHub are scam-farm clones of famous projects (fake `someuser/CockroachDB` issues), and the genuinely good ones get swarmed by AI agents within hours.
>
> So I built a small API that aggregates live GitHub bounties, filters the scam clones (owner-vs-canonical-org heuristics + bait-title detection), and scores competition by comment volume. It's monetized with x402 — $0.01 per call in USDC on Base, no API key, no account, you just pay per request. Built for agents as much as humans.
>
> Live: https://x402-bounty-radar.nikolas-sapalidis.workers.dev (GET / is free and self-describing)
> Code: https://github.com/nikolas-sapa/x402-bounty-radar
>
> Stack: Hono + x402-hono on Cloudflare Workers. Happy to talk about the scam-filter heuristics or the x402 integration.

---

## 3. X / Twitter

> Built a pay-per-call API for real dev bounties. Filters the scam-farm clones, scores competition, $0.01/call in USDC via x402 — no key, no signup. Agents can hit it directly.
>
> https://x402-bounty-radar.nikolas-sapalidis.workers.dev
> #x402 #buildinpublic

---

## 4. Agent tool registries / MCP lists
- Submit as an x402-payable tool to agent toolkits (CDP AgentKit examples, x402 community tool lists).
- Post in the x402 Discord / Foundation channels "#built-with-x402".

---

## Reality check
Pricing $0.01/call. Break-even is trivial (Workers free tier). Revenue scales only with adoption —
the Bazaar + agent registries are the leverage because those consumers *already pay per call*.
Human traffic (HN/X) is one-time spikes; agent/registry presence is the durable channel.
