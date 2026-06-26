// Resolve a human-entered name (e.g. a project name) to an item on another
// Monday board, so a board-relation/connect column can be linked and any mirror
// that reflects it auto-populates. Used by BOTH the Direct resolver (orchestrator)
// and the AI search tool, so matching behaves identically.

import { mondayGraphQL } from './client';

export interface Candidate {
  id: string;
  name: string;
}

export interface ScoredCandidate extends Candidate {
  score: number;
}

export interface LinkResolution {
  itemId: string | null;
  reason: string;
  matchName?: string;
  score?: number;
}

export const DEFAULT_THRESHOLD = 0.6;
// Minimum gap between the best and runner-up to accept a single confident match.
const AMBIGUITY_MARGIN = 0.08;
const MAX_SCAN_ITEMS = 1000;
const PAGE_SIZE = 100;

export function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Dice coefficient over character bigrams (0..1). Exact (normalized) == 1. */
export function similarity(a: string, b: string): number {
  const A = normalizeName(a);
  const B = normalizeName(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.length < 2 || B.length < 2) return A === B ? 1 : 0;

  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };

  const ba = bigrams(A);
  const bb = bigrams(B);
  let intersection = 0;
  let total = 0;
  for (const [g, c] of ba) {
    total += c;
    const other = bb.get(g);
    if (other) intersection += Math.min(c, other);
  }
  for (const [, c] of bb) total += c;
  return total === 0 ? 0 : (2 * intersection) / total;
}

interface ItemsPageData {
  boards: { items_page: { cursor: string | null; items: Candidate[] } }[];
}

const SCAN_QUERY = `
  query ($boardId: [ID!], $cursor: String, $limit: Int!) {
    boards(ids: $boardId) {
      items_page(limit: $limit, cursor: $cursor) {
        cursor
        items { id name }
      }
    }
  }`;

/**
 * Fetch items (id + name) from a board, paging up to MAX_SCAN_ITEMS. Reliable
 * across API versions (no dependence on name query_params). For very large
 * boards consider narrowing later; project/client boards are well within cap.
 */
export async function searchBoardItemsByName(boardId: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  let cursor: string | null = null;
  do {
    const data: ItemsPageData = await mondayGraphQL<ItemsPageData>(SCAN_QUERY, {
      boardId: [boardId],
      cursor,
      limit: PAGE_SIZE,
    });
    const page = data.boards?.[0]?.items_page;
    if (!page) break;
    for (const it of page.items) out.push({ id: String(it.id), name: it.name });
    cursor = page.cursor;
  } while (cursor && out.length < MAX_SCAN_ITEMS);
  return out;
}

/** Rank candidates against a query name (highest similarity first). */
export function rankCandidates(name: string, candidates: Candidate[]): ScoredCandidate[] {
  return candidates
    .map((c) => ({ ...c, score: similarity(name, c.name) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Decide the single best linked item for `name`, or null when unsure. Pure given
 * the candidate list — unit-testable without network. Skips (returns null) on no
 * match, below-threshold, or an ambiguous tie (per the feature's safety policy).
 */
export function pickBestMatch(
  name: string,
  candidates: Candidate[],
  threshold = DEFAULT_THRESHOLD,
): LinkResolution {
  if (candidates.length === 0) return { itemId: null, reason: 'linked board has no items' };
  const ranked = rankCandidates(name, candidates);

  // Prefer a unique exact (normalized) match.
  const exacts = ranked.filter((c) => c.score === 1);
  if (exacts.length === 1) return { itemId: exacts[0].id, reason: 'exact match', matchName: exacts[0].name, score: 1 };
  if (exacts.length > 1) return { itemId: null, reason: `ambiguous: ${exacts.length} items named the same` };

  const best = ranked[0];
  const second = ranked[1];
  if (best.score < threshold) {
    return { itemId: null, reason: `no confident match (best ${best.score.toFixed(2)} < ${threshold})` };
  }
  if (second && best.score - second.score < AMBIGUITY_MARGIN) {
    return { itemId: null, reason: `ambiguous: "${best.name}" vs "${second.name}"` };
  }
  return { itemId: best.id, reason: 'fuzzy match', matchName: best.name, score: best.score };
}

/** Live resolution: fetch the board's items then pick the best match. */
export async function resolveLinkedItem(
  boardId: string,
  name: string,
  opts: { threshold?: number } = {},
): Promise<LinkResolution> {
  const query = (name ?? '').trim();
  if (!query) return { itemId: null, reason: 'empty name' };
  const candidates = await searchBoardItemsByName(boardId);
  return pickBestMatch(query, candidates, opts.threshold ?? DEFAULT_THRESHOLD);
}
