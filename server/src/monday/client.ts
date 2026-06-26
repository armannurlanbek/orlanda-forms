// Low-level Monday GraphQL client (§6). POSTs to the v2 endpoint with the token
// from server env (NEVER logged, NEVER sent to the client), inspects the
// response body via classifyMondayBody, and throws MondayError on failure.
//
// Monday returns HTTP 200 even on GraphQL errors — success is judged from the
// body, never the HTTP status.

import { env } from '../config/env';
import { logger } from '../config/logger';
import { MondayError, classifyMondayBody } from './errors';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const API_VERSION = '2024-10';
const DEFAULT_TIMEOUT_MS = 30_000;

interface MondayResponseBody {
  data?: unknown;
  errors?: unknown;
  error_message?: unknown;
  error_code?: unknown;
  status_code?: unknown;
}

/**
 * Execute a Monday GraphQL query/mutation and return the typed `data` payload.
 *
 * - Sends `Authorization`, `API-Version: 2024-10`, `Content-Type: application/json`.
 * - `variables` are sent as the standard GraphQL variables object; pass
 *   `column_values` already JSON.stringify()'d by the caller (§6/§12.4).
 * - Uses an AbortController-backed ~30s timeout.
 * - Throws `MondayError` (retryable) on network/timeout/non-OK transport,
 *   and `MondayError` (classified) when the body carries GraphQL `errors`.
 */
export async function mondayGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        Authorization: env.MONDAY_API_TOKEN,
        'API-Version': API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables: variables ?? {} }),
      signal: controller.signal,
    });
  } catch (err) {
    // Network failure or abort/timeout — transient, retryable. Never log token.
    const aborted = err instanceof Error && err.name === 'AbortError';
    const message = aborted ? `Monday request timed out after ${timeoutMs}ms` : 'Monday network error';
    logger.warn({ msg: message }, 'monday request failed (transport)');
    throw new MondayError(message, { retryable: true, raw: aborted ? 'timeout' : String((err as Error)?.message ?? err) });
  } finally {
    clearTimeout(timer);
  }

  // A 5xx HTTP status is transient even before we read the body.
  let body: MondayResponseBody;
  try {
    body = (await res.json()) as MondayResponseBody;
  } catch {
    if (res.status >= 500) {
      throw new MondayError(`Monday returned HTTP ${res.status}`, { retryable: true });
    }
    throw new MondayError(`Monday returned an unparseable response (HTTP ${res.status})`, {
      retryable: res.status === 429,
    });
  }

  const classification = classifyMondayBody(body);
  if (!classification.ok && classification.error) {
    // 5xx/429 transport-level statuses force retryable even if the body is terse.
    if ((res.status >= 500 || res.status === 429) && !classification.error.retryable) {
      classification.error.retryable = true;
    }
    logger.warn(
      { msg: classification.error.message, httpStatus: res.status, retryable: classification.error.retryable },
      'monday graphql error',
    );
    throw classification.error;
  }

  if (body.data === undefined || body.data === null) {
    // No errors but also no data — treat as transient so a retry can recover.
    throw new MondayError('Monday response contained no data', { retryable: true, raw: body });
  }

  return body.data as T;
}
