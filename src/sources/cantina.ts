// Cantina adapter — competitions + bug bounties on one platform. No public
// JSON API (probed /api/public/* -> 404); the /opportunities/competitions page
// embeds a React Query infiniteQuery cache in its RSC stream.
//
// Verified 2026-11-18: GET https://cantina.xyz/opportunities/competitions
// (/competitions redirects here). The RSC payload holds queries like
//   ["infiniteQuery","opportunities.listOpportunities",
//    {query:{limit:10, kind:["public_contest","private_contest",
//           "public_bounty","private_bounty"], status:"live"}}]
// whose state.data.pages[].items[] are the program objects:
//   { id, name, url: "https://cantina.xyz/bounties/<uuid>" | ".../competitions/<uuid>",
//     company: { name, handle, website, github, twitter },
//     timeframe: { start: "2024-11-26T14:00:00Z", end: null },
//     status: "live" | "judging" | ..., currencyCode: "USDC" | "USDC + rEUL",
//     totalRewardPot: "15500000", submissionFee: "50.00",
//     kind: "public_bounty" | "public_contest" | "private_*",
//     assetGroups: [{ rewards: [{ severity: "critical",
//                    minReward: null, maxReward: "15500000.00" }, ...] }] | null }
//
// Quirks:
//  - Items are NESTED inside the query-state object — extractRscObjects yields
//    the outer state object, so we walk it recursively (same walker as
//    code4rena). The same item can appear in multiple cached queries: dedupe
//    by url.
//  - The server's own status:"live" query returns items whose item.status is
//    "judging" — the platform counts in-judging competitions as live
//    opportunities. We include live/upcoming/judging and skip anything else.
//  - Money fields are STRINGS: totalRewardPot "15500000", maxReward
//    "15500000.00" — Number() them. assetGroups can be null (then maxReward
//    falls back to null; totalRewardPot still gives amountUsd).
//  - private_* kinds are only returned to authenticated clients; guarded anyway.
//  - Program URLs come embedded as absolute links (verified 200 for both
//    /bounties/<uuid> and /competitions/<uuid>).

import type { BountyDraft, FetchContext, SourceAdapter } from "../types.js";
import { fetchText } from "./http.js";
import { extractRscObjects } from "./rsc.js";

const PAGE = "https://cantina.xyz/opportunities/competitions";

const LIVE_STATUSES = new Set(["live", "upcoming", "judging"]);

interface CantinaItem {
  name: string | null;
  url: string;
  status: string;
  kind: string | null;
  currencyCode: string | null;
  totalRewardPot: string | null;
  company: { name?: string | null } | null;
  timeframe: { start: string | null; end: string | null } | null;
  assetGroups: Array<{ rewards?: Array<{ maxReward?: string | null }> | null }> | null;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function maxPayout(item: CantinaItem): number | null {
  let best: number | null = null;
  for (const g of item.assetGroups ?? []) {
    for (const r of g?.rewards ?? []) {
      const n = num(r?.maxReward);
      if (n !== null && (best === null || n > best)) best = n;
    }
  }
  return best;
}

// Program objects sit inside the React Query state objects that
// extractRscObjects returns — recursive walk + dedupe by url.
function collectItems(html: string): CantinaItem[] {
  const out = new Map<string, CantinaItem>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if ("totalRewardPot" in o && "timeframe" in o && typeof o.url === "string") {
        out.set(o.url, o as unknown as CantinaItem);
      }
      for (const x of Object.values(o)) walk(x);
    }
  };
  for (const obj of extractRscObjects(html, "totalRewardPot")) walk(obj);
  return [...out.values()];
}

function toDraft(item: CantinaItem): BountyDraft {
  return {
    repo: item.company?.name || item.name || "unknown",
    number: null,
    title: `${item.name ?? item.company?.name ?? "Program"} — Cantina bounty`,
    url: item.url,
    createdAt: item.timeframe?.start ?? null,
    comments: 0,
    labels: ["cantina"],
    amountUsd: num(item.totalRewardPot),
    maxReward: maxPayout(item),
    source: "cantina",
    escrowed: true,
    deadline: item.timeframe?.end ?? null,
    severity: null,
    language: null,
    signals: {
      sourceNotes: [
        `status:${item.status}`,
        item.currencyCode && item.currencyCode !== "USDC" ? `currency:${item.currencyCode}` : "",
      ].filter(Boolean),
    },
    fundingHint: "escrowed",
  };
}

export const cantina: SourceAdapter = {
  name: "cantina",
  mode: "live",
  describe: () => ({
    url: PAGE,
    note: "no public JSON API; program objects extracted from the RSC-embedded React Query cache (bounties + competitions)",
  }),
  async fetch(_ctx: FetchContext): Promise<BountyDraft[]> {
    try {
      const html = await fetchText(PAGE);
      return collectItems(html)
        .filter((i) => LIVE_STATUSES.has(i.status))
        .filter((i) => !i.kind || i.kind.startsWith("public_"))
        .map(toDraft);
    } catch (e) {
      console.error(`[cantina] ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  },
};
