// Sherlock audit-contest adapter — public JSON API, the cleanest contest source.
//
// Verified 2026-11-18:
//   GET https://audits.sherlock.xyz/api/contests?status=<S>&page=<N>
//     -> { page, next_page, items[], total, has_next, pages }
//   Items: { id, title, prize_pool, rewards, token, starts_at, ends_at,
//            status, type_label, private, short_description,
//            judging_prize_pool, judging_progress, is_judging_v3,
//            is_best_efforts, escalation_started_at, escalation_ends_at, ... }
//
// Quirks:
//  - The unfiltered list is ordered by prize size, not recency — a live
//    contest can sit on any page. The API accepts a server-side `status`
//    filter, so we query each live status separately (one cheap page each).
//  - Valid status values (from the site's own tab mapping): RUNNING (active),
//    CREATED (upcoming), JUDGING, ESCALATING, SHERLOCK_JUDGING, FINISHED.
//    Other strings (UPCOMING, ACTIVE, JUDGED, ...) return a 4xx error body.
//  - We include every non-FINISHED status: judging/escalating contests still
//    hold an escrowed pot that is being paid out.
//  - `rewards` is the headline pot (>= prize_pool; it is NOT
//    prize_pool + judging_prize_pool — verified against live rows).
//  - Contest page: https://audits.sherlock.xyz/contests/<id> (verified 200).

import type { BountyDraft, FetchContext, SourceAdapter } from "../types.js";
import { fetchJson } from "./http.js";

const API = "https://audits.sherlock.xyz/api/contests";
const PAGE_URL = "https://audits.sherlock.xyz/contests";

// Live states per the site's own tab mapping. FINISHED is the only
// terminal-ish public status; anything else still has money in escrow.
const LIVE_STATUSES = ["RUNNING", "CREATED", "JUDGING", "SHERLOCK_JUDGING", "ESCALATING"] as const;
const MAX_PAGES_PER_STATUS = 3;

interface SherlockContest {
  id: number;
  title: string;
  prize_pool: number | null;
  rewards: number | null;
  token: string | null;
  starts_at: number | null;
  ends_at: number | null;
  status: string;
  type_label: string | null;
  private: boolean;
  judging_prize_pool: number | null;
}

interface SherlockPage {
  page: number;
  next_page: number | null;
  items: SherlockContest[];
}

function isoFromEpoch(sec: number | null): string | null {
  if (!sec || !Number.isFinite(sec)) return null;
  return new Date(sec * 1000).toISOString();
}

function toDraft(c: SherlockContest): BountyDraft {
  const amount = c.rewards ?? c.prize_pool ?? null;
  const notes = [`status:${c.status}`];
  if ((c.judging_prize_pool ?? 0) > 0) notes.push(`judging prize pool: $${c.judging_prize_pool}`);
  return {
    repo: c.title,
    number: c.id,
    title: `${c.title} — Sherlock ${c.type_label || "audit"}`,
    url: `${PAGE_URL}/${c.id}`,
    createdAt: isoFromEpoch(c.starts_at),
    comments: 0,
    labels: c.type_label ? [c.type_label] : [],
    amountUsd: amount,
    maxReward: amount,
    source: "sherlock",
    escrowed: true,
    deadline: isoFromEpoch(c.ends_at),
    severity: null,
    language: null,
    signals: { sourceNotes: notes },
    fundingHint: "escrowed",
  };
}

export const sherlock: SourceAdapter = {
  name: "sherlock",
  mode: "live",
  describe: () => ({
    url: API,
    note: "public contest API; one status-filtered page per live status (RUNNING/CREATED/JUDGING/SHERLOCK_JUDGING/ESCALATING)",
  }),
  async fetch(_ctx: FetchContext): Promise<BountyDraft[]> {
    const drafts: BountyDraft[] = [];
    const seen = new Set<number>();
    try {
      for (const status of LIVE_STATUSES) {
        try {
          let page: number | null = 1;
          let fetched = 0;
          while (page !== null && fetched < MAX_PAGES_PER_STATUS) {
            const data = (await fetchJson(`${API}?status=${status}&page=${page}`)) as SherlockPage;
            for (const c of data.items ?? []) {
              if (c.private) continue;
              if (c.status === "FINISHED") continue;
              if (seen.has(c.id)) continue;
              seen.add(c.id);
              drafts.push(toDraft(c));
            }
            page = data.next_page;
            fetched++;
          }
        } catch (e) {
          // One dead status query shouldn't zero the others.
          console.error(`[sherlock] status=${status}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return drafts;
    } catch (e) {
      console.error(`[sherlock] ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  },
};
