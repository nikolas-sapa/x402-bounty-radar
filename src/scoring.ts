// Competition score v2 + funding classification (the product's two moats).
// Score is a single 0-100 number; `signals` explains WHY. Band stays for
// back-compat: <34 low, <67 medium, else high.

import type { Bounty, BountyDraft, CompetitionSignals, CompetitionBand, Funding } from "./types.js";

// Score weights — documented so adapter authors know what they're feeding:
//   comments   -> up to 40 pts (4/pt): hunters talking under the bounty
//   linkedPrs  -> up to 36 pts (12/pr): someone already shipped an attempt
//   reactions  -> up to 8 pts  (2/pt): watchers/subscriber proxy
//   crossListed-> +15: listed on multiple platforms = more hunter reach
//   sourceNotes-> +2 each, max 10: native signals (resolved reports, paid total)
//   freshness  -> +8 if <2 days old: swarm hasn't landed yet but will
export function scoreCompetition(input: {
  comments: number;
  linkedPrs: number;
  reactions: number;
  ageDays: number | null;
  crossListed: boolean;
  sourceNotes: string[];
}): { score: number; band: CompetitionBand; signals: CompetitionSignals } {
  const signals: CompetitionSignals = {
    comments: input.comments,
    linkedPrs: input.linkedPrs,
    reactions: input.reactions,
    ageDays: input.ageDays,
    crossListed: input.crossListed,
    sourceNotes: input.sourceNotes,
  };
  let score =
    Math.min(input.comments * 4, 40) +
    Math.min(input.linkedPrs * 12, 36) +
    Math.min(input.reactions * 2, 8) +
    (input.crossListed ? 15 : 0) +
    Math.min(input.sourceNotes.length * 2, 10);
  if (input.ageDays !== null && input.ageDays < 2) score += 8;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const band: CompetitionBand = score >= 67 ? "high" : score >= 34 ? "medium" : "low";
  return { score, band, signals };
}

// funding: escrowed is strongest (money is actually locked on a platform);
// verified-history = this repo/program has provably paid before;
// claimed = a reward amount is asserted but unverified; unknown = nothing.
export function classifyFunding(draft: BountyDraft, repoHasHistory: boolean): Funding {
  if (draft.escrowed) return "escrowed";
  if (draft.fundingHint === "escrowed") return "escrowed";
  if (repoHasHistory || draft.fundingHint === "verified-history") return "verified-history";
  if (draft.amountUsd !== null || draft.maxReward !== null || draft.fundingHint === "claimed") return "claimed";
  return "unknown";
}

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

export function bountyFromDraft(draft: BountyDraft, repoHasHistory: boolean): Bounty {
  const ageDays = daysSince(draft.createdAt);
  const notes = draft.signals?.sourceNotes ?? [];
  const { score, band, signals } = scoreCompetition({
    comments: draft.comments,
    linkedPrs: draft.signals?.linkedPrs ?? 0,
    reactions: draft.signals?.reactions ?? 0,
    ageDays,
    crossListed: draft.crossListed ?? false,
    sourceNotes: notes,
  });
  return {
    repo: draft.repo,
    number: draft.number,
    title: draft.title,
    url: draft.url,
    createdAt: draft.createdAt,
    ageDays,
    comments: draft.comments,
    labels: draft.labels,
    amountUsd: draft.amountUsd,
    maxReward: draft.maxReward,
    competition: band,
    competitionScore: score,
    signals,
    trust: draft.trust ?? "likely_real",
    scamReasons: draft.scamReasons ?? [],
    source: draft.source,
    escrowed: draft.escrowed,
    funding: classifyFunding(draft, repoHasHistory),
    deadline: draft.deadline,
    severity: draft.severity,
    crossListed: draft.crossListed ?? false,
    language: draft.language ?? null,
  };
}
