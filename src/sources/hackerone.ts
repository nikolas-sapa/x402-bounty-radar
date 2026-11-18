// HackerOne adapter — manual-only. Verified: /programs/search.json returns
// 200 with body "[]" (dead endpoint), /hacktivity.json 301-redirects to an
// HTML page, and the directory + GraphQL API need auth/JS. There is no
// enumerable public API, so this returns a curated list of well-known public
// program pages. Rewards are program-variable and undisclosed — no invented
// numbers: amountUsd/maxReward stay null. Handles HEAD-verified 200 today.

import type { BountyDraft, FetchContext, SourceAdapter } from "../types.js";

// name -> handle at https://hackerone.com/<handle>
const PROGRAMS: Record<string, string> = {
  GitHub: "github",
  GitLab: "gitlab",
  Shopify: "shopify",
  Stripe: "stripe",
  Coinbase: "coinbase",
  Uber: "uber",
  Slack: "slack",
  Spotify: "spotify",
  Airbnb: "airbnb",
  Cloudflare: "cloudflare",
  Figma: "figma",
  "X (Twitter)": "x",
  HackerOne: "security", // HackerOne's own program
};

const NOTE = "manual-only: HackerOne has no enumerable public API; curated public programs";

export const hackerone: SourceAdapter = {
  name: "hackerone",
  mode: "manual-only",
  describe: () => ({
    url: "https://hackerone.com/directory/programs",
    note: "manual-only: no enumerable public API (search.json dead, hacktivity.json redirects to HTML, GraphQL needs auth) — curated public program list",
  }),
  async fetch(_ctx: FetchContext): Promise<BountyDraft[]> {
    return Object.entries(PROGRAMS).map(([name, handle]) => ({
      repo: name,
      number: null, // program-level listing
      title: `${name} — HackerOne program`,
      url: `https://hackerone.com/${handle}`,
      createdAt: null, // directory doesn't publish a date
      comments: 0,
      labels: ["hackerone"],
      amountUsd: null,
      maxReward: null, // undisclosed / program-variable
      source: "hackerone",
      escrowed: true,
      deadline: null,
      severity: null,
      language: null,
      signals: { sourceNotes: [NOTE] },
      fundingHint: "escrowed",
    }));
  },
};
