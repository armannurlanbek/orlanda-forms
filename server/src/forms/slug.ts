// Slug generation (§15.3.1/2). Auto-derives a kebab-case slug from the form
// title, blocks the reserved-path set, and generates a globally-unique slug by
// looping on the DB unique constraint (NOT pre-check-then-insert, which races).

import { RESERVED_SLUGS } from '@orlanda/shared';
import { prisma } from '../db/prisma';

/**
 * Convert a title to a kebab-case slug (§15.3.1): lowercase, ASCII-fold,
 * non-alphanumerics → `-`, collapse repeats, trim hyphens. Returns '' when the
 * title has no slug-able characters (the caller substitutes a fallback base).
 */
export function slugify(title: string): string {
  return (title ?? '')
    .normalize('NFKD') // decompose accents so the next step can strip them
    .replace(/[̀-ͯ]/g, '') // drop combining diacritics (ASCII-fold)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumerics → hyphen
    .replace(/-+/g, '-') // collapse repeats
    .replace(/^-+|-+$/g, ''); // trim leading/trailing hyphens
}

/**
 * Pure candidate helper (testable): the 1st candidate is the bare base, the
 * 2nd is `base-2`, the 3rd `base-3`, etc.
 */
export function nextCandidate(base: string, n: number): string {
  return n <= 1 ? base : `${base}-${n}`;
}

/** True if a slug collides with a reserved top-level path (§15.3.2). */
export function isReserved(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug);
}

const RESERVED_SET = new Set<string>(RESERVED_SLUGS as readonly string[]);

/**
 * Find a slug not currently used by any Form and not reserved. This is a
 * best-effort pre-filter; the authoritative uniqueness guard is the DB unique
 * constraint enforced at insert time (the create loop retries on conflict).
 */
export async function generateUniqueSlug(title: string): Promise<string> {
  const base = slugify(title) || 'form';

  // Pull the slugs that share this base so we can pick the first free suffix in
  // one query rather than N round-trips. Still only a hint — see create loop.
  const existing = await prisma.form.findMany({
    where: { OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }] },
    select: { slug: true },
  });
  const taken = new Set(existing.map((f) => f.slug));

  for (let n = 1; ; n++) {
    const candidate = nextCandidate(base, n);
    if (!taken.has(candidate) && !RESERVED_SET.has(candidate)) return candidate;
  }
}
