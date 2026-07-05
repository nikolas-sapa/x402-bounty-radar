# x402 Bounty Radar

A **paid API** that aggregates *real, funded* developer bounties from GitHub, filters out the scam-farm clones, and scores competition — sold per-request for **USDC on Base** via the [x402 protocol](https://x402.org). No KYC, no platform middleman: payments settle straight to your wallet.

> **x402 Bounty Radar is a pay-per-call API that returns real, funded GitHub bounties — scam-filtered and competition-scored — billed in USDC on Base via the x402 protocol, with no API key or account.**

## Why x402 Bounty Radar

Raw GitHub bounty search has two failure modes this fixes:

- **Scam-farm clones** — throwaway accounts fork famous repos (`someuser/CockroachDB`, `someuser/TiKV`) and open fake "🎯 Fix this for $500" issues with no escrow. This API flags them via owner-vs-canonical-org and bait-title heuristics (`trust: suspect_scam`, with `scamReasons[]`).
- **Already swarmed** — the genuinely good bounties get 5+ AI-agent PRs within hours. Each result carries a `competition` score (low / medium / high) from comment volume, and results rank low-competition → dollar amount → freshest.

It's pay-per-call, so an agent with a wallet can call it directly and pay per request — no key to provision, no account to create.

## x402 Bounty Radar vs the alternatives

| | x402 Bounty Radar | GitHub issue search | Bounty platforms (Algora, etc.) | Generic issue scrapers |
|---|---|---|---|---|
| Scam-clone filtering | Yes (`trust` + `scamReasons[]`) | No | N/A (curated, but limited to their repos) | No |
| Competition scoring | Yes (`competition`) | No | Partial (shows attempts) | No |
| Coverage | All of GitHub's bounty issues | All of GitHub, unfiltered | Only opted-in repos | Whatever you scrape |
| Access | Pay-per-call, no account | Free, no ranking | Account required | Build & host it yourself |
| Payment | $0.01/call USDC on Base (x402) | Free | Platform fees on payout | N/A |
| Agent-callable | Yes, native (wallet pays the 402) | Yes, but no signal | Not designed for it | Yes, but you own the pipeline |

Honest read: if you want a free firehose, plain GitHub search is fine. Curated platforms like Algora give you real escrow but only for repos that joined. This sits in between — GitHub-wide coverage with the scam/competition signal layered on, priced per call so agents can consume it without an account.

## When to use it

- You're building an agent that hunts bounties and auto-drafts PRs, and you need clean input data instead of re-deriving a scam filter each run.
- You want GitHub-wide bounty coverage (not just one curated platform's repos) with a real-vs-scam signal attached.
- You want to skip already-swarmed bounties and see the low-competition ones first.
- Your caller is itself an agent with a Base wallet — pay-per-call with no key fits that better than API-key provisioning.

## FAQ

**Is it free?** The `GET /` (self-describing) and `GET /health` endpoints are free. The `GET /bounties` data endpoint is $0.01 per call in USDC on Base via x402.

**Do I need an account or API key?** No. There's no signup, no key, and no KYC. An x402-aware client (or agent wallet) pays the per-request 402 challenge and receives the data.

**How does it decide a bounty is "real"?** Heuristics, not guarantees: owner login vs the cloned repo's canonical org, bait-title patterns (emoji + dollar amount + "fix this"), and account signals. Each result returns `trust` (`likely_real` / `suspect_scam`) with `scamReasons[]` so you can see the reasoning. You can include suspects with `includeSuspect=true`.

**Can an AI agent call it directly?** Yes — that's the point. The caller can be an agent holding a Base wallet; it auto-pays the 402 and gets JSON back. No human-in-the-loop account setup.

**What does it return?** A ranked JSON list of bounties with `repo`, `title`, `url`, `amountUsd`, `competition`, and `trust` — filterable by `language`, `minAmount`, `maxAgeDays`, and `limit`.

## Why it exists

The discoverable bounty landscape is mostly noise:
- **Scam farms** — throwaway accounts cloning famous repos (`someuser/CockroachDB`, `someuser/TiKV`) with fake "🎯 Fix…" issues and no real escrow.
- **Already swarmed** — well-scoped bounties get 5+ AI-agent PRs within hours.

This API does the filtering and ranking for you (or for an agent calling it programmatically), and charges a few cents per query.

## What it returns

`GET /bounties` → JSON list of bounties, each with:
- `repo`, `number`, `title`, `url`, `createdAt`, `ageDays`, `comments`
- `amountUsd` — best-effort parsed reward
- `competition` — `low` / `medium` / `high` (from comment volume)
- `trust` — `likely_real` / `suspect_scam`, with `scamReasons[]`

Ranked: lowest competition → highest amount → freshest.

### Query params
| param | meaning |
|---|---|
| `language` | filter by language, e.g. `typescript` |
| `minAmount` | min USD bounty value |
| `maxAgeDays` | freshness cap |
| `includeSuspect` | `true` to include scam-suspect listings |
| `limit` | max results (≤ 50) |

Free endpoints: `GET /` (self-describing), `GET /health`.

## Run locally

```bash
npm install
cp .env.example .env      # set PAY_TO_ADDRESS to your Base wallet
npm run dev
```

Test the payment gate (returns HTTP 402 with payment requirements):
```bash
curl -i localhost:3000/bounties
```

## Get paid (go live)

1. **Set your wallet** — `PAY_TO_ADDRESS` = a Base address you control. That's the only identity needed. No KYC.
2. **Testnet first** (`X402_NETWORK=base-sepolia`) — keyless public facilitator, free to exercise the full flow.
3. **Mainnet** — set `X402_NETWORK=base` and a mainnet facilitator (`X402_FACILITATOR_URL`). Real USDC then lands in your wallet on each paid call.
4. **Deploy** — any Node host. Railway / Render / Fly / a Vercel Node function. Set the env vars there.
5. **Add `GITHUB_TOKEN`** in prod to raise GitHub's rate limit (60→5000 req/hr).

## How clients pay

Consumers use an x402-aware client — e.g. `x402-fetch`:
```ts
import { wrapFetchWithPayment } from "x402-fetch";
const fetchWithPay = wrapFetchWithPayment(fetch, walletClient);
const res = await fetchWithPay("https://your-host/bounties?language=typescript");
```
The client auto-pays the 402 challenge in USDC and receives the data. This is x402's native market: **agent-to-agent micropayments**.

## Stack
Hono · x402-hono · TypeScript · GitHub Search API. Zero database.

## Honest scope
This ships a working, verified, monetized endpoint. Revenue depends on distribution (getting agents/devs to call it) — that's the part that lives outside the code.
