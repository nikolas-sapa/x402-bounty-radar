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
      const key = `${adapter.name}:${ctx.ecosystem ?? "*"}`;
      const hit = cache.get(key);
      if (!bustCache && hit && Date.now() - hit.at < TTL_MS) {
        cacheHits++;
        return hit.items;
      }
      cacheMisses++;
      try {
        const items = await adapter.fetch(ctx);
        record(adapter, true, items.length, null);
        cache.set(key, { at: Date.now(), items });
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

const STOP = new Set(["the", "a", "an", "of", "for", "and", "in", "on", "to", "bug", "bounty", "program", "fix", "issue"]);

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
// Same project when: identical repo, matching repo-name tokens, or a
// program-level name matching the other side's org owner ("Uniswap" the
// Immunefi program covers github.com/Uniswap/* repos).
function sameProject(a: BountyDraft, b: BountyDraft): boolean {
  if (norm(a.repo) === norm(b.repo)) return true;
  const A = repoParts(a);
  const B = repoParts(b);
  const ta = tokens(A.name);
  const tb = tokens(B.name);
  for (const t of ta) if (tb.has(t)) return true; // shared repo/project name token
  if (A.owner && norm(A.owner) === norm(B.name)) return true; // org program covers repo
  if (B.owner && norm(B.owner) === norm(A.name)) return true;
  return false;
}

function titleSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

// Same underlying bounty = same URL, or same project + strongly similar title.
function sameBounty(a: BountyDraft, b: BountyDraft): boolean {
  if (a.url.toLowerCase() === b.url.toLowerCase()) return true;
  if (!sameProject(a, b)) return false;
  return titleSimilarity(a.title, b.title) >= 0.5;
}

// Prefer the richer record when merging: more fields filled wins.
function richer(a: BountyDraft, b: BountyDraft): BountyDraft {
  const score = (d: BountyDraft) =>
    (d.amountUsd !== null ? 4 : 0) +
    (d.maxReward !== null ? 3 : 0) +
    (d.deadline ? 2 : 0) +
    (d.number !== null ? 1 : 0) +
    Math.min(d.comments, 2);
  return score(a) >= score(b) ? a : b;
}

// Merges true duplicates, then flags crossListed on every draft whose project
// shows up under >1 distinct source name.
export function dedupeAndFlag(drafts: BountyDraft[]): BountyDraft[] {
  const merged: BountyDraft[] = [];
  const mergedFrom = new Map<BountyDraft, Set<string>>();
  for (const d of drafts) {
    const idx = merged.findIndex((m) => sameBounty(m, d));
    if (idx === -1) {
      merged.push(d);
      mergedFrom.set(d, new Set([d.source]));
    } else {
      const keep = richer(merged[idx], d);
      const others = merged[idx] === keep ? d : merged[idx];
      // union the provenance; fold the loser's notes into the keeper
      const srcs = mergedFrom.get(merged[idx]) ?? new Set([merged[idx].source]);
      for (const s of mergedFrom.get(d) ?? [d.source]) srcs.add(s);
      const combinedNotes = [...(keep.signals?.sourceNotes ?? []), ...(others.signals?.sourceNotes ?? [])];
      keep.signals = { ...keep.signals, sourceNotes: [...new Set(combinedNotes)] };
      merged[idx] = keep;
      mergedFrom.delete(merged[idx]);
      mergedFrom.set(keep, srcs);
    }
  }
  // Cross-listed: same project (repo token overlap) reachable via >1 source.
  for (let i = 0; i < merged.length; i++) {
    const srcs = mergedFrom.get(merged[i]) ?? new Set([merged[i].source]);
    if (srcs.size > 1) continue; // already merged from multiple
    for (let j = 0; j < merged.length; j++) {
      if (i === j) continue;
      const otherSrcs = mergedFrom.get(merged[j]) ?? new Set([merged[j].source]);
      if ([...otherSrcs].some((s) => !srcs.has(s)) && sameProject(merged[i], merged[j])) {
        for (const s of otherSrcs) srcs.add(s);
      }
    }
    mergedFrom.set(merged[i], srcs);
  }
  return merged.map((d) => ({ ...d, crossListed: (mergedFrom.get(d)?.size ?? 1) > 1 }));
}
