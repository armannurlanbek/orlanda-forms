// Safe defaults so any test that transitively imports config/env.ts does not
// fail the fail-fast boot check (§16.3). Pure-logic tests don't need these.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-1234567890';
process.env.ANTHROPIC_API_KEY ??= 'test-anthropic-key';
process.env.MONDAY_API_TOKEN ??= 'test-monday-token';
process.env.APP_URL ??= 'http://localhost:5173';
