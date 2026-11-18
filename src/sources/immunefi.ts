// Immunefi adapter — live. Verified: GET /bug-bounty/?filter=bugs returns a
// 200 Next.js page; there is no public JSON API — the program list ships
// embedded in the __next_f RSC stream as {"tab":"bounties","bounties":[...]}
// nested inside one streamed element tree (not as top-level objects, so we
// deep-walk the extracted rows for the array). ?filter=audits returns the
// same payload — the filter is applied client-side — so one page covers all.

import type { BountyDraft, FetchContext, SourceAdapter } from "../types.js";
import { fetchText } from "./http.js";
import { extractRscObjects } from "./rsc.js";

const BASE = "https://immunefi.com";
const PAGE = `${BASE}/bug-bounty/?filter=bugs`;

interface ImmTags {
  language?: string[];
  ecosystem?: string[];
  programType?: string[];
}

interface ImmBounty {
  slug?: string;
  url?: string;
  project?: string;
  launchDate?: string;
  pausedAt?: string | null;
  maxBounty?: number;
  inviteOnly?: boolean;
  isPayToSubmit?: boolean;
  tags?: ImmTags;
  performanceMetrics?: { totalPaidAmount?: number };
}

// The RSC row is a React element tree ([type, props, children] tuples) — find
// arrays whose items are program objects rather than hardcode the index path.
function collect(node: unknown, out: ImmBounty[]): void {
  if (Array.isArray(node)) {
    if (node.length > 0 && node.every((x) => x !== null && typeof x === "object" && "maxBounty" in x)) {
      out.push(...(node as ImmBounty[]));
      return;
    }
    for (const x of node) collect(x, out);
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const v of Object.values(node)) collect(v, out);
  }
}

// $727745.86 -> "$728k", $10_000_000 -> "$10M" — for the sourceNotes line.
function usdCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function toDraft(b: ImmBounty): BountyDraft | null {
  if (b.pausedAt) return null; // paused program — skip
  const project = b.project ?? b.slug;
  if (!project) return null;

  const tags = b.tags ?? {};
  const labels = [...new Set([...(tags.language ?? []), ...(tags.ecosystem ?? []), ...(tags.programType ?? [])])];
  const totalPaid = b.performanceMetrics?.totalPaidAmount ?? 0;

  const sourceNotes: string[] = [];
  if (totalPaid > 0) sourceNotes.push(`${usdCompact(totalPaid)} paid historically`);
  if (b.inviteOnly) sourceNotes.push("invite-only");

  const href = b.url ?? `/bug-bounty/${b.slug}/`;
  return {
    repo: project,
    number: null, // program-level listing
    title: `${project} — Immunefi bug bounty`,
    url: href.startsWith("http") ? href : `${BASE}${href}`,
    createdAt: b.launchDate ?? null,
    comments: 0,
    labels,
    amountUsd: b.maxBounty ?? null, // published max reward
    maxReward: b.maxBounty ?? null,
    source: "immunefi",
    escrowed: true,
    deadline: null,
    severity: null,
    language: tags.language?.[0] ?? null,
    signals: sourceNotes.length ? { sourceNotes } : undefined,
    fundingHint: "escrowed",
    meta: {
      totalPaidAmount: totalPaid,
      inviteOnly: b.inviteOnly ?? false,
      isPayToSubmit: b.isPayToSubmit ?? false,
    },
  };
}

export const immunefi: SourceAdapter = {
  name: "immunefi",
  mode: "live",
  describe: () => ({
    url: PAGE,
    note: "Next.js RSC stream (__next_f) — no public JSON API; paused programs skipped; ?filter=audits shares the same payload",
  }),
  async fetch(_ctx: FetchContext): Promise<BountyDraft[]> {
    try {
      const html = await fetchText(PAGE);
      const seen = new Set<string>();
      const drafts: BountyDraft[] = [];
      for (const row of extractRscObjects(html, "maxBounty")) {
        const found: ImmBounty[] = [];
        collect(row, found);
        for (const b of found) {
          const key = b.slug ?? b.url ?? b.project ?? "";
          if (seen.has(key)) continue;
          seen.add(key);
          const d = toDraft(b);
          if (d) drafts.push(d);
        }
      }
      return drafts;
    } catch (e) {
      console.error(`[immunefi] fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  },
};
