// T1-T6 from the expansion brief. node:test + tsx — no new deps.
// Stubbed adapters only: these tests make zero live network calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BountyDraft, SourceAdapter, FetchContext } from "../src/types.js";
import { getBounties, sourceHealth } from "../src/bounties.js";
import { bountyFromDraft, scoreCompetition, classifyFunding } from "../src/scoring.js";
import { dedupeAndFlag } from "../src/sources/registry.js";
import { buildApp } from "../src/app.js";

function stubAdapter(name: string, drafts: BountyDraft[], mode: "live" | "manual-only" = "live"): SourceAdapter {
  return {
    name,
    mode,
    describe: () => ({ url: `https://example.com/${name}`, note: "test stub" }),
    fetch: async (_ctx: FetchContext) => drafts,
  };
}

function draft(partial: Partial<BountyDraft>): BountyDraft {
  return {
    repo: "org/proj",
    number: 1,
    title: "Fix the thing",
    url: "https://example.com/b/1",
    createdAt: new Date().toISOString(),
    comments: 0,
    labels: [],
    amountUsd: null,
    maxReward: null,
    source: "test",
    escrowed: false,
    deadline: null,
    severity: null,
    ...partial,
  };
}

// T1: two stubbed adapters merge + dedupe, output sorted by
// competition-adjusted value (amountUsd * (1 - score/100)).
test("T1: merged output sorted by competition-adjusted value", async () => {
  const a = stubAdapter("a", [
    draft({ repo: "acme/alpha", title: "Bounty: small", amountUsd: 100, comments: 0, url: "https://a/1" }),
    draft({ repo: "acme/big", title: "Bounty: big", amountUsd: 1000, comments: 0, url: "https://a/2" }),
  ]);
  const b = stubAdapter("b", [draft({ repo: "acme/contested", title: "Bounty: contested", amountUsd: 900, comments: 40, url: "https://b/1" })]);
  const out = await getBounties({ limit: 10 }, [a, b]);
  assert.equal(out.length, 3);
  // big: 1000*(1-.08)=920 > contested: 900*(1-.48)=468 > small: 100*(1-.08)=92
  assert.equal(out[0].repo, "acme/big");
  assert.equal(out[1].repo, "acme/contested");
  assert.equal(out[2].repo, "acme/alpha");
});

// T2: one adapter throwing -> response still served, /sources shows it down.
test("T2: throwing adapter degrades, health shows it down", async () => {
  const bad: SourceAdapter = {
    name: "broken-stub",
    mode: "live",
    describe: () => ({ url: "https://broken", note: "always throws" }),
    fetch: async () => {
      throw new Error("kaboom");
    },
  };
  const good = stubAdapter("good-stub", [draft({ repo: "x/y", amountUsd: 50 })]);
  const out = await getBounties({ limit: 10 }, [bad, good]);
  assert.equal(out.length, 1);
  const h = sourceHealth().find((s) => s.name === "broken-stub");
  assert.ok(h, "health row exists");
  assert.equal(h.ok, false);
  assert.ok(h.lastError?.includes("kaboom"));
});

// T3: same bounty on GitHub + external -> single entry, crossListed: true.
test("T3: cross-source dedupe yields one cross-listed entry", () => {
  const gh = draft({ repo: "acme/vault", source: "github", title: "Fix overflow in vault payout", url: "https://github.com/acme/vault/issues/9" });
  const ext = draft({ repo: "acme", source: "immunefi", title: "Fix overflow in vault payout", url: "https://immunefi.com/bug-bounty/acme/", escrowed: true });
  const out = dedupeAndFlag([gh, ext]);
  assert.equal(out.length, 1);
  assert.equal(out[0].crossListed, true);
  const b = bountyFromDraft(out[0], false);
  assert.equal(b.crossListed, true);
  assert.equal(b.signals.crossListed, true);
});

// T4: funding classification across the four states.
test("T4: funding — escrowed / verified-history / claimed / unknown", () => {
  assert.equal(classifyFunding(draft({ escrowed: true, amountUsd: 5000 }), false), "escrowed");
  assert.equal(classifyFunding(draft({ fundingHint: "escrowed" }), false), "escrowed");
  assert.equal(classifyFunding(draft({ amountUsd: 100 }), true), "verified-history");
  assert.equal(classifyFunding(draft({ amountUsd: 100 }), false), "claimed");
  assert.equal(classifyFunding(draft({ maxReward: 500 }), false), "claimed");
  assert.equal(classifyFunding(draft({}), false), "unknown");
  // escrowed beats everything, even with history
  assert.equal(classifyFunding(draft({ escrowed: true }), true), "escrowed");
});

// T5: competition score monotonic — quiet bounty vs swarmed bounty.
test("T5: 0 comments scores lower than 40 comments + 3 linked PRs", () => {
  const quiet = scoreCompetition({ comments: 0, linkedPrs: 0, reactions: 0, ageDays: 30, crossListed: false, sourceNotes: [] });
  const swarmed = scoreCompetition({ comments: 40, linkedPrs: 3, reactions: 0, ageDays: 30, crossListed: false, sourceNotes: [] });
  assert.ok(quiet.score < swarmed.score, `${quiet.score} < ${swarmed.score}`);
  assert.equal(quiet.band, "low");
  assert.equal(swarmed.band, "high");
  // cross-listing alone raises the score
  const listed = scoreCompetition({ comments: 0, linkedPrs: 0, reactions: 0, ageDays: 30, crossListed: true, sourceNotes: [] });
  assert.ok(listed.score > quiet.score);
  // bounds
  assert.ok(scoreCompetition({ comments: 1000, linkedPrs: 100, reactions: 500, ageDays: 0, crossListed: true, sourceNotes: ["a", "b", "c", "d", "e", "f"] }).score <= 100);
});

// T6: GET /sources answers 200 with no API key and no x402 payment.
test("T6: /sources is free and lists adapters", async () => {
  const app = buildApp();
  const res = await app.fetch(new Request("http://localhost/sources"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { sources: Array<{ name: string; mode: string }>; ecosystems: string[] };
  assert.ok(Array.isArray(body.sources));
  assert.ok(Array.isArray(body.ecosystems));
});
