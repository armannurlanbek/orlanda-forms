# Orlanda Forms — Security Review

_Phase 5 security workstream. Scope: `server/`, `.env.example`. Date: 2026-06-26._

## (a) Executive summary

Orlanda Forms is a single-instance Node/Express + TypeScript + Prisma service that
publishes public forms, ingests untrusted (often PII-bearing) submissions, and
maps them onto Monday.com board items — optionally via an Anthropic-backed AI
mapping engine. The security posture is strong and defense-in-depth: the public
boundary is a strict DTO whitelist, all abuse/size/file checks run before any
paid third-party call, AI writes are allowlist-only with prompt-injection
guardrails and post-generation validation, secrets fail-fast at boot and are
redacted from logs, and the HTTP surface carries a restrictive CSP plus the usual
hardening headers.

This review implemented six targeted hardening fixes (all **Fixed**, below) and
added 20 unit tests (143 → 163 passing). No high-severity issues were found; the
fixes close low/medium-severity gaps (quota leak on transport failure, untyped
idempotency keys, a theoretical theme-render crash, and a leaked real admin email
in the env template) and make two AI-mapping defenses explicit rather than
heuristic. Two items are intentionally **Deferred** because they only matter for
multi-instance high-availability, which is out of scope for the current
single-instance-by-design deployment.

## (b) What's well-implemented

| Area | Implementation | File(s) |
| --- | --- | --- |
| Password hashing | argon2id (19 MB / t=2), generic verify on error, 12-char min policy | `server/src/auth/password.ts` |
| Session JWT + revocation | HMAC JWT in an `httpOnly`/`secure`/`sameSite` cookie, `jti` denylist checked on every request, logout revokes until natural expiry | `server/src/auth/tokens.ts`, `server/src/auth/middleware.ts` |
| CSRF | Strict Origin/Referer allowlist vs `APP_URL` on all state-changing builder routes; missing Origin/Referer rejected | `server/src/auth/middleware.ts` (`csrfProtect`) |
| Login anti-bruteforce | Per-IP rate limit + per-email consecutive-failure lockout (10 → 15 min), generic "Invalid credentials" regardless of account existence | `server/src/auth/routes.ts`, `server/src/http/rateLimit.ts` |
| Rate limits + per-form caps | Per-IP/min, per-IP/hour, and a global/min circuit breaker on submit; per-form atomic daily cap with speculative-increment + rollback | `server/src/http/rateLimit.ts`, `server/src/public/submit.ts` (`enforceDailyCap`) |
| File upload safety | Extension allowlist + magic-byte content validation (never trusts client `Content-Type`), filename sanitization (basename, strips `..`/NUL/CRLF), count/size/total caps | `server/src/files/validate.ts`, `server/src/public/submit.ts` (`enforceAndValidateFiles`) |
| Prompt-injection defense | Answers framed as untrusted data, explicit guardrail block, byte-stable cached system prefix with no per-request data | `server/src/ai/prompt.ts` (`GUARDRAIL`, `buildStableBlock`, `buildUserContent`) |
| Allowlist-only AI writes | Model emits human values; post-gen validator drops anything off the allowlist and converts survivors to wire shapes; link-column ids only accepted from the per-board search allow-set (no hallucinated ids) | `server/src/ai/validate.ts`, `server/src/ai/engine.ts` (`resolveLinkColumns`) |
| Public DTO whitelist | Public form endpoint emits an explicit render-safe DTO only; unpublished/soft-deleted → 404 (no enumeration) | `server/src/public/routes.ts`, `shared/src/dto.ts` (`PublicFormDTO`) |
| Submission privacy | Async mapping outcome never revealed to the public client; client IP anonymized before storage | `server/src/public/submit.ts` (`handleSubmit`, `anonymizeIp`) |
| Fail-fast env | Server refuses to boot on missing/placeholder/weak secrets (JWT ≥ 32 chars, no `CHANGE_ME`) | `server/src/config/env.ts` |
| Logger redaction | Pino redacts `authorization`, `cookie`, `passwordHash`, `password`; Monday/Anthropic tokens never logged | `server/src/config/logger.ts` |
| Security headers + CSP | `default-src 'self'`, `script-src 'self'` (no inline scripts), `object-src 'none'`, `frame-ancestors 'none'`, nosniff, DENY, no-referrer, Permissions-Policy | `server/src/http/securityHeaders.ts` |
| Spend guards | Pre-call answer/size/board-schema caps; daily AI-call ceiling (atomic reservation); SSRF-safe theme `logoUrl` (app-relative only) | `server/src/ai/engine.ts` (`enforceInputGuards`, `enforceDailyCeiling`), `shared/src/theme.ts` |

## (c) Findings

| # | Severity | Area | File | Status |
| --- | --- | --- | --- | --- |
| 1 | Medium | AI output shape hardening — wire-shaped object/array on a scalar column could reach the formatter (heuristic-only rejection) | `server/src/ai/validate.ts` | **Fixed** |
| 2 | Medium | AI daily ceiling permanently consumed quota when the Anthropic call threw before completing | `server/src/ai/engine.ts` | **Fixed** |
| 3 | Low | Public submit accepted any non-empty idempotency key (no UUID validation) | `server/src/public/submit.ts` | **Fixed** |
| 4 | Low | Public form render could 500 if a stored theme had invalid colors (`normalizeTheme` throws) | `server/src/public/routes.ts` | **Fixed** |
| 5 | Low | Submissions-list form-existence check (consistent 404 for missing/soft-deleted form) | `server/src/forms/service.ts` (`listSubmissions`) / `server/src/forms/routes.ts` | **Fixed** (regression test added) |
| 6 | Low | Real admin email committed in the env template | `.env.example` | **Fixed** |
| D1 | Info | Login lockout + rate limits are in-memory (not shared across instances) | `server/src/auth/routes.ts`, `server/src/http/rateLimit.ts` | **Deferred** |
| D2 | Info | No global daily Monday API spend ceiling (only per-form caps + AI ceiling) | `server/src/monday/service.ts` | **Deferred** |
| D3 | Info | CSP `style-src 'unsafe-inline'` | `server/src/http/securityHeaders.ts` | **Deferred** |

### Fix details

1. **AI output shape hardening** (`server/src/ai/validate.ts`). Replaced the
   heuristic `isLikelyWireShape` (which only caught a few specific keys for a few
   types) with an explicit, total **default-deny** check `isWireShapeForScalar`.
   Any object/array value is rejected for every column type except the genuine
   container types (`dropdown`, `board_relation`, `connect_boards`, `timeline`).
   A hallucinated wire shape — `{"item_ids":[999]}`, `{"label":"x"}`,
   `{"date":"..."}` — on a scalar column (text, long_text, numbers, status, date,
   email, link, phone, checkbox) can no longer slip through to the formatter.
   Tests: object on a text column dropped; `{item_ids}` on a text column dropped;
   array on a numbers column dropped; `{date}` on a date column dropped;
   legitimate scalar values still pass; dropdown arrays still pass.

2. **AI daily ceiling refund on failed call** (`server/src/ai/engine.ts`). The
   concurrency-safe pre-send reservation is kept, but the reservation now refunds
   (decrements the `UsageCounter`) when, and only when, the Anthropic request
   itself throws — in `callAnthropic`'s catch path. The counter key is computed
   once per mapping (`aiCallCounterKey`) and threaded through so the refund
   targets the exact reserved row. No refund happens on a ceiling/guard rejection
   (those reject before any call) or on a successful call that merely returned an
   unusable tool block (that call consumed quota). The refund is best-effort and
   never masks the original failure. Tests: refund on `messages.create` reject;
   no refund when the ceiling is exceeded; no refund when the call succeeds but
   yields no usable tool block.

3. **Idempotency-key validation** (`server/src/public/submit.ts`). Added a pure
   `isValidIdempotencyKey` helper enforcing a well-formed RFC-4122 UUID (any
   version 1–5, correct version/variant nibbles, case-insensitive). `handleSubmit`
   now validates the key (after the existing presence check) **before any DB
   work** — before the per-form cap counter, the unique-index lookup, and any
   insert — rejecting malformed keys with the existing `badRequest(...)` 400.
   Tests: a focused unit suite for the helper (valid v1/v3/v4/v5, case
   insensitivity, and rejection of empty/non-string/wrong-layout/bad-nibble
   inputs).

4. **Theme re-validation at the public boundary** (`server/src/public/routes.ts`).
   The public form DTO already re-runs the shared `normalizeTheme`; it is now
   wrapped so that if the normalizer throws on a malformed stored theme (bad
   legacy row / manual DB edit) the response falls back to `DEFAULT_THEME` rather
   than returning a 500. Only validated colors ever reach the browser.

5. **Form-existence check on submissions list** (`server/src/forms/service.ts`).
   `listSubmissions` already calls `getLiveFormOrThrow(id)` before querying, so a
   missing/soft-deleted form returns a consistent 404 (never 403, no enumeration)
   — matching the established thin-route / service-layer pattern that every other
   forms endpoint uses (the route in `forms/routes.ts` delegates to it). Added a
   regression test that asserts the 404 short-circuits before any submissions
   query runs, locking the behavior in.

6. **Scrub real admin email** (`.env.example`). Replaced `armann@orlanda.info`
   with `admin@example.com` (comments preserved).

## (d) Deferred items

These are intentional, with rationale — they do not affect the security of the
current deployment.

- **D1 — Move login lockout and rate-limit state from in-memory to DB/Redis.**
  The login per-email lockout (`server/src/auth/routes.ts`) and the
  `express-rate-limit` stores (`server/src/http/rateLimit.ts`) are per-process.
  This is correct and sufficient for the current **single-instance-by-design**
  deployment (the role agent guarantees only the primary runs the submit/login
  path). It only becomes a gap under horizontal scale-out, where an attacker
  could spread attempts across instances. Deferred until multi-instance HA is on
  the roadmap.

- **D2 — Add a global daily Monday API spend ceiling.** Spend is currently
  bounded by per-form daily caps, the global submit circuit breaker, and the
  daily AI-call ceiling — all of which gate the paths that call Monday. A single
  org-wide Monday API budget counter would add a backstop, but is most valuable
  once submission volume is sharded across instances (it shares D1's shared-state
  requirement). Deferred with D1.

- **D3 — CSP `style-src 'unsafe-inline'`.** Required because the public form
  applies per-form theme colors as inline CSS custom properties on the form root.
  Scripts are never inline (`script-src 'self'`), so the XSS blast radius is
  limited to style injection, and theme colors are strictly validated server-side
  (`shared/src/theme.ts` — hex/rgb/rgba only) and re-validated at the public
  boundary (fix #4). Removing `'unsafe-inline'` would require a nonce/hash
  strategy for the per-form style block; deferred as low value vs. effort given
  the validated, non-script-bearing inputs.

## (e) Recommended before multi-instance scale-out

1. Move rate-limit and login-lockout state to a shared store (Redis or a DB
   table with atomic upserts), mirroring the existing `UsageCounter` pattern. (D1)
2. Add a shared org-wide daily Monday API spend ceiling alongside the existing
   per-form caps and AI ceiling. (D2)
3. Ensure the AI-call `UsageCounter` and per-form cap counters (already
   DB-backed and atomic) remain the source of truth — they are already
   cluster-safe; the in-memory limiters are the only per-process state to migrate.
4. Consider a CSP nonce/hash for the per-form theme style block to drop
   `style-src 'unsafe-inline'`. (D3)
