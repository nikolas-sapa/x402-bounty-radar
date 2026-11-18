// Bounty pipeline orchestrator: runs every source adapter, dedupes, enriches,
// filters, scores, and ranks. Data sources live in src/sources/ — GitHub issue
// search plus external platforms. No KYC, no third-party paid API.

import type { Bounty, Query, SourceAdapter } from "./types.js";
import { fetchAllSources, dedupeAndFlag, sourceHealth, cacheStats, registerSources, type SourceHealth } from "./sources/registry.js";
import { bountyFromDraft } from "./scoring.js";
import { github, enrichLinkedPrs, repoBountyHistory, ecosystemNames } from "./sources/github.js";

// Every adapter registers here. External adapters are added by expansion;
// each one: failure => stderr + [], never crashes the response.
import { immunefi } from "./sources/immunefi.js";
import { hackerone } from "./sources/hackerone.js";
import { code4rena } from "./sources/code4rena.js";
import { sherlock } from "./sources/sherlock.js";
import { cantina } from "./sources/cantina.js";
import { bugcrowd } from "./sources/bugcrowd.js";
import { githubExtras } from "./sources/github-extras.js";

export const ADAPTERS: SourceAdapter[] = [
  github,
  githubExtras,
  immunefi,
  hackerone,
  code4rena,
  sherlock,
  cantina,
  bugcrowd,
];

// /sources lists all of them from startup — pending until first fetch.
registerSources(ADAPTERS);

export { cacheStats, ecosystemNames };
export type { Query, Bounty, SourceHealth };
export { sourceHealth };

function dedup<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// Ecosystem filter is GitHub-watchlist-driven (data/watchlists.json): an
// ecosystem means a set of repos, and only the GitHub source can see issues.
// External platforms have no ecosystem concept, so they're skipped — documented
// semantic, keeps the field honest rather than empty-but-implied.

export async function getBounties(query: Query, adapters: SourceAdapter[] = ADAPTERS): Promise<Bounty[]> {
  const limit = Math.min(query.limit ?? 25, 50);
  const minReward = query.minReward ?? query.minAmount;

  let list = adapters;
  if (query.source) {
    const wanted = new Set(query.source.split(",").map((s) => s.trim().toLowerCase()));
    list = list.filter((a) => wanted.has(a.name));
  }
  if (query.ecosystem) list = list.filter((a) => a.name === "github" || a.name === "github-extras");

  const drafts = dedupeAndFlag(
    await fetchAllSources(list, { ecosystem: query.ecosystem, language: query.language }),
  );

  // Pre-score filters (cheap, no score needed).
  let kept = drafts;
  if (!query.includeSuspect) kept = kept.filter((d) => (d.trust ?? "likely_real") === "likely_real");
  if (minReward != null) kept = kept.filter((d) => (d.amountUsd ?? d.maxReward ?? 0) >= minReward);
  if (query.maxAgeDays != null) {
    // Unknown-age entries (programs without a published date) survive: a
    // freshness cap on ageDays shouldn't drop listings with no date to compare.
    kept = kept.filter((d) => {
      const age = d.createdAt ? (Date.now() - new Date(d.createdAt).getTime()) / 86400000 : null;
      return age === null || age <= query.maxAgeDays!;
    });
  }
  if (query.language) {
    const want = query.language.toLowerCase();
    // GitHub language filtering happens inside its search query; other sources
    // filter on the language the adapter declared.
    kept = kept.filter((d) => d.source === "github" || (d.language ?? "").toLowerCase() === want || !d.language);
  }

  // Enrichment pass — bounded external calls on the surviving drafts only:
  //  - linked PR counts for GitHub issues (timeline API, needs GITHUB_TOKEN)
  //  - repo bounty-payout history => funding "verified-history"
  await enrichLinkedPrs(kept, 15);
  const repos = dedup(kept.filter((d) => d.source === "github" || d.source === "github-extras").map((d) => d.repo)).slice(0, 10);
  const history = new Map<string, boolean>();
  if (process.env.GITHUB_TOKEN) {
    await Promise.all(repos.map(async (r) => history.set(r, await repoBountyHistory(r))));
  }

  const out = kept.map((d) => bountyFromDraft(d, history.get(d.repo) ?? false));

  // Score-dependent filter.
  let filtered = out;
  if (query.maxCompetition != null) filtered = filtered.filter((b) => b.competitionScore <= query.maxCompetition!);

  // Rank by competition-adjusted value: reward discounted by how contested the
  // bounty already is; unknown amounts rank by freshness at the bottom.
  filtered.sort(
    (a, b) =>
      (b.amountUsd ?? b.maxReward ?? 0) * (1 - b.competitionScore / 100) -
        (a.amountUsd ?? a.maxReward ?? 0) * (1 - a.competitionScore / 100) ||
      (a.ageDays ?? 1e9) - (b.ageDays ?? 1e9),
  );

  return filtered.slice(0, limit);
}
