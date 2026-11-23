// Adapter parsing tests: real adapter code, canned upstream payloads.
// globalThis.fetch is stubbed per test — zero live network calls.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { github } from "../src/sources/github.js";
import { bugcrowd } from "../src/sources/bugcrowd.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(handler: (url: string) => unknown): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    return new Response(JSON.stringify(handler(url)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return urls;
}

function ghIssue(repo: string, number: number, title: string, labels: string[] = ["bounty"]) {
  return {
    title,
    html_url: `https://github.com/${repo}/issues/${number}`,
    number,
    comments: 2,
    created_at: "2026-01-01T00:00:00Z",
    repository_url: `https://api.github.com/repos/${repo}`,
    labels: labels.map((name) => ({ name })),
    reactions: { total_count: 4 },
  };
}

// A1: scam filter — clone of a famous repo under a random owner is flagged,
// the canonical org is not. This is the headline product signal.
test("A1: github flags famous-name clones, trusts the canonical org", async () => {
  stubFetch(() => ({
    items: [
      ghIssue("someuser/cockroachdb", 1, "\u{1F3AF} Fix this for $500"),
      ghIssue("cockroachdb/cockroachdb", 9123, "Bounty: speed up range scans $2,000"),
    ],
  }));
  const out = await github.fetch({});
  const clone = out.find((d) => d.repo === "someuser/cockroachdb");
  const real = out.find((d) => d.repo === "cockroachdb/cockroachdb");
  assert.ok(clone && real);
  assert.equal(clone.trust, "suspect_scam");
  assert.ok(clone.scamReasons?.some((r) => r.includes("not the canonical org")));
  assert.equal(real.trust, "likely_real");
  assert.deepEqual(real.scamReasons, []);
});

// A2: amount parsing from title/labels, incl. commas, k-suffix and the
// "k binds to the matched amount only" rule.
test("A2: github parses reward amounts from title and labels", async () => {
  stubFetch(() => ({
    items: [
      ghIssue("a/one", 50, "Bounty: refactor parser $2,000"),
      ghIssue("a/two", 51, "Implement caching", ["bounty", "$1.5k"]),
      ghIssue("a/three", 52, "Bounty $200 (pool was $5k)"),
      ghIssue("a/four", 53, "No amount here"),
    ],
  }));
  const out = await github.fetch({});
  const amt = (repo: string) => out.find((d) => d.repo === repo)?.amountUsd;
  assert.equal(amt("a/one"), 2000);
  assert.equal(amt("a/two"), 1500);
  assert.equal(amt("a/three"), 200);
  assert.equal(amt("a/four"), null);
  assert.equal(out.find((d) => d.repo === "a/one")?.signals?.reactions, 4);
});

// A3: the same issue returned by multiple label queries appears once, and
// the language filter is pushed into the GitHub query.
test("A3: github dedupes across label queries and forwards language", async () => {
  const urls = stubFetch(() => ({ items: [ghIssue("a/dup", 7, "Bounty $100")] }));
  const out = await github.fetch({ language: "rust" });
  assert.equal(out.length, 1);
  assert.equal(urls.length, 3);
  assert.ok(urls.every((u) => decodeURIComponent(u).includes("language:rust")));
});

// A4: bugcrowd keeps only open public programs and survives malformed rows.
test("A4: bugcrowd filters private/demo/closed and malformed engagements", async () => {
  const base = { isPrivate: false, isBanned: false, isDemo: false, accessStatus: "open" };
  stubFetch(() => ({
    engagements: [
      { ...base, name: " Acme Corp ", briefUrl: "/engagements/acme", rewardSummary: { minReward: "$100", maxReward: "$3,000" }, industryName: "Fintech", productEngagementType: { label: "Bug Bounty" } },
      { ...base, name: "Points Only", briefUrl: "/engagements/points", rewardSummary: { minReward: "Points", maxReward: null } },
      { ...base, name: "Secret", briefUrl: "/engagements/secret", isPrivate: true },
      { ...base, name: "Demo", briefUrl: "/engagements/demo", isDemo: true },
      { ...base, name: "Closed", briefUrl: "/engagements/closed", accessStatus: "closed" },
      { ...base, name: null, briefUrl: "/engagements/broken" },
    ],
  }));
  const out = await bugcrowd.fetch({});
  assert.deepEqual(out.map((d) => d.repo), ["Acme Corp", "Points Only"]);
  const acme = out[0];
  assert.equal(acme.url, "https://bugcrowd.com/engagements/acme");
  assert.equal(acme.amountUsd, 3000);
  assert.equal(acme.maxReward, 3000);
  assert.equal(acme.escrowed, true);
  assert.deepEqual(acme.labels, ["Bug Bounty", "Fintech"]);
  assert.equal(out[1].amountUsd, null);
});
