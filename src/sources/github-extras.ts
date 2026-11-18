// GitHub extras adapter — GitHub-native bounty signals that the label search
// (src/sources/github.ts) does NOT cover:
//   a) escrow-platform links in issue bodies (algora.io/bounties, polar.sh)
//      — an escrow link means the money is already posted on a platform
//   b) repos tagged topic:bug-bounty / topic:bounty — a repository-level
//      signal that the project runs a bounty program (program-level drafts)
// Covered: the four issue-search queries below. NOT covered:
//   - SECURITY.md reward mentions — needs code search auth + isn't
//     enumerable at scale via the public search API (documented, not fetched)
//   - GitHub Sponsors-for-issues — no public enumerable endpoint
//   - label search — deliberately left to the github adapter, no duplication
// fetch() never throws: each query fails independently (console.error) and
// the adapter returns whatever succeeded.

import type { BountyDraft, FetchContext, SourceAdapter } from "../types.js";
import { watchlistRepos } from "./github.js";

const GH = "https://api.github.com";

// Same canonical-owner table as github.ts — detectScam is meaningless without it.
const FAMOUS: Record<string, string[]> = {
  cockroachdb: ["cockroachdb"],
  tikv: ["tikv"],
  casbin: ["casbin"],
  "apache-pulsar": ["apache"],
  "apache-apisix": ["apache"],
  pulsar: ["apache"],
  apisix: ["apache"],
  gofiber: ["gofiber"],
  "gofiber-fiber": ["gofiber"],
  fiber: ["gofiber"],
  kubernetes: ["kubernetes"],
  prometheus: ["prometheus"],
  grafana: ["grafana"],
  redis: ["redis"],
  postgres: ["postgres"],
  vitess: ["vitessio"],
  etcd: ["etcd-io"],
};

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "x402-bounty-radar",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// Copied from github.ts — "$5000", "[Bounty $50]", "$50-200", "$5k".
function parseAmount(title: string, labels: string[]): number | null {
  const hay = [title, ...labels].join(" ");
  const m = hay.match(/\$\s?(\d[\d,]*)\s*(?:k\b)?/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  if (/\$\s?\d[\d,]*\s*k/i.test(hay)) n *= 1000;
  return Number.isFinite(n) ? n : null;
}

// Lightweight copy of github.ts detectScam (not exported there).
function detectScam(repo: string, issueNumber: number, title: string): string[] {
  const reasons: string[] = [];
  const [owner, name] = repo.split("/");
  const key = (name || "").toLowerCase();
  const allowed = FAMOUS[key];
  if (allowed && !allowed.includes((owner || "").toLowerCase())) {
    reasons.push(`repo named "${name}" but owner "${owner}" is not the canonical org`);
  }
  if (issueNumber <= 3 && /^(\s*🎯|\s*\[Bug\]|\s*Fix\s)/i.test(title)) {
    reasons.push("low issue number + generic 'Fix …' bait title");
  }
  if (/^\s*🎯/.test(title)) reasons.push("🎯 bait-style title");
  return reasons;
}

interface GhIssue {
  title: string;
  html_url: string;
  number: number;
  comments: number;
  created_at: string;
  repository_url: string;
  labels: Array<{ name: string }>;
  reactions?: { total_count?: number };
}

async function searchIssues(q: string, perPage: number): Promise<GhIssue[]> {
  const url = `${GH}/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=${perPage}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) {
    if (res.status === 403) throw new Error("GitHub rate limit hit — set GITHUB_TOKEN");
    throw new Error(`GitHub search failed: ${res.status}`);
  }
  const data = (await res.json()) as { items?: GhIssue[] };
  return data.items ?? [];
}

// issue queries -> provenance note -> whether hits count as escrow-backed
// (topic: is a repository qualifier — dead on /search/issues — so tagged
// repos come from /search/repositories below instead of issue queries)
const ISSUE_QUERIES: Array<{ q: string; note: string; escrowed: boolean }> = [
  { q: '"algora.io/bounties" in:body state:open type:issue', note: "escrow-link:algora", escrowed: true },
  { q: '"polar.sh" in:body state:open type:issue', note: "escrow-link:polar", escrowed: true },
];

const TOPIC_QUERIES: Array<{ topic: string; note: string }> = [
  { topic: "bug-bounty", note: "topic:bug-bounty" },
  { topic: "bounty", note: "topic:bounty" },
];

interface GhRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  topics?: string[];
  pushed_at?: string;
}

async function searchRepos(q: string, perPage: number): Promise<GhRepo[]> {
  const url = `${GH}/search/repositories?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=${perPage}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) {
    if (res.status === 403) throw new Error("GitHub rate limit hit — set GITHUB_TOKEN");
    throw new Error(`GitHub repo search failed: ${res.status}`);
  }
  const data = (await res.json()) as { items?: GhRepo[] };
  return data.items ?? [];
}

function repoToDraft(r: GhRepo, note: string): BountyDraft {
  return {
    repo: r.full_name,
    number: null, // program-level: the repo advertises a bounty program
    title: r.description ?? `${r.full_name} (bug-bounty tagged repo)`,
    url: r.html_url,
    createdAt: r.pushed_at ?? null,
    comments: 0,
    labels: r.topics ?? [],
    amountUsd: null,
    maxReward: null,
    source: "github-extras",
    escrowed: false,
    deadline: null,
    severity: null,
    signals: { sourceNotes: [note] },
  };
}

function toDraft(it: GhIssue, note: string, escrowed: boolean): BountyDraft {
  const repo = it.repository_url.split("/").slice(-2).join("/");
  const labelNames = (it.labels ?? []).map((l) => l.name);
  const scamReasons = detectScam(repo, it.number, it.title);
  return {
    repo,
    number: it.number,
    title: it.title,
    url: it.html_url,
    createdAt: it.created_at,
    comments: it.comments,
    labels: labelNames,
    amountUsd: parseAmount(it.title, labelNames),
    maxReward: null,
    source: "github-extras",
    escrowed,
    deadline: null,
    severity: null,
    signals: { reactions: it.reactions?.total_count ?? 0, sourceNotes: [note] },
    ...(escrowed ? { fundingHint: "escrowed" as const } : {}),
    trust: scamReasons.length ? "suspect_scam" : "likely_real",
    scamReasons,
  };
}

export const githubExtras: SourceAdapter = {
  name: "github-extras",
  mode: "live",
  describe: () => ({
    url: "https://api.github.com/search/issues",
    note: "escrow links (algora, polar) + topic:bug-bounty/bounty repos; label search stays in the github adapter; SECURITY.md and Sponsors-for-issues aren't publicly enumerable without auth — documented, not fetched",
  }),
  async fetch(ctx: FetchContext): Promise<BountyDraft[]> {
    const perPage = 40;
    const byUrl = new Map<string, BountyDraft>();

    // Ecosystem queries are watchlist-scoped: extras contribute only drafts
    // inside watchlist repos (plus their per-query repo: filters below).
    const wl = ctx.ecosystem ? watchlistRepos(ctx.ecosystem) : undefined;
    const inWatchlist = (repo: string) => !wl || wl.some((r) => r.toLowerCase() === repo.toLowerCase());
    const repoScope = wl ? wl.map((r) => `repo:${r}`).join(" ") : "";

    for (const { q, note, escrowed } of ISSUE_QUERIES) {
      let items: GhIssue[] = [];
      try {
        items = await searchIssues(repoScope ? `${q} ${repoScope}` : q, perPage);
      } catch (e) {
        // One dead query costs its results only — return what succeeded.
        console.error(`[github-extras] query failed (${note}): ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      for (const it of items) {
        const repo = it.repository_url.split("/").slice(-2).join("/");
        if (!inWatchlist(repo)) continue;
        const existing = byUrl.get(it.html_url);
        if (existing) {
          // Same issue matched another query — union provenance, upgrade escrow.
          const notes = new Set([...(existing.signals?.sourceNotes ?? []), note]);
          existing.signals = { ...existing.signals, sourceNotes: [...notes] };
          if (escrowed && !existing.escrowed) {
            existing.escrowed = true;
            existing.fundingHint = "escrowed";
          }
          continue;
        }
        byUrl.set(it.html_url, toDraft(it, note, escrowed));
      }
    }

    for (const { topic, note } of TOPIC_QUERIES) {
      try {
        for (const r of await searchRepos(`topic:${topic} sort:updated-desc`, perPage)) {
          if (!byUrl.has(r.html_url) && inWatchlist(r.full_name)) byUrl.set(r.html_url, repoToDraft(r, note));
        }
      } catch (e) {
        console.error(`[github-extras] repo query failed (${note}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return [...byUrl.values()];
  },
};
