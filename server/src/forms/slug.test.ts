import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Prisma before importing the module under test so generateUniqueSlug's
// findMany hits our in-memory slug set rather than a real DB.
const slugStore = new Set<string>();

vi.mock('../db/prisma', () => ({
  prisma: {
    form: {
      findMany: async ({ where }: { where: { OR: { slug?: string; slug_startsWith?: string }[] } }) => {
        // Emulate { OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }] }.
        const conds = (where as unknown as {
          OR: { slug?: string | { startsWith: string } }[];
        }).OR;
        const matches: { slug: string }[] = [];
        for (const slug of slugStore) {
          const hit = conds.some((c) => {
            if (typeof c.slug === 'string') return slug === c.slug;
            if (c.slug && typeof c.slug === 'object') return slug.startsWith(c.slug.startsWith);
            return false;
          });
          if (hit) matches.push({ slug });
        }
        return matches;
      },
    },
  },
}));

import { generateUniqueSlug, isReserved, nextCandidate, slugify } from './slug';

beforeEach(() => {
  slugStore.clear();
});

describe('slugify', () => {
  it('lowercases and kebab-cases', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('collapses repeated separators and trims hyphens', () => {
    expect(slugify('  Foo   &&  Bar!! ')).toBe('foo-bar');
    expect(slugify('--Lead--')).toBe('lead');
  });

  it('ASCII-folds accented characters', () => {
    expect(slugify('Café Über Señor')).toBe('cafe-uber-senor');
  });

  it('returns empty string when nothing is slug-able', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('   ')).toBe('');
  });

  it('keeps numbers', () => {
    expect(slugify('Q4 2026 Survey')).toBe('q4-2026-survey');
  });
});

describe('nextCandidate', () => {
  it('returns the bare base for n<=1', () => {
    expect(nextCandidate('survey', 1)).toBe('survey');
    expect(nextCandidate('survey', 0)).toBe('survey');
  });

  it('appends -n for n>=2', () => {
    expect(nextCandidate('survey', 2)).toBe('survey-2');
    expect(nextCandidate('survey', 3)).toBe('survey-3');
  });
});

describe('isReserved', () => {
  it('flags reserved top-level paths', () => {
    expect(isReserved('api')).toBe(true);
    expect(isReserved('admin')).toBe(true);
    expect(isReserved('public')).toBe(true);
  });

  it('passes ordinary slugs', () => {
    expect(isReserved('survey')).toBe(false);
    expect(isReserved('my-form')).toBe(false);
  });
});

describe('generateUniqueSlug', () => {
  it('uses the bare base when free', async () => {
    expect(await generateUniqueSlug('Customer Feedback')).toBe('customer-feedback');
  });

  it('falls back to "form" for an empty title', async () => {
    expect(await generateUniqueSlug('!!!')).toBe('form');
  });

  it('appends -2, -3 on collision', async () => {
    slugStore.add('survey');
    expect(await generateUniqueSlug('Survey')).toBe('survey-2');
    slugStore.add('survey-2');
    expect(await generateUniqueSlug('Survey')).toBe('survey-3');
  });

  it('skips reserved candidates', async () => {
    // "api" is reserved, so the base must be suffixed.
    expect(await generateUniqueSlug('API')).toBe('api-2');
  });
});
