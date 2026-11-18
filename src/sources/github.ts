// GitHub issue-search adapter — the v1 data path, now one source among many.
// Extra v2 signals carried in drafts: reactions.total_count (search returns it
// free), linkedPrs via the issue timeline API (token-gated — 1 call per issue,
// only worth it for the final result slice), and repo bounty-payout history.

import type { BountyDraft, FetchContext, SourceAdapter } from "../types.js";
import watchlists from "../../data/watchlists.json" with { type: "json" };

const GH = "https://api.github.com";

// Canonical owners for famous project names. A repo named like one of these
// but owned by a random account is the classic AI-bait clone pattern.
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

interface Watchlist {
  description: string;
  repos: string[];
}
const WATCHLISTS = watchlists as Record<string, Watchlist>;

export function ecosystemNames(): string[] {
  return Object.keys(WATCHLISTS);
}

export function watchlistRepos(name: string): string[] | undefined {
  return WATCHLISTS[name]?.repos;
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "x402-bounty-radar",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// Best-effort dollar amount from title or labels: "$5000", "[Bounty $50]",
// "$50-200", "$5k", "$1.5k". The k-multiplier binds to the matched amount
// only — "$200 (pool was $5k)" is $200, not $200k.
function parseAmount(title: string, labels: string[]): number | null {
  const hay = [title, ...labels].join(" ");
  const m = hay.match(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) ? n : null;
}

function detectScam(repo: string, issueNumber: number, title: string): string[] {
  const reasons: string[] = [];
  const [owner, name] = repo.split("/");
  const key = (name || "").toLowerCase();
  const allowed = FAMOUS[key];
  if (allowed && !allowed.includes((owner || "").toLowerCase())) {
    reasons.push(`repo named "${name}" but owner "${owner}" is not the canonical org`);
  }
  // Fresh throwaway repos: issue #1-ish with generic AI-bait titles.
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
  const res = await fetch(url, { headers: ghHeaders(), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    if (res.status === 403) throw new Error("GitHub rate limit hit — set GITHUB_TOKEN");
    throw new Error(`GitHub search failed: ${res.status}`);
  }
  const data = (await res.json()) as { items?: GhIssue[] };
  return data.items ?? [];
}

function toDraft(it: GhIssue): BountyDraft {
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
    source: "github",
    escrowed: false,
    deadline: null,
    severity: null,
    signals: { reactions: it.reactions?.total_count ?? 0 },
    trust: scamReasons.length ? "suspect_scam" : "likely_real",
    scamReasons,
  };
}

export const github: SourceAdapter = {
  name: "github",
  mode: "live",
  describe: () => ({
    url: "https://api.github.com/search/issues",
    note: "label search: 💎 Bounty / bounty / 💰 bounty; ecosystem watchlists add repo: filters",
  }),
  async fetch(ctx: FetchContext): Promise<BountyDraft[]> {
    const perPage = 40;
    // Cast a wide net across the labels real maintainers actually use.
    const labels = ["💎 Bounty", "bounty", "💰 bounty"];
    const seen = new Set<string>();
    const raw: GhIssue[] = [];

    const wl = ctx.ecosystem ? WATCHLISTS[ctx.ecosystem] : undefined;
    if (ctx.ecosystem && !wl) throw new Error(`unknown ecosystem "${ctx.ecosystem}" (have: ${ecosystemNames().join(", ")})`);
    const langFilter = ctx.language ? ` language:${ctx.language}` : "";

    if (wl) {
      // Ecosystem view: bounty issues inside watchlist repos only.
      // Multiple repo: terms are OR'd (~5 safe per query) — chunk, and reuse
      // the same per-label pattern as the main path plus a title catch-all.
      // A renamed/deleted watchlist repo 422s its query; one bad chunk must
      // not zero the whole adapter.
      const qParts = [...labels.map((l) => `label:"${l}"`), "bounty in:title"];
      for (let i = 0; i < wl.repos.length; i += 5) {
        const repos = wl.repos.slice(i, i + 5).map((r) => `repo:${r}`).join(" ");
        for (const part of qParts) {
          try {
            const items = await searchIssues(`${part} state:open type:issue ${repos}${langFilter}`, perPage);
            for (const it of items) {
              if (!seen.has(it.html_url)) {
                seen.add(it.html_url);
                raw.push(it);
              }
            }
          } catch (e) {
            console.error(`[github] watchlist query failed (${part}, ${repos}): ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
    } else {
      for (const lbl of labels) {
        let items: GhIssue[] = [];
        try {
          items = await searchIssues(`label:"${lbl}" state:open type:issue${langFilter}`, perPage);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[github] label query failed (${lbl}): ${msg}`);
          // One dead label query shouldn't zero the whole source.
          if (raw.length === 0 && lbl === labels[labels.length - 1]) throw e;
        }
        for (const it of items) {
          if (!seen.has(it.html_url)) {
            seen.add(it.html_url);
            raw.push(it);
          }
        }
      }
    }
    return raw.map(toDraft);
  },
};

// --- Post-slice enrichment (token-gated; called by the orchestrator) --------

interface TimelineEvent {
  event?: string;
  source?: { issue?: { pull_request?: unknown } };
  pull_request?: unknown;
}

// Counts PRs cross-referenced on an issue's timeline — the strongest
// "someone already attempted this" signal. Only run when GITHUB_TOKEN is set:
// it's 1 request/issue and unauthenticated rate is ~60/hr.
export async function enrichLinkedPrs(drafts: BountyDraft[], maxIssues = 15): Promise<void> {
  if (!process.env.GITHUB_TOKEN) return;
  const issues = drafts
    .filter((d) => (d.source === "github" || d.source === "github-extras") && d.number !== null)
    .slice(0, maxIssues);
  await Promise.all(
    issues.map(async (d) => {
      try {
        const res = await fetch(`${GH}/repos/${d.repo}/issues/${d.number}/timeline?per_page=100`, {
          headers: { ...ghHeaders(), Accept: "application/vnd.github.mockingbird-preview+json" },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return;
        const events = (await res.json()) as TimelineEvent[];
        const prs = events.filter((e) => (e.event === "cross-referenced" || e.event === "referenced") && (e.source?.issue?.pull_request || e.pull_request));
        if (prs.length) d.signals = { ...d.signals, linkedPrs: prs.length };
      } catch {
        // per-issue failure is fine — linkedPrs stays 0
      }
    }),
  );
}

// Has this repo actually paid bounties before? Proxy: closed issues with
// "bounty" in the title. One search per repo, cached 10 min, token-gated.
const historyCache = new Map<string, { at: number; paid: boolean }>();
const HISTORY_TTL_MS = 600_000;

export async function repoBountyHistory(repo: string): Promise<boolean> {
  const hit = historyCache.get(repo);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.paid;
  try {
    // total_count is the real signal — closed issues titled "bounty" = paid before.
    const res = await fetch(
      `${GH}/search/issues?q=${encodeURIComponent(`repo:${repo} state:closed type:issue bounty in:title`)}&per_page=1`,
      { headers: ghHeaders(), signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { total_count?: number };
    const paid = (data.total_count ?? 0) > 0;
    historyCache.set(repo, { at: Date.now(), paid });
    return paid;
  } catch {
    return false; // fail-open: leave funding at "claimed"
  }
}
