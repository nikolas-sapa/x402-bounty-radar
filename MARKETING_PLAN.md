# x402 Bounty Radar — Go-to-Market & Marketing Plan

> **Extends** `DISTRIBUTION.md` (draft copy lives there — reference it, don't duplicate).
> Last updated: June 2026. Operator: solo, near-zero budget. All tactics are time-leveraged or automatable.

---

## Positioning

**One-paragraph statement:**

x402 Bounty Radar is a pay-per-call API for AI agents and developers who want real, funded GitHub bounties — not the scam-farm clones that pollute every bounty board. No signup, no API key, no account: an agent sends $0.01 USDC on Base and gets back clean JSON. The scam-filter (owner-vs-canonical-org heuristics + bait-title detection) and competition score (comment-volume bucketed low/medium/high) are what separates it from a raw GitHub search. It runs on Cloudflare Workers, it's always on, and it costs nothing to keep live.

**Core hook / narrative:**

> "Most 'GitHub bounties' are scam clones of famous repos. We built the filter. $0.01/call, agents pay directly, no account."

Lead with this in every channel. The scam-filter angle is concrete, verifiable, and shareable — it earns the right to explain x402 next, not before.

---

## Target Consumers & ICP

### Primary — AI Agents

| Attribute | Detail |
|---|---|
| Who | Autonomous coding agents, MCP-connected AI assistants, AgentKit-powered bots searching for funded work |
| Job to be done | Find real, payable bounties to route to capable agents or developers; filter noise automatically |
| Discovery path | MCP registries → tool call → x402 payment → JSON response |
| Willingness to pay | Structural: $0.01/call is below noise threshold for any agent that bills time or acts on behalf of a paying user |
| Key friction | Must be findable in the registries and directories those agents poll (Bazaar, MCP registries, Smithery, Glama) |

### Secondary — Bounty-Hunting Developers

| Attribute | Detail |
|---|---|
| Who | Freelance devs, open-source contributors, students looking for paid OSS work |
| Job to be done | Find legit bounties quickly; avoid wasting time on fake repos |
| Discovery path | Show HN / Reddit post → direct API call or simple curl loop → pay per query |
| Willingness to pay | Lower: need to see value before committing even $0.01 — free `GET /` endpoint and compelling Show HN post do this job |
| Key friction | Crypto friction (need USDC on Base); mitigate with a `GET /` self-describing response that explains x402 simply |

---

## The Bazaar / No-KYC Tradeoff Decision

### The Problem

The CDP Bazaar discovery layer (CDP `/v2/x402/discovery/resources`) is the primary agent auto-discovery channel for x402 services. It is tightly coupled to the CDP facilitator flow. Open issue x402-foundation/x402 #2207 documents that services using non-CDP facilitators — including xpay (keyless, no-KYC) — may not be crawled or indexed by CDP's Bazaar indexer, even with `declareDiscoveryExtension`/`bazaarResourceServerExtension` and `discoverable: true` in metadata.

Using keyless xpay is a deliberate design choice to avoid KYC. That is non-negotiable per the operator's stated constraint.

### Three Options

| Option | Pros | Cons | Effort |
|---|---|---|---|
| **(A) Accept reduced Bazaar reach** — lean on xpay's own directory, MCP registries, community lists | Stays zero-KYC, simpler, no dual-facilitator complexity | Misses CDP Bazaar's 35K+ indexed resources audience | Zero extra build |
| **(B) CDP-facilitator variant just for Bazaar indexing** — run a second endpoint with CDP facilitator, xpay remains primary | Gets Bazaar indexed; keeps no-KYC for real traffic | Requires CDP account/KYC for the listing endpoint; operational complexity; splits identity | Medium build, breaks constraint |
| **(C) Alternative/federated registries + own directory submission** — MCP registries, Smithery, Glama, PulseMCP, mcp.so, xpay directory, awesome-x402 lists | Reaches agent builders without CDP dependency; MCP ecosystem growing fast | Smaller audience than full CDP Bazaar today | Low effort, high leverage |

### Recommendation: Option A + C combined

Do not compromise on KYC. Option B breaks the core design principle and adds maintenance overhead for a listing endpoint that would be a lie if it redirects payments through CDP anyway.

Instead: add the `bazaarResourceServerExtension` metadata correctly (it costs nothing, and CDP may fix issue #2207), then invest the rest of the effort in Option C channels. The MCP registry ecosystem (registry.modelcontextprotocol.io, Smithery, Glama, mcp.so, PulseMCP, mcpservers.org, Apigene) is growing faster than Bazaar and is the right long-term bet for agent discovery. Revisit Bazaar integration quarterly as the x402 / CDP facilitator situation evolves.

**Add this metadata to `GET /` response now regardless** (crawlers index it whether or not CDP uses it):

```json
{
  "discovery": {
    "type": "bazaarResourceServerExtension",
    "discoverable": true,
    "description": "Pay-per-call API for real, scam-filtered GitHub bounties. $0.01 USDC/call on Base, no signup.",
    "tags": ["developer-tools", "bounties", "github", "ai-agents", "x402"],
    "inputSchema": {
      "language": "string (optional) — filter by programming language",
      "minAmount": "number (optional) — minimum bounty USD",
      "maxAgeDays": "number (optional) — max age of issue in days",
      "includeSuspect": "boolean (optional) — include flagged repos",
      "limit": "number (optional, default 20) — max results"
    },
    "output": {
      "example": {
        "bounties": [
          {
            "repo": "denoland/deno",
            "issue": "Fast HTTP server benchmark regression",
            "amount_usd": 500,
            "language": "rust",
            "competition": "low",
            "suspect": false,
            "url": "https://github.com/denoland/deno/issues/1234"
          }
        ]
      }
    }
  }
}
```

---

## Channel Strategy

Ranked by leverage. Agent-discovery channels first.

---

### Channel 1 — MCP Server Wrapper (Build, then list everywhere)

**Why:** This is the single highest-leverage engineering investment. Tensorfeed and Swarmwage are listed on `punkpeye/awesome-mcp-servers` doing exactly this — pay-per-call USDC on Base, no accounts, `npx -y @package/mcp-server`. The moment Bounty Radar is installable as an MCP tool, every Claude Desktop / Cursor / Windsurf / agent framework user can add it in one command. The API call and x402 payment become invisible; the agent just sees a `search_bounties` tool.

**Exact steps:**
1. Create `packages/mcp-server/` in repo. Use `@modelcontextprotocol/sdk` + `x402-fetch` (the x402-aware fetch wrapper). Expose one tool: `search_bounties` with the same query params as `/bounties`.
2. Publish to npm as `@nikolas-sapa/x402-bounty-radar-mcp` (or `bounty-radar-mcp`).
3. README `npx -y bounty-radar-mcp` one-liner — copy tensorfeed's pattern exactly.
4. Submit to MCP registries (step below). Use `mcp-submit` CLI to push to 10+ directories in one command.

**Effort:** 3–4 hours build + 1 hour submission.
**Expected impact:** Permanent agent-layer discoverability. Each registry listing is a passive inbound channel.
**Automatable:** Yes — submission with `mcp-submit`; npm publish via CI.

---

### Channel 2 — MCP Registry Submissions

**Why:** registry.modelcontextprotocol.io, Smithery, Glama, PulseMCP, mcp.so, mcpservers.org, Apigene — these are where agent builders actively search for tools to wire into their systems. One listing = permanent presence. `mcp-submit` CLI pushes to 10+ in one command.

**Exact steps:**
1. After MCP server is published to npm: `npx mcp-submit --name "Bounty Radar" --description "..." --npm bounty-radar-mcp --url https://x402-bounty-radar.nikolas-sapalidis.workers.dev`
2. For official MCP Registry (PR-based): open a PR to `modelcontextprotocol/servers` following their contribution guide. Include `name`, `description`, `install`, `tools[]`, and example.
3. Smithery: submit via smithery.ai/submit — fill the form, reference the npm package.
4. Glama, mcp.so, PulseMCP: similar web forms or GitHub issue submissions.
5. `punkpeye/awesome-mcp-servers`: open a PR adding Bounty Radar under "Developer Tools" or "Data & APIs" with the one-liner.

**One-line registry description:**
> Bounty Radar — real, scam-filtered GitHub bounties as an MCP tool. Pay $0.01 USDC per search via x402 on Base. No signup, no key. `npx bounty-radar-mcp`

**MCP server description (for registry listings):**
> search_bounties — Query aggregated, scam-filtered GitHub bounties. Filters fake clone repos, scores competition (low/medium/high), parses bounty amounts. Pays $0.01 USDC on Base via x402 — no API key required. Parameters: language, minAmount, maxAgeDays, includeSuspect, limit.

**Effort:** 2 hours (post npm publish).
**Expected impact:** Durable. Each registry = passive discovery channel for agent builders.
**Automatable:** `mcp-submit` automates multi-registry push.

---

### Channel 3 — xpay Directory + x402 Community Lists

**Why:** Since CDP Bazaar reach is constrained by the facilitator issue, xpay's own directory of keyless services is the natural alternative. The x402 Foundation community (Discord `#built-with-x402`, GitHub ecosystem lists) are where protocol-native builders look.

**Exact steps:**
1. Submit to xpay's service directory at xpay.sh (check for a submission form or GitHub issue tracker).
2. Open a PR to any `awesome-x402` community list on GitHub (search `github.com/search?q=awesome-x402`).
3. Post in x402 Discord `#built-with-x402` with the listing blurb from `DISTRIBUTION.md`.
4. Add `bazaarResourceServerExtension` metadata to `GET /` regardless (future-proofing for when #2207 is fixed).

**Effort:** 1–2 hours.
**Expected impact:** Small audience today, but exactly the right audience (protocol-native agent builders).
**Automatable:** One-time manual; monitor xpay directory for status.

---

### Channel 4 — awesome-lists PRs

**Why:** Low effort, permanent backlinks, indexed by agent tooling searches and GitHub Copilot-style searches.

**Exact steps:**
1. `punkpeye/awesome-mcp-servers` — PR under "Developer Tools" (do this after MCP server is live).
2. Search GitHub for `awesome-x402`, `awesome-web3-apis`, `awesome-bounties` — PR each relevant one.
3. `awesome-cloudflare` — PR under "Workers" with a note about x402 monetization.

**Effort:** 1 hour (3–5 PRs).
**Expected impact:** Passive SEO + discoverability for agent builders browsing awesome-lists.
**Automatable:** One-time.

---

### Channel 5 — Show HN (spike, not durable)

**Why:** HN audience includes agent builders, OSS devs, and the rare person who will write a blog post about you. One good Show HN → backlinks + secondary coverage. The scam-filter angle is HN-native: concrete, verifiable, anti-spam.

**Refined Show HN title and body** (building on `DISTRIBUTION.md` draft):

**Title:** `Show HN: I built a scam-filter for GitHub bounties — pay-per-call API, $0.01 USDC via x402`

**Body:**
```
Half the repos that appear in GitHub bounty searches are scam-farm clones — fake
"someuser/CockroachDB" issues with rewards that never pay out. The other half get
swarmed by AI agents before a human can finish reading them.

I built Bounty Radar to fix both problems:
- Aggregates real, funded GitHub bounties
- Filters fake clone repos (owner-vs-canonical-org heuristics + bait-title detection)
- Scores competition (low/medium/high) by comment volume
- Parses bounty $ amounts from issue text

Monetized with x402 (the HTTP 402 payment protocol) — $0.01 USDC on Base per call,
no API key, no account. Designed for AI agents first, developers second.

Live: https://x402-bounty-radar.nikolas-sapalidis.workers.dev
GET / is free and self-describing. GET /bounties costs $0.01.

Stack: Hono + x402-hono on Cloudflare Workers (free tier, always on).

Happy to talk about: the scam-filter heuristics, the x402 integration, or the
"agents as primary consumers" design pattern.
```

**Timing:** Post Tuesday–Thursday 9–11am ET. Don't post same day as a major x402/crypto news event.
**Effort:** 15 minutes to post; monitor comments for 48 hours.
**Expected impact:** 1-day spike, possible secondary coverage. Not durable alone.
**Automatable:** No — manual post, manual comment responses required.

---

### Channel 6 — X/Twitter (ongoing, low-effort)

**Why:** #x402 and #buildinpublic have the right audience. Build-in-public posts compound over time. The scam-filter heuristic is tweetable.

**Tweet 1 (launch):**
```
Most "GitHub bounties" are scam-farm clones of famous repos.

Built a filter. Pay $0.01 USDC per query via x402 — no account, no key.
Agents can hit it directly.

https://x402-bounty-radar.nikolas-sapalidis.workers.dev

#x402 #buildinpublic
```

**Tweet 2 (technical hook, a few days later):**
```
How do you detect fake bounty repos on GitHub?

- Compare owner to canonical org (facebook ≠ some-user/facebook)
- Flag bait titles ("$10,000 bounty" in issue title on 3-star repo)
- Score competition by comment velocity

All of this for $0.01/call. x402, USDC on Base.

#buildinpublic #x402
```

**Cadence:** 1 post at launch, 1 technical thread per week for 4 weeks. Then monthly updates.
**Effort:** 20 minutes/week.
**Automatable:** Partially — draft in bulk, schedule with Buffer/Typefully.

---

### Channel 7 — Reddit (spike)

**Subreddits:** r/opensource, r/webdev, r/AIAgents, r/ethdev (for x402 angle)

**Post title:** `Built a scam-filter for GitHub bounties — it's a pay-per-call API, $0.01/query in USDC, no signup`

**Post body:**
```
I kept seeing fake bounty repos polluting every GitHub search — clone repos of famous projects
with fake issues promising rewards. Built a filter API to remove them.

What it does:
- Aggregates funded GitHub bounties
- Filters scam clone repos (owner vs canonical org heuristics)
- Scores competition (low/medium/high)
- Parses bounty amounts from issue text

It's monetized with x402 (HTTP 402 payment protocol) — you pay $0.01 USDC per query on Base
network, no account or API key required. Works great as a tool for AI agents.

Try it: https://x402-bounty-radar.nikolas-sapalidis.workers.dev
GET / is free and self-describing. GET /bounties costs $0.01.

Happy to share the scam-detection heuristics if anyone's curious.
```

**Effort:** 30 minutes. Post once, respond to comments.
**Expected impact:** Spike only. Some secondhand links.
**Automatable:** No.

---

### Channel 8 — dev.to / Blog Post (one-time, long-term SEO)

**Why:** "How I built a scam-filter for GitHub bounties" + "How to monetize a Cloudflare Worker with x402" are both searchable topics. One post = permanent backlink + SEO for agent builders Googling x402 tutorials.

**Title options:**
- "How I filtered 90% of fake GitHub bounties and monetized the result with x402"
- "Pay-per-call APIs on Cloudflare Workers: x402 integration walkthrough"

**Effort:** 2–3 hours. Publish to dev.to + cross-post to Hashnode.
**Automatable:** No — write once, syndicate.

---

## Product / Roadmap Recommendations

### Priority 1: MCP Server Wrapper (highest-leverage build)

Justify: The API already exists. An MCP wrapper is ~100 lines of TypeScript. The payoff is access to every MCP-capable agent (Claude Desktop, Cursor, Windsurf, custom LLM agents) without any extra infrastructure. The x402 payment happens inside `x402-fetch` automatically. Tensorfeed (`npx -y @tensorfeed/mcp-server`) is the exact template — copy the pattern.

Implementation sketch:
```typescript
// packages/mcp-server/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { x402Fetch } from "x402-fetch";

const server = new McpServer({ name: "bounty-radar", version: "1.0.0" });

server.tool("search_bounties", {
  description: "Search real, scam-filtered GitHub bounties. Pays $0.01 USDC on Base via x402.",
  inputSchema: { /* language, minAmount, maxAgeDays, includeSuspect, limit */ }
}, async (params) => {
  const url = new URL("https://x402-bounty-radar.nikolas-sapalidis.workers.dev/bounties");
  // append params
  const res = await x402Fetch(url.toString(), { wallet: process.env.WALLET_PRIVATE_KEY });
  return { content: [{ type: "text", text: await res.text() }] };
});
```

### Priority 2: Rich Self-Description at `GET /`

The free `GET /` endpoint is the API's "README for agents." Make it the best-in-class self-describing response in the x402 ecosystem:

- Add full OpenAPI-compatible `inputSchema` with field descriptions and examples
- Add `output.example` with a real response sample
- Add `bazaarResourceServerExtension` discovery metadata (future-proofs CDP indexing)
- Add `pricing`, `facilitator`, `network`, `payTo` fields explicitly

Agents that probe `GET /` before calling get everything they need to call correctly on the first try.

### Priority 3: Premium Endpoint (optional, 30-day timeline)

Current $0.01/call is correct for traction. Once there are measurable daily calls, add:

- `GET /bounties/premium` at $0.05/call — adds GitHub Stars trend, contributor count, estimated time-to-close, and raw bounty source URL
- Or a bulk endpoint: $0.10 for up to 100 results (vs 20 default)

Do not add this before first revenue signals. Complexity before traction = waste.

---

## Pricing & Packaging Recommendation

**Keep $0.01/call as the entry price.** Comparable: Firecrawl $0.01/scrape, CoinGecko x402 endpoints. It's below the psychological threshold for agents and developers alike.

**Add premium at $0.05/call after first 100 paid calls.** Premium adds richer metadata (Stars, contributor stats, estimated pay timeline). This creates a two-tier model without breaking the no-signup principle.

**Do not add subscription tiers.** Subscriptions require accounts. That violates the zero-KYC / no-signup design. Bulk call discounts are fine (pay X, get N calls cheaper) if implemented via a voucher or signed token, but this is post-MVP complexity.

---

## 2-Week Launch Sprint

### Phase 1: Foundation (Days 1–3)

**Day 1**
- [ ] Enrich `GET /` response with full self-description, inputSchema, output.example, discovery metadata
- [ ] Verify `GET /bounties` returns correct x402 challenge on testnet and mainnet
- [ ] Add `bazaarResourceServerExtension` fields to the response regardless of CDP indexer status

**Day 2**
- [ ] Build MCP server wrapper (`packages/mcp-server/`) — ~100 lines
- [ ] Publish to npm as `bounty-radar-mcp`
- [ ] Test `npx bounty-radar-mcp` locally with a real wallet env var

**Day 3**
- [ ] Run `mcp-submit` to push to Smithery, Glama, PulseMCP, mcp.so, mcpservers.org, Apigene
- [ ] Open PR to official MCP Registry (`modelcontextprotocol/servers`)
- [ ] Submit to xpay's service directory

### Phase 2: Community Presence (Days 4–7)

**Day 4**
- [ ] Open PRs: `punkpeye/awesome-mcp-servers`, any `awesome-x402` list, `awesome-cloudflare`
- [ ] Post in x402 Discord `#built-with-x402` with listing blurb

**Day 5**
- [ ] Post Show HN (Tuesday–Thursday 9–11am ET)
- [ ] Monitor HN comments for 48 hours, respond to technical questions

**Day 6**
- [ ] Post Tweet 1 (launch tweet from `DISTRIBUTION.md`, refined version above)
- [ ] Post Reddit: r/opensource + r/AIAgents

**Day 7**
- [ ] Review first 7 days of Cloudflare Workers analytics
- [ ] Check on-chain payTo balance for any USDC received
- [ ] Note which MCP registry PRs are merged vs pending

### Phase 3: Content & Monitoring (Days 8–14)

**Day 8–10**
- [ ] Write dev.to post: "How I filtered fake GitHub bounties and monetized with x402"
- [ ] Publish + cross-post to Hashnode

**Day 11–12**
- [ ] Post Tweet 2 (technical scam-detection thread)
- [ ] Follow up on any pending MCP registry PRs

**Day 13–14**
- [ ] Review 14-day metrics (calls/day, unique callers, USDC received)
- [ ] Decide: add premium endpoint? Adjust limit defaults? Expand language coverage?

---

## 90-Day Plan

### Month 1 (Weeks 1–4): Discoverability

- MCP server live + listed in 5+ registries
- Show HN + Reddit posted
- dev.to article live
- Bazaar metadata in place (even if not indexed yet)
- Target: 10+ calls/day, at least 1 paid call from a non-owner wallet

### Month 2 (Weeks 5–8): Amplification

- Monitor which MCP registries drive traffic (Cloudflare Workers request logs)
- Post a build-in-public update tweet with early metrics ("X paid calls in month 1")
- Open PR to `coinbase/x402` examples if any agent integration story is worth sharing
- Add premium endpoint if call volume justifies it (target: 50+ calls/day threshold)
- Explore: wrapper for a specific agent framework (LangChain tool, AutoGen plugin)

### Month 3 (Weeks 9–12): Compounding

- Submit to any Cloudflare Workers showcase or blog (Cloudflare has featured x402 integrations)
- Re-evaluate CDP Bazaar status (check if issue #2207 is resolved; if so, add CDP facilitator variant or resubmit)
- Add a second data source (Gitcoin grants, IssueHunt, Bountysource) to expand coverage
- Write a follow-up HN post or dev.to update with real usage data — follow-ups with numbers get more traction than original posts

---

## Success Metrics & Tracking

### Leading Indicators (action-driven, check weekly)

| Metric | Target (30 days) | How to track |
|---|---|---|
| Calls/day to `/bounties` | 10+ | Cloudflare Workers Analytics → Requests |
| MCP registry listings live | 5+ | Manual check: Smithery, Glama, mcp.so, PulseMCP, official registry |
| Awesome-list PRs merged | 3+ | GitHub PR status |
| Bazaar discovery metadata in response | Yes | `curl GET /` and inspect JSON |
| Unique caller wallets | 3+ | On-chain analytics for payTo address |

### Lagging Indicator (revenue truth)

| Metric | Target (30 days) | How to track |
|---|---|---|
| USDC received to payTo wallet | > $0 | Check 0x07c9c5D37D28693CfD9DDB8858b2046853E1fA95 on Basescan |
| Monthly revenue | $1+ (100 calls) | Same: Basescan balance delta |

### Tracking Method

No analytics stack needed. Two sources of truth:
1. **Cloudflare Workers Analytics** — request count, geographic distribution, error rates. Free tier. Check dashboard weekly.
2. **Basescan** — `https://basescan.org/address/0x07c9c5D37D28693CfD9DDB8858b2046853E1fA95` — USDC transfers are the real revenue ledger. No self-reporting, no lying.

Optional: Add a `GET /metrics` endpoint (publicly readable, no payment required) that returns aggregate call count from a Cloudflare KV counter. This gives agents and curious developers a live signal that the service is active and used — social proof in machine-readable form.

---

## Reality Check

**Revenue depends on agent adoption, which is early.** The x402 protocol had ~75M transactions and ~$24M cumulative volume by December 2025, with 75% of that being AI-agent payments — the trend is real. But agent-layer discovery is still immature: registries are fragmented, agent frameworks don't all support x402 natively yet, and most developers are still learning that `HTTP 402` is a payment mechanism.

**What "success" looks like at 30 days:**
- 5+ MCP registry listings merged — that's the foundation
- At least 10 paid calls total — proof the payment flow works end-to-end
- At least 1 HN comment or tweet reply from someone who actually tested it — social signal

**What failure looks like at 30 days:**
- 0 calls from wallets other than the owner's test wallet
- MCP registry PRs all pending/rejected
- No engagement on Show HN or social posts

**If failure:** The issue is almost certainly discoverability, not the product. Triage: (a) are the MCP registry listings live? (b) does `npx bounty-radar-mcp` actually work for a cold user? (c) is the Show HN title leading with the scam-filter hook or with x402 protocol details? Fix the discovery/hook before changing pricing or adding features.

**Revenue projection (honest):**
- 10 calls/day × $0.01 = $0.10/day = ~$3/month
- 100 calls/day × $0.01 = $1/day = ~$30/month
- 1,000 calls/day (agent-scale) = $10/day = ~$300/month

The economics only work at agent scale. Human traffic (HN, Reddit) will not get there alone. The MCP server wrapper + registry listings are the only path to agent-scale call volume. That's why it's Priority 1.

**The integration IS the distribution.** Being findable in the registries where agents look for tools is more valuable than any ad, tweet, or blog post. Build the MCP server first. Everything else is amplification.

---

## Bazaar Metadata Reference (add to `GET /` immediately)

```json
{
  "service": "x402-bounty-radar",
  "version": "1.0.0",
  "description": "Real, scam-filtered GitHub bounties. Pay $0.01 USDC on Base per query. No signup, no API key.",
  "pricing": {
    "amount": "10000",
    "asset": "USDC",
    "network": "base",
    "scheme": "exact",
    "per": "call"
  },
  "facilitator": "https://facilitator.xpay.sh",
  "payTo": "0x07c9c5D37D28693CfD9DDB8858b2046853E1fA95",
  "endpoints": {
    "free": "GET /",
    "paid": "GET /bounties"
  },
  "discovery": {
    "type": "bazaarResourceServerExtension",
    "discoverable": true,
    "tags": ["developer-tools", "bounties", "github", "ai-agents", "x402", "data"],
    "inputSchema": {
      "language": { "type": "string", "description": "Filter by programming language (e.g. 'typescript', 'rust')" },
      "minAmount": { "type": "number", "description": "Minimum bounty amount in USD" },
      "maxAgeDays": { "type": "number", "description": "Max issue age in days (default 90)" },
      "includeSuspect": { "type": "boolean", "description": "Include flagged/suspect repos (default false)" },
      "limit": { "type": "number", "description": "Max results (default 20, max 100)" }
    },
    "output": {
      "format": "application/json",
      "example": {
        "bounties": [
          {
            "repo": "denoland/deno",
            "issue_title": "HTTP server benchmark regression",
            "issue_url": "https://github.com/denoland/deno/issues/1234",
            "amount_usd": 500,
            "language": "rust",
            "competition": "low",
            "suspect": false,
            "age_days": 3
          }
        ],
        "count": 1,
        "filtered_suspect": 47
      }
    }
  }
}
```

---

*This plan extends `DISTRIBUTION.md`. Copy from there is referenced, not duplicated — check that file for the original Bazaar listing blurb, machine-readable JSON, Show HN body draft, and tweet copy before posting.*
