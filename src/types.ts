// Shared types for the multi-source bounty pipeline.
// Bounty v2: same fields as v1 plus source/funding/competition-v2/extension
// fields. New fields are additive — existing consumers keep working.

export type Trust = "likely_real" | "suspect_scam";
export type CompetitionBand = "low" | "medium" | "high";
export type Funding = "escrowed" | "verified-history" | "claimed" | "unknown";

// Why the competitionScore is what it is — agents can inspect the signals.
export interface CompetitionSignals {
  comments: number;
  linkedPrs: number; // GitHub: PRs cross-referenced on the issue timeline
  reactions: number; // GitHub: reactions.total_count (watcher proxy; subscribers endpoint needs auth)
  ageDays: number | null;
  crossListed: boolean;
  sourceNotes: string[]; // e.g. "immunefi: $727k paid historically"
}

export interface Bounty {
  repo: string;
  number: number | null; // null for program-level (non-issue) listings
  title: string;
  url: string;
  createdAt: string | null; // null when the source doesn't publish a date
  ageDays: number | null;
  comments: number;
  labels: string[];
  amountUsd: number | null;
  maxReward: number | null; // max of a published reward range; null = undisclosed
  competition: CompetitionBand; // v1 bucket, derived from competitionScore
  competitionScore: number; // v2: 0-100
  signals: CompetitionSignals;
  trust: Trust;
  scamReasons: string[];
  source: string; // adapter name: github | immunefi | hackerone | code4rena | sherlock | cantina | bugcrowd | github-extras
  escrowed: boolean;
  funding: Funding;
  deadline: string | null; // ISO, when the source publishes one
  severity: string | null;
  crossListed: boolean; // same underlying program seen on >1 source
  language: string | null;
}

export interface Query {
  language?: string;
  minAmount?: number; // back-compat alias of minReward
  minReward?: number;
  maxAgeDays?: number;
  includeSuspect?: boolean;
  limit?: number;
  source?: string;
  ecosystem?: string;
  maxCompetition?: number; // filters competitionScore <= N
}

// What an adapter returns — normalized draft, enriched centrally afterwards.
export interface BountyDraft {
  repo: string;
  number: number | null;
  title: string;
  url: string;
  createdAt: string | null;
  comments: number;
  labels: string[];
  amountUsd: number | null;
  maxReward: number | null;
  source: string;
  escrowed: boolean;
  deadline: string | null;
  severity: string | null;
  language?: string | null;
  // Source-native signals that feed competition + funding classification.
  signals?: { linkedPrs?: number; reactions?: number; sourceNotes?: string[] };
  fundingHint?: Funding; // adapter's best guess; central enricher may upgrade
  trust?: Trust;
  scamReasons?: string[];
  crossListed?: boolean; // set by the dedupe pass, not by adapters
  meta?: Record<string, unknown>; // e.g. immunefi totalPaidAmount
}

export interface FetchContext {
  ecosystem?: string; // watchlist name, e.g. "x402"
  language?: string; // pushed into source-native filters where supported
}

export interface SourceAdapter {
  name: string;
  // "live" hits a public endpoint; "manual-only" returns a curated list
  // (source has no enumerable public API — documented in the adapter file).
  mode: "live" | "manual-only";
  // Human-readable endpoint/notes for /sources. Never throws.
  describe(): { url: string; note: string };
  // Adapter contract: failure => return [] (and log to stderr), never throw.
  fetch(ctx: FetchContext): Promise<BountyDraft[]>;
}
