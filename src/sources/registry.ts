// Source registry: runs adapters, caches their output (same TTL pattern as the
// v1 raw GitHub cache), tracks per-source health for GET /sources, and
// dedupes/flags cross-listed bounties.

import type { BountyDraft, FetchContext, SourceAdapter } from "../types.js";

const TTL_MS = 60_000;

export interface SourceHealth {
  name: string;
  mode: "live" | "manual-only";
  url: string;
  note: string;
  status: "ok" | "down" | "pending"; // pending = registered, not yet fetched
  ok: boolean; // last fetch succeeded
  count: number; // drafts returned by the last fetch
  lastOk: string | null; // ISO of last successful fetch
  lastError: string | null;
}

interface CacheEntry {
  at: number;
  items: BountyDraft[];
}

const health = new Map<string, SourceHealth>();
const cache = new Map<string, CacheEntry>();
let cacheHits = 0;
let cacheMisses = 0;

export function cacheStats() {
  return { hits: cacheHits, misses: cacheMisses, keys: cache.size, ttlMs: TTL_MS };
}

export function sourceHealth(): SourceHealth[] {
  return [...health.values()];
}

// Every adapter is visible from startup — a source that has never fetched
// shows "pending", one that failed shows "down". Never silently absent.
export function registerSources(adapters: SourceAdapter[]): void {
  for (const adapter of adapters) {
    if (health.has(adapter.name)) continue;
    const d = adapter.describe();
    health.set(adapter.name, {
      name: adapter.name,
      mode: adapter.mode,
      url: d.url,
      note: d.note,
      status: "pending",
      ok: false,
      count: 0,
      lastOk: null,
      lastError: null,
    });
  }
}

function record(adapter: SourceAdapter, ok: boolean, count: number, err: string | null) {
  const d = adapter.describe();
  const prev = health.get(adapter.name);
  health.set(adapter.name, {
    name: adapter.name,
    mode: adapter.mode,
    url: d.url,
    note: d.note,
    status: ok ? "ok" : "down",
    ok,
    count,
    lastOk: ok ? new Date().toISOString() : (prev?.lastOk ?? null),
    lastError: err,
  });
}

// Drafts are per-request objects: downstream merge/enrichment mutates them,
// so the cache stores clones and hands out clones — never shared references.
function cloneDraft(d: BountyDraft): BountyDraft {
  return {
    ...d,
    labels: [...d.labels],
    scamReasons: d.scamReasons ? [...d.scamReasons] : d.scamReasons,
    signals: d.signals ? { ...d.signals, sourceNotes: [...(d.signals.sourceNotes ?? [])] } : d.signals,
    meta: d.meta ? { ...d.meta } : d.meta,
  };
}

// Fetch every adapter, honoring the shared TTL cache. One adapter throwing or
// timing out costs us its drafts only — the merged response is still served
// and /sources shows it as down.
export async function fetchAllSources(
  adapters: SourceAdapter[],
  ctx: FetchContext,
  bustCache = false,
): Promise<BountyDraft[]> {
  const results = await Promise.all(
    adapters.map(async (adapter) => {
      // language/ecosystem both shape adapter output — both must key the cache.
      const key = `${adapter.name}:${ctx.ecosystem ?? "*"}:${(ctx.language ?? "*").toLowerCase()}`;
      const hit = cache.get(key);
      if (!bustCache && hit && Date.now() - hit.at < TTL_MS) {
        cacheHits++;
        return hit.items.map(cloneDraft);
      }
      cacheMisses++;
      try {
        const items = await adapter.fetch(ctx);
        record(adapter, true, items.length, null);
        cache.set(key, { at: Date.now(), items: items.map(cloneDraft) });
        return items;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Failure => stderr + empty contribution. Never crash the response.
        console.error(`[sources] ${adapter.name} failed: ${msg}`);
        record(adapter, false, 0, msg);
        return [] as BountyDraft[];
      }
    }),
  );
  return results.flat();
}

// --- Dedupe + cross-listing -----------------------------------------------

// Generic tokens carry no identity — "defi"/"sdk"/"protocol" match hundreds of
// unrelated programs, so they don't count as shared-name evidence.
const STOP = new Set([
  "the", "a", "an", "of", "for", "and", "in", "on", "to", "bug", "bounty", "program", "fix", "issue",
  "sdk", "core", "app", "api", "protocol", "protocols", "defi", "dao", "finance", "labs", "lab",
  "chain", "contract", "contracts", "swap", "token", "tokens", "network", "foundation", "web",
  "v1", "v2", "v3", "v4", "v5", "xyz", "io", "com", "org", "dev", "hq", "inc", "pay", "money",
]);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function repoParts(d: BountyDraft): { owner: string; name: string } {
  const p = d.repo.split("/");
  return p.length > 1 ? { owner: p[0], name: p.slice(1).join("/") } : { owner: "", name: d.repo };
}

// Repo identity across sources: GitHub "owner/name" vs a program name.
// Same project when: identical repo, a program-level name matching the other
// side's org owner ("Uniswap" the Immunefi program covers github.com/Uniswap/*
// repos), or >=2 shared non-generic name tokens — one word isn't evidence.
function sameProject(
  a: BountyDraft,
  b: BountyDraft,
  aTok: Set<string>,
  bTok: Set<string>,
): boolean {
  if (norm(a.repo) === norm(b.repo)) return true;
  const A = repoParts(a);
  const B = repoParts(b);
  if (A.owner && norm(A.owner) === norm(B.name)) return true; // org program covers repo
  if (B.owner && norm(B.owner) === norm(A.name)) return true;
  let shared = 0;
  for (const t of aTok) if (bTok.has(t)) shared++;
  return shared >= 2;
}

function titleSimilarity(ta: Set<string>, tb: Set<string>): number {
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

function normUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, "");
}

// Prefer the richer record for display fields when merging.
function richer(a: BountyDraft, b: BountyDraft): BountyDraft {
  const score = (d: BountyDraft) =>
    (d.amountUsd !== null ? 4 : 0) +
    (d.maxReward !== null ? 3 : 0) +
    (d.deadline ? 2 : 0) +
    (d.number !== null ? 1 : 0) +
    Math.min(d.comments, 2);
  return score(a) >= score(b) ? a : b;
}

// The winner's identity fields (title/url/repo) stay, but signal-bearing
// fields union — a merge must never drop escrow status, activity counts, or
// scam evidence that only the losing record carried.
function mergeFields(keep: BountyDraft, lose: BountyDraft): void {
  keep.escrowed = keep.escrowed || lose.escrowed;
  keep.comments = Math.max(keep.comments, lose.comments);
  keep.labels = [...new Set([...keep.labels, ...lose.labels])];
  keep.scamReasons = [...new Set([...(keep.scamReasons ?? []), ...(lose.scamReasons ?? [])])];
  if ((lose.trust ?? "likely_real") === "suspect_scam") keep.trust = "suspect_scam";
  if (keep.fundingHint !== "escrowed" && lose.fundingHint) keep.fundingHint = lose.fundingHint;
  keep.deadline = keep.deadline ?? lose.deadline;
  keep.amountUsd = keep.amountUsd ?? lose.amountUsd;
  keep.maxReward = keep.maxReward ?? lose.maxReward;
  keep.severity = keep.severity ?? lose.severity;
  keep.createdAt = keep.createdAt ?? lose.createdAt;
  keep.number = keep.number ?? lose.number;
  keep.signals = {
    ...keep.signals,
    linkedPrs: Math.max(keep.signals?.linkedPrs ?? 0, lose.signals?.linkedPrs ?? 0),
    reactions: Math.max(keep.signals?.reactions ?? 0, lose.signals?.reactions ?? 0),
    sourceNotes: [...new Set([...(keep.signals?.sourceNotes ?? []), ...(lose.signals?.sourceNotes ?? [])])],
  };
}

// Merges true duplicates, then flags crossListed on every draft whose project
// shows up under >1 distinct source name. Malformed drafts (no usable url)
// degrade like adapter failures — dropped, never crash the response.
export function dedupeAndFlag(drafts: BountyDraft[]): BountyDraft[] {
  const valid = drafts.filter((d) => typeof d.url === "string" && d.url.length > 0);
  // Precompute token sets once — comparisons run O(n^2) over merged drafts.
  const toks = new Map<BountyDraft, { name: Set<string>; title: Set<string> }>();
  for (const d of valid) toks.set(d, { name: tokens(repoParts(d).name), title: tokens(d.title) });

  const sameBounty = (a: BountyDraft, b: BountyDraft): boolean => {
    if (normUrl(a.url) === normUrl(b.url)) return true;
    const ta = toks.get(a)!;
    const tb = toks.get(b)!;
    if (!sameProject(a, b, ta.name, tb.name)) return false;
    return titleSimilarity(ta.title, tb.title) >= 0.5;
  };

  const merged: BountyDraft[] = [];
  const mergedFrom = new Map<BountyDraft, Set<string>>();
  const urlIdx = new Map<string, number>();
  for (const d of valid) {
    const u = normUrl(d.url);
    let idx = urlIdx.get(u) ?? -1;
    if (idx === -1) idx = merged.findIndex((m) => sameBounty(m, d));
    if (idx === -1) {
      merged.push(d);
      mergedFrom.set(d, new Set([d.source]));
      urlIdx.set(u, merged.length - 1);
    } else {
      const prev = merged[idx];
      const keep = richer(prev, d);
      const lose = prev === keep ? d : prev;
      const srcs = new Set(mergedFrom.get(prev) ?? [prev.source]);
      for (const s of mergedFrom.get(d) ?? [d.source]) srcs.add(s);
      mergedFrom.delete(prev);
      mergeFields(keep, lose);
      merged[idx] = keep;
      mergedFrom.set(keep, srcs);
    }
  }
  // Cross-listed: same project reachable via >1 source.
  for (let i = 0; i < merged.length; i++) {
    const srcs = mergedFrom.get(merged[i]) ?? new Set([merged[i].source]);
    if (srcs.size > 1) continue; // already merged from multiple
    for (let j = 0; j < merged.length; j++) {
      if (i === j) continue;
      const otherSrcs = mergedFrom.get(merged[j]) ?? new Set([merged[j].source]);
      if (
        [...otherSrcs].some((s) => !srcs.has(s)) &&
        sameProject(merged[i], merged[j], toks.get(merged[i])!.name, toks.get(merged[j])!.name)
      ) {
        for (const s of otherSrcs) srcs.add(s);
      }
    }
    mergedFrom.set(merged[i], srcs);
  }
  return merged.map((d) => ({ ...d, crossListed: (mergedFrom.get(d)?.size ?? 1) > 1 }));
}
