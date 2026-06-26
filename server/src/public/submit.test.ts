import { describe, it, expect } from 'vitest';
import { isValidIdempotencyKey } from './submit';

// §14.1 — the public submit accepts a client-supplied idempotencyKey. It must be
// a well-formed RFC-4122 UUID; malformed keys are rejected (400) before any DB
// work. This exercises the pure validator that gates that rejection.
describe('isValidIdempotencyKey — UUID gate for the public submit (§14.1)', () => {
  it('accepts a standard v4 UUID', () => {
    expect(isValidIdempotencyKey('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
  });

  it('accepts UUIDs of other RFC-4122 versions (1-5)', () => {
    expect(isValidIdempotencyKey('a8098c1a-f86e-11da-bd1a-00112444be1e')).toBe(true); // v1
    expect(isValidIdempotencyKey('6fa459ea-ee8a-3ca4-894e-db77e160355e')).toBe(true); // v3
    expect(isValidIdempotencyKey('886313e1-3b8a-5372-9b90-0c9aee199e5d')).toBe(true); // v5
  });

  it('is case-insensitive', () => {
    expect(isValidIdempotencyKey('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidIdempotencyKey('')).toBe(false);
  });

  it('rejects non-string inputs', () => {
    expect(isValidIdempotencyKey(undefined)).toBe(false);
    expect(isValidIdempotencyKey(null)).toBe(false);
    expect(isValidIdempotencyKey(42)).toBe(false);
    expect(isValidIdempotencyKey({})).toBe(false);
  });

  it('rejects a non-UUID free-form string', () => {
    expect(isValidIdempotencyKey('not-a-uuid')).toBe(false);
    expect(isValidIdempotencyKey('1234')).toBe(false);
  });

  it('rejects a UUID with the wrong layout (too short / extra chars)', () => {
    expect(isValidIdempotencyKey('3f2504e0-4f89-41d3-9a0c-0305e82c330')).toBe(false); // 11 trailing
    expect(isValidIdempotencyKey('3f2504e0-4f89-41d3-9a0c-0305e82c3301x')).toBe(false);
    expect(isValidIdempotencyKey(' 3f2504e0-4f89-41d3-9a0c-0305e82c3301 ')).toBe(false); // padded
  });

  it('rejects a UUID with an invalid version nibble (0 or 6-9)', () => {
    expect(isValidIdempotencyKey('3f2504e0-4f89-01d3-9a0c-0305e82c3301')).toBe(false); // version 0
    expect(isValidIdempotencyKey('3f2504e0-4f89-71d3-9a0c-0305e82c3301')).toBe(false); // version 7
  });

  it('rejects a UUID with an invalid variant nibble', () => {
    expect(isValidIdempotencyKey('3f2504e0-4f89-41d3-1a0c-0305e82c3301')).toBe(false); // variant 1
  });
});
