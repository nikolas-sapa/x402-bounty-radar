# x402 Bounty Radar

A **paid API** that aggregates *real, funded* developer bounties from GitHub, filters out the scam-farm clones, and scores competition — sold per-request for **USDC on Base** via the [x402 protocol](https://x402.org). No KYC, no platform middleman: payments settle straight to your wallet.

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
