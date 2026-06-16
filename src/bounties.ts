// Bounty aggregation + scam-farm filtering + competition scoring.
// Data source: GitHub issue search. No KYC, no third-party paid API.

export interface Bounty {
  repo: string;
  number: number;
  title: string;
  url: string;
  createdAt: string;
  ageDays: number;
  comments: number;
  labels: string[];
  amountUsd: number | null; // parsed best-effort
  competition: "low" | "medium" | "high";
  trust: "likely_real" | "suspect_scam";
  scamReasons: string[];
}

export interface Query {
  language?: string;
  minAmount?: number;
  maxAgeDays?: number;
  includeSuspect?: boolean;
  limit?: number;
}

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

const GH = "https://api.github.com";

// In-isolate cache of raw GitHub search results, keyed by language. Cloudflare
// Workers isolates persist briefly across requests, so a short TTL sharply cuts
// GitHub calls under burst traffic (critical: unauthenticated search is ~10/min).
const RAW_TTL_MS = 60_000;
const rawCache = new Map<string, { at: number; items: GhIssue[] }>();
let cacheHits = 0;
let cacheMisses = 0;

export function cacheStats() {
  return { hits: cacheHits, misses: cacheMisses, keys: rawCache.size, ttlMs: RAW_TTL_MS };
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

// Best-effort dollar amount from title or labels: "$5000", "[Bounty $50]", "$50-200".
function parseAmount(title: string, labels: string[]): number | null {
  const hay = [title, ...labels].join(" ");
  const m = hay.match(/\$\s?(\d[\d,]*)\s*(?:k\b)?/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  if (/\$\s?\d[\d,]*\s*k/i.test(hay)) n *= 1000;
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

function scoreCompetition(comments: number): Bounty["competition"] {
  if (comments >= 8) return "high";
  if (comments >= 3) return "medium";
  return "low";
}

interface GhIssue {
  title: string;
  html_url: string;
  number: number;
  comments: number;
  created_at: string;
  repository_url: string;
  labels: Array<{ name: string }>;
}

async function searchLabel(label: string, language: string | undefined, perPage: number): Promise<GhIssue[]> {
  const parts = [`label:"${label}"`, "state:open"];
  if (language) parts.push(`language:${language}`);
  const q = encodeURIComponent(parts.join(" "));
  const url = `${GH}/search/issues?q=${q}&sort=created&order=desc&per_page=${perPage}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) {
    if (res.status === 403) throw new Error("GitHub rate limit hit — set GITHUB_TOKEN");
    throw new Error(`GitHub search failed: ${res.status}`);
  }
  const data = (await res.json()) as { items?: GhIssue[] };
  return data.items ?? [];
}

export async function getBounties(query: Query): Promise<Bounty[]> {
  const limit = Math.min(query.limit ?? 25, 50);
  const perPage = 40;
  // Cast a wide net across the labels real maintainers actually use.
  const labels = ["💎 Bounty", "bounty", "💰 bounty"];
  const lang = query.language;

  const cacheKey = lang ?? "*";
  const cached = rawCache.get(cacheKey);
  let raw: GhIssue[];
  if (cached && Date.now() - cached.at < RAW_TTL_MS) {
    cacheHits++;
    raw = cached.items;
  } else {
    cacheMisses++;
    raw = [];
    const seen = new Set<string>();
    for (const lbl of labels) {
      let items: GhIssue[] = [];
      try {
        items = await searchLabel(lbl, lang, perPage);
      } catch (e) {
        if (raw.length === 0 && lbl === labels[labels.length - 1]) throw e;
      }
      for (const it of items) {
        if (!seen.has(it.html_url)) {
          seen.add(it.html_url);
          raw.push(it);
        }
      }
    }
    rawCache.set(cacheKey, { at: Date.now(), items: raw });
  }

  const now = Date.now();
  const out: Bounty[] = raw.map((it) => {
    const repo = it.repository_url.split("/").slice(-2).join("/");
    const labelNames = (it.labels ?? []).map((l) => l.name);
    const scamReasons = detectScam(repo, it.number, it.title);
    const ageDays = Math.round((now - new Date(it.created_at).getTime()) / 86400000);
    return {
      repo,
      number: it.number,
      title: it.title,
      url: it.html_url,
      createdAt: it.created_at,
      ageDays,
      comments: it.comments,
      labels: labelNames,
      amountUsd: parseAmount(it.title, labelNames),
      competition: scoreCompetition(it.comments),
      trust: scamReasons.length ? "suspect_scam" : "likely_real",
      scamReasons,
    };
  });

  let filtered = out;
  if (!query.includeSuspect) filtered = filtered.filter((b) => b.trust === "likely_real");
  if (query.minAmount != null) filtered = filtered.filter((b) => (b.amountUsd ?? 0) >= query.minAmount!);
  if (query.maxAgeDays != null) filtered = filtered.filter((b) => b.ageDays <= query.maxAgeDays!);

  // Rank: lower competition first, then higher amount, then fresher.
  const compRank = { low: 0, medium: 1, high: 2 } as const;
  filtered.sort(
    (a, b) =>
      compRank[a.competition] - compRank[b.competition] ||
      (b.amountUsd ?? 0) - (a.amountUsd ?? 0) ||
      a.ageDays - b.ageDays,
  );

  return filtered.slice(0, limit);
}
