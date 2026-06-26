# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Orlanda Forms — a self-hosted, mobile-first form builder for Monday.com. Internal
staff build forms in an authenticated builder; external clients fill a public link
(no login); answers are written into a Monday board either by **direct column
mapping** or by an **Anthropic AI agent** that reads the board schema and decides
where answers go. TypeScript end-to-end, Dockerized, with a resumable submission
pipeline that never loses a submission.

The authoritative build spec is `orlanda-forms-claude-code-prompt.md` (§ references
throughout the code point at it; Part B §11–§22 supersedes §1–§10). The applied
design decisions are in `docs/superpowers/specs/2026-06-25-orlanda-forms-design.md`.

## Commands

This is an **npm workspaces monorepo** (`shared`, `server`, `client`). Run from the
repo root unless noted.

```bash
npm install
npm run build:shared        # MUST run before server/client typecheck or dev — both
                            # import @orlanda/shared from its built dist/
npm run build               # build all: shared → server → client (in order)
npm run typecheck           # tsc --noEmit across all workspaces
npm test                    # vitest run across all workspaces (no network/creds)

npm run dev:server          # tsx watch, API on http://localhost:8001
npm run dev:client          # vite, client on http://localhost:5173 (proxies /api → 8001)

npm run prisma:generate     # regenerate client after schema.prisma changes
npm run prisma:migrate      # prisma migrate dev (local schema changes)
npm run prisma:deploy       # prisma migrate deploy (prod / container entrypoint)
npm run seed:dev            # create the admin user (tsx server/src/seed.ts)
```

Run a **single test** by passing a path/pattern through to vitest for one workspace:

```bash
npm run test --workspace server -- src/monday/formatter.test.ts
npm run test --workspace server -- -t "picks a confident fuzzy match"
```

(`vitest run <path> --root server` from the repo root does **not** resolve correctly;
use the `--workspace` form above, or run vitest from inside the workspace directory.)

Docker (self-contained app + Postgres): `docker compose up -d --build`, then
`docker compose exec app npm run seed`. Migrations run automatically in the
container entrypoint before traffic is accepted.

## Architecture

### `/shared` is the contract — build it first
`shared/src` holds the zod schemas and TS types imported by **both** client and
server. This is deliberate: the public form's client-side validation and the
server's authoritative validation come from the same code and can never diverge
(e.g. `validateAnswers` in `shared/src/answers.ts`). Because server/client resolve
`@orlanda/shared` from its compiled `dist/`, you must `npm run build:shared` after
editing it before downstream typecheck/dev will see the change. Some shapes are
marked FROZEN in comments (other code depends on them) — extend, don't reshape.

### One mapping orchestrator, two callers
`server/src/mapping/orchestrator.ts` (`buildMapping`) is the single branch point
between Direct mode (§12) and AI mode (§18). It is called by **both** the submission
worker (which then writes to Monday) **and** the builder's preview-mapping endpoint
(which does not). Keeping it shared means the preview a builder sees can never
diverge from what the real submission writes. `mapping/inputs.ts` translates the
persisted `Form` + `Question` rows into the orchestrator's inputs identically for
both callers.

### Submissions are a resumable state machine
The public submit endpoint (`server/src/public/`) only **persists** the submission
row + all attachment bytes and returns a generic success — it never calls Monday on
the request path. An in-process worker (`server/src/worker/index.ts`) drives the
state machine in `server/src/submissions/pipeline.ts`:

```
received → item_created → files_pending → mapped | partial | failed
```

State lives entirely in Postgres, so a crash/restart/retry resumes at the exact
failed step. Two hard rules in the pipeline:
- **No Postgres transaction ever wraps a Monday HTTP call.** Each external effect
  (`mondayItemId`, each `Attachment.uploadedToMonday`) is recorded in its own small
  write the instant it succeeds.
- **`create_item` is guarded**: the item id is persisted in the very next statement
  after creation, so a crash can never orphan a Monday item behind a NULL id. On
  re-entry, `create_item` is skipped when `mondayItemId` is set and only
  not-yet-uploaded attachments are retried.

The worker is a single-instance Postgres **polling** loop (no Redis) — the deploy's
role agent ensures only the primary runs the app. It claims work via `lockedAt`
with stale-lock reclaim, and runs scheduled jobs hourly (submission retention
purge, token denylist sweep, releasing attachment bytes for long-mapped submissions
since the files now live on Monday).

### AI mapping (`server/src/ai/`)
Backend-only (the Anthropic key never reaches the client and is never logged).
Forced tool-use (`emit_mapping`), prompt caching via `cache_control: ephemeral` on a
byte-stable system prefix (`prompt.ts`), `temperature: 0`. Spend/size guards and a
daily-call ceiling (`UsageCounter`) run **before** any call. The model returns human
values; `ai/validate.ts` (pure, FROZEN) deterministically converts them to Monday
wire shapes and **drops anything not on the builder's allow-list or that fails
validation** — client answers are untrusted data, never instructions.

Link columns (`board_relation`/`connect_boards`, which feed Monday's read-only
mirror columns) extend this: a bounded multi-turn loop with a second tool
`search_linked_board`. The model searches a linked board by name; we return ranked
candidates and remember their ids in a per-board **allow-set**, then accept only ids
we actually returned — a hallucinated id can never be written.

### Monday integration (`server/src/monday/`)
Direct GraphQL to `api.monday.com/v2` (`API-Version: 2024-10`), token server-side
only. `formatter.ts` converts human values to per-type wire shapes; `direct.ts`
builds Direct-mode `column_values` (pure, no network) and emits `pendingLinks` for
async name→item-id resolution; `linkedItems.ts` resolves a name to a linked item via
Dice-coefficient fuzzy matching (threshold 0.6, **skip-and-mark-partial** on no/
ambiguous match — never silently links the wrong item). Board schemas are cached
(`BoardSchemaCache`) and invalidated when a terminal "column not found" error
suggests the board changed.

### Persistence notes
- **Attachment (and logo) bytes live in Postgres `bytea`**, not on disk, so they
  replicate across the failover cluster. A 10 MB/file cap keeps this safe.
- Builders are **org-wide-trusted** (no per-form ownership scoping); object-level
  checks live in code and return **404 (not 403)** for unauthorized access to avoid
  enumeration.

### Client (`client/src/`)
`App.tsx` holds FROZEN top-level routing: `/app/*` is the authenticated builder,
`/:slug` is the public form. The builder lives in `client/src/builder/` (Zustand
store, dnd-kit canvas, Direct/AI mapping panels). The public form is in
`client/src/public/` and returns/consumes a **render-safe DTO only** — board id,
mapping mode, AI prompt, AI reasoning, and internal status are never sent to the
public client. React Query for data, TailwindCSS for styling. No
`dangerouslySetInnerHTML`; all client-supplied text rendered as text.

### Server wiring
`server/src/app.ts` builds the Express app (security headers, CORS, health checks,
SPA static serving); `routes/index.ts` mounts one sub-router per module
(`auth`, `forms`, `monday`, `uploads`, `submissions`, `public`) — each router is
owned by its module so changes don't collide here. `config/env.ts` validates the
environment with zod and **refuses to boot** on missing/placeholder/weak secrets
(`JWT_SECRET` ≥ 32 chars).

## Conventions

- Module CommonJS/ESM: `shared` and `server` are CommonJS; `client` is ESM.
- Code comments reference spec sections (`§12`, `§18.7`, …) pointing at
  `orlanda-forms-claude-code-prompt.md`. Preserve these when editing.
- `server/fixtures/` is **synthetic** Monday data for offline unit tests. Before
  trusting live mapping, replace it with a real board capture (see
  `server/fixtures/README.md`). All committed tests run with no network or creds.
