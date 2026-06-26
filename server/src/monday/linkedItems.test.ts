import { describe, it, expect } from 'vitest';
import { similarity, pickBestMatch, rankCandidates } from './linkedItems';

describe('similarity', () => {
  it('is 1 for exact (normalized) matches', () => {
    expect(similarity('Acme HQ', 'acme   hq')).toBe(1);
  });
  it('is high for small typos', () => {
    expect(similarity('Acme HQ Renovation', 'Acme HQ Renovaton')).toBeGreaterThan(0.85);
  });
  it('is low for unrelated names', () => {
    expect(similarity('Acme HQ', 'Globex Tower')).toBeLessThan(0.3);
  });
  it('is 0 for empty input', () => {
    expect(similarity('', 'x')).toBe(0);
  });
});

describe('pickBestMatch', () => {
  const cands = [
    { id: '1', name: 'Acme HQ Renovation' },
    { id: '2', name: 'Globex Tower' },
    { id: '3', name: 'Initech Fit-out' },
  ];

  it('returns null when there are no candidates', () => {
    expect(pickBestMatch('Acme', []).itemId).toBeNull();
  });

  it('picks a unique exact match', () => {
    const r = pickBestMatch('globex tower', cands);
    expect(r.itemId).toBe('2');
  });

  it('picks a confident fuzzy match', () => {
    const r = pickBestMatch('Acme HQ Renovaton', cands); // typo
    expect(r.itemId).toBe('1');
    expect(r.score).toBeGreaterThan(0.8);
  });

  it('skips when below threshold', () => {
    const r = pickBestMatch('Wayne Enterprises', cands);
    expect(r.itemId).toBeNull();
    expect(r.reason).toMatch(/no confident match/);
  });

  it('skips on duplicate exact names (ambiguous)', () => {
    const dupes = [
      { id: '10', name: 'Acme' },
      { id: '11', name: 'Acme' },
    ];
    const r = pickBestMatch('acme', dupes);
    expect(r.itemId).toBeNull();
    expect(r.reason).toMatch(/ambiguous/);
  });

  it('ranks candidates highest-first', () => {
    const ranked = rankCandidates('Acme HQ Renovation', cands);
    expect(ranked[0].id).toBe('1');
  });
});
