// Monday error type + GraphQL-body classifier (§6 / §14.4).
//
// Monday returns HTTP 200 even on GraphQL errors, so success can NEVER be
// inferred from the HTTP status. A response is successful ONLY when the
// `errors` field is absent/empty. The presence of the expected entity id in
// `data` is verified by the caller (the classifier here only judges errors).

/** An error raised against the Monday API. `retryable` drives the §14 state machine. */
export class MondayError extends Error {
  retryable: boolean;
  raw?: unknown;

  constructor(message: string, opts: { retryable?: boolean; raw?: unknown } = {}) {
    super(message);
    this.name = 'MondayError';
    this.retryable = opts.retryable ?? false;
    this.raw = opts.raw;
  }
}

/**
 * Substrings that mark a transient/retryable Monday failure (§14.4.1):
 * complexity-budget exhaustion, rate limiting, and 5xx-shaped/transient errors.
 * Matched case-insensitively against the error message and error code.
 */
const RETRYABLE_PATTERNS = [
  'complexityexception',
  'complexity budget',
  'complexity',
  'rate limit',
  'ratelimit',
  'rate-limit',
  'too many requests',
  'maximum number of requests',
  'minute limit',
  'daily limit',
  'temporarily unavailable',
  'service unavailable',
  'internal server error',
  'timeout',
  'timed out',
  'gateway',
  'try again',
];

function textLooksRetryable(text: string): boolean {
  const low = text.toLowerCase();
  return RETRYABLE_PATTERNS.some((p) => low.includes(p));
}

/** Pull a printable message + any status/code hints out of one GraphQL error entry. */
function describeError(err: unknown): { message: string; retryable: boolean } {
  if (typeof err === 'string') {
    return { message: err, retryable: textLooksRetryable(err) };
  }
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const message = typeof o.message === 'string' ? o.message : JSON.stringify(o);
    // Monday sometimes carries the kind under extensions.code / error_code / status_code.
    const ext = (o.extensions && typeof o.extensions === 'object' ? (o.extensions as Record<string, unknown>) : {}) as Record<string, unknown>;
    const code = String(ext.code ?? o.error_code ?? o.code ?? '');
    const statusCode = Number(ext.status_code ?? o.status_code ?? 0);
    const retryable =
      textLooksRetryable(message) ||
      textLooksRetryable(code) ||
      (Number.isFinite(statusCode) && statusCode >= 500);
    return { message, retryable };
  }
  return { message: 'Unknown Monday error', retryable: false };
}

function normalizeErrors(errors: unknown): unknown[] {
  if (errors === undefined || errors === null) return [];
  if (Array.isArray(errors)) return errors.filter((e) => e !== null && e !== undefined);
  // A non-array truthy value (e.g. a bare error_message string) still counts.
  return [errors];
}

/**
 * Classify a parsed Monday GraphQL response body (§14.4).
 *
 * Returns `{ ok: true }` only when `errors` is absent/empty. When errors are
 * present, returns `{ ok: false, error }` with `error.retryable` set per §14.4
 * (retryable = complexity/rate-limit/5xx-shaped/transient; terminal otherwise).
 * The caller is responsible for the additional §14.4.3 check that `data`
 * contains the expected entity id before treating an `ok:true` body as success.
 */
export function classifyMondayBody(body: {
  data?: unknown;
  errors?: unknown;
  // Monday also surfaces a top-level error_message / error_code on some failures.
  error_message?: unknown;
  error_code?: unknown;
  status_code?: unknown;
}): { ok: boolean; error?: MondayError } {
  const errorList = normalizeErrors(body?.errors);

  // Top-level error_message (non-GraphQL transport/auth failures) also fails.
  const topMessage = typeof body?.error_message === 'string' ? body.error_message : '';
  const topCode = body?.error_code !== undefined ? String(body.error_code) : '';
  const topStatus = Number(body?.status_code ?? 0);

  if (errorList.length === 0 && !topMessage && !topCode) {
    return { ok: true };
  }

  const described = errorList.map(describeError);
  if (topMessage || topCode) {
    described.push({
      message: topMessage || `Monday error (code ${topCode})`,
      retryable:
        textLooksRetryable(topMessage) ||
        textLooksRetryable(topCode) ||
        (Number.isFinite(topStatus) && topStatus >= 500),
    });
  }

  const retryable = described.some((d) => d.retryable);
  const message = described.map((d) => d.message).join('; ') || 'Monday request failed';

  return {
    ok: false,
    error: new MondayError(message, { retryable, raw: body }),
  };
}
