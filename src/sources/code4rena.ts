// Code4rena audit-contest adapter — no public JSON API; the /audits page IS
// the API. Next.js App-Router page streams contest objects in its RSC payload.
//
// Verified 2026-11-18: GET https://code4rena.com/audits (old /contests redirects
// here). Contest objects appear as top-level `id:{...}` RSC rows, extractable
// via extractRscObjects(html, "contestId"). Shape:
//   { contestId: 554, title: "Monetrix", slug: "2026-04-monetrix",
//     status: "Completed", auditType: "Audit", schema: "live_judging",
//     startTime: "2026-04-24T20:00:00.000Z", endTime: "2026-05-04T20:00:00.000Z",
//     formattedAmount: "$$22,000 in USDC", league: "Hyperliquid",
//     repo: "https://github.com/code-423n4/2026-04-monetrix", org: "$1a", ... }
//
// Quirks:
//  - No numeric prize field: parse `formattedAmount` ("$$22,000 in USDC",
//    "$$6,000 in USDC (all rounds)") — first digit group after the $ signs.
//  - `status` uses the site's display enum: "Active", "Upcoming",
//    "Submissions closed", "Live Judging" are non-terminal (escrow still held /
//    paying out); "Completed" / "Lost Deal" are dead. The page itself buckets
//    contests into audits:{Active,Upcoming,"Submissions closed",Completed}.
//  - `org` is an unresolved RSC "$ref" string, not data — `title` is the
//    project name. `{"contestId":"$xx"}` placeholder objects also parse, so we
//    require a numeric contestId + string slug.
//  - Contest page: https://code4rena.com/audits/<slug> (verified 200).

import type { BountyDraft, FetchContext, SourceAdapter } from "../types.js";
import { fetchText } from "./http.js";
import { extractRscObjects } from "./rsc.js";

const PAGE = "https://code4rena.com/audits";

// Non-terminal statuses = escrow still held / prize still being awarded.
// Anything else (Completed, Lost Deal, unknown future values) is skipped.
const LIVE_STATUSES = new Set(["Active", "Upcoming", "Submissions closed", "Live Judging"]);

interface C4AContest {
  contestId: number;
  title: string;
  slug: string;
  status: string;
  auditType: string | null;
  startTime: string | null;
  endTime: string | null;
  formattedAmount: string | null;
  league: string | null;
}

// "$$22,000 in USDC" / "$$6,000 in USDC (all rounds)" -> 22000 / 6000.
function parseAmount(formatted: string | null): number | null {
  const m = formatted?.match(/\$+\s*([\d,]+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Contest objects are top-level RSC rows today, but also walk parsed objects
// recursively — if Next starts nesting them (e.g. inside the audits{} bucket
// object) we still find them. Dedupes by contestId.
function collectContests(html: string): C4AContest[] {
  const out = new Map<number, C4AContest>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.contestId === "number" && typeof o.slug === "string") {
        out.set(o.contestId, o as unknown as C4AContest);
      }
      for (const x of Object.values(o)) walk(x);
    }
  };
  for (const obj of extractRscObjects(html, "contestId")) walk(obj);
  return [...out.values()];
}

function toDraft(c: C4AContest): BountyDraft {
  const amount = parseAmount(c.formattedAmount);
  const notes = [`status:${c.status}`];
  if (c.league) notes.push(`league:${c.league}`);
  if (c.auditType && c.auditType !== "Audit") notes.push(`type:${c.auditType}`);
  return {
    repo: c.title,
    number: c.contestId,
    title: `${c.title} — Code4rena ${c.auditType || "audit"}`,
    url: `${PAGE}/${c.slug}`,
    createdAt: c.startTime,
    comments: 0,
    labels: c.auditType ? [c.auditType] : [],
    amountUsd: amount,
    maxReward: amount,
    source: "code4rena",
    escrowed: true,
    deadline: c.endTime,
    severity: null,
    language: null,
    signals: { sourceNotes: notes },
    fundingHint: "escrowed",
  };
}

export const code4rena: SourceAdapter = {
  name: "code4rena",
  mode: "live",
  describe: () => ({
    url: PAGE,
    note: "no public JSON API; contest objects extracted from the /audits RSC stream (status, slug, formattedAmount)",
  }),
  async fetch(_ctx: FetchContext): Promise<BountyDraft[]> {
    try {
      const html = await fetchText(PAGE);
      return collectContests(html)
        .filter((c) => LIVE_STATUSES.has(c.status))
        .map(toDraft);
    } catch (e) {
      console.error(`[code4rena] ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  },
};
