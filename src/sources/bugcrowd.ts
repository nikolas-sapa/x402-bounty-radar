// Bugcrowd adapter — public engagements feed.
// Endpoint: GET https://bugcrowd.com/engagements.json (no auth, returns the
// public program directory as JSON). Each engagement is a program-level
// listing: reward range, brief URL, industry, engagement type. There is no
// per-submission data here — just programs, so number/createdAt/comments
// are null/0 by nature of the source.
// Verified live 2026-: all engagements carried accessStatus "open"; we still
// filter defensively since private/invite-only programs appear in the feed.

import type { BountyDraft, FetchContext, SourceAdapter } from "../types.js";
import { fetchJson } from "./http.js";

const ENDPOINT = "https://bugcrowd.com/engagements.json";
const BASE = "https://bugcrowd.com";

interface Engagement {
  name: string;
  briefUrl: string;
  rewardSummary?: {
    minReward?: string | null;
    maxReward?: string | null;
  } | null;
  isDemo?: boolean;
  isBanned?: boolean;
  isPrivate?: boolean;
  industryName?: string | null;
  accessStatus?: string;
  endsAt?: string | null;
  productEngagementType?: { label?: string | null } | null;
}

// "$3,000" -> 3000; "Points"/null/garbage -> null (undisclosed is honest).
function parseReward(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/\$\s?([\d,]+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toDraft(e: Engagement): BountyDraft {
  const name = e.name.trim();
  const typeLabel = e.productEngagementType?.label ?? null;
  const labels = [typeLabel, e.industryName].filter((x): x is string => Boolean(x));
  return {
    repo: name,
    number: null, // program-level listing, not an issue
    title: name,
    url: `${BASE}${e.briefUrl}`,
    createdAt: null, // feed doesn't publish one
    comments: 0,
    labels,
    amountUsd: parseReward(e.rewardSummary?.minReward),
    maxReward: parseReward(e.rewardSummary?.maxReward),
    source: "bugcrowd",
    escrowed: true, // Bugcrowd holds program funds — platform-managed payouts
    deadline: e.endsAt ?? null,
    severity: null,
    language: null,
    signals: { sourceNotes: typeLabel ? [typeLabel] : [] },
    fundingHint: "escrowed",
  };
}

export const bugcrowd: SourceAdapter = {
  name: "bugcrowd",
  mode: "live",
  describe: () => ({
    url: ENDPOINT,
    note: "public engagements directory; only open, non-private, non-demo programs",
  }),
  async fetch(_ctx: FetchContext): Promise<BountyDraft[]> {
    const data = (await fetchJson(ENDPOINT)) as { engagements?: Engagement[] };
    return (data.engagements ?? [])
      .filter(
        (e) =>
          e.isPrivate === false &&
          e.isBanned !== true &&
          e.isDemo !== true &&
          e.accessStatus === "open",
      )
      .map(toDraft);
  },
};
