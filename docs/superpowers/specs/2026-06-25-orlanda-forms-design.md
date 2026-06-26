# Orlanda Forms — Design (2026-06-25)

AI-mapping form builder for Monday.com. Internal staff build forms; external
clients fill a public link (no login); answers are written into a Monday board
either by direct column mapping or by an Anthropic AI agent.

The authoritative requirements live in `orlanda-forms-claude-code-prompt.md`
(§1–§22; Part B §11–§22 supersedes §1–§10). This document records the
**architecture, the decisions taken on top of the spec, and the build plan**.

## Decisions taken (resolving spec-open items + infra reality)

The live Orlanda cluster (see `server_info/`) differs from the spec's deployment
sketch. Decisions confirmed with the user:

1. **Deployment artifacts — both local + cluster kit.** Ship a self-contained
   `docker-compose.yml` (app + postgres) for local dev/portability *as the spec
   demands*, **plus** a production deployment kit tailored to the cluster:
   host-mode compose pointing at the db-router (`127.0.0.1:6432`), a DB-free
   `/healthz` endpoint, **no bundled Postgres** in prod, and a step-by-step
   deploy doc following the Deploy-a-New-App Playbook (Cloudflare Tunnel + Load
   Balancer, **not** nginx/certbot). A generic `nginx.conf` is included for
   non-cluster deploys. We produce artifacts + docs only; we never touch the
   live servers.
2. **Attachment bytes in Postgres (`bytea`).** Files written to local disk do
   **not** replicate across the failover cluster, so a `files_pending`
   submission could lose its bytes on failover. Storing bytes in the DB makes
   them ride streaming replication for free. The 10 MB/file cap (§16.2) keeps
   this safe. The `Attachment` model keeps `storageKey` (nullable) for
   compatibility but `bytes` is the source of truth.
3. **Builders are org-wide-trusted.** Per §16.5 this is an allowed, documented
   decision: any authenticated `builder` may access all forms/submissions;
   `admin` additionally manages users/seed and data-subject deletion.
   Object-level checks still run on every `:id` route (authenticated +
   published/ownership-agnostic), returning `404` on unauthorized access to
   avoid enumeration. The rationale: all builders are internal Orlanda staff.
4. **No CAPTCHA.** Public-submit abuse is controlled by per-IP, global, and
   per-form-daily rate limits plus the Anthropic spend/size guards (§16.1).
   Turnstile/hCaptcha are intentionally omitted.

## Architecture

Typed monorepo (npm workspaces):

- `/shared` — zod schemas + TS types: canonical answer shapes (§15.1),
  Monday column-value contracts (§12), the public DTO (§16.6), theme
  validation (§16.8), and API request/response contracts. Imported by **both**
  client and server so validation never drifts. This is the keystone that lets
  parallel agents build without colliding.
- `/server` — Express + Prisma + `@anthropic-ai/sdk`, plus an in-process
  Postgres-polling worker for the submission state machine.
- `/client` — React 18 + Vite + TS, Tailwind, React Router, React Query,
  Zustand, dnd-kit.
- `/prisma` — schema, migrations, seed (one admin).
- `/server/fixtures` — §19 fixtures (synthetic but realistic; flagged to be
  replaced with one real Monday board capture before live Phase 4/5).

## Key flows

- **Submission (§14)** — submit handler checks rate limits + spend/size guards,
  persists `Submission(received)` + `Attachment` rows + bytes in one
  transaction, returns a generic success. An in-process worker drives the
  resumable state machine off the request path (§18.6): build column_values
  (Direct §12 / AI §18) → guarded `create_item` (assert `mondayItemId IS NULL`)
  → persist id → upload files via `add_file_to_column` keyed off
  `uploadedToMonday` → finalize `mapped`/`partial`/`failed`. Retry re-enters the
  same machine. No Redis — the app runs single-instance (role agent), so a DB
  poller is sufficient and crash-safe (state in Postgres).
- **AI engine (§18)** — `@anthropic-ai/sdk`, `claude-sonnet-4-6`, **forced
  tool-use** (`emit_mapping`, strict input schema, `tool_choice`) — no
  fence-stripping. One repair retry then `failed`. Writable-column allowlist
  only; prompt caching on the stable prefix; `temperature: 0`; mechanical
  partial-success validation against §12 shapes + allowed labels.
- **Monday (§6/§12)** — GraphQL with `API-Version: 2024-10`; inspect
  `data`/`errors` on every HTTP 200; one formatter per column type dispatched on
  the **stored** `columnType`; files via the two-step assets flow after the item
  exists; single-flight `BoardSchemaCache`.

## Testing (§19/§22)

Unit tests run with **no network** against committed fixtures: Direct formatter
→ `expected-column-values.json`; AI parser/validator → `ai-mapping-response.json`
(incl. a dropped invalid columnId); answer validation §15. Fixtures are
synthetic-but-realistic and flagged for replacement with a real board capture.

## GATED work

Live `create_item`/file upload and the live Anthropic call need the user's
`MONDAY_API_TOKEN` + real board and `ANTHROPIC_API_KEY`. Code is complete and
unit-tested against fixtures; live integration is verified by the user on deploy.

## Parallel-agent build plan

- **Wave 0 (sequential, foundation):** scaffold, Prisma schema + migration +
  seed, `/shared`, env/config fail-fast (§16.3), Express base + security headers
  /CSP (§16.7) + structured logging + error hook, client base, fixtures.
- **Wave 1 (parallel):** Monday module + formatter + tests · AI engine + tests ·
  Auth (JWT cookie, login rate-limit, org-wide guard).
- **Wave 2 (parallel):** Forms/submissions/preview API + slug/publish rules ·
  Submission worker + abuse controls + retention purge · Public form frontend ·
  Builder frontend.
- **Wave 3 (sequential):** deployment kit + README + final wiring; typecheck /
  build / tests green.

Agents parallelize safely because they build against the frozen `/shared`
contracts and touch disjoint folders.
